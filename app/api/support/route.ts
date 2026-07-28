import { NextRequest, NextResponse } from "next/server";
import type { SupportStatus } from "../../../types/support";
import { createAuditedAdminClient, getOptionalAuditActor, safeAuditError, writeAuditEvent } from "../../lib/audit-server";
import {
    clearSupportTelegramKeyboard,
    recordSupportStatus,
    setSupportTelegramKeyboard,
    sendSupportTelegramMessage,
    supportAdmin,
} from "../../lib/support-server";
import {
    COACH_CLOSED_CONVERSATION_MESSAGE,
    REOPENED_CONVERSATION_MESSAGE,
    coachReplyCloseKeyboard,
    formatCoachReply,
    formatSystemMessage,
    reopenConversationKeyboard,
} from "../../lib/telegram-support-flow";
import {
    COACH_FOLLOW_UP_REOPENED_MESSAGE,
    canCloseAfterCoachReply,
    isSubstantiveCoachReply,
} from "../../lib/support-conversation-policy";
import {
    buildPublicSupportMessage,
    buildPublicSupportMessages,
} from "../../lib/support-message-replies";
import {
    deleteSupportForumTopicBeforeConversation,
    mirrorSupportForumAutomatedMessage,
    mirrorSupportForumCoachReply,
    syncSupportForumState,
} from "../../lib/support-forum-server";

const validStatuses: SupportStatus[] = [
    "ai_active",
    "waiting_parent",
    "escalated",
    "human_active",
    "resolved",
    "closed_parent",
];

const asError = (error: unknown) => error instanceof Error ? error.message : "Unexpected support error.";

function supportContactLabel(contact: any) {
    const fullName = [contact?.first_name, contact?.last_name]
        .filter(Boolean)
        .join(" ")
        .trim();
    if (fullName) return fullName;
    if (contact?.username) return `@${contact.username}`;
    return "Parent";
}

export async function GET(request: NextRequest) {
    const actor = await getOptionalAuditActor(request);
    if (!actor || actor.role !== "superuser") {
        await writeAuditEvent({
            request,
            actor,
            eventKind: "security",
            category: "support",
            eventType: "support.access.denied",
            action: "view_support",
            outcome: "denied",
            summary: actor
                ? "A signed-in user without permission attempted to view parent support data."
                : "An unauthenticated request attempted to view parent support data.",
            actorSource: actor ? "support_api" : "anonymous",
            metadata: { reason: actor ? "insufficient_role" : "authentication_required" },
        });
        return NextResponse.json(
            { error: actor ? "Superuser access required." : "Authentication required." },
            { status: actor ? 403 : 401 },
        );
    }
    const auditedAdmin = createAuditedAdminClient(request, actor, "support_api");

    try {
        const view = request.nextUrl.searchParams.get("view");
        if (view === "count") {
            const { count, error } = await auditedAdmin
                .from("support_conversations")
                .select("id", { count: "exact", head: true })
                .eq("status", "escalated");
            if (error) throw error;
            return NextResponse.json({ escalated: count || 0 });
        }

        const conversationId = request.nextUrl.searchParams.get("conversation_id");
        if (conversationId) {
            const { error: readError } = await auditedAdmin
                .from("support_conversations")
                .update({ unread_count: 0 })
                .eq("id", conversationId)
                .gt("unread_count", 0);
            if (readError) throw readError;

            const { data: conversation, error: conversationError } = await auditedAdmin
                .from("support_conversations")
                .select("*, contact:support_contacts(*)")
                .eq("id", conversationId)
                .single();
            if (conversationError) throw conversationError;

            const { data: messages, error: messagesError } = await auditedAdmin
                .from("support_messages")
                .select("*")
                .eq("conversation_id", conversationId)
                .order("created_at", { ascending: true });
            if (messagesError) throw messagesError;

            return NextResponse.json({
                conversation,
                messages: buildPublicSupportMessages(messages),
            });
        }

        const [conversationsResult, knowledgeResult, announcementsResult] = await Promise.all([
            auditedAdmin
                .from("support_conversations")
                .select("*, contact:support_contacts(*)")
                .order("last_message_at", { ascending: false }),
            auditedAdmin.from("support_knowledge").select("*").order("updated_at", { ascending: false }),
            auditedAdmin
                .from("support_announcements")
                .select("*")
                .order("starts_on", { ascending: false }),
        ]);

        if (conversationsResult.error) throw conversationsResult.error;
        if (knowledgeResult.error) throw knowledgeResult.error;
        if (announcementsResult.error) throw announcementsResult.error;

        return NextResponse.json({
            conversations: conversationsResult.data || [],
            knowledge: knowledgeResult.data || [],
            announcements: announcementsResult.data || [],
        });
    } catch (error) {
        console.error("Support GET error:", error);
        return NextResponse.json(
            { error: `${asError(error)} Apply the parent-support Supabase migration if it has not been run.` },
            { status: 500 },
        );
    }
}

export async function POST(request: NextRequest) {
    const actor = await getOptionalAuditActor(request);
    if (!actor || actor.role !== "superuser") {
        await writeAuditEvent({
            request,
            actor,
            eventKind: "security",
            category: "support",
            eventType: "support.access.denied",
            action: "mutate_support",
            outcome: "denied",
            summary: actor
                ? "A signed-in user without permission attempted to change parent support data."
                : "An unauthenticated request attempted to change parent support data.",
            actorSource: actor ? "support_api" : "anonymous",
            metadata: { reason: actor ? "insufficient_role" : "authentication_required" },
        });
        return NextResponse.json(
            { error: actor ? "Superuser access required." : "Authentication required." },
            { status: actor ? 403 : 401 },
        );
    }
    const user = actor.user;
    const auditedAdmin = createAuditedAdminClient(request, actor, "support_api");
    let attemptedAction = "unknown";

    try {
        const body = await request.json();
        const action = String(body.action || "");
        attemptedAction = action || "unknown";

        if (action === "send_message") {
            const conversationId = String(body.conversationId || "");
            const content = String(body.content || "").trim();
            const expectedParentMessageId = body.expectedParentMessageId == null
                ? null
                : String(body.expectedParentMessageId);
            if (!conversationId || !content) {
                return NextResponse.json({ error: "Conversation and message are required." }, { status: 400 });
            }
            if (content.length > 3900) {
                return NextResponse.json({ error: "Telegram replies must be 3,900 characters or fewer." }, { status: 400 });
            }

            const { data: conversation, error } = await auditedAdmin
                .from("support_conversations")
                .select("*, contact:support_contacts(*)")
                .eq("id", conversationId)
                .single();
            if (error || !conversation) throw error || new Error("Conversation not found.");
            if (["resolved", "closed_parent"].includes(conversation.status)) {
                return NextResponse.json(
                    {
                        error: conversation.status === "closed_parent"
                            ? "The parent closed this conversation. Wait for a new parent message before replying."
                            : "Reopen this resolved conversation before replying.",
                    },
                    { status: 409 },
                );
            }

            const replyStartedAt = new Date().toISOString();
            const { data: latestParentBeforeReply, error: latestParentBeforeReplyError } = await auditedAdmin
                .from("support_messages")
                .select("id")
                .eq("conversation_id", conversationId)
                .eq("sender_type", "parent")
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
            if (latestParentBeforeReplyError) throw latestParentBeforeReplyError;
            const parentContextVerified = expectedParentMessageId !== null
                && String(latestParentBeforeReply?.id || "") === expectedParentMessageId;
            if (
                expectedParentMessageId !== null
                && !parentContextVerified
            ) {
                return NextResponse.json(
                    {
                        error: "A new parent message arrived before this reply was sent. Review the latest message and try again.",
                    },
                    { status: 409 },
                );
            }
            const replyOffersConversationControls = Boolean(
                parentContextVerified
                && latestParentBeforeReply?.id
                && isSubstantiveCoachReply(content),
            );

            const previousStatus = conversation.status as SupportStatus;
            const { data: claimedRows, error: claimError } = await auditedAdmin
                .from("support_conversations")
                .update({
                    status: "human_active",
                    assigned_to: user.id,
                    escalation_reason: null,
                })
                .eq("id", conversationId)
                .eq("status", previousStatus)
                .select("id");
            if (claimError) throw claimError;
            if (!claimedRows?.length) {
                return NextResponse.json(
                    { error: "The conversation changed before the reply was sent. Refresh it and try again." },
                    { status: 409 },
                );
            }

            let telegramMessage;
            try {
                telegramMessage = await sendSupportTelegramMessage(
                    conversation.contact.telegram_chat_id,
                    formatCoachReply(content),
                );
            } catch (deliveryError) {
                // Keep the AI paused: a parent message may have arrived while Telegram delivery was in flight.
                throw new Error(`${asError(deliveryError)} The conversation remains assigned to Coach Patrick, so the AI is still paused.`);
            }
            const { data: message, error: insertError } = await auditedAdmin
                .from("support_messages")
                .insert({
                    conversation_id: conversationId,
                    telegram_message_id: String(telegramMessage.message_id),
                    direction: "outbound",
                    sender_type: "superuser",
                    sender_user_id: user.id,
                    content,
                    telegram_delivery_status: parentContextVerified ? "sent" : "sent_unverified_context",
                    created_at: replyStartedAt,
                })
                .select("*")
                .single();
            if (insertError) throw insertError;

            if (replyOffersConversationControls) {
                try {
                    const { data: latestParentAfterReply, error: latestParentAfterReplyError } = await auditedAdmin
                        .from("support_messages")
                        .select("id")
                        .eq("conversation_id", conversationId)
                        .eq("sender_type", "parent")
                        .order("created_at", { ascending: false })
                        .limit(1)
                        .maybeSingle();
                    if (latestParentAfterReplyError) throw latestParentAfterReplyError;
                    if (String(latestParentAfterReply?.id || "") === String(latestParentBeforeReply.id)) {
                        await setSupportTelegramKeyboard(
                            conversation.contact.telegram_chat_id,
                            telegramMessage.message_id,
                            coachReplyCloseKeyboard(conversationId),
                        );
                        const { data: latestParentAfterControl, error: latestParentAfterControlError } = await auditedAdmin
                            .from("support_messages")
                            .select("id")
                            .eq("conversation_id", conversationId)
                            .eq("sender_type", "parent")
                            .order("created_at", { ascending: false })
                            .limit(1)
                            .maybeSingle();
                        if (latestParentAfterControlError) throw latestParentAfterControlError;
                        if (String(latestParentAfterControl?.id || "") !== String(latestParentBeforeReply.id)) {
                            await clearSupportTelegramKeyboard(
                                conversation.contact.telegram_chat_id,
                                telegramMessage.message_id,
                            );
                        }
                    }
                } catch (closeControlError) {
                    console.error("Could not add the parent close control to Coach Patrick's reply:", closeControlError);
                }
            }

            const { error: updateError } = await auditedAdmin.from("support_conversations").update({
                last_message_at: new Date().toISOString(),
                last_message_preview: content.slice(0, 180),
            })
                .eq("id", conversationId)
                .eq("status", "human_active")
                .eq("assigned_to", user.id);
            if (updateError) throw updateError;
            if (previousStatus !== "human_active") {
                await recordSupportStatus(conversationId, previousStatus, "human_active", "superuser", "Coach Patrick replied.", user.id);
            }
            try {
                await mirrorSupportForumCoachReply(supportAdmin, {
                    conversationId,
                    parentName: supportContactLabel(conversation.contact),
                    text: `Coach Patrick replied:\n\n${content}`,
                });
            } catch {
                // The parent reply has already been delivered. The private
                // forum is an operational mirror and cannot roll that back.
                console.error("Could not mirror a PatLau Chats reply into the Telegram support forum.");
            }
            await writeAuditEvent({
                request,
                actor,
                category: "support",
                eventType: "support.reply.sent",
                action: "send_message",
                outcome: "success",
                summary: `${user.user_metadata?.name || user.email || "Superuser"} replied to a parent conversation`,
                actorSource: "support_api",
                targetTable: "support_conversations",
                targetRecordId: { id: conversationId },
                targetLabel: supportContactLabel(conversation.contact),
                metadata: {
                    message_id: message.id,
                    delivery_status: "sent",
                    parent_context_verified: parentContextVerified,
                },
            });
            return NextResponse.json({
                message: buildPublicSupportMessage(message, [message]),
            });
        }

        if (action === "set_status") {
            const conversationId = String(body.conversationId || "");
            const status = String(body.status || "") as SupportStatus;
            if (!conversationId || !validStatuses.includes(status)) {
                return NextResponse.json({ error: "A valid conversation status is required." }, { status: 400 });
            }
            const { data: current, error: currentError } = await auditedAdmin
                .from("support_conversations")
                .select("status, contact:support_contacts(first_name,last_name,username,telegram_chat_id,blocked)")
                .eq("id", conversationId)
                .single();
            if (currentError) throw currentError;
            const currentContact = Array.isArray(current.contact) ? current.contact[0] : current.contact;
            if (
                current.status === "closed_parent"
                && !["closed_parent", "human_active"].includes(status)
            ) {
                return NextResponse.json(
                    { error: "A parent-closed conversation can only be reopened as Coach Patrick." },
                    { status: 409 },
                );
            }
            if (status === "resolved") {
                if (current.status !== "human_active") {
                    return NextResponse.json(
                        {
                            error: "Coach Patrick must be handling the conversation before it can be closed.",
                        },
                        { status: 409 },
                    );
                }
                const { data: messages, error: messagesError } = await auditedAdmin
                    .from("support_messages")
                    .select("sender_type,content,created_at,telegram_delivery_status")
                    .eq("conversation_id", conversationId)
                    .order("created_at", { ascending: true });
                if (messagesError) throw messagesError;
                if (!canCloseAfterCoachReply(messages || [])) {
                    return NextResponse.json(
                        {
                            error: "Send the parent a complete Coach Patrick reply before closing this conversation.",
                        },
                        { status: 409 },
                    );
                }
            }
            const reopenMarkerContent = ["resolved", "closed_parent"].includes(current.status)
                && ["ai_active", "human_active"].includes(status)
                ? status === "human_active"
                    ? COACH_FOLLOW_UP_REOPENED_MESSAGE
                    : REOPENED_CONVERSATION_MESSAGE
                : null;
            let reopenMarkerId = "";
            if (reopenMarkerContent) {
                const { data: reopenMarker, error: reopenMarkerError } = await auditedAdmin
                    .from("support_messages")
                    .insert({
                        conversation_id: conversationId,
                        direction: "outbound",
                        sender_type: "system",
                        content: reopenMarkerContent,
                        telegram_delivery_status: "pending",
                    })
                    .select("id")
                    .single();
                if (reopenMarkerError || !reopenMarker) {
                    console.error("Could not establish the conversation reopen baseline:", reopenMarkerError);
                    return NextResponse.json(
                        {
                            error: "The conversation could not be reopened safely. Please try again.",
                        },
                        { status: 503 },
                    );
                }
                reopenMarkerId = String(reopenMarker.id);
            }
            const now = new Date().toISOString();
            const updates: Record<string, unknown> = {
                status,
                assigned_to: status === "human_active" ? user.id : null,
                escalation_reason: status === "escalated" ? body.reason || "Needs attention" : null,
                resolved_at: status === "resolved" ? now : null,
                closed_at: status === "closed_parent" ? now : null,
            };
            const { data: updatedRows, error } = await auditedAdmin
                .from("support_conversations")
                .update(updates)
                .eq("id", conversationId)
                .eq("status", current.status)
                .select("id");
            if (error) {
                if (reopenMarkerId) {
                    const { error: cleanupError } = await auditedAdmin
                        .from("support_messages")
                        .delete()
                        .eq("id", reopenMarkerId);
                    if (cleanupError) {
                        console.error("Could not remove an unused conversation reopen marker:", cleanupError);
                    }
                }
                throw error;
            }
            if (!updatedRows?.length) {
                if (reopenMarkerId) {
                    const { error: cleanupError } = await auditedAdmin
                        .from("support_messages")
                        .delete()
                        .eq("id", reopenMarkerId);
                    if (cleanupError) {
                        console.error("Could not remove an unused conversation reopen marker:", cleanupError);
                    }
                }
                return NextResponse.json(
                    { error: "The conversation changed before this action was completed. Refresh it and try again." },
                    { status: 409 },
                );
            }
            let notificationWarning = "";
            const parentStateMessage = current.status !== status && status === "resolved"
                ? {
                    content: COACH_CLOSED_CONVERSATION_MESSAGE,
                    keyboard: reopenConversationKeyboard(conversationId),
                }
                : current.status === "resolved" && status === "ai_active"
                    ? { content: REOPENED_CONVERSATION_MESSAGE, keyboard: undefined }
                    : ["resolved", "closed_parent"].includes(current.status) && status === "human_active"
                        ? { content: COACH_FOLLOW_UP_REOPENED_MESSAGE, keyboard: undefined }
                    : null;
            if (parentStateMessage && currentContact?.telegram_chat_id && !currentContact.blocked) {
                try {
                    const telegramMessage = await sendSupportTelegramMessage(
                        currentContact.telegram_chat_id,
                        formatSystemMessage(parentStateMessage.content),
                        parentStateMessage.keyboard,
                    );
                    let messageError: any = null;
                    if (reopenMarkerId) {
                        const result = await auditedAdmin
                            .from("support_messages")
                            .update({
                                telegram_message_id: String(telegramMessage.message_id),
                                telegram_delivery_status: "sent",
                            })
                            .eq("id", reopenMarkerId);
                        messageError = result.error;
                    } else {
                        const result = await auditedAdmin.from("support_messages").insert({
                            conversation_id: conversationId,
                            telegram_message_id: String(telegramMessage.message_id),
                            direction: "outbound",
                            sender_type: "system",
                            content: parentStateMessage.content,
                            telegram_delivery_status: "sent",
                        })
                            .select("id")
                            .single();
                        messageError = result.error;
                    }
                    if (messageError) {
                        console.error("Could not save a delivered conversation-state message:", messageError);
                        notificationWarning = reopenMarkerId
                            ? "The parent was notified, but the delivery status could not be synchronized."
                            : "The parent was notified, but the status message could not be saved in the chat history.";
                    }
                } catch (notificationError) {
                    console.error("Could not notify the parent about the conversation state:", notificationError);
                    notificationWarning = "The conversation status changed, but Telegram could not deliver the status update.";
                    if (reopenMarkerId) {
                        const { error: markerUpdateError } = await auditedAdmin
                            .from("support_messages")
                            .update({ telegram_delivery_status: "failed" })
                            .eq("id", reopenMarkerId);
                        if (markerUpdateError) {
                            console.error("Could not update the failed conversation-state delivery:", markerUpdateError);
                        }
                    }
                }
            }
            if (
                reopenMarkerId
                && (!currentContact?.telegram_chat_id || currentContact.blocked)
            ) {
                const { error: markerError } = await auditedAdmin
                    .from("support_messages")
                    .update({
                        telegram_delivery_status: currentContact?.blocked ? "blocked" : "not_sent",
                    })
                    .eq("id", reopenMarkerId);
                if (markerError) {
                    console.error("Could not update the undelivered conversation-state marker:", markerError);
                }
            }
            const mirrorStoredStateMessageToForum = async () => {
                if (!parentStateMessage) return;
                try {
                    const forumMirror = await mirrorSupportForumAutomatedMessage(
                        supportAdmin,
                        {
                            conversationId,
                            text: `System:\n\n${formatSystemMessage(parentStateMessage.content)}`,
                        },
                    );
                    if (!forumMirror.mirrored && !forumMirror.noTopic) {
                        notificationWarning = [
                            notificationWarning,
                            "The conversation update could not be mirrored into the Telegram support topic.",
                        ].filter(Boolean).join(" ");
                    }
                } catch {
                    notificationWarning = [
                        notificationWarning,
                        "The conversation update could not be mirrored into the Telegram support topic.",
                    ].filter(Boolean).join(" ");
                }
            };
            if (status === "resolved") {
                // A resolved topic is about to close, so mirror the final
                // message while the forum topic is still open.
                await mirrorStoredStateMessageToForum();
            }
            await recordSupportStatus(
                conversationId,
                current.status as SupportStatus,
                status,
                "superuser",
                String(body.reason || "Status changed in Chats."),
                user.id,
            );
            try {
                const forumSync = await syncSupportForumState(supportAdmin, {
                    conversationId,
                    parentName: supportContactLabel(currentContact),
                    status,
                    latestSenderType: status === "human_active"
                        ? "system"
                        : status === "waiting_parent"
                            ? "ai"
                            : "system",
                });
                if (!forumSync.synced && !forumSync.noTopic) {
                    notificationWarning = [
                        notificationWarning,
                        "The Telegram support topic could not be synchronized.",
                    ].filter(Boolean).join(" ");
                }
            } catch {
                console.error("Could not synchronize the Telegram support forum after a status change.");
                notificationWarning = [
                    notificationWarning,
                    "The Telegram support topic could not be synchronized.",
                ].filter(Boolean).join(" ");
            }
            if (status !== "resolved") {
                // Reopen the forum first, then place the matching system turn
                // into the same topic.
                await mirrorStoredStateMessageToForum();
            }
            await writeAuditEvent({
                request,
                actor,
                category: "support",
                eventType: "support.status.changed",
                action: "change_status",
                outcome: "success",
                summary: `${user.user_metadata?.name || user.email || "Superuser"} changed ${supportContactLabel(currentContact)}'s conversation from ${current.status.replaceAll('_', ' ')} to ${status.replaceAll('_', ' ')}`,
                actorSource: "support_api",
                targetTable: "support_conversations",
                targetRecordId: { id: conversationId },
                targetLabel: supportContactLabel(currentContact),
                changedFields: ["status"],
                oldValues: { status: current.status },
                newValues: { status },
            });
            return NextResponse.json({ success: true, ...(notificationWarning ? { warning: notificationWarning } : {}) });
        }

        if (action === "delete_conversation") {
            const conversationId = String(body.conversationId || "").trim();
            const expectedUpdatedAt = String(body.expectedUpdatedAt || "").trim();
            if (
                !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversationId)
                || !expectedUpdatedAt
                || Number.isNaN(Date.parse(expectedUpdatedAt))
            ) {
                return NextResponse.json(
                    { error: "A valid conversation and confirmation version are required." },
                    { status: 400 },
                );
            }

            const { data: existing, error: existingError } = await auditedAdmin
                .from("support_conversations")
                .select("id,status,updated_at,contact:support_contacts(first_name,last_name,username)")
                .eq("id", conversationId)
                .maybeSingle();
            if (existingError) throw existingError;
            if (!existing) {
                return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
            }
            if (existing.updated_at !== expectedUpdatedAt) {
                return NextResponse.json(
                    {
                        error: "This conversation changed after the confirmation opened. Review the latest messages before deleting it.",
                    },
                    { status: 409 },
                );
            }

            const [messageCountResult, statusCountResult] = await Promise.all([
                auditedAdmin
                    .from("support_messages")
                    .select("id", { count: "exact", head: true })
                    .eq("conversation_id", conversationId),
                auditedAdmin
                    .from("support_status_events")
                    .select("id", { count: "exact", head: true })
                    .eq("conversation_id", conversationId),
            ]);
            if (messageCountResult.error) throw messageCountResult.error;
            if (statusCountResult.error) throw statusCountResult.error;

            const forumDeletion = await deleteSupportForumTopicBeforeConversation(
                supportAdmin,
                { conversationId },
            );
            if (!forumDeletion.canDeleteConversation) {
                return NextResponse.json(
                    {
                        error: "The private Telegram support topic could not be removed, so nothing was deleted. Please try again.",
                    },
                    { status: 503 },
                );
            }
            const supportForumTopicDeleted = forumDeletion.deleted;

            const { data: deleted, error: deleteError } = await auditedAdmin
                .from("support_conversations")
                .delete()
                .eq("id", conversationId)
                .eq("updated_at", expectedUpdatedAt)
                .select("id")
                .maybeSingle();
            if (deleteError) throw deleteError;
            if (!deleted) {
                return NextResponse.json(
                    {
                        error: "This conversation changed before deletion. Refresh it and try again.",
                    },
                    { status: 409 },
                );
            }

            const contact = Array.isArray(existing.contact) ? existing.contact[0] : existing.contact;
            const contactLabel = supportContactLabel(contact);
            await writeAuditEvent({
                request,
                actor,
                category: "support",
                eventType: "support.conversation.deleted",
                action: "delete",
                outcome: "success",
                summary: `${user.user_metadata?.name || user.email || "Superuser"} permanently deleted ${contactLabel}'s stored support conversation`,
                actorSource: "support_api",
                targetTable: "support_conversations",
                targetRecordId: { id: conversationId },
                targetLabel: contactLabel,
                metadata: {
                    previous_status: existing.status,
                    deleted_message_count: messageCountResult.count || 0,
                    deleted_status_event_count: statusCountResult.count || 0,
                    contact_retained: true,
                    telegram_messages_deleted: false,
                    telegram_support_forum_topic_deleted: supportForumTopicDeleted,
                },
            });
            return NextResponse.json({ success: true });
        }

        if (action === "save_knowledge") {
            const record = {
                title: String(body.title || "").trim(),
                category: String(body.category || "General").trim() || "General",
                content: String(body.content || "").trim(),
                status: ["draft", "published", "archived"].includes(body.status) ? body.status : "draft",
                updated_by: user.id,
            };
            if (!record.title || !record.content) {
                return NextResponse.json({ error: "Title and content are required." }, { status: 400 });
            }
            const query = body.id
                ? auditedAdmin.from("support_knowledge").update(record).eq("id", body.id)
                : auditedAdmin.from("support_knowledge").insert(record);
            const { data, error } = await query.select("*").single();
            if (error) throw error;
            await writeAuditEvent({
                request,
                actor,
                category: "support",
                eventType: body.id ? "support.knowledge.updated" : "support.knowledge.created",
                action: body.id ? "update" : "create",
                outcome: "success",
                summary: `${user.user_metadata?.name || user.email || "Superuser"} ${body.id ? "updated" : "created"} knowledge “${record.title}”`,
                actorSource: "support_api",
                targetTable: "support_knowledge",
                targetRecordId: { id: data.id },
                targetLabel: record.title,
                metadata: { category: record.category, status: record.status },
            });
            return NextResponse.json({ record: data });
        }

        if (action === "delete_knowledge") {
            const { data: existing } = await auditedAdmin.from("support_knowledge").select("title").eq("id", body.id).maybeSingle();
            const { error } = await auditedAdmin.from("support_knowledge").delete().eq("id", body.id);
            if (error) throw error;
            await writeAuditEvent({
                request,
                actor,
                category: "support",
                eventType: "support.knowledge.deleted",
                action: "delete",
                outcome: "success",
                summary: `${user.user_metadata?.name || user.email || "Superuser"} deleted knowledge “${existing?.title || "Unknown knowledge item"}”`,
                actorSource: "support_api",
                targetTable: "support_knowledge",
                targetRecordId: { id: body.id },
                targetLabel: existing?.title || "Unknown knowledge item",
            });
            return NextResponse.json({ success: true });
        }

        if (action === "save_announcement") {
            const record = {
                title: String(body.title || "").trim(),
                content: String(body.content || "").trim(),
                programme: String(body.programme || "all"),
                starts_on: String(body.startsOn || ""),
                ends_on: String(body.endsOn || ""),
                priority: 0,
                status: ["draft", "published", "archived"].includes(body.status) ? body.status : "draft",
                updated_by: user.id,
            };
            if (!record.title || !record.content || !/^\d{4}-\d{2}-\d{2}$/.test(record.starts_on) || !/^\d{4}-\d{2}-\d{2}$/.test(record.ends_on)) {
                return NextResponse.json({ error: "Title, content, start date and end date are required." }, { status: 400 });
            }
            if (record.ends_on < record.starts_on) {
                return NextResponse.json({ error: "End date cannot be before the start date." }, { status: 400 });
            }
            const query = body.id
                ? auditedAdmin.from("support_announcements").update(record).eq("id", body.id)
                : auditedAdmin.from("support_announcements").insert(record);
            const { data, error } = await query.select("*").single();
            if (error) throw error;
            await writeAuditEvent({
                request,
                actor,
                category: "support",
                eventType: body.id ? "support.announcement.updated" : "support.announcement.created",
                action: body.id ? "update" : "create",
                outcome: "success",
                summary: `${user.user_metadata?.name || user.email || "Superuser"} ${body.id ? "updated" : "created"} announcement “${record.title}”`,
                actorSource: "support_api",
                targetTable: "support_announcements",
                targetRecordId: { id: data.id },
                targetLabel: record.title,
                metadata: {
                    programme: record.programme,
                    starts_on: record.starts_on,
                    ends_on: record.ends_on,
                    status: record.status,
                },
            });
            return NextResponse.json({ record: data });
        }

        if (action === "delete_announcement") {
            const { data: existing } = await auditedAdmin.from("support_announcements").select("title").eq("id", body.id).maybeSingle();
            const { error } = await auditedAdmin.from("support_announcements").delete().eq("id", body.id);
            if (error) throw error;
            await writeAuditEvent({
                request,
                actor,
                category: "support",
                eventType: "support.announcement.deleted",
                action: "delete",
                outcome: "success",
                summary: `${user.user_metadata?.name || user.email || "Superuser"} deleted announcement “${existing?.title || "Unknown announcement"}”`,
                actorSource: "support_api",
                targetTable: "support_announcements",
                targetRecordId: { id: body.id },
                targetLabel: existing?.title || "Unknown announcement",
            });
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: "Unknown support action." }, { status: 400 });
    } catch (error) {
        console.error("Support POST error:", error);
        await writeAuditEvent({
            request,
            actor,
            category: "support",
            eventType: `support.${attemptedAction}.failed`,
            action: attemptedAction,
            outcome: "failure",
            summary: `Support action “${attemptedAction}” failed`,
            actorSource: "support_api",
            metadata: { error: safeAuditError(error) },
        });
        return NextResponse.json({ error: asError(error) }, { status: 500 });
    }
}
