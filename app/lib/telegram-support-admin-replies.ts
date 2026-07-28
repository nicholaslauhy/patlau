import type { TelegramSupportAdminRecipient } from "./telegram-support-admin-policy";

type SupportDatabaseClient = {
    from: (table: string) => any;
};

const TELEGRAM_MESSAGE_ID_PATTERN = /^[1-9][0-9]{0,19}$/;

export interface TelegramSupportAdminReplyEnvelope {
    adminChatId: string;
    adminUserId: string;
    adminMessageId: string;
    repliedNotificationMessageId: string;
    content: string;
}

export interface TelegramSupportAdminNotificationRecord {
    id: string;
    telegram_admin_id: string | null;
    admin_display_name: string;
    telegram_chat_id: string;
    telegram_message_id: string | number;
    conversation_id: string | null;
    expected_parent_message_id: string | number | null;
    created_at: string;
    expires_at: string;
}

export interface TelegramSupportAdminReplyReceiptRecord {
    id: string;
    notification_id: string;
    telegram_admin_id: string | null;
    admin_display_name: string;
    telegram_chat_id: string;
    telegram_message_id: string | number;
    conversation_id: string | null;
    expected_parent_message_id: string | number | null;
    support_message_id: string | number | null;
    parent_telegram_message_id: string | number | null;
    status: "processing" | "delivered" | "failed" | "rejected";
    failure_code: string | null;
    created_at: string;
    updated_at: string;
}

export const TELEGRAM_SUPPORT_ADMIN_FORCE_REPLY_MARKUP = Object.freeze({
    force_reply: true,
    selective: false,
    input_field_placeholder: "Type Coach Patrick's reply to the parent",
});

function normalizeTelegramMessageId(value: unknown) {
    const normalized = typeof value === "number" || typeof value === "bigint"
        ? String(value)
        : typeof value === "string"
            ? value.trim()
            : "";
    return TELEGRAM_MESSAGE_ID_PATTERN.test(normalized) ? normalized : "";
}

/**
 * Extracts a direct reply to a bot alert. Authorization and alert ownership
 * must still be checked against the private mapping table before delivery.
 */
export function extractTelegramSupportAdminReply(
    message: Record<string, any> | null | undefined,
): TelegramSupportAdminReplyEnvelope | null {
    const adminChatId = String(message?.chat?.id || "").trim();
    const adminUserId = String(message?.from?.id || "").trim();
    const adminMessageId = normalizeTelegramMessageId(message?.message_id);
    const repliedNotificationMessageId = normalizeTelegramMessageId(
        message?.reply_to_message?.message_id,
    );

    if (
        message?.chat?.type !== "private"
        || !adminChatId
        || adminChatId !== adminUserId
        || !adminMessageId
        || !repliedNotificationMessageId
    ) {
        return null;
    }

    return {
        adminChatId,
        adminUserId,
        adminMessageId,
        repliedNotificationMessageId,
        content: String(message?.text || "").trim(),
    };
}

export async function loadLatestSupportParentMessageId(
    database: SupportDatabaseClient,
    conversationId: string,
) {
    const { data, error } = await database
        .from("support_messages")
        .select("id")
        .eq("conversation_id", conversationId)
        .eq("sender_type", "parent")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data?.id == null ? null : String(data.id);
}

export async function storeTelegramSupportAdminNotification(
    database: SupportDatabaseClient,
    input: {
        recipient: TelegramSupportAdminRecipient;
        telegramMessageId: string | number;
        conversationId: string;
        expectedParentMessageId: string | number | null;
    },
) {
    const telegramMessageId = normalizeTelegramMessageId(input.telegramMessageId);
    if (!telegramMessageId) {
        throw new Error("Telegram returned an invalid administrator notification message ID.");
    }

    const { data, error } = await database
        .from("telegram_support_admin_notifications")
        .upsert({
            telegram_admin_id: input.recipient.id,
            admin_display_name: input.recipient.displayName,
            telegram_chat_id: input.recipient.telegramChatId,
            telegram_message_id: telegramMessageId,
            conversation_id: input.conversationId,
            expected_parent_message_id: input.expectedParentMessageId,
        }, {
            onConflict: "telegram_chat_id,telegram_message_id",
        })
        .select("id")
        .single();
    if (error || !data) {
        throw error || new Error("Could not store the Telegram administrator notification mapping.");
    }
    return String(data.id);
}

export async function findTelegramSupportAdminNotification(
    database: SupportDatabaseClient,
    adminChatId: string,
    telegramMessageId: string | number,
): Promise<TelegramSupportAdminNotificationRecord | null> {
    const normalizedMessageId = normalizeTelegramMessageId(telegramMessageId);
    if (!adminChatId || !normalizedMessageId) return null;

    const { data, error } = await database
        .from("telegram_support_admin_notifications")
        .select([
            "id",
            "telegram_admin_id",
            "admin_display_name",
            "telegram_chat_id",
            "telegram_message_id",
            "conversation_id",
            "expected_parent_message_id",
            "created_at",
            "expires_at",
        ].join(","))
        .eq("telegram_chat_id", adminChatId)
        .eq("telegram_message_id", normalizedMessageId)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

export function telegramSupportAdminNotificationIsExpired(
    notification: Pick<TelegramSupportAdminNotificationRecord, "expires_at">,
    now = Date.now(),
) {
    const expiresAt = Date.parse(notification.expires_at);
    return !Number.isFinite(expiresAt) || expiresAt <= now;
}

/**
 * Claims one Telegram webhook message exactly once. A duplicate Telegram
 * delivery returns the existing receipt instead of allowing another send.
 */
export async function claimTelegramSupportAdminReplyReceipt(
    database: SupportDatabaseClient,
    input: {
        notification: TelegramSupportAdminNotificationRecord;
        adminMessageId: string | number;
    },
): Promise<{
    claimed: boolean;
    receipt: TelegramSupportAdminReplyReceiptRecord;
}> {
    const adminMessageId = normalizeTelegramMessageId(input.adminMessageId);
    if (!adminMessageId) throw new Error("The Telegram administrator reply message ID is invalid.");

    const values = {
        notification_id: input.notification.id,
        telegram_admin_id: input.notification.telegram_admin_id,
        admin_display_name: input.notification.admin_display_name,
        telegram_chat_id: input.notification.telegram_chat_id,
        telegram_message_id: adminMessageId,
        conversation_id: input.notification.conversation_id,
        expected_parent_message_id: input.notification.expected_parent_message_id,
        status: "processing",
    };
    const { data, error } = await database
        .from("telegram_support_admin_reply_receipts")
        .insert(values)
        .select("*")
        .single();

    if (!error && data) return { claimed: true, receipt: data };
    if (error?.code !== "23505") {
        throw error || new Error("Could not claim the Telegram administrator reply.");
    }

    const { data: existing, error: existingError } = await database
        .from("telegram_support_admin_reply_receipts")
        .select("*")
        .eq("telegram_chat_id", input.notification.telegram_chat_id)
        .eq("telegram_message_id", adminMessageId)
        .single();
    if (existingError || !existing) {
        throw existingError || new Error("Could not load the existing Telegram reply receipt.");
    }
    return { claimed: false, receipt: existing };
}

/**
 * The first administrator to answer a particular parent message owns that
 * reply turn. The same administrator may send follow-ups for that turn.
 */
export async function claimTelegramSupportAdminReplyTurn(
    database: SupportDatabaseClient,
    input: {
        notification: TelegramSupportAdminNotificationRecord;
    },
) {
    if (!input.notification.conversation_id || input.notification.expected_parent_message_id == null) {
        return { claimed: false, ownedByRequester: false, ownerDisplayName: null };
    }

    const values = {
        conversation_id: input.notification.conversation_id,
        expected_parent_message_id: input.notification.expected_parent_message_id,
        telegram_admin_id: input.notification.telegram_admin_id,
        admin_display_name: input.notification.admin_display_name,
        telegram_chat_id: input.notification.telegram_chat_id,
        notification_id: input.notification.id,
    };
    const { data, error } = await database
        .from("telegram_support_admin_reply_turns")
        .insert(values)
        .select("telegram_chat_id,admin_display_name")
        .single();
    if (!error && data) {
        return {
            claimed: true,
            ownedByRequester: true,
            ownerDisplayName: String(data.admin_display_name || ""),
        };
    }
    if (error?.code !== "23505") {
        throw error || new Error("Could not claim the Telegram administrator reply turn.");
    }

    const { data: existing, error: existingError } = await database
        .from("telegram_support_admin_reply_turns")
        .select("telegram_chat_id,admin_display_name")
        .eq("conversation_id", input.notification.conversation_id)
        .eq("expected_parent_message_id", input.notification.expected_parent_message_id)
        .single();
    if (existingError || !existing) {
        throw existingError || new Error("Could not load the Telegram administrator reply owner.");
    }
    return {
        claimed: false,
        ownedByRequester: String(existing.telegram_chat_id) === input.notification.telegram_chat_id,
        ownerDisplayName: String(existing.admin_display_name || ""),
    };
}

export async function finishTelegramSupportAdminReplyReceipt(
    database: SupportDatabaseClient,
    input: {
        receiptId: string;
        status: "delivered" | "failed" | "rejected";
        supportMessageId?: string | number | null;
        parentTelegramMessageId?: string | number | null;
        failureCode?: string | null;
    },
) {
    const { data, error } = await database
        .from("telegram_support_admin_reply_receipts")
        .update({
            status: input.status,
            support_message_id: input.supportMessageId || null,
            parent_telegram_message_id: input.parentTelegramMessageId || null,
            failure_code: input.failureCode || null,
            updated_at: new Date().toISOString(),
        })
        .eq("id", input.receiptId)
        .eq("status", "processing")
        .select("id")
        .maybeSingle();
    if (error) throw error;
    return Boolean(data);
}
