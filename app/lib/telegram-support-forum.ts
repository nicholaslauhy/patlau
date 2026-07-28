type SupportDatabaseClient = {
    from: (table: string) => any;
};

export type ForumDisplayState =
    | "needs_reply"
    | "coach_active"
    | "waiting_parent"
    | "ai_handling"
    | "closed";

type SupportConversationStatus =
    | "ai_active"
    | "waiting_parent"
    | "escalated"
    | "human_active"
    | "resolved"
    | "closed_parent";

type SupportMessageSender = "parent" | "ai" | "superuser" | "system";

type TelegramFetch = typeof fetch;

export interface TelegramSupportForumTopicRecord {
    id: string;
    conversation_id: string;
    telegram_forum_chat_id: string;
    telegram_message_thread_id: string | number | null;
    header_message_id: string | number | null;
    topic_name: string;
    lifecycle_status: "provisioning" | "open" | "closed" | "failed";
    display_state: ForumDisplayState;
    expected_parent_message_id: string | number | null;
    provisioning_token: string;
    provisioning_started_at: string;
    last_error_code: string | null;
    closed_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface TelegramSupportForumMessageEnvelope {
    forumChatId: string;
    messageThreadId: string;
    telegramMessageId: string;
    replyToTelegramMessageId: string | null;
    adminUserId: string;
    adminDisplayName: string;
    content: string;
}

export interface TelegramSupportForumReplyReceiptRecord {
    id: string;
    topic_id: string;
    telegram_message_id: string | number;
    telegram_admin_user_id: string;
    telegram_admin_display_name: string;
    support_message_id: string | number | null;
    telegram_parent_message_id: string | number | null;
    delivery_status: "received" | "sending" | "delivered" | "failed" | "ignored";
    delivery_error: string | null;
    delivered_at: string | null;
    created_at: string;
    updated_at: string;
}

interface TelegramSupportForumTransportOptions {
    token?: string;
    fetchImpl?: TelegramFetch;
}

interface TelegramSupportForumTarget extends TelegramSupportForumTransportOptions {
    chatId: string;
    messageThreadId: string | number;
}

const FORUM_CHAT_ID_PATTERN = /^-100[1-9][0-9]{5,16}$/;
const POSITIVE_TELEGRAM_ID_PATTERN = /^[1-9][0-9]{0,19}$/;
const TOPIC_NAME_MAX_LENGTH = 128;

const FORUM_STATE_LABELS: Record<ForumDisplayState, string> = Object.freeze({
    needs_reply: "🔴 Needs reply",
    coach_active: "🟠 Coach active",
    waiting_parent: "🟡 Waiting for parent",
    ai_handling: "🤖 AI handling",
    closed: "✅ Closed",
});

function normalizePositiveTelegramId(value: unknown) {
    if (
        typeof value === "number"
        && (!Number.isSafeInteger(value) || value <= 0)
    ) {
        return "";
    }
    const normalized = typeof value === "number" || typeof value === "bigint"
        ? String(value)
        : typeof value === "string"
            ? value.trim()
            : "";
    return POSITIVE_TELEGRAM_ID_PATTERN.test(normalized) ? normalized : "";
}

function telegramInteger(value: string | number, fieldName: string) {
    const normalized = normalizePositiveTelegramId(value);
    if (!normalized) {
        throw new Error(`${fieldName} must be a positive Telegram integer.`);
    }
    const numberValue = Number(normalized);
    return Number.isSafeInteger(numberValue) ? numberValue : normalized;
}

function unicodeLength(value: string) {
    return Array.from(value).length;
}

function truncateUnicode(value: string, maximum: number) {
    return Array.from(value).slice(0, Math.max(0, maximum)).join("");
}

function sanitizeSingleLine(value: unknown, fallback: string, maximum: number) {
    const normalized = String(value || "")
        .normalize("NFKC")
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return truncateUnicode(normalized || fallback, maximum);
}

function stableConversationSuffix(conversationId: unknown) {
    const normalized = String(conversationId || "")
        .replace(/[^a-zA-Z0-9]/g, "")
        .toUpperCase();
    return (normalized.slice(0, 8) || "CHAT");
}

function normalizeAuthorizedAdminIds(values: Iterable<unknown>) {
    return new Set(
        Array.from(values || [])
            .map(normalizePositiveTelegramId)
            .filter(Boolean),
    );
}

function sanitizeDeliveryError(value: unknown) {
    return sanitizeSingleLine(value, "Telegram delivery failed.", 1000)
        .replace(/bot[0-9]+:[A-Za-z0-9_-]+/gi, "bot[redacted]");
}

export function getConfiguredTelegramSupportForumChatId(
    value = process.env.TELEGRAM_PARENT_SUPPORT_FORUM_CHAT_ID,
) {
    const normalized = typeof value === "string" ? value.trim() : "";
    return FORUM_CHAT_ID_PATTERN.test(normalized) ? normalized : null;
}

export function isTelegramSupportForumConfigured(
    value = process.env.TELEGRAM_PARENT_SUPPORT_FORUM_CHAT_ID,
) {
    return getConfiguredTelegramSupportForumChatId(value) !== null;
}

export function getTelegramSupportForumSetupError(input?: {
    forumChatId?: string | null;
    botToken?: string | null;
}) {
    const configuredId = getConfiguredTelegramSupportForumChatId(
        input && Object.hasOwn(input, "forumChatId")
            ? String(input.forumChatId || "")
            : process.env.TELEGRAM_PARENT_SUPPORT_FORUM_CHAT_ID,
    );
    if (!configuredId) {
        return "The Telegram support forum group is not configured with a valid -100… supergroup ID.";
    }

    const token = input && Object.hasOwn(input, "botToken")
        ? String(input.botToken || "").trim()
        : String(process.env.TELEGRAM_PARENT_SUPPORT_BOT_TOKEN || "").trim();
    if (!token) {
        return "The Telegram parent-support bot token is not configured.";
    }
    return null;
}

export function deriveTelegramSupportForumDisplayState(
    status: SupportConversationStatus | string,
    latestSenderType?: SupportMessageSender | string | null,
): ForumDisplayState {
    if (status === "resolved" || status === "closed_parent") return "closed";
    if (status === "escalated") return "needs_reply";
    if (status === "human_active") {
        if (latestSenderType === "parent") return "needs_reply";
        if (latestSenderType === "superuser") return "waiting_parent";
        return "coach_active";
    }
    if (status === "waiting_parent") return "waiting_parent";
    return "ai_handling";
}

export function buildTelegramSupportForumTopicTitle(input: {
    conversationId: string;
    parentName?: string | null;
    state: ForumDisplayState;
}) {
    const label = FORUM_STATE_LABELS[input.state] || FORUM_STATE_LABELS.ai_handling;
    const suffix = ` · #${stableConversationSuffix(input.conversationId)}`;
    const fixedLength = unicodeLength(label) + unicodeLength(suffix) + 3;
    const parent = sanitizeSingleLine(
        input.parentName,
        "Parent",
        Math.max(1, TOPIC_NAME_MAX_LENGTH - fixedLength),
    );
    return truncateUnicode(
        `${label} · ${parent}${suffix}`,
        TOPIC_NAME_MAX_LENGTH,
    );
}

/**
 * Extracts a parent-facing administrator reply from one private forum topic.
 * The caller supplies the currently active administrator user IDs; the group
 * chat ID itself must never be treated as an administrator identity.
 */
export function parseTelegramSupportForumMessage(
    message: Record<string, any> | null | undefined,
    input: {
        forumChatId: string;
        authorizedAdminUserIds: Iterable<unknown>;
    },
): TelegramSupportForumMessageEnvelope | null {
    const configuredForumChatId = getConfiguredTelegramSupportForumChatId(input.forumChatId);
    const forumChatId = String(message?.chat?.id || "").trim();
    const messageThreadId = normalizePositiveTelegramId(message?.message_thread_id);
    const telegramMessageId = normalizePositiveTelegramId(message?.message_id);
    const replyToTelegramMessageId =
        normalizePositiveTelegramId(message?.reply_to_message?.message_id) || null;
    const adminUserId = normalizePositiveTelegramId(message?.from?.id);
    const content = typeof message?.text === "string" ? message.text.trim() : "";
    const authorizedAdminIds = normalizeAuthorizedAdminIds(
        input.authorizedAdminUserIds,
    );

    if (
        !configuredForumChatId
        || forumChatId !== configuredForumChatId
        || message?.chat?.type !== "supergroup"
        || message?.chat?.is_forum !== true
        || message?.is_topic_message !== true
        || !messageThreadId
        || messageThreadId === "1"
        || !telegramMessageId
        || !adminUserId
        || message?.from?.is_bot === true
        || message?.sender_chat
        || !authorizedAdminIds.has(adminUserId)
        || !content
        || content.startsWith("/")
    ) {
        return null;
    }

    const adminDisplayName = sanitizeSingleLine(
        [
            message?.from?.first_name,
            message?.from?.last_name,
        ].filter(Boolean).join(" ") || message?.from?.username,
        "Telegram administrator",
        80,
    );

    return {
        forumChatId,
        messageThreadId,
        telegramMessageId,
        replyToTelegramMessageId,
        adminUserId,
        adminDisplayName,
        content,
    };
}

export class TelegramSupportForumApiError extends Error {
    method: string;
    httpStatus: number;
    telegramErrorCode: number | null;

    constructor(
        method: string,
        message: string,
        httpStatus: number,
        telegramErrorCode: number | null,
    ) {
        super(message);
        this.name = "TelegramSupportForumApiError";
        this.method = method;
        this.httpStatus = httpStatus;
        this.telegramErrorCode = telegramErrorCode;
    }
}

async function callTelegramSupportForumApi<T>(
    method: string,
    payload: Record<string, unknown>,
    options: TelegramSupportForumTransportOptions = {},
): Promise<T> {
    const token = String(
        options.token || process.env.TELEGRAM_PARENT_SUPPORT_BOT_TOKEN || "",
    ).trim();
    if (!token) {
        throw new Error("The Telegram parent-support bot token is not configured.");
    }

    const fetchImpl = options.fetchImpl || fetch;
    let response: Response;
    try {
        response = await fetchImpl(
            `https://api.telegram.org/bot${token}/${method}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: AbortSignal.timeout(10_000),
                body: JSON.stringify(payload),
            },
        );
    } catch (error) {
        throw new TelegramSupportForumApiError(
            method,
            sanitizeDeliveryError(error instanceof Error ? error.message : error),
            0,
            null,
        );
    }

    const data = await response.json().catch(() => null) as {
        ok?: boolean;
        result?: T;
        description?: string;
        error_code?: number;
    } | null;
    if (!response.ok || !data?.ok) {
        throw new TelegramSupportForumApiError(
            method,
            sanitizeDeliveryError(data?.description || "Telegram rejected the forum request."),
            response.status,
            Number.isInteger(data?.error_code) ? Number(data?.error_code) : null,
        );
    }
    return data.result as T;
}

function normalizedForumTarget(input: TelegramSupportForumTarget) {
    const chatId = getConfiguredTelegramSupportForumChatId(input.chatId);
    if (!chatId) {
        throw new Error("A valid Telegram forum supergroup ID is required.");
    }
    return {
        chatId,
        messageThreadId: telegramInteger(
            input.messageThreadId,
            "The Telegram message thread ID",
        ),
    };
}

export function createTelegramSupportForumTopic(input: {
    chatId: string;
    name: string;
    iconColor?: number;
} & TelegramSupportForumTransportOptions) {
    const chatId = getConfiguredTelegramSupportForumChatId(input.chatId);
    if (!chatId) throw new Error("A valid Telegram forum supergroup ID is required.");
    const name = sanitizeSingleLine(input.name, "Parent support", TOPIC_NAME_MAX_LENGTH);
    return callTelegramSupportForumApi<{
        message_thread_id: number;
        name: string;
        icon_color: number;
        icon_custom_emoji_id?: string;
    }>("createForumTopic", {
        chat_id: chatId,
        name,
        ...(Number.isInteger(input.iconColor) ? { icon_color: input.iconColor } : {}),
    }, input);
}

export function sendTelegramSupportForumMessage(input: {
    chatId: string;
    messageThreadId: string | number;
    text: string;
    replyMarkup?: Record<string, unknown>;
    disableNotification?: boolean;
} & TelegramSupportForumTransportOptions) {
    const target = normalizedForumTarget(input);
    const text = String(input.text || "").trim();
    if (!text) throw new Error("A Telegram forum message cannot be empty.");
    return callTelegramSupportForumApi<Record<string, any>>("sendMessage", {
        chat_id: target.chatId,
        message_thread_id: target.messageThreadId,
        text,
        ...(input.replyMarkup ? { reply_markup: input.replyMarkup } : {}),
        ...(typeof input.disableNotification === "boolean"
            ? { disable_notification: input.disableNotification }
            : {}),
    }, input);
}

export function editTelegramSupportForumTopic(input: {
    chatId: string;
    messageThreadId: string | number;
    name: string;
} & TelegramSupportForumTransportOptions) {
    const target = normalizedForumTarget(input);
    return callTelegramSupportForumApi<boolean>("editForumTopic", {
        chat_id: target.chatId,
        message_thread_id: target.messageThreadId,
        name: sanitizeSingleLine(input.name, "Parent support", TOPIC_NAME_MAX_LENGTH),
    }, input);
}

export function closeTelegramSupportForumTopic(input: TelegramSupportForumTarget) {
    const target = normalizedForumTarget(input);
    return callTelegramSupportForumApi<boolean>("closeForumTopic", {
        chat_id: target.chatId,
        message_thread_id: target.messageThreadId,
    }, input);
}

export function reopenTelegramSupportForumTopic(input: TelegramSupportForumTarget) {
    const target = normalizedForumTarget(input);
    return callTelegramSupportForumApi<boolean>("reopenForumTopic", {
        chat_id: target.chatId,
        message_thread_id: target.messageThreadId,
    }, input);
}

export function deleteTelegramSupportForumTopic(input: TelegramSupportForumTarget) {
    const target = normalizedForumTarget(input);
    return callTelegramSupportForumApi<boolean>("deleteForumTopic", {
        chat_id: target.chatId,
        message_thread_id: target.messageThreadId,
    }, input);
}

export function reactToTelegramSupportForumMessage(input: {
    chatId: string;
    messageId: string | number;
    emoji?: string;
} & TelegramSupportForumTransportOptions) {
    const chatId = getConfiguredTelegramSupportForumChatId(input.chatId);
    if (!chatId) throw new Error("A valid Telegram forum supergroup ID is required.");
    return callTelegramSupportForumApi<boolean>("setMessageReaction", {
        chat_id: chatId,
        message_id: telegramInteger(input.messageId, "The Telegram message ID"),
        reaction: [{
            type: "emoji",
            emoji: sanitizeSingleLine(input.emoji, "✅", 8),
        }],
        is_big: false,
    }, input);
}

const FORUM_TOPIC_COLUMNS = [
    "id",
    "conversation_id",
    "telegram_forum_chat_id",
    "telegram_message_thread_id",
    "header_message_id",
    "topic_name",
    "lifecycle_status",
    "display_state",
    "expected_parent_message_id",
    "provisioning_token",
    "provisioning_started_at",
    "last_error_code",
    "closed_at",
    "created_at",
    "updated_at",
].join(",");

export async function loadForumTopicByConversation(
    database: SupportDatabaseClient,
    conversationId: string,
    forumChatId?: string | null,
): Promise<TelegramSupportForumTopicRecord | null> {
    if (!String(conversationId || "").trim()) return null;
    let query = database
        .from("telegram_support_forum_topics")
        .select(FORUM_TOPIC_COLUMNS)
        .eq("conversation_id", conversationId)
        .in("lifecycle_status", ["open", "closed"]);
    const normalizedForumChatId = forumChatId
        ? getConfiguredTelegramSupportForumChatId(forumChatId)
        : null;
    if (forumChatId && !normalizedForumChatId) return null;
    if (normalizedForumChatId) {
        query = query.eq("telegram_forum_chat_id", normalizedForumChatId);
    }
    const { data, error } = await query
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

export async function loadForumTopicByThread(
    database: SupportDatabaseClient,
    forumChatId: string,
    messageThreadId: string | number,
): Promise<TelegramSupportForumTopicRecord | null> {
    const normalizedForumChatId = getConfiguredTelegramSupportForumChatId(forumChatId);
    const normalizedThreadId = normalizePositiveTelegramId(messageThreadId);
    if (!normalizedForumChatId || !normalizedThreadId) return null;
    const { data, error } = await database
        .from("telegram_support_forum_topics")
        .select(FORUM_TOPIC_COLUMNS)
        .eq("telegram_forum_chat_id", normalizedForumChatId)
        .eq("telegram_message_thread_id", normalizedThreadId)
        .in("lifecycle_status", ["open", "closed"])
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

/**
 * Resolves a Telegram forum message to the canonical support message it
 * represents. Forum alert IDs and administrator message IDs live in the
 * private group, so they must be scoped to the already-verified topic.
 */
export async function resolveTelegramSupportForumReplyTarget(
    database: SupportDatabaseClient,
    topicId: string,
    telegramMessageId: string | number | null | undefined,
    conversationId: string,
): Promise<string | null> {
    const normalizedTopicId = String(topicId || "").trim();
    const normalizedMessageId = normalizePositiveTelegramId(telegramMessageId);
    const normalizedConversationId = String(conversationId || "").trim();
    if (
        !normalizedTopicId
        || !normalizedMessageId
        || !normalizedConversationId
    ) {
        return null;
    }

    const notification = await database
        .from("telegram_support_forum_notifications")
        .select("expected_parent_message_id")
        .eq("topic_id", normalizedTopicId)
        .eq("telegram_message_id", normalizedMessageId)
        .maybeSingle();
    if (notification.error) throw notification.error;
    let supportMessageId = normalizePositiveTelegramId(
        notification.data?.expected_parent_message_id,
    );
    if (!supportMessageId) {
        const receipt = await database
            .from("telegram_support_forum_reply_receipts")
            .select("support_message_id")
            .eq("topic_id", normalizedTopicId)
            .eq("telegram_message_id", normalizedMessageId)
            .maybeSingle();
        if (receipt.error) throw receipt.error;
        supportMessageId =
            normalizePositiveTelegramId(receipt.data?.support_message_id);
    }
    if (!supportMessageId) return null;

    const target = await database
        .from("support_messages")
        .select("id")
        .eq("id", supportMessageId)
        .eq("conversation_id", normalizedConversationId)
        .maybeSingle();
    if (target.error) throw target.error;
    return normalizePositiveTelegramId(target.data?.id) || null;
}

export async function claimTelegramSupportForumReplyReceipt(
    database: SupportDatabaseClient,
    input: {
        topicId: string;
        telegramMessageId: string | number;
        adminUserId: string | number;
        adminDisplayName: string;
    },
): Promise<{
    claimed: boolean;
    receipt: TelegramSupportForumReplyReceiptRecord;
}> {
    const topicId = String(input.topicId || "").trim();
    const telegramMessageId = normalizePositiveTelegramId(input.telegramMessageId);
    const adminUserId = normalizePositiveTelegramId(input.adminUserId);
    const adminDisplayName = sanitizeSingleLine(
        input.adminDisplayName,
        "Telegram administrator",
        80,
    );
    if (!topicId || !telegramMessageId || !adminUserId) {
        throw new Error("The Telegram forum reply receipt contains invalid identifiers.");
    }

    const { data, error } = await database
        .from("telegram_support_forum_reply_receipts")
        .insert({
            topic_id: topicId,
            telegram_message_id: telegramMessageId,
            telegram_admin_user_id: adminUserId,
            telegram_admin_display_name: adminDisplayName,
            delivery_status: "received",
        })
        .select("*")
        .single();
    if (!error && data) return { claimed: true, receipt: data };
    if (error?.code !== "23505") {
        throw error || new Error("Could not claim the Telegram forum reply.");
    }

    const { data: existing, error: existingError } = await database
        .from("telegram_support_forum_reply_receipts")
        .select("*")
        .eq("topic_id", topicId)
        .eq("telegram_message_id", telegramMessageId)
        .single();
    if (existingError || !existing) {
        throw existingError || new Error("Could not load the existing Telegram forum reply receipt.");
    }
    return { claimed: false, receipt: existing };
}

export async function finishTelegramSupportForumReplyReceipt(
    database: SupportDatabaseClient,
    input: {
        receiptId: string;
        status: "sending" | "delivered" | "failed" | "ignored";
        supportMessageId?: string | number | null;
        parentTelegramMessageId?: string | number | null;
        deliveryError?: string | null;
    },
) {
    const updates: Record<string, unknown> = {
        delivery_status: input.status,
        updated_at: new Date().toISOString(),
    };
    if (Object.hasOwn(input, "supportMessageId")) {
        updates.support_message_id = input.supportMessageId || null;
    }
    if (Object.hasOwn(input, "parentTelegramMessageId")) {
        updates.telegram_parent_message_id = input.parentTelegramMessageId || null;
    }
    if (input.status === "delivered") {
        updates.delivered_at = new Date().toISOString();
        updates.delivery_error = null;
    } else if (input.status === "failed" || input.status === "ignored") {
        updates.delivery_error = sanitizeDeliveryError(input.deliveryError);
    }

    const { data, error } = await database
        .from("telegram_support_forum_reply_receipts")
        .update(updates)
        .eq("id", input.receiptId)
        .in("delivery_status", ["received", "sending"])
        .select("id")
        .maybeSingle();
    if (error) throw error;
    return Boolean(data);
}
