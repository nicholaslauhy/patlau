import { createHash } from "crypto";
import { NextResponse } from "next/server";
import type { SupportStatus } from "../../../../types/support";
import {
    answerSupportCallback,
    clearSupportTelegramKeyboard,
    getSingaporeDateKey,
    notifySupportSuperuser,
    recordSupportStatus,
    sendSupportTelegramMessage,
    supportAdmin,
} from "../../../lib/support-server";
import {
    AI_INTRO_MESSAGE,
    CLOSED_CONVERSATION_MESSAGE,
    REOPENED_CONVERSATION_MESSAGE,
    formatAiReply,
    formatSystemMessage,
    normaliseCoachReferences,
    parentExplicitlyRequestsCoach,
    parentIsDissatisfied,
    reopenConversationKeyboard,
    shouldOfferDelayedFeedback,
} from "../../../lib/telegram-support-flow";

const delayedFeedbackKeyboard = (conversationId: string) => ({
    inline_keyboard: [
        [{ text: "This answered my question", callback_data: `ps|helpful|${conversationId}` }],
        [{ text: "Close conversation", callback_data: `ps|close|${conversationId}` }],
    ],
});

const parentName = (from: any) =>
    [from?.first_name, from?.last_name].filter(Boolean).join(" ").trim()
    || (from?.username ? `@${from.username}` : "Parent");

async function clearCallbackKeyboard(callbackQuery: any) {
    const chatId = callbackQuery.message?.chat?.id;
    const messageId = callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;
    try {
        await clearSupportTelegramKeyboard(String(chatId), messageId);
    } catch (error) {
        console.error("Could not clear an outdated parent-support keyboard:", error);
    }
}

async function getOrCreateConversation(chat: any, from: any) {
    const chatId = String(chat.id);
    const contactRecord = {
        telegram_chat_id: chatId,
        telegram_user_id: from?.id ? String(from.id) : null,
        username: from?.username || null,
        first_name: from?.first_name || null,
        last_name: from?.last_name || null,
        language_code: from?.language_code || null,
        blocked: false,
    };
    const { data: contact, error: contactError } = await supportAdmin
        .from("support_contacts")
        .upsert(contactRecord, { onConflict: "telegram_chat_id" })
        .select("*")
        .single();
    if (contactError || !contact) throw contactError || new Error("Could not save Telegram contact.");

    const { data: existing, error: existingError } = await supportAdmin
        .from("support_conversations")
        .select("*")
        .eq("contact_id", contact.id)
        .maybeSingle();
    if (existingError) throw existingError;
    if (existing) return { contact, conversation: existing };

    const { data: conversation, error: conversationError } = await supportAdmin
        .from("support_conversations")
        .insert({ contact_id: contact.id, status: "ai_active" })
        .select("*")
        .single();
    if (conversationError || !conversation) throw conversationError || new Error("Could not start support conversation.");
    await recordSupportStatus(conversation.id, null, "ai_active", "system", "Conversation started.");
    return { contact, conversation };
}

async function saveInbound(conversationId: string, telegramMessageId: string, content: string) {
    const { error } = await supportAdmin.from("support_messages").insert({
        conversation_id: conversationId,
        telegram_message_id: telegramMessageId,
        direction: "inbound",
        sender_type: "parent",
        content,
        telegram_delivery_status: "received",
    });
    if (error?.code === "23505") return false;
    if (error) throw error;
    return true;
}

async function sendAndStore(
    conversationId: string,
    chatId: string,
    content: string,
    senderType: "ai" | "system",
    sources: string[] = [],
    keyboard?: Record<string, unknown>,
) {
    const storedContent = normaliseCoachReferences(content);
    const deliveredContent = senderType === "ai"
        ? formatAiReply(storedContent)
        : formatSystemMessage(storedContent);
    const message = await sendSupportTelegramMessage(chatId, deliveredContent.slice(0, 3900), keyboard);
    const { error } = await supportAdmin.from("support_messages").insert({
        conversation_id: conversationId,
        telegram_message_id: String(message.message_id),
        direction: "outbound",
        sender_type: senderType,
        content: storedContent.slice(0, 3900),
        source_refs: sources,
        telegram_delivery_status: "sent",
    });
    if (error) throw error;
}

async function setConversationStatus(
    conversation: any,
    status: SupportStatus,
    actor: "parent" | "ai" | "system",
    reason?: string,
) {
    const now = new Date().toISOString();
    const updates: Record<string, unknown> = {
        status,
        assigned_to: null,
        escalation_reason: status === "escalated" ? reason || "Parent requested help." : null,
        resolved_at: status === "resolved" ? now : null,
        closed_at: status === "closed_parent" ? now : null,
    };
    const { error } = await supportAdmin.from("support_conversations").update(updates).eq("id", conversation.id);
    if (error) throw error;
    if (conversation.status !== status) {
        await recordSupportStatus(conversation.id, conversation.status, status, actor, reason || null);
    }
    conversation.status = status;
}

async function escalate(conversation: any, chatId: string, name: string, latestMessage: string, reason: string) {
    await setConversationStatus(conversation, "escalated", "ai", reason);
    await sendAndStore(
        conversation.id,
        chatId,
        "I’m sorry I couldn’t fully resolve this. I’ve passed the conversation directly to Coach Patrick. You can continue messaging here, and Coach Patrick will reply in this chat.",
        "system",
    );
    try {
        await notifySupportSuperuser(conversation.id, name, latestMessage, reason);
    } catch (error) {
        console.error("Support escalation notification failed:", error);
    }
}

async function moderateText(text: string) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return false;
    const response = await fetch("https://api.openai.com/v1/moderations", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "omni-moderation-latest", input: text }),
    });
    if (!response.ok) return false;
    const data = await response.json();
    return Boolean(data?.results?.[0]?.flagged);
}

function responseText(data: any) {
    if (typeof data?.output_text === "string") return data.output_text;
    for (const item of data?.output || []) {
        for (const content of item?.content || []) {
            if (content?.type === "output_text" && typeof content.text === "string") return content.text;
        }
    }
    return "";
}

async function generateSupportReply(conversationId: string, telegramUserId: string) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OpenAI is not configured.");
    const today = getSingaporeDateKey();

    const [knowledgeResult, announcementsResult, historyResult] = await Promise.all([
        supportAdmin
            .from("support_knowledge")
            .select("title, category, content, updated_at")
            .eq("status", "published")
            .order("updated_at", { ascending: false })
            .limit(50),
        supportAdmin
            .from("support_announcements")
            .select("title, content, programme, starts_on, ends_on, updated_at")
            .eq("status", "published")
            .lte("starts_on", today)
            .gte("ends_on", today)
            .order("updated_at", { ascending: false })
            .limit(30),
        supportAdmin
            .from("support_messages")
            .select("sender_type, content, created_at")
            .eq("conversation_id", conversationId)
            .in("sender_type", ["parent", "ai", "superuser"])
            .order("created_at", { ascending: false })
            .limit(16),
    ]);
    if (knowledgeResult.error) throw knowledgeResult.error;
    if (announcementsResult.error) throw announcementsResult.error;
    if (historyResult.error) throw historyResult.error;

    const knowledge = knowledgeResult.data || [];
    const announcements = announcementsResult.data || [];
    const previousAiReplyCount = (historyResult.data || []).filter((item: any) =>
        item.sender_type === "ai" && String(item.content || "").trim() !== AI_INTRO_MESSAGE
    ).length;
    if (knowledge.length === 0 && announcements.length === 0) {
        return {
            needsHuman: true,
            reason: "No published coaching information is available.",
            reply: "",
            sources: [] as string[],
            previousAiReplyCount,
        };
    }

    const announcementText = announcements.map((item) =>
        `[ANNOUNCEMENT: ${item.title}] Programme: ${item.programme}; Effective: ${item.starts_on} to ${item.ends_on}; ${item.content}`,
    ).join("\n\n");
    const knowledgeText = knowledge.map((item) =>
        `[KNOWLEDGE: ${item.title} | ${item.category}] ${item.content}`,
    ).join("\n\n");
    const developerPrompt = `You are the PatLau badminton coaching parent-support assistant.
Today in Singapore is ${today}.
Answer general coaching questions only, using only the CURRENT ANNOUNCEMENTS and PUBLISHED KNOWLEDGE below.
Current announcements override general knowledge. Never invent schedules, fees, venues, policies, holiday operations, availability, or personal records.
Do not provide a parent's personal student attendance, payment, account, or schedule information. Escalate those requests for identity verification.
Escalate complaints, refund requests, disputes, explicit requests for a human, conflicting information, or anything not fully supported by the supplied information.
Escalate immediately if the parent sounds frustrated, dissatisfied, agitated, says the answer is not helping, repeats an unanswered question, or asks for Coach Patrick.
If you cannot answer the question fully and confidently from the supplied information, set needs_human=true instead of offering a guess or asking the parent to choose an escalation button.
When referring to the person who will take over, always say Coach Patrick. Do not use another name or a generic title.
Reply in the language used by the parent. Be warm, professional, concise, and transparent.
Set needs_human=true whenever escalation is required. source_titles must contain only exact titles used below.

CURRENT ANNOUNCEMENTS:
${announcementText || "None"}

PUBLISHED KNOWLEDGE:
${knowledgeText || "None"}`;
    const history = [...(historyResult.data || [])].reverse().map((item: any) => ({
        role: item.sender_type === "parent" ? "user" : "assistant",
        content: item.content,
    }));

    const safetyIdentifier = createHash("sha256").update(`patlau:${telegramUserId}`).digest("hex");
    const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            model: process.env.OPENAI_SUPPORT_MODEL || "gpt-5.6-terra",
            reasoning: { effort: "low" },
            safety_identifier: safetyIdentifier,
            max_output_tokens: 600,
            input: [{ role: "developer", content: developerPrompt }, ...history],
            text: {
                format: {
                    type: "json_schema",
                    name: "parent_support_reply",
                    strict: true,
                    schema: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                            reply: { type: "string" },
                            needs_human: { type: "boolean" },
                            escalation_reason: { type: "string" },
                            source_titles: { type: "array", items: { type: "string" } },
                        },
                        required: ["reply", "needs_human", "escalation_reason", "source_titles"],
                    },
                },
            },
        }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || "OpenAI could not produce a response.");
    const raw = responseText(data);
    const parsed = JSON.parse(raw);
    const allowedSourceTitles = new Set([
        ...announcements.map((item) => item.title),
        ...knowledge.map((item) => item.title),
    ]);
    return {
        needsHuman: Boolean(parsed.needs_human),
        reason: String(parsed.escalation_reason || "Coach Patrick should review this question."),
        reply: String(parsed.reply || "").trim(),
        sources: Array.isArray(parsed.source_titles)
            ? parsed.source_titles.map(String).filter((title: string) => allowedSourceTitles.has(title))
            : [],
        previousAiReplyCount,
    };
}

async function handleCallback(callbackQuery: any) {
    const [prefix, action, conversationId] = String(callbackQuery.data || "").split("|");
    if (prefix !== "ps" || !action || !conversationId) return;
    const { data: conversation } = await supportAdmin
        .from("support_conversations")
        .select("*, contact:support_contacts(*)")
        .eq("id", conversationId)
        .maybeSingle();
    if (!conversation) {
        await answerSupportCallback(callbackQuery.id, "Conversation not found.");
        return;
    }
    const chatId = String(callbackQuery.message?.chat?.id || conversation.contact.telegram_chat_id);
    const callbackUserId = String(callbackQuery.from?.id || "");
    if (
        !callbackUserId
        || callbackUserId !== String(conversation.contact.telegram_user_id || "")
        || chatId !== String(conversation.contact.telegram_chat_id)
    ) {
        await answerSupportCallback(callbackQuery.id, "This action belongs to another conversation.");
        return;
    }
    const name = parentName(callbackQuery.from);

    if (action === "helpful") {
        if (conversation.status !== "waiting_parent") {
            await clearCallbackKeyboard(callbackQuery);
            await answerSupportCallback(
                callbackQuery.id,
                ["escalated", "human_active"].includes(conversation.status)
                    ? "Coach Patrick is already handling this conversation."
                    : "This option is no longer active.",
            );
            if (["resolved", "closed_parent"].includes(conversation.status)) {
                await sendAndStore(
                    conversation.id,
                    chatId,
                    CLOSED_CONVERSATION_MESSAGE,
                    "system",
                    [],
                    reopenConversationKeyboard(conversation.id),
                );
            }
            return;
        }
        await setConversationStatus(conversation, "resolved", "parent", "Parent marked the answer helpful.");
        await clearCallbackKeyboard(callbackQuery);
        await answerSupportCallback(callbackQuery.id, "Thank you — marked as resolved.");
        await sendAndStore(
            conversation.id,
            chatId,
            `Glad I could help. ${CLOSED_CONVERSATION_MESSAGE}`,
            "system",
            [],
            reopenConversationKeyboard(conversation.id),
        );
    } else if (action === "reopen") {
        if (!["resolved", "closed_parent"].includes(conversation.status)) {
            await clearCallbackKeyboard(callbackQuery);
            await answerSupportCallback(callbackQuery.id, "This conversation is already open.");
            if (conversation.status === "ai_active") {
                await sendAndStore(conversation.id, chatId, REOPENED_CONVERSATION_MESSAGE, "system");
            }
            return;
        }
        await setConversationStatus(conversation, "ai_active", "parent", "Parent reopened the conversation.");
        await clearCallbackKeyboard(callbackQuery);
        await answerSupportCallback(callbackQuery.id, "Conversation reopened.");
        await sendAndStore(conversation.id, chatId, REOPENED_CONVERSATION_MESSAGE, "system");
    } else if (action === "human") {
        if (["escalated", "human_active"].includes(conversation.status)) {
            await answerSupportCallback(callbackQuery.id, "Coach Patrick is already handling this conversation.");
            return;
        }
        if (["resolved", "closed_parent"].includes(conversation.status)) {
            await clearCallbackKeyboard(callbackQuery);
            await answerSupportCallback(callbackQuery.id, "Please reopen this conversation before requesting Coach Patrick.");
            await sendAndStore(
                conversation.id,
                chatId,
                CLOSED_CONVERSATION_MESSAGE,
                "system",
                [],
                reopenConversationKeyboard(conversation.id),
            );
            return;
        }
        await answerSupportCallback(callbackQuery.id, "Coach Patrick has been notified.");
        await escalate(conversation, chatId, name, "Parent requested Coach Patrick using the chat button.", "Parent requested Coach Patrick.");
    } else if (action === "close") {
        if (conversation.status === "closed_parent") {
            await clearCallbackKeyboard(callbackQuery);
            await answerSupportCallback(callbackQuery.id, "This conversation is already closed.");
            await sendAndStore(
                conversation.id,
                chatId,
                CLOSED_CONVERSATION_MESSAGE,
                "system",
                [],
                reopenConversationKeyboard(conversation.id),
            );
            return;
        }
        await setConversationStatus(conversation, "closed_parent", "parent", "Parent closed the conversation.");
        await clearCallbackKeyboard(callbackQuery);
        await answerSupportCallback(callbackQuery.id, "Conversation closed.");
        await sendAndStore(
            conversation.id,
            chatId,
            CLOSED_CONVERSATION_MESSAGE,
            "system",
            [],
            reopenConversationKeyboard(conversation.id),
        );
    }
}

export async function POST(request: Request) {
    const expectedSecret = process.env.TELEGRAM_PARENT_SUPPORT_WEBHOOK_SECRET;
    const suppliedSecret = request.headers.get("x-telegram-bot-api-secret-token");
    if (!expectedSecret || suppliedSecret !== expectedSecret) {
        return NextResponse.json({ error: "Invalid Telegram webhook secret." }, { status: 401 });
    }

    try {
        const update = await request.json();
        if (update.callback_query) {
            await handleCallback(update.callback_query);
            return NextResponse.json({ ok: true });
        }

        const membership = update.my_chat_member;
        if (membership?.chat?.id) {
            const blocked = ["kicked", "left"].includes(membership.new_chat_member?.status);
            await supportAdmin.from("support_contacts").update({ blocked }).eq("telegram_chat_id", String(membership.chat.id));
            return NextResponse.json({ ok: true });
        }

        const message = update.message;
        if (!message?.chat?.id || message.chat.type !== "private") {
            return NextResponse.json({ ok: true, ignored: true });
        }
        const chatId = String(message.chat.id);
        const adminChatId = process.env.TELEGRAM_PARENT_SUPPORT_ADMIN_CHAT_ID;
        if (adminChatId && chatId === String(adminChatId)) {
            if (String(message.text || "").startsWith("/start")) {
                await sendSupportTelegramMessage(chatId, "PatLau support notifications are enabled for this Telegram account.");
            }
            return NextResponse.json({ ok: true, admin: true });
        }

        const { contact, conversation } = await getOrCreateConversation(message.chat, message.from);
        const text = String(message.text || "").trim();
        if (!text) {
            if (["resolved", "closed_parent"].includes(conversation.status)) {
                await sendAndStore(
                    conversation.id,
                    chatId,
                    CLOSED_CONVERSATION_MESSAGE,
                    "system",
                    [],
                    reopenConversationKeyboard(conversation.id),
                );
                return NextResponse.json({ ok: true, closed: true });
            }
            if (["escalated", "human_active"].includes(conversation.status)) {
                try {
                    await notifySupportSuperuser(
                        conversation.id,
                        parentName(message.from),
                        "Parent sent a non-text Telegram message.",
                        "New non-text message while Coach Patrick is handling the conversation.",
                    );
                } catch (error) {
                    console.error("Support non-text notification failed:", error);
                }
                return NextResponse.json({ ok: true, waitingForHuman: true });
            }
            await sendAndStore(conversation.id, chatId, "I can currently help with text messages. Please type and send your question below. If you need personal assistance, ask for Coach Patrick.", "system");
            return NextResponse.json({ ok: true });
        }

        if (text.startsWith("/start")) {
            if (["escalated", "human_active"].includes(conversation.status)) {
                await sendAndStore(conversation.id, chatId, "Coach Patrick is already handling this conversation. You can continue typing your messages here, and the AI assistant will remain paused.", "system");
                return NextResponse.json({ ok: true, waitingForHuman: true });
            }
            if (["resolved", "closed_parent"].includes(conversation.status)) {
                await setConversationStatus(conversation, "ai_active", "parent", "Parent restarted the bot.");
            }
            await sendAndStore(
                conversation.id,
                chatId,
                AI_INTRO_MESSAGE,
                "ai",
            );
            return NextResponse.json({ ok: true });
        }
        if (text.startsWith("/help")) {
            if (["escalated", "human_active"].includes(conversation.status)) {
                await sendAndStore(conversation.id, chatId, "Coach Patrick is handling this conversation. Continue typing your message here, use /status to check the conversation, or use /close to close it.", "system");
                return NextResponse.json({ ok: true, waitingForHuman: true });
            }
            await sendAndStore(conversation.id, chatId, "Type and send any general PatLau coaching question. You can also ask to speak with Coach Patrick, use /status to check the conversation, or use /close to close it.", "system");
            return NextResponse.json({ ok: true });
        }
        if (text.startsWith("/status")) {
            if (["resolved", "closed_parent"].includes(conversation.status)) {
                await sendAndStore(
                    conversation.id,
                    chatId,
                    CLOSED_CONVERSATION_MESSAGE,
                    "system",
                    [],
                    reopenConversationKeyboard(conversation.id),
                );
            } else {
                await sendAndStore(conversation.id, chatId, `Current conversation status: ${String(conversation.status).replaceAll("_", " ")}.`, "system");
            }
            return NextResponse.json({ ok: true });
        }
        if (text.startsWith("/close")) {
            if (conversation.status !== "closed_parent") {
                await setConversationStatus(conversation, "closed_parent", "parent", "Parent used /close.");
            }
            await sendAndStore(
                conversation.id,
                chatId,
                CLOSED_CONVERSATION_MESSAGE,
                "system",
                [],
                reopenConversationKeyboard(conversation.id),
            );
            return NextResponse.json({ ok: true });
        }

        const inserted = await saveInbound(conversation.id, String(message.message_id), text);
        if (!inserted) return NextResponse.json({ ok: true, duplicate: true });
        await supportAdmin.from("support_conversations").update({
            last_message_at: new Date().toISOString(),
            last_message_preview: text.slice(0, 180),
            unread_count: Number(conversation.unread_count || 0) + 1,
        }).eq("id", conversation.id);

        const name = parentName(message.from);
        if (["escalated", "human_active"].includes(conversation.status)) {
            try {
                await notifySupportSuperuser(conversation.id, name, text, conversation.status === "human_active" ? "New parent reply in a Coach Patrick-managed chat." : "New message in an escalated chat.");
            } catch (error) {
                console.error("Support follow-up notification failed:", error);
            }
            return NextResponse.json({ ok: true, waitingForHuman: true });
        }
        if (parentExplicitlyRequestsCoach(text)) {
            await escalate(conversation, chatId, name, text, "Parent requested Coach Patrick.");
            return NextResponse.json({ ok: true });
        }
        if (/\b(refund|complaint|complain|dispute)\b/i.test(text) || parentIsDissatisfied(text)) {
            await escalate(conversation, chatId, name, text, "Parent expressed dissatisfaction or raised a sensitive complaint, refund, or dispute.");
            return NextResponse.json({ ok: true });
        }
        if (["resolved", "closed_parent"].includes(conversation.status)) {
            await setConversationStatus(conversation, "ai_active", "parent", "Parent sent a new message.");
        }

        if (await moderateText(text)) {
            await escalate(conversation, chatId, name, text, "Message requires human review.");
            return NextResponse.json({ ok: true });
        }

        try {
            const result = await generateSupportReply(conversation.id, contact.telegram_user_id || chatId);
            if (result.needsHuman || !result.reply) {
                await escalate(conversation, chatId, name, text, result.reason);
                return NextResponse.json({ ok: true, escalated: true });
            }
            const includeDelayedFeedback = shouldOfferDelayedFeedback(result.previousAiReplyCount);
            await sendAndStore(
                conversation.id,
                chatId,
                result.reply,
                "ai",
                result.sources,
                includeDelayedFeedback ? delayedFeedbackKeyboard(conversation.id) : undefined,
            );
            await setConversationStatus(conversation, "waiting_parent", "ai", "AI response sent.");
            await supportAdmin.from("support_conversations").update({
                last_message_at: new Date().toISOString(),
                last_message_preview: result.reply.slice(0, 180),
            }).eq("id", conversation.id);
        } catch (error) {
            console.error("AI support response failed:", error);
            await escalate(conversation, chatId, name, text, error instanceof Error ? error.message : "AI response failed.");
        }

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("Parent support webhook error:", error);
        return NextResponse.json({ error: error instanceof Error ? error.message : "Unexpected webhook error." }, { status: 500 });
    }
}
