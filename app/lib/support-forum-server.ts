import type { SupportStatus } from "../../types/support";
import {
    buildTelegramSupportForumTopicTitle,
    closeTelegramSupportForumTopic,
    createTelegramSupportForumTopic,
    deleteTelegramSupportForumMessage,
    deleteTelegramSupportForumTopic,
    deriveTelegramSupportForumDisplayState,
    editTelegramSupportForumTopic,
    getConfiguredTelegramSupportForumChatId,
    getTelegramSupportForumTopicIconCustomEmojiId,
    pinTelegramSupportForumMessage,
    reopenTelegramSupportForumTopic,
    sendTelegramSupportForumMessage,
    sendTelegramSupportForumPhoto,
    TelegramSupportForumApiError,
    type ForumDisplayState,
    type TelegramSupportForumTopicRecord,
} from "./telegram-support-forum";
import { extractSupportImageFileId } from "./support-image-server";
import { formatSupportConversationLinks } from "./support-links";

export type SupportForumDatabaseClient = {
    from: (table: string) => any;
};

type SupportMessageSender = "parent" | "ai" | "superuser" | "system";
type TelegramFetch = typeof fetch;

type ForumTransportOptions = {
    forumChatId?: string | null;
    token?: string | null;
    fetchImpl?: TelegramFetch;
    siteUrl?: string | null;
};

type ForumResultBase = {
    fallbackRequired: boolean;
    reason: string | null;
    errorCode: string | null;
};

export type ForumProvisionResult = ForumResultBase & {
    state: "ready" | "unconfigured" | "provisioning" | "failed";
    created: boolean;
    topic: TelegramSupportForumTopicRecord | null;
};

export type ForumNotificationResult = ForumResultBase & {
    delivered: boolean;
    duplicate: boolean;
    inFlight: boolean;
    telegramMessageId: string | number | null;
    topic: TelegramSupportForumTopicRecord | null;
};

export type ForumSyncResult = ForumResultBase & {
    synced: boolean;
    noTopic: boolean;
    topic: TelegramSupportForumTopicRecord | null;
};

export type ForumMirrorResult = ForumResultBase & {
    mirrored: boolean;
    noTopic: boolean;
    telegramMessageId: string | number | null;
    topic: TelegramSupportForumTopicRecord | null;
};

export type ForumTurnClaimResult = ForumResultBase & {
    claimed: boolean;
    claimedByCaller: boolean;
    turn: Record<string, any> | null;
};

export type ForumDeleteResult = ForumResultBase & {
    canDeleteConversation: boolean;
    deleted: boolean;
    noTopic: boolean;
};

const TOPICS_TABLE = "telegram_support_forum_topics";
const NOTIFICATIONS_TABLE = "telegram_support_forum_notifications";
const TURNS_TABLE = "telegram_support_forum_reply_turns";
const PROVISIONING_STALE_AFTER_MS = 60_000;
const NOTIFICATION_STALE_AFTER_MS = 60_000;
const DELETION_TOMBSTONE_RECOVERY_AFTER_MS = 60_000;
const FORUM_PROVISIONING_RETRY_DELAYS_MS = [75, 150, 300, 600];
const FORUM_NOTIFICATION_RETRY_DELAYS_MS = [100, 250, 500];
const TOPIC_DELETION_PENDING_CODE = "topic_deletion_pending";
const TOPIC_DELETED_TOMBSTONE_CODE =
    "topic_deleted_pending_conversation_delete";

function hasOwn(object: object, key: string) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

function configuredForumChatId(input: ForumTransportOptions) {
    const value = hasOwn(input, "forumChatId")
        ? input.forumChatId || ""
        : process.env.TELEGRAM_PARENT_SUPPORT_FORUM_CHAT_ID;
    return getConfiguredTelegramSupportForumChatId(value);
}

function configuredBotToken(input: ForumTransportOptions) {
    return String(
        hasOwn(input, "token")
            ? input.token || ""
            : process.env.TELEGRAM_PARENT_SUPPORT_BOT_TOKEN || "",
    ).trim();
}

function transport(input: ForumTransportOptions) {
    return {
        ...(configuredBotToken(input) ? { token: configuredBotToken(input) } : {}),
        ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    };
}

function configuredSiteUrl(input: ForumTransportOptions) {
    return String(
        hasOwn(input, "siteUrl")
            ? input.siteUrl || ""
            : process.env.NEXT_PUBLIC_SITE_URL || "",
    ).trim();
}

function cleanIdentifier(value: unknown) {
    return String(value || "").trim();
}

function positiveInteger(value: unknown) {
    const normalized = typeof value === "number" || typeof value === "bigint"
        ? String(value)
        : typeof value === "string"
            ? value.trim()
            : "";
    return /^[1-9][0-9]*$/.test(normalized) ? normalized : "";
}

function cleanDisplayName(value: unknown) {
    return String(value || "")
        .normalize("NFKC")
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80) || "Telegram administrator";
}

function errorText(error: unknown) {
    return String(error instanceof Error ? error.message : error || "Unknown error")
        .replace(/bot[0-9]+:[A-Za-z0-9_-]+/gi, "bot[redacted]")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 300);
}

function databaseErrorCode(error: any, fallback = "database_error") {
    const code = String(error?.code || "").replace(/[^A-Za-z0-9_.:-]/g, "");
    return (code ? `db_${code}` : fallback).slice(0, 100);
}

function telegramErrorCode(
    error: unknown,
    operation: "create" | "notify" | "sync" | "mirror" | "delete",
) {
    if (error instanceof TelegramSupportForumApiError) {
        if (error.httpStatus === 0) return `telegram_${operation}_ambiguous`;
        return `telegram_${operation}_rejected`;
    }
    return `telegram_${operation}_ambiguous`;
}

function isUniqueViolation(error: any) {
    return error?.code === "23505";
}

function isForumSchemaUnavailable(error: any) {
    const code = String(error?.code || "").toUpperCase();
    const message = String(error?.message || error?.details || "")
        .toLowerCase();
    return (
        code === "42P01"
        || code === "PGRST205"
        || (
            message.includes("telegram_support_forum_topics")
            && (
                message.includes("does not exist")
                || message.includes("schema cache")
                || message.includes("could not find the table")
            )
        )
    );
}

function ageInMilliseconds(value: unknown) {
    const timestamp = new Date(String(value || "")).getTime();
    return Number.isFinite(timestamp) ? Date.now() - timestamp : Number.POSITIVE_INFINITY;
}

function isHarmlessTelegramStateError(error: unknown) {
    const text = errorText(error).toLowerCase();
    return (
        text.includes("topic is not modified")
        || text.includes("message is not modified")
        || text.includes("topic not modified")
        || text.includes("topic is already closed")
        || text.includes("topic is already open")
    );
}

function isMissingTelegramTopicError(error: unknown) {
    const text = errorText(error).toLowerCase();
    return (
        text.includes("message thread not found")
        || text.includes("topic not found")
        || text.includes("forum topic not found")
        || text.includes("topic was deleted")
    );
}

async function loadAnyForumTopic(
    database: SupportForumDatabaseClient,
    conversationId: string,
): Promise<{ topic: TelegramSupportForumTopicRecord | null; error: any }> {
    const { data, error } = await database
        .from(TOPICS_TABLE)
        .select("*")
        .eq("conversation_id", conversationId)
        .maybeSingle();
    return { topic: data || null, error };
}

async function updateTopic(
    database: SupportForumDatabaseClient,
    topicId: string,
    updates: Record<string, unknown>,
): Promise<{ topic: TelegramSupportForumTopicRecord | null; error: any }> {
    const { data, error } = await database
        .from(TOPICS_TABLE)
        .update(updates)
        .eq("id", topicId)
        .select("*")
        .maybeSingle();
    return { topic: data || null, error };
}

async function advanceExpectedParentMessage(
    database: SupportForumDatabaseClient,
    topic: TelegramSupportForumTopicRecord,
    deliveredMessageId: string,
) {
    // Only a successfully delivered parent message may become the reply
    // target. The conditional update is a database-side compare-and-set, so
    // an older Telegram request that finishes late cannot move the pointer
    // backwards after a newer message has already completed.
    const nextMessageId = positiveInteger(deliveredMessageId);
    const advanced = await database
        .from(TOPICS_TABLE)
        .update({ expected_parent_message_id: nextMessageId })
        .eq("id", topic.id)
        .or(
            `expected_parent_message_id.is.null,expected_parent_message_id.lt.${nextMessageId}`,
        )
        .select("*")
        .maybeSingle();
    if (advanced.error || advanced.data) {
        return { topic: advanced.data || null, error: advanced.error };
    }
    return loadAnyForumTopic(database, topic.conversation_id);
}

async function markProvisioningFailed(
    database: SupportForumDatabaseClient,
    topic: TelegramSupportForumTopicRecord,
    errorCode: string,
    messageThreadId?: string | number | null,
) {
    let query = database
        .from(TOPICS_TABLE)
        .update({
            lifecycle_status: "failed",
            display_state: "needs_reply",
            last_error_code: errorCode.slice(0, 100),
            closed_at: null,
            ...(messageThreadId ? { telegram_message_thread_id: messageThreadId } : {}),
        })
        .eq("id", topic.id)
        .eq("provisioning_token", topic.provisioning_token)
        .eq("lifecycle_status", "provisioning");
    query = query.select("id");
    await query.maybeSingle().catch(() => null);
}

function unconfiguredProvisionResult(reason: string): ForumProvisionResult {
    return {
        state: "unconfigured",
        created: false,
        topic: null,
        fallbackRequired: true,
        reason,
        errorCode: "forum_unconfigured",
    };
}

function provisionResultForExisting(
    topic: TelegramSupportForumTopicRecord,
    configuredChatId: string,
): ForumProvisionResult {
    if (topic.telegram_forum_chat_id !== configuredChatId) {
        return {
            state: "failed",
            created: false,
            topic,
            fallbackRequired: true,
            reason: "The stored forum topic belongs to a different Telegram group. Private administrator alerts will remain active until the forum mapping is repaired.",
            errorCode: "forum_group_mismatch",
        };
    }
    if (
        (topic.lifecycle_status === "open" || topic.lifecycle_status === "closed")
        && positiveInteger(topic.telegram_message_thread_id)
    ) {
        return {
            state: "ready",
            created: false,
            topic,
            fallbackRequired: false,
            reason: null,
            errorCode: null,
        };
    }
    if (topic.lifecycle_status === "provisioning") {
        const stale = ageInMilliseconds(topic.provisioning_started_at)
            > PROVISIONING_STALE_AFTER_MS;
        return {
            state: "provisioning",
            created: false,
            topic,
            fallbackRequired: stale,
            reason: stale
                ? "Forum topic provisioning is stale; use the private administrator fallback."
                : "Another request is provisioning this forum topic.",
            errorCode: stale ? "topic_provisioning_stale" : null,
        };
    }
    return {
        state: "failed",
        created: false,
        topic,
        fallbackRequired: true,
        reason: "Forum topic provisioning previously failed and will not be retried automatically.",
        errorCode: topic.last_error_code || "topic_provisioning_failed",
    };
}

const FORUM_HEADER_PIN_PENDING_CODE = "forum_header_pin_pending";
const FORUM_HEADER_PIN_FAILED_CODE = "forum_header_pin_failed";

function clearTopicErrorUnlessHeaderPinNeedsRetry(
    topic: TelegramSupportForumTopicRecord,
) {
    return (
        topic.last_error_code === FORUM_HEADER_PIN_PENDING_CODE
        || topic.last_error_code === FORUM_HEADER_PIN_FAILED_CODE
    )
        ? {}
        : { last_error_code: null };
}

async function ensureSupportForumHeader(
    database: SupportForumDatabaseClient,
    provision: ForumProvisionResult,
    input: ForumTransportOptions,
): Promise<ForumProvisionResult> {
    if (provision.state !== "ready" || !provision.topic) return provision;

    let topic = provision.topic;
    let headerMessageId = positiveInteger(topic.header_message_id);
    let shouldPin = (
        topic.last_error_code === FORUM_HEADER_PIN_PENDING_CODE
        || topic.last_error_code === FORUM_HEADER_PIN_FAILED_CODE
    );
    const telegramTransport = transport(input);

    if (!headerMessageId) {
        const headerText = formatSupportConversationLinks(
            topic.conversation_id,
            configuredSiteUrl(input),
        ).trim();
        if (!headerText) {
            return {
                ...provision,
                state: "failed",
                fallbackRequired: true,
                reason: "The secure PatLau app and website links could not be created for the forum topic.",
                errorCode: "forum_header_links_unavailable",
            };
        }

        let remoteHeader: Record<string, any>;
        try {
            remoteHeader = await sendTelegramSupportForumMessage({
                chatId: topic.telegram_forum_chat_id,
                messageThreadId: topic.telegram_message_thread_id!,
                text: headerText,
                disableNotification: true,
                ...telegramTransport,
            });
        } catch (error) {
            return {
                ...provision,
                state: "failed",
                fallbackRequired: true,
                reason: `Telegram could not create the forum links header: ${errorText(error)}`,
                errorCode: telegramErrorCode(error, "notify"),
            };
        }

        const sentHeaderMessageId = positiveInteger(remoteHeader?.message_id);
        if (!sentHeaderMessageId) {
            return {
                ...provision,
                state: "failed",
                fallbackRequired: true,
                reason: "Telegram created a forum links header without a valid message ID.",
                errorCode: "forum_header_message_id_missing",
            };
        }

        const claimedHeader = await database
            .from(TOPICS_TABLE)
            .update({
                header_message_id: sentHeaderMessageId,
                last_error_code: FORUM_HEADER_PIN_PENDING_CODE,
            })
            .eq("id", topic.id)
            .is("header_message_id", null)
            .select("*")
            .maybeSingle();

        if (claimedHeader.error) {
            await deleteTelegramSupportForumMessage({
                chatId: topic.telegram_forum_chat_id,
                messageId: sentHeaderMessageId,
                ...telegramTransport,
            }).catch(() => null);
            return {
                ...provision,
                state: "failed",
                fallbackRequired: true,
                reason: "The forum links header could not be recorded safely.",
                errorCode: databaseErrorCode(
                    claimedHeader.error,
                    "forum_header_mapping_failed",
                ),
            };
        }

        if (claimedHeader.data) {
            topic = claimedHeader.data;
            headerMessageId = sentHeaderMessageId;
            shouldPin = true;
        } else {
            const winner = await loadAnyForumTopic(
                database,
                topic.conversation_id,
            );
            await deleteTelegramSupportForumMessage({
                chatId: topic.telegram_forum_chat_id,
                messageId: sentHeaderMessageId,
                ...telegramTransport,
            }).catch(() => null);
            const winnerHeaderMessageId = positiveInteger(
                winner.topic?.header_message_id,
            );
            if (winner.error || !winner.topic || !winnerHeaderMessageId) {
                return {
                    ...provision,
                    state: "failed",
                    fallbackRequired: true,
                    reason: "Another request reserved the forum links header, but its mapping could not be verified.",
                    errorCode: databaseErrorCode(
                        winner.error,
                        "forum_header_mapping_unavailable",
                    ),
                };
            }
            topic = winner.topic;
            headerMessageId = winnerHeaderMessageId;
            shouldPin = (
                topic.last_error_code === FORUM_HEADER_PIN_PENDING_CODE
                || topic.last_error_code === FORUM_HEADER_PIN_FAILED_CODE
            );
        }
    }

    if (!shouldPin) {
        return { ...provision, topic };
    }

    try {
        await pinTelegramSupportForumMessage({
            chatId: topic.telegram_forum_chat_id,
            messageId: headerMessageId!,
            disableNotification: true,
            ...telegramTransport,
        });
        const pinned = await database
            .from(TOPICS_TABLE)
            .update({ last_error_code: null })
            .eq("id", topic.id)
            .eq("header_message_id", headerMessageId!)
            .select("*")
            .maybeSingle();
        if (pinned.data) topic = pinned.data;
        return {
            ...provision,
            topic,
            reason: pinned.error
                ? "The forum links header was pinned, but its local state could not be finalized."
                : provision.reason,
            errorCode: pinned.error
                ? databaseErrorCode(pinned.error, "forum_header_pin_state_failed")
                : provision.errorCode,
        };
    } catch (error) {
        const failed = await database
            .from(TOPICS_TABLE)
            .update({ last_error_code: FORUM_HEADER_PIN_FAILED_CODE })
            .eq("id", topic.id)
            .eq("header_message_id", headerMessageId!)
            .select("*")
            .maybeSingle();
        if (failed.data) topic = failed.data;
        return {
            ...provision,
            topic,
            fallbackRequired: false,
            reason: "The forum links header was created, but Telegram could not pin it. Grant the bot Pin Messages permission.",
            errorCode: FORUM_HEADER_PIN_FAILED_CODE,
        };
    }
}

function isDeletedTopicTombstone(topic: TelegramSupportForumTopicRecord) {
    return (
        topic.lifecycle_status === "failed"
        && topic.last_error_code === TOPIC_DELETED_TOMBSTONE_CODE
    );
}

async function retireStaleDeletedTopicTombstone(
    database: SupportForumDatabaseClient,
    topic: TelegramSupportForumTopicRecord,
) {
    if (
        !isDeletedTopicTombstone(topic)
        || ageInMilliseconds(topic.updated_at) <= DELETION_TOMBSTONE_RECOVERY_AFTER_MS
    ) {
        return { retired: false, settling: isDeletedTopicTombstone(topic), error: null };
    }

    const { data, error } = await database
        .from(TOPICS_TABLE)
        .delete()
        .eq("id", topic.id)
        .eq("conversation_id", topic.conversation_id)
        .eq("provisioning_token", topic.provisioning_token)
        .eq("lifecycle_status", "failed")
        .eq("last_error_code", TOPIC_DELETED_TOMBSTONE_CODE)
        .eq("updated_at", topic.updated_at)
        .select("id")
        .maybeSingle();
    return { retired: Boolean(data), settling: false, error };
}

export async function ensureSupportForumTopic(
    database: SupportForumDatabaseClient,
    input: {
        conversationId: string;
        parentName?: string | null;
        status?: SupportStatus;
        latestSenderType?: SupportMessageSender | null;
    } & ForumTransportOptions,
): Promise<ForumProvisionResult> {
    const conversationId = cleanIdentifier(input.conversationId);
    if (!conversationId) {
        return {
            state: "failed",
            created: false,
            topic: null,
            fallbackRequired: true,
            reason: "A conversation ID is required to provision a forum topic.",
            errorCode: "invalid_conversation_id",
        };
    }

    const forumChatId = configuredForumChatId(input);
    if (!forumChatId) {
        return unconfiguredProvisionResult(
            "TELEGRAM_PARENT_SUPPORT_FORUM_CHAT_ID is not configured with a valid forum supergroup ID.",
        );
    }
    if (!configuredBotToken(input)) {
        return unconfiguredProvisionResult(
            "TELEGRAM_PARENT_SUPPORT_BOT_TOKEN is not configured.",
        );
    }

    const displayState = deriveTelegramSupportForumDisplayState(
        input.status || "escalated",
        input.latestSenderType,
    );
    const safeProvisioningState: ForumDisplayState =
        displayState === "closed" ? "ai_handling" : displayState;
    const topicName = buildTelegramSupportForumTopicTitle({
        conversationId,
        parentName: input.parentName,
        state: safeProvisioningState,
    });

    const { data: inserted, error: insertError } = await database
        .from(TOPICS_TABLE)
        .insert({
            conversation_id: conversationId,
            telegram_forum_chat_id: forumChatId,
            topic_name: topicName,
            lifecycle_status: "provisioning",
            display_state: safeProvisioningState,
        })
        .select("*")
        .single();

    if (insertError || !inserted) {
        if (!isUniqueViolation(insertError)) {
            return {
                state: "failed",
                created: false,
                topic: null,
                fallbackRequired: true,
                reason: `Could not reserve the forum topic: ${errorText(insertError)}`,
                errorCode: databaseErrorCode(insertError),
            };
        }

        const existing = await loadAnyForumTopic(database, conversationId);
        if (existing.error || !existing.topic) {
            return {
                state: "failed",
                created: false,
                topic: null,
                fallbackRequired: true,
                reason: "The existing forum topic reservation could not be loaded.",
                errorCode: databaseErrorCode(existing.error),
            };
        }
        const retiredTombstone = await retireStaleDeletedTopicTombstone(
            database,
            existing.topic,
        );
        if (retiredTombstone.error) {
            return {
                state: "failed",
                created: false,
                topic: existing.topic,
                fallbackRequired: true,
                reason: "The deleted forum-topic mapping could not be retired safely.",
                errorCode: databaseErrorCode(retiredTombstone.error),
            };
        }
        if (retiredTombstone.settling) {
            return {
                state: "failed",
                created: false,
                topic: existing.topic,
                fallbackRequired: true,
                reason: "The deleted forum topic is waiting for the conversation deletion to finish. Private administrator alerts remain active meanwhile.",
                errorCode: "topic_deletion_settling",
            };
        }
        if (retiredTombstone.retired) {
            // A versioned conversation delete conflicted after Telegram had
            // already removed the topic. Once the durable tombstone has aged
            // beyond the deletion window, retire that exact row and reserve a
            // fresh mapping. The CAS above prevents deleting any newer topic.
            return ensureSupportForumTopic(database, input);
        }
        return ensureSupportForumHeader(
            database,
            provisionResultForExisting(existing.topic, forumChatId),
            input,
        );
    }

    const provisioningTopic = inserted as TelegramSupportForumTopicRecord;
    let createdThreadId: string | number | null = null;
    try {
        const created = await createTelegramSupportForumTopic({
            chatId: forumChatId,
            name: topicName,
            iconCustomEmojiId:
                getTelegramSupportForumTopicIconCustomEmojiId(
                    safeProvisioningState,
                ),
            ...transport(input),
        });
        createdThreadId = created.message_thread_id;
    } catch (error) {
        const errorCode = telegramErrorCode(error, "create");
        await markProvisioningFailed(database, provisioningTopic, errorCode);
        return {
            state: "failed",
            created: false,
            topic: provisioningTopic,
            fallbackRequired: true,
            reason: `Telegram could not provision the forum topic: ${errorText(error)}`,
            errorCode,
        };
    }

    const finalized = await database
        .from(TOPICS_TABLE)
        .update({
            telegram_message_thread_id: createdThreadId,
            topic_name: topicName,
            lifecycle_status: "open",
            display_state: safeProvisioningState,
            last_error_code: null,
            closed_at: null,
        })
        .eq("id", provisioningTopic.id)
        .eq("provisioning_token", provisioningTopic.provisioning_token)
        .eq("lifecycle_status", "provisioning")
        .select("*")
        .maybeSingle();

    if (finalized.error || !finalized.data) {
        // The remote topic exists but its mapping is not durable. Delete the
        // known topic immediately; a failed row prevents an unsafe blind retry.
        await deleteTelegramSupportForumTopic({
            chatId: forumChatId,
            messageThreadId: createdThreadId!,
            ...transport(input),
        }).catch(() => null);
        const errorCode = databaseErrorCode(
            finalized.error,
            "topic_mapping_finalize_failed",
        );
        await markProvisioningFailed(
            database,
            provisioningTopic,
            errorCode,
            createdThreadId,
        );
        return {
            state: "failed",
            created: false,
            topic: provisioningTopic,
            fallbackRequired: true,
            reason: "Telegram created a topic, but its database mapping could not be finalized.",
            errorCode,
        };
    }

    return ensureSupportForumHeader(database, {
        state: "ready",
        created: true,
        topic: finalized.data,
        fallbackRequired: false,
        reason: null,
        errorCode: null,
    }, input);
}

async function applyRemoteTopicState(
    topic: TelegramSupportForumTopicRecord,
    input: {
        parentName?: string | null;
        state: ForumDisplayState;
    } & ForumTransportOptions,
) {
    const name = buildTelegramSupportForumTopicTitle({
        conversationId: topic.conversation_id,
        parentName: input.parentName,
        state: input.state,
    });
    const forumChatId = topic.telegram_forum_chat_id;
    const messageThreadId = topic.telegram_message_thread_id!;
    const telegramTransport = transport(input);

    if (input.state !== "closed" && topic.lifecycle_status === "closed") {
        await reopenTelegramSupportForumTopic({
            chatId: forumChatId,
            messageThreadId,
            ...telegramTransport,
        }).catch((error) => {
            if (!isHarmlessTelegramStateError(error)) throw error;
        });
    }
    if (
        topic.topic_name !== name
        || topic.display_state !== input.state
    ) {
        await editTelegramSupportForumTopic({
            chatId: forumChatId,
            messageThreadId,
            name,
            iconCustomEmojiId:
                getTelegramSupportForumTopicIconCustomEmojiId(input.state),
            ...telegramTransport,
        }).catch((error) => {
            if (!isHarmlessTelegramStateError(error)) throw error;
        });
    }
    if (input.state === "closed" && topic.lifecycle_status !== "closed") {
        await closeTelegramSupportForumTopic({
            chatId: forumChatId,
            messageThreadId,
            ...telegramTransport,
        }).catch((error) => {
            if (!isHarmlessTelegramStateError(error)) throw error;
        });
    }
    return name;
}

async function updateNotification(
    database: SupportForumDatabaseClient,
    notificationId: string,
    updates: Record<string, unknown>,
) {
    const { error } = await database
        .from(NOTIFICATIONS_TABLE)
        .update(updates)
        .eq("id", notificationId);
    return error;
}

function parentMessageForumDisplayState(
    status: SupportStatus | undefined,
): ForumDisplayState {
    return status === "escalated" || status === "human_active"
        ? "needs_reply"
        : "ai_handling";
}

function parentPhotoCaption(content: unknown) {
    const value = String(content || "").trim();
    if (value === "[Photo]") return "";
    return value.startsWith("[Photo]\n")
        ? value.slice("[Photo]\n".length).trim()
        : value;
}

/**
 * Mirrors one canonical stored parent message into its private Telegram forum
 * topic. The row is reloaded by both identifiers so a caller can never attach
 * content or an opaque Telegram photo reference from another conversation.
 */
export async function mirrorSupportForumParentMessage(
    database: SupportForumDatabaseClient,
    input: {
        conversationId: string;
        parentName?: string | null;
        expectedParentMessageId: string | number;
        status?: SupportStatus;
    } & ForumTransportOptions,
): Promise<ForumNotificationResult> {
    const conversationId = cleanIdentifier(input.conversationId);
    const expectedParentMessageId = positiveInteger(
        input.expectedParentMessageId,
    );
    if (!conversationId || !expectedParentMessageId) {
        return {
            delivered: false,
            duplicate: false,
            inFlight: false,
            telegramMessageId: null,
            topic: null,
            fallbackRequired: false,
            reason: "A conversation ID and parent message ID are required.",
            errorCode: "invalid_parent_message_mirror",
        };
    }

    const { data: storedMessage, error } = await database
        .from("support_messages")
        .select("id,conversation_id,sender_type,content,source_refs")
        .eq("id", expectedParentMessageId)
        .eq("conversation_id", conversationId)
        .eq("sender_type", "parent")
        .maybeSingle();
    if (error || !storedMessage) {
        return {
            delivered: false,
            duplicate: false,
            inFlight: false,
            telegramMessageId: null,
            topic: null,
            fallbackRequired: false,
            reason: error
                ? "The stored parent message could not be loaded safely."
                : "The stored parent message does not belong to this conversation.",
            errorCode: error
                ? databaseErrorCode(error)
                : "parent_message_mirror_mismatch",
        };
    }

    const photoFileId = extractSupportImageFileId(
        storedMessage.source_refs,
    );
    const content = photoFileId
        ? parentPhotoCaption(storedMessage.content)
        : String(storedMessage.content || "").trim();
    if (!photoFileId && !content) {
        return {
            delivered: false,
            duplicate: false,
            inFlight: false,
            telegramMessageId: null,
            topic: null,
            fallbackRequired: false,
            reason: "The stored parent message is empty.",
            errorCode: "empty_parent_message_mirror",
        };
    }

    const notificationInput = {
        ...input,
        conversationId,
        expectedParentMessageId,
        alertText: content,
        photoFileId,
        latestSenderType: "parent" as const,
        displayState: parentMessageForumDisplayState(input.status),
    };
    let result = await notifySupportForum(database, notificationInput);
    let provisioningRetryIndex = 0;
    let notificationRetryIndex = 0;
    while (true) {
        const provisioningMayFinish = result.inFlight && !result.duplicate;
        const telegramDefinitelyRejected =
            result.errorCode === "telegram_notify_rejected";
        if (!provisioningMayFinish && !telegramDefinitelyRejected) break;
        const retryDelays = telegramDefinitelyRejected
            ? FORUM_NOTIFICATION_RETRY_DELAYS_MS
            : FORUM_PROVISIONING_RETRY_DELAYS_MS;
        const retryIndex = telegramDefinitelyRejected
            ? notificationRetryIndex++
            : provisioningRetryIndex++;
        const delay = retryDelays[retryIndex];
        if (delay === undefined) break;
        await new Promise((resolve) => setTimeout(resolve, delay));
        result = await notifySupportForum(database, notificationInput);
    }
    return result;
}

export async function notifySupportForum(
    database: SupportForumDatabaseClient,
    input: {
        conversationId: string;
        parentName?: string | null;
        expectedParentMessageId: string | number;
        alertText: string;
        photoFileId?: string | null;
        status?: SupportStatus;
        latestSenderType?: SupportMessageSender | null;
        displayState?: ForumDisplayState;
    } & ForumTransportOptions,
): Promise<ForumNotificationResult> {
    const expectedParentMessageId = positiveInteger(input.expectedParentMessageId);
    const alertText = String(input.alertText || "").trim();
    const photoFileId = String(input.photoFileId || "").trim();
    if (!expectedParentMessageId || (!alertText && !photoFileId)) {
        return {
            delivered: false,
            duplicate: false,
            inFlight: false,
            telegramMessageId: null,
            topic: null,
            fallbackRequired: true,
            reason: "A parent message ID and either message text or a photo are required.",
            errorCode: "invalid_notification",
        };
    }

    const provision = await ensureSupportForumTopic(database, input);
    if (provision.state !== "ready" || !provision.topic) {
        return {
            delivered: false,
            duplicate: false,
            inFlight: provision.state === "provisioning",
            telegramMessageId: null,
            topic: provision.topic,
            fallbackRequired: provision.fallbackRequired,
            reason: provision.reason,
            errorCode: provision.errorCode,
        };
    }
    let topic = provision.topic;
    const requestedState = input.displayState
        || deriveTelegramSupportForumDisplayState(
            input.status || "escalated",
            input.latestSenderType,
        );
    let topicName = topic.topic_name;
    let statePersistenceError: any = null;
    // An AI-owned parent-message request may finish after the conversation has
    // already escalated or Coach Patrick has replied. It must never repaint a
    // newer red/yellow/green topic state back to the AI state. Explicit
    // Return-to-AI transitions remain handled by syncSupportForumState().
    if (requestedState !== "ai_handling") {
        try {
            topicName = await applyRemoteTopicState(topic, {
                ...input,
                state: requestedState,
            });
            const preparedTopic = await updateTopic(database, topic.id, {
                topic_name: topicName,
                lifecycle_status: requestedState === "closed" ? "closed" : "open",
                display_state: requestedState,
                closed_at: requestedState === "closed"
                    ? new Date().toISOString()
                    : null,
            });
            statePersistenceError = preparedTopic.error;
            if (preparedTopic.topic) topic = preparedTopic.topic;
        } catch (error) {
            return {
                delivered: false,
                duplicate: false,
                inFlight: false,
                telegramMessageId: null,
                topic,
                fallbackRequired: true,
                reason: `Telegram could not prepare the parent topic: ${errorText(error)}`,
                errorCode: telegramErrorCode(error, "sync"),
            };
        }
    }

    const reservation = await database
        .from(NOTIFICATIONS_TABLE)
        .insert({
            topic_id: topic.id,
            expected_parent_message_id: expectedParentMessageId,
            delivery_status: "sending",
        })
        .select("*")
        .single();
    let claimed = reservation.data;
    const claimError = reservation.error;
    let duplicateClaim = false;

    if (claimError || !claimed) {
        if (!isUniqueViolation(claimError)) {
            return {
                delivered: false,
                duplicate: false,
                inFlight: false,
                telegramMessageId: null,
                topic,
                fallbackRequired: true,
                reason: `Could not reserve the forum alert: ${errorText(claimError)}`,
                errorCode: databaseErrorCode(claimError),
            };
        }
        const { data: existing, error: existingError } = await database
            .from(NOTIFICATIONS_TABLE)
            .select("*")
            .eq("topic_id", topic.id)
            .eq("expected_parent_message_id", expectedParentMessageId)
            .single();
        if (existingError || !existing) {
            return {
                delivered: false,
                duplicate: true,
                inFlight: false,
                telegramMessageId: null,
                topic,
                fallbackRequired: true,
                reason: "The existing forum alert reservation could not be loaded.",
                errorCode: databaseErrorCode(existingError),
            };
        }
        if (existing.delivery_status === "delivered") {
            const pointerUpdate = await advanceExpectedParentMessage(
                database,
                topic,
                expectedParentMessageId,
            );
            const finalTopic = pointerUpdate.topic || topic;
            const persistenceError = statePersistenceError
                || pointerUpdate.error;
            return {
                delivered: true,
                duplicate: true,
                inFlight: false,
                telegramMessageId: existing.telegram_message_id || null,
                topic: finalTopic,
                fallbackRequired: false,
                reason: persistenceError
                    ? "Telegram has this parent message, but its local topic state could not be fully updated."
                    : null,
                errorCode: persistenceError
                    ? databaseErrorCode(persistenceError)
                    : null,
            };
        }
        if (
            existing.delivery_status === "failed"
            && existing.failure_code === "telegram_notify_rejected"
        ) {
            // Telegram explicitly rejected the previous request, so it is
            // known not to have created a remote message. Reclaim only that
            // exact failed state. Ambiguous network failures and stale
            // "sending" claims are deliberately never retried because doing
            // so could create a duplicate parent message in the forum.
            const reclaimed = await database
                .from(NOTIFICATIONS_TABLE)
                .update({
                    delivery_status: "sending",
                    telegram_message_id: null,
                    delivered_at: null,
                    failure_code: null,
                })
                .eq("id", existing.id)
                .eq("delivery_status", "failed")
                .eq("failure_code", "telegram_notify_rejected")
                .select("*")
                .maybeSingle();
            if (reclaimed.error) {
                return {
                    delivered: false,
                    duplicate: true,
                    inFlight: false,
                    telegramMessageId: null,
                    topic,
                    fallbackRequired: true,
                    reason: "The rejected forum alert could not be reserved for a safe retry.",
                    errorCode: databaseErrorCode(reclaimed.error),
                };
            }
            if (!reclaimed.data) {
                return {
                    delivered: false,
                    duplicate: true,
                    inFlight: true,
                    telegramMessageId: null,
                    topic,
                    fallbackRequired: false,
                    reason: "Another request is retrying this rejected forum alert.",
                    errorCode: null,
                };
            }
            claimed = reclaimed.data;
            duplicateClaim = true;
        } else {
            const inFlight = existing.delivery_status === "sending"
                && ageInMilliseconds(existing.updated_at || existing.created_at)
                    <= NOTIFICATION_STALE_AFTER_MS;
            return {
                delivered: false,
                duplicate: true,
                inFlight,
                telegramMessageId: existing.telegram_message_id || null,
                topic,
                fallbackRequired: !inFlight,
                reason: inFlight
                    ? "Another request is delivering this forum alert."
                    : "This forum alert previously failed or became stale; use the private fallback.",
                errorCode: existing.failure_code || (inFlight ? null : "forum_notification_stalled"),
            };
        }
    }

    if (!claimed) {
        return {
            delivered: false,
            duplicate: duplicateClaim,
            inFlight: false,
            telegramMessageId: null,
            topic,
            fallbackRequired: true,
            reason: "The forum alert reservation was not available for delivery.",
            errorCode: "forum_notification_claim_unavailable",
        };
    }

    let remoteMessage: Record<string, any> | null = null;
    try {
        remoteMessage = photoFileId
            ? await sendTelegramSupportForumPhoto({
                chatId: topic.telegram_forum_chat_id,
                messageThreadId: topic.telegram_message_thread_id!,
                photoFileId,
                caption: alertText,
                ...transport(input),
            })
            : await sendTelegramSupportForumMessage({
                chatId: topic.telegram_forum_chat_id,
                messageThreadId: topic.telegram_message_thread_id!,
                text: alertText,
                ...transport(input),
            });
    } catch (error) {
        const errorCode = telegramErrorCode(error, "notify");
        await updateNotification(database, claimed.id, {
            delivery_status: "failed",
            failure_code: errorCode,
        }).catch(() => null);
        return {
            delivered: false,
            duplicate: duplicateClaim,
            inFlight: false,
            telegramMessageId: null,
            topic,
            fallbackRequired: true,
            reason: `Telegram could not deliver the forum alert: ${errorText(error)}`,
            errorCode,
        };
    }

    const telegramMessageId = remoteMessage?.message_id || null;
    const deliveredAt = new Date().toISOString();
    const notificationUpdateError = await updateNotification(database, claimed.id, {
        delivery_status: "delivered",
        telegram_message_id: telegramMessageId,
        delivered_at: deliveredAt,
        failure_code: null,
    });
    let finalTopic = topic;
    const pointerUpdate = await advanceExpectedParentMessage(
        database,
        finalTopic,
        expectedParentMessageId,
    );
    if (pointerUpdate.topic) finalTopic = pointerUpdate.topic;
    const persistenceError = notificationUpdateError
        || pointerUpdate.error
        || statePersistenceError;

    return {
        delivered: true,
        duplicate: duplicateClaim,
        inFlight: false,
        telegramMessageId,
        topic: finalTopic,
        fallbackRequired: false,
        reason: persistenceError
            ? "Telegram received the alert, but its local delivery state could not be fully recorded."
            : null,
        errorCode: persistenceError ? databaseErrorCode(persistenceError) : null,
    };
}

export async function syncSupportForumState(
    database: SupportForumDatabaseClient,
    input: {
        conversationId: string;
        parentName?: string | null;
        status: SupportStatus;
        latestSenderType?: SupportMessageSender | null;
        displayState?: ForumDisplayState;
    } & ForumTransportOptions,
): Promise<ForumSyncResult> {
    const conversationId = cleanIdentifier(input.conversationId);
    if (!conversationId) {
        return {
            synced: false,
            noTopic: true,
            topic: null,
            fallbackRequired: false,
            reason: "A conversation ID is required.",
            errorCode: "invalid_conversation_id",
        };
    }
    const forumChatId = configuredForumChatId(input);
    if (!forumChatId) {
        return {
            synced: true,
            noTopic: true,
            topic: null,
            fallbackRequired: false,
            reason: null,
            errorCode: null,
        };
    }

    const loaded = await loadAnyForumTopic(database, conversationId);
    if (loaded.error) {
        if (isForumSchemaUnavailable(loaded.error)) {
            return {
                synced: true,
                noTopic: true,
                topic: null,
                fallbackRequired: false,
                reason: null,
                errorCode: null,
            };
        }
        return {
            synced: false,
            noTopic: false,
            topic: null,
            fallbackRequired: false,
            reason: `The forum mapping could not be loaded: ${errorText(loaded.error)}`,
            errorCode: databaseErrorCode(loaded.error),
        };
    }
    const topic = loaded.topic;
    if (topic && topic.telegram_forum_chat_id !== forumChatId) {
        return {
            synced: false,
            noTopic: false,
            topic,
            fallbackRequired: false,
            reason: "The stored forum topic belongs to a different Telegram group, so no forum state was changed.",
            errorCode: "forum_group_mismatch",
        };
    }
    if (
        !topic
        || !positiveInteger(topic.telegram_message_thread_id)
        || !["open", "closed"].includes(topic.lifecycle_status)
    ) {
        return {
            synced: true,
            noTopic: true,
            topic,
            fallbackRequired: false,
            reason: null,
            errorCode: null,
        };
    }

    const state = input.displayState || deriveTelegramSupportForumDisplayState(
        input.status,
        input.latestSenderType,
    );
    let topicName: string;
    try {
        topicName = await applyRemoteTopicState(topic, { ...input, state });
    } catch (error) {
        return {
            synced: false,
            noTopic: false,
            topic,
            fallbackRequired: false,
            reason: `Telegram could not synchronize the forum topic: ${errorText(error)}`,
            errorCode: telegramErrorCode(error, "sync"),
        };
    }

    const closed = state === "closed";
    const updated = await updateTopic(database, topic.id, {
        topic_name: topicName,
        lifecycle_status: closed ? "closed" : "open",
        display_state: state,
        closed_at: closed ? new Date().toISOString() : null,
        ...clearTopicErrorUnlessHeaderPinNeedsRetry(topic),
    });
    if (updated.error) {
        return {
            synced: false,
            noTopic: false,
            topic,
            fallbackRequired: false,
            reason: "Telegram was synchronized, but the local topic state could not be updated.",
            errorCode: databaseErrorCode(updated.error),
        };
    }
    return {
        synced: true,
        noTopic: false,
        topic: updated.topic,
        fallbackRequired: false,
        reason: null,
        errorCode: null,
    };
}

export async function mirrorSupportForumCoachReply(
    database: SupportForumDatabaseClient,
    input: {
        conversationId: string;
        parentName?: string | null;
        text: string;
    } & ForumTransportOptions,
): Promise<ForumMirrorResult> {
    const conversationId = cleanIdentifier(input.conversationId);
    const text = String(input.text || "").trim();
    if (!conversationId || !text) {
        return {
            mirrored: false,
            noTopic: !conversationId,
            telegramMessageId: null,
            topic: null,
            fallbackRequired: false,
            reason: "A conversation ID and reply text are required.",
            errorCode: "invalid_forum_mirror",
        };
    }
    const forumChatId = configuredForumChatId(input);
    if (!forumChatId) {
        return {
            mirrored: false,
            noTopic: true,
            telegramMessageId: null,
            topic: null,
            fallbackRequired: false,
            reason: null,
            errorCode: null,
        };
    }

    const loaded = await loadAnyForumTopic(database, conversationId);
    if (loaded.error) {
        return {
            mirrored: false,
            noTopic: false,
            telegramMessageId: null,
            topic: null,
            fallbackRequired: false,
            reason: `The forum mapping could not be loaded: ${errorText(loaded.error)}`,
            errorCode: databaseErrorCode(loaded.error),
        };
    }
    const topic = loaded.topic;
    if (topic && topic.telegram_forum_chat_id !== forumChatId) {
        return {
            mirrored: false,
            noTopic: false,
            telegramMessageId: null,
            topic,
            fallbackRequired: false,
            reason: "The stored forum topic belongs to a different Telegram group, so the Coach reply was not mirrored.",
            errorCode: "forum_group_mismatch",
        };
    }
    if (
        !topic
        || !positiveInteger(topic.telegram_message_thread_id)
        || !["open", "closed"].includes(topic.lifecycle_status)
    ) {
        return {
            mirrored: false,
            noTopic: true,
            telegramMessageId: null,
            topic,
            fallbackRequired: false,
            reason: null,
            errorCode: null,
        };
    }

    let topicName = topic.topic_name;
    let remoteMessage: Record<string, any>;
    try {
        topicName = await applyRemoteTopicState(topic, {
            ...input,
            state: "waiting_parent",
        });
        remoteMessage = await sendTelegramSupportForumMessage({
            chatId: topic.telegram_forum_chat_id,
            messageThreadId: topic.telegram_message_thread_id!,
            text,
            disableNotification: true,
            ...transport(input),
        });
    } catch (error) {
        return {
            mirrored: false,
            noTopic: false,
            telegramMessageId: null,
            topic,
            fallbackRequired: false,
            reason: `Telegram could not mirror the coach reply: ${errorText(error)}`,
            errorCode: telegramErrorCode(error, "mirror"),
        };
    }

    const updated = await updateTopic(database, topic.id, {
        topic_name: topicName,
        lifecycle_status: "open",
        display_state: "waiting_parent",
        closed_at: null,
        ...clearTopicErrorUnlessHeaderPinNeedsRetry(topic),
    });
    return {
        mirrored: true,
        noTopic: false,
        telegramMessageId: remoteMessage?.message_id || null,
        topic: updated.topic || topic,
        fallbackRequired: false,
        reason: updated.error
            ? "Telegram received the mirror, but the local topic state could not be updated."
            : null,
        errorCode: updated.error ? databaseErrorCode(updated.error) : null,
    };
}

/**
 * Copy an AI or system response into an existing parent-support topic without
 * changing the topic's workflow state. State changes remain the responsibility
 * of syncSupportForumState so mirroring a message can never reopen, rename, or
 * close a conversation by accident.
 */
export async function mirrorSupportForumAutomatedMessage(
    database: SupportForumDatabaseClient,
    input: {
        conversationId: string;
        text: string;
    } & ForumTransportOptions,
): Promise<ForumMirrorResult> {
    const conversationId = cleanIdentifier(input.conversationId);
    const text = String(input.text || "").trim();
    if (!conversationId || !text) {
        return {
            mirrored: false,
            noTopic: !conversationId,
            telegramMessageId: null,
            topic: null,
            fallbackRequired: false,
            reason: "A conversation ID and message text are required.",
            errorCode: "invalid_forum_mirror",
        };
    }
    const forumChatId = configuredForumChatId(input);
    if (!forumChatId) {
        return {
            mirrored: false,
            noTopic: true,
            telegramMessageId: null,
            topic: null,
            fallbackRequired: false,
            reason: null,
            errorCode: null,
        };
    }

    const loaded = await loadAnyForumTopic(database, conversationId);
    if (loaded.error) {
        return {
            mirrored: false,
            noTopic: false,
            telegramMessageId: null,
            topic: null,
            fallbackRequired: false,
            reason: `The forum mapping could not be loaded: ${errorText(loaded.error)}`,
            errorCode: databaseErrorCode(loaded.error),
        };
    }
    const topic = loaded.topic;
    if (topic && topic.telegram_forum_chat_id !== forumChatId) {
        return {
            mirrored: false,
            noTopic: false,
            telegramMessageId: null,
            topic,
            fallbackRequired: false,
            reason: "The stored forum topic belongs to a different Telegram group, so the automated message was not mirrored.",
            errorCode: "forum_group_mismatch",
        };
    }
    if (
        !topic
        || !positiveInteger(topic.telegram_message_thread_id)
        || topic.lifecycle_status !== "open"
    ) {
        return {
            mirrored: false,
            noTopic: !topic,
            telegramMessageId: null,
            topic,
            fallbackRequired: false,
            reason: null,
            errorCode: null,
        };
    }

    try {
        const remoteMessage = await sendTelegramSupportForumMessage({
            chatId: topic.telegram_forum_chat_id,
            messageThreadId: topic.telegram_message_thread_id!,
            text,
            disableNotification: true,
            ...transport(input),
        });
        return {
            mirrored: true,
            noTopic: false,
            telegramMessageId: remoteMessage?.message_id || null,
            topic,
            fallbackRequired: false,
            reason: null,
            errorCode: null,
        };
    } catch (error) {
        return {
            mirrored: false,
            noTopic: false,
            telegramMessageId: null,
            topic,
            fallbackRequired: false,
            reason: `Telegram could not mirror the automated message: ${errorText(error)}`,
            errorCode: telegramErrorCode(error, "mirror"),
        };
    }
}

export async function claimSupportForumTurn(
    database: SupportForumDatabaseClient,
    input: {
        topicId: string;
        conversationId: string;
        expectedParentMessageId: string | number;
        adminUserId: string | number;
        adminDisplayName: string;
    },
): Promise<ForumTurnClaimResult> {
    const topicId = cleanIdentifier(input.topicId);
    const conversationId = cleanIdentifier(input.conversationId);
    const expectedParentMessageId = positiveInteger(input.expectedParentMessageId);
    const adminUserId = positiveInteger(input.adminUserId);
    const adminDisplayName = cleanDisplayName(input.adminDisplayName);
    if (!topicId || !conversationId || !expectedParentMessageId || !adminUserId) {
        return {
            claimed: false,
            claimedByCaller: false,
            turn: null,
            fallbackRequired: false,
            reason: "The forum turn contains invalid identifiers.",
            errorCode: "invalid_forum_turn",
        };
    }

    const { data, error } = await database
        .from(TURNS_TABLE)
        .insert({
            topic_id: topicId,
            conversation_id: conversationId,
            expected_parent_message_id: expectedParentMessageId,
            telegram_admin_user_id: adminUserId,
            telegram_admin_display_name: adminDisplayName,
            last_reply_at: new Date().toISOString(),
        })
        .select("*")
        .single();
    if (!error && data) {
        return {
            claimed: true,
            claimedByCaller: true,
            turn: data,
            fallbackRequired: false,
            reason: null,
            errorCode: null,
        };
    }
    if (!isUniqueViolation(error)) {
        return {
            claimed: false,
            claimedByCaller: false,
            turn: null,
            fallbackRequired: false,
            reason: `The forum turn could not be claimed: ${errorText(error)}`,
            errorCode: databaseErrorCode(error),
        };
    }

    const existing = await database
        .from(TURNS_TABLE)
        .select("*")
        .eq("conversation_id", conversationId)
        .eq("expected_parent_message_id", expectedParentMessageId)
        .single();
    if (existing.error || !existing.data) {
        return {
            claimed: false,
            claimedByCaller: false,
            turn: null,
            fallbackRequired: false,
            reason: "The existing forum turn could not be loaded.",
            errorCode: databaseErrorCode(existing.error),
        };
    }
    const claimedByCaller =
        String(existing.data.telegram_admin_user_id) === adminUserId;
    return {
        claimed: false,
        claimedByCaller,
        turn: existing.data,
        fallbackRequired: false,
        reason: claimedByCaller
            ? "This administrator already owns the current parent turn."
            : `This parent turn is already handled by ${cleanDisplayName(
                existing.data.telegram_admin_display_name,
            )}.`,
        errorCode: "forum_turn_already_claimed",
    };
}

export async function deleteSupportForumTopicBeforeConversation(
    database: SupportForumDatabaseClient,
    input: {
        conversationId: string;
    } & ForumTransportOptions,
): Promise<ForumDeleteResult> {
    const conversationId = cleanIdentifier(input.conversationId);
    if (!conversationId) {
        return {
            canDeleteConversation: false,
            deleted: false,
            noTopic: true,
            fallbackRequired: false,
            reason: "A conversation ID is required.",
            errorCode: "invalid_conversation_id",
        };
    }

    const loaded = await loadAnyForumTopic(database, conversationId);
    if (loaded.error) {
        if (isForumSchemaUnavailable(loaded.error)) {
            return {
                canDeleteConversation: true,
                deleted: false,
                noTopic: true,
                fallbackRequired: false,
                reason: null,
                errorCode: null,
            };
        }
        return {
            canDeleteConversation: false,
            deleted: false,
            noTopic: false,
            fallbackRequired: false,
            reason: `The forum mapping could not be loaded: ${errorText(loaded.error)}`,
            errorCode: databaseErrorCode(loaded.error),
        };
    }
    const topic = loaded.topic;
    if (!topic) {
        return {
            canDeleteConversation: true,
            deleted: false,
            noTopic: true,
            fallbackRequired: false,
            reason: null,
            errorCode: null,
        };
    }

    const messageThreadId = positiveInteger(topic.telegram_message_thread_id);
    if (isDeletedTopicTombstone(topic)) {
        return {
            canDeleteConversation: true,
            deleted: Boolean(messageThreadId),
            noTopic: false,
            fallbackRequired: false,
            reason: null,
            errorCode: null,
        };
    }

    const definitelyAbsent =
        topic.lifecycle_status === "failed"
        && topic.last_error_code === "telegram_create_rejected";
    if (!messageThreadId) {
        if (!definitelyAbsent) {
            return {
                canDeleteConversation: false,
                deleted: false,
                noTopic: false,
                fallbackRequired: false,
                reason: "The forum topic may have been created, but its Telegram thread ID is unknown. Deletion was stopped to avoid leaving a private copy behind.",
                errorCode: "forum_topic_identity_unknown",
            };
        }
    }

    if (messageThreadId && !configuredBotToken(input)) {
        return {
            canDeleteConversation: false,
            deleted: false,
            noTopic: false,
            fallbackRequired: false,
            reason: "The Telegram bot token is unavailable, so the private forum topic could not be deleted.",
            errorCode: "forum_bot_token_unconfigured",
        };
    }

    const originalTopicState = {
        lifecycle_status: topic.lifecycle_status,
        display_state: topic.display_state,
        last_error_code: topic.last_error_code,
        closed_at: topic.closed_at,
    };
    let deletionClaim = topic;
    if (topic.last_error_code !== TOPIC_DELETION_PENDING_CODE) {
        const claimed = await database
            .from(TOPICS_TABLE)
            .update({
                lifecycle_status: "failed",
                display_state: "needs_reply",
                last_error_code: TOPIC_DELETION_PENDING_CODE,
                closed_at: null,
            })
            .eq("id", topic.id)
            .eq("conversation_id", topic.conversation_id)
            .eq("provisioning_token", topic.provisioning_token)
            .eq("lifecycle_status", topic.lifecycle_status)
            .eq("updated_at", topic.updated_at)
            .select("*")
            .maybeSingle();
        if (claimed.error || !claimed.data) {
            return {
                canDeleteConversation: false,
                deleted: false,
                noTopic: false,
                fallbackRequired: false,
                reason: claimed.error
                    ? "The forum topic could not be reserved for deletion."
                    : "The forum topic changed before deletion. Refresh and try again.",
                errorCode: claimed.error
                    ? databaseErrorCode(claimed.error)
                    : "forum_topic_changed_before_delete",
            };
        }
        deletionClaim = claimed.data;
    }

    if (messageThreadId) {
        try {
            await deleteTelegramSupportForumTopic({
                chatId: deletionClaim.telegram_forum_chat_id,
                messageThreadId,
                ...transport(input),
            });
        } catch (error) {
            if (!isMissingTelegramTopicError(error)) {
                const definitivelyRejected =
                    error instanceof TelegramSupportForumApiError
                    && error.httpStatus > 0
                    && error.telegramErrorCode !== null;
                if (definitivelyRejected) {
                    await database
                        .from(TOPICS_TABLE)
                        .update(originalTopicState)
                        .eq("id", deletionClaim.id)
                        .eq("provisioning_token", deletionClaim.provisioning_token)
                        .eq("lifecycle_status", "failed")
                        .eq("last_error_code", TOPIC_DELETION_PENDING_CODE)
                        .select("id")
                        .maybeSingle()
                        .catch(() => null);
                }
                return {
                    canDeleteConversation: false,
                    deleted: false,
                    noTopic: false,
                    fallbackRequired: false,
                    reason: `Telegram could not delete the forum topic: ${errorText(error)}`,
                    errorCode: telegramErrorCode(error, "delete"),
                };
            }
        }
    }

    const tombstone = await database
        .from(TOPICS_TABLE)
        .update({
            lifecycle_status: "failed",
            display_state: "needs_reply",
            last_error_code: TOPIC_DELETED_TOMBSTONE_CODE,
            closed_at: null,
        })
        .eq("id", deletionClaim.id)
        .eq("provisioning_token", deletionClaim.provisioning_token)
        .eq("lifecycle_status", "failed")
        .eq("last_error_code", TOPIC_DELETION_PENDING_CODE)
        .select("*")
        .maybeSingle();
    if (tombstone.error || !tombstone.data) {
        return {
            canDeleteConversation: false,
            deleted: Boolean(messageThreadId),
            noTopic: false,
            fallbackRequired: false,
            reason: "Telegram removed the topic, but its recoverable deletion marker could not be finalized. Retry deletion before removing the conversation.",
            errorCode: tombstone.error
                ? databaseErrorCode(tombstone.error)
                : "forum_deletion_tombstone_not_finalized",
        };
    }
    return {
        canDeleteConversation: true,
        deleted: Boolean(messageThreadId),
        noTopic: false,
        fallbackRequired: false,
        reason: null,
        errorCode: null,
    };
}
