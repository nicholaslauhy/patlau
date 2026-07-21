import { createClient, type User } from "@supabase/supabase-js";
import type { SupportStatus } from "../../types/support";
import { getStoredUserRole } from "./server-auth";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supportAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
});

const supportAuth = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
});

export async function getSupportSuperuser(request: Request): Promise<User | null> {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) return null;
    const { data, error } = await supportAuth.auth.getUser(authorization.slice(7));
    if (error || !data.user) return null;
    const { data: current, error: currentError } =
        await supportAdmin.auth.admin.getUserById(data.user.id);
    if (currentError || !current.user) return null;
    return getStoredUserRole(current.user) === "superuser" ? current.user : null;
}

export function getSingaporeDateKey() {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Singapore",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date());
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
}

export async function sendSupportTelegramMessage(
    chatId: string,
    text: string,
    replyMarkup?: Record<string, unknown>,
) {
    const token = process.env.TELEGRAM_PARENT_SUPPORT_BOT_TOKEN;
    if (!token) throw new Error("Missing TELEGRAM_PARENT_SUPPORT_BOT_TOKEN.");

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: chatId,
            text,
            ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
        throw new Error(data?.description || "Telegram could not deliver the message.");
    }
    return data.result;
}

export async function answerSupportCallback(callbackQueryId: string, text: string) {
    const token = process.env.TELEGRAM_PARENT_SUPPORT_BOT_TOKEN;
    if (!token) return;
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: false }),
    });
}

export async function clearSupportTelegramKeyboard(chatId: string, messageId: string | number) {
    const token = process.env.TELEGRAM_PARENT_SUPPORT_BOT_TOKEN;
    if (!token) return;
    const response = await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [] },
        }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
        throw new Error(data?.description || "Telegram could not update the conversation controls.");
    }
}

export async function notifySupportSuperuser(
    conversationId: string,
    parentName: string,
    message: string,
    reason: string,
) {
    const chatId = process.env.TELEGRAM_PARENT_SUPPORT_ADMIN_CHAT_ID;
    if (!chatId) return;
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
    const link = siteUrl ? `\n\nOpen conversation: ${siteUrl}/chats?conversation=${conversationId}` : "";
    await sendSupportTelegramMessage(
        chatId,
        `Parent chat needs attention\n\nParent: ${parentName}\nReason: ${reason}\n\nLatest message:\n${message.slice(0, 700)}${link}`,
    );
}

export async function recordSupportStatus(
    conversationId: string,
    fromStatus: SupportStatus | null,
    toStatus: SupportStatus,
    actorType: "parent" | "ai" | "superuser" | "system",
    reason?: string | null,
    actorUserId?: string | null,
) {
    await supportAdmin.from("support_status_events").insert({
        conversation_id: conversationId,
        from_status: fromStatus,
        to_status: toStatus,
        actor_type: actorType,
        actor_user_id: actorUserId || null,
        reason: reason || null,
    });
}
