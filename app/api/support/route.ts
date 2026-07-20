import { NextRequest, NextResponse } from "next/server";
import type { SupportStatus } from "../../../types/support";
import {
    getSupportSuperuser,
    recordSupportStatus,
    sendSupportTelegramMessage,
    supportAdmin,
} from "../../lib/support-server";

const validStatuses: SupportStatus[] = [
    "ai_active",
    "waiting_parent",
    "escalated",
    "human_active",
    "resolved",
    "closed_parent",
];

const asError = (error: unknown) => error instanceof Error ? error.message : "Unexpected support error.";

export async function GET(request: NextRequest) {
    const user = await getSupportSuperuser(request);
    if (!user) return NextResponse.json({ error: "Superuser access required." }, { status: 403 });

    try {
        const view = request.nextUrl.searchParams.get("view");
        if (view === "count") {
            const { count, error } = await supportAdmin
                .from("support_conversations")
                .select("id", { count: "exact", head: true })
                .eq("status", "escalated");
            if (error) throw error;
            return NextResponse.json({ escalated: count || 0 });
        }

        const conversationId = request.nextUrl.searchParams.get("conversation_id");
        if (conversationId) {
            const { data: conversation, error: conversationError } = await supportAdmin
                .from("support_conversations")
                .select("*, contact:support_contacts(*)")
                .eq("id", conversationId)
                .single();
            if (conversationError) throw conversationError;

            const { data: messages, error: messagesError } = await supportAdmin
                .from("support_messages")
                .select("*")
                .eq("conversation_id", conversationId)
                .order("created_at", { ascending: true });
            if (messagesError) throw messagesError;

            await supportAdmin
                .from("support_conversations")
                .update({ unread_count: 0 })
                .eq("id", conversationId);
            return NextResponse.json({ conversation, messages: messages || [] });
        }

        const [conversationsResult, knowledgeResult, announcementsResult] = await Promise.all([
            supportAdmin
                .from("support_conversations")
                .select("*, contact:support_contacts(*)")
                .order("last_message_at", { ascending: false }),
            supportAdmin.from("support_knowledge").select("*").order("updated_at", { ascending: false }),
            supportAdmin
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
    const user = await getSupportSuperuser(request);
    if (!user) return NextResponse.json({ error: "Superuser access required." }, { status: 403 });

    try {
        const body = await request.json();
        const action = String(body.action || "");

        if (action === "send_message") {
            const conversationId = String(body.conversationId || "");
            const content = String(body.content || "").trim();
            if (!conversationId || !content) {
                return NextResponse.json({ error: "Conversation and message are required." }, { status: 400 });
            }
            if (content.length > 3900) {
                return NextResponse.json({ error: "Telegram replies must be 3,900 characters or fewer." }, { status: 400 });
            }

            const { data: conversation, error } = await supportAdmin
                .from("support_conversations")
                .select("*, contact:support_contacts(*)")
                .eq("id", conversationId)
                .single();
            if (error || !conversation) throw error || new Error("Conversation not found.");

            const telegramMessage = await sendSupportTelegramMessage(conversation.contact.telegram_chat_id, content);
            const { data: message, error: insertError } = await supportAdmin
                .from("support_messages")
                .insert({
                    conversation_id: conversationId,
                    telegram_message_id: String(telegramMessage.message_id),
                    direction: "outbound",
                    sender_type: "superuser",
                    sender_user_id: user.id,
                    content,
                    telegram_delivery_status: "sent",
                })
                .select("*")
                .single();
            if (insertError) throw insertError;

            const previousStatus = conversation.status as SupportStatus;
            await supportAdmin.from("support_conversations").update({
                status: "human_active",
                assigned_to: user.id,
                last_message_at: new Date().toISOString(),
                last_message_preview: content.slice(0, 180),
                escalation_reason: null,
            }).eq("id", conversationId);
            if (previousStatus !== "human_active") {
                await recordSupportStatus(conversationId, previousStatus, "human_active", "superuser", "Superuser replied.", user.id);
            }
            return NextResponse.json({ message });
        }

        if (action === "set_status") {
            const conversationId = String(body.conversationId || "");
            const status = String(body.status || "") as SupportStatus;
            if (!conversationId || !validStatuses.includes(status)) {
                return NextResponse.json({ error: "A valid conversation status is required." }, { status: 400 });
            }
            const { data: current, error: currentError } = await supportAdmin
                .from("support_conversations")
                .select("status")
                .eq("id", conversationId)
                .single();
            if (currentError) throw currentError;
            const now = new Date().toISOString();
            const updates: Record<string, unknown> = {
                status,
                assigned_to: status === "human_active" ? user.id : null,
                escalation_reason: status === "escalated" ? body.reason || "Needs attention" : null,
                resolved_at: status === "resolved" ? now : null,
                closed_at: status === "closed_parent" ? now : null,
            };
            const { error } = await supportAdmin.from("support_conversations").update(updates).eq("id", conversationId);
            if (error) throw error;
            await recordSupportStatus(
                conversationId,
                current.status as SupportStatus,
                status,
                "superuser",
                String(body.reason || "Status changed in Chats."),
                user.id,
            );
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
                ? supportAdmin.from("support_knowledge").update(record).eq("id", body.id)
                : supportAdmin.from("support_knowledge").insert(record);
            const { data, error } = await query.select("*").single();
            if (error) throw error;
            return NextResponse.json({ record: data });
        }

        if (action === "delete_knowledge") {
            const { error } = await supportAdmin.from("support_knowledge").delete().eq("id", body.id);
            if (error) throw error;
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
                ? supportAdmin.from("support_announcements").update(record).eq("id", body.id)
                : supportAdmin.from("support_announcements").insert(record);
            const { data, error } = await query.select("*").single();
            if (error) throw error;
            return NextResponse.json({ record: data });
        }

        if (action === "delete_announcement") {
            const { error } = await supportAdmin.from("support_announcements").delete().eq("id", body.id);
            if (error) throw error;
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: "Unknown support action." }, { status: 400 });
    } catch (error) {
        console.error("Support POST error:", error);
        return NextResponse.json({ error: asError(error) }, { status: 500 });
    }
}
