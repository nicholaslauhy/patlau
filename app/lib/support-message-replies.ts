import {
    extractSupportImageFileId,
    publicSupportSourceRefs,
} from "./support-image-server";

type SupportDatabaseClient = {
    from: (table: string) => any;
};

type SupportMessageSender = "parent" | "ai" | "superuser" | "system";
type SupportMessageDirection = "inbound" | "outbound";

export interface PublicSupportReplyPreview {
    message_id: number;
    sender_type: SupportMessageSender;
    text: string;
    has_image: boolean;
}

export interface PublicSupportMessageProjection {
    id: number;
    conversation_id: string;
    direction: SupportMessageDirection;
    sender_type: SupportMessageSender;
    sender_user_id: string | null;
    content: string;
    source_refs: string[];
    has_image: boolean;
    telegram_delivery_status: string | null;
    created_at: string;
    reply_preview: PublicSupportReplyPreview | null;
}

export interface SupportMessageInsertResult<T = Record<string, any>> {
    data: T | null;
    error: any;
    replyContextStored: boolean;
    usedLegacyReplyFallback: boolean;
}

const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const REPLY_COLUMN = "reply_to_message_id";

function positiveIntegerString(value: unknown) {
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
    return POSITIVE_INTEGER_PATTERN.test(normalized) ? normalized : "";
}

function positiveSafeInteger(value: unknown) {
    const normalized = positiveIntegerString(value);
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function missingReplyColumnError(error: any) {
    if (String(error?.code || "").toUpperCase() !== "PGRST204") return false;
    const description = [
        error?.message,
        error?.details,
        error?.hint,
    ].filter(Boolean).join(" ").toLowerCase();
    return description.includes(REPLY_COLUMN);
}

function missingReplyTargetError(error: any) {
    if (String(error?.code || "") !== "23503") return false;
    const description = [
        error?.message,
        error?.details,
        error?.hint,
        error?.constraint,
    ].filter(Boolean).join(" ").toLowerCase();
    return (
        description.includes(REPLY_COLUMN)
        || description.includes("support_messages_reply_same_conversation_fk")
        || description.includes("support_messages_reply_target_fk")
    );
}

async function insertOneSupportMessage(
    database: SupportDatabaseClient,
    values: Record<string, unknown>,
) {
    return database
        .from("support_messages")
        .insert(values)
        .select("*")
        .single();
}

/**
 * Telegram update objects use a positive numeric message ID for a normal
 * same-chat reply. Return it as a string so no precision is lost when it is
 * passed through PostgREST.
 */
export function extractTelegramReplyToMessageId(
    message: Record<string, any> | null | undefined,
) {
    const value = message?.reply_to_message?.message_id;
    return positiveIntegerString(value) || null;
}

/**
 * Resolve a Telegram message only inside the current support conversation.
 * This constraint prevents a forged or colliding Telegram ID from linking
 * parent data across conversations.
 */
export async function resolveSupportReplyTargetId(
    database: SupportDatabaseClient,
    input: {
        conversationId: string;
        telegramMessageId: string | number;
    },
) {
    const conversationId = String(input.conversationId || "").trim();
    const telegramMessageId = positiveIntegerString(input.telegramMessageId);
    if (!conversationId || !telegramMessageId) return null;

    const { data, error } = await database
        .from("support_messages")
        .select("id")
        .eq("conversation_id", conversationId)
        .eq("telegram_message_id", telegramMessageId)
        .maybeSingle();
    if (error) throw error;
    return positiveSafeInteger(data?.id);
}

/**
 * Insert reply-aware messages during a rolling database deployment. PGRST204
 * for this exact new column means PostgREST rejected the request before an
 * insert occurred. A reply-target 23503 means the original was deleted after
 * it was resolved. Both statements are atomic failures, so one retry without
 * optional quote context is safe. Every other error is returned without a
 * retry to avoid duplicate messages.
 */
export async function insertSupportMessageWithReplyFallback<T = Record<string, any>>(
    database: SupportDatabaseClient,
    values: Record<string, unknown>,
    replyToMessageId?: string | number | null,
): Promise<SupportMessageInsertResult<T>> {
    const normalizedReplyId = positiveSafeInteger(replyToMessageId);
    const baseValues = { ...values };
    if (!normalizedReplyId) {
        const result = await insertOneSupportMessage(database, baseValues);
        return {
            data: result.data || null,
            error: result.error || null,
            replyContextStored: false,
            usedLegacyReplyFallback: false,
        };
    }

    const first = await insertOneSupportMessage(database, {
        ...baseValues,
        [REPLY_COLUMN]: normalizedReplyId,
    });
    if (
        first.data
        || (
            !missingReplyColumnError(first.error)
            && !missingReplyTargetError(first.error)
        )
    ) {
        return {
            data: first.data || null,
            error: first.error || null,
            replyContextStored: !first.error,
            usedLegacyReplyFallback: false,
        };
    }

    const legacy = await insertOneSupportMessage(database, baseValues);
    return {
        data: legacy.data || null,
        error: legacy.error || null,
        replyContextStored: false,
        usedLegacyReplyFallback: true,
    };
}

function publicReplyPreview(
    source: Record<string, any>,
    target: Record<string, any>,
): PublicSupportReplyPreview | null {
    if (
        String(source.conversation_id || "")
        !== String(target.conversation_id || "")
    ) {
        return null;
    }
    const messageId = positiveSafeInteger(target.id);
    if (!messageId) return null;
    return {
        message_id: messageId,
        sender_type: target.sender_type as SupportMessageSender,
        text: String(target.content ?? ""),
        has_image: Boolean(extractSupportImageFileId(target.source_refs)),
    };
}

/**
 * Build the superuser-facing chat payload from an already loaded conversation.
 * Explicit field selection prevents raw Telegram IDs, the reply foreign key,
 * internal image references, or future database columns from leaking.
 */
export function buildPublicSupportMessages(
    messages: Array<Record<string, any>> | null | undefined,
): PublicSupportMessageProjection[] {
    const rows = Array.isArray(messages) ? messages : [];
    const byId = new Map<string, Record<string, any>>();
    for (const row of rows) {
        const id = positiveIntegerString(row?.id);
        if (id) byId.set(id, row);
    }

    return rows.map((message) => {
        const replyId = positiveIntegerString(message?.reply_to_message_id);
        const target = replyId ? byId.get(replyId) : undefined;
        const replyPreview = target
            ? publicReplyPreview(message, target)
            : null;

        return {
            id: Number(message.id),
            conversation_id: String(message.conversation_id || ""),
            direction: message.direction as SupportMessageDirection,
            sender_type: message.sender_type as SupportMessageSender,
            sender_user_id: typeof message.sender_user_id === "string"
                ? message.sender_user_id
                : null,
            content: String(message.content ?? ""),
            source_refs: publicSupportSourceRefs(message.source_refs),
            has_image: Boolean(extractSupportImageFileId(message.source_refs)),
            telegram_delivery_status:
                typeof message.telegram_delivery_status === "string"
                    ? message.telegram_delivery_status
                    : null,
            created_at: String(message.created_at || ""),
            reply_preview: replyPreview,
        };
    });
}

export function buildPublicSupportMessage(
    message: Record<string, any>,
    loadedConversationMessages: Array<Record<string, any>>,
) {
    const projected = buildPublicSupportMessages(loadedConversationMessages);
    const messageId = positiveIntegerString(message?.id);
    return projected.find((candidate) => String(candidate.id) === messageId) || null;
}
