import type { SupportStatus } from "../../types/support";
import {
    buildTelegramSupportForumTopicTitle,
    closeTelegramSupportForumTopic,
    createTelegramSupportForumTopic,
    deleteTelegramSupportForumTopic,
    deriveTelegramSupportForumDisplayState,
    editTelegramSupportForumTopic,
    getConfiguredTelegramSupportForumChatId,
    reopenTelegramSupportForumTopic,
    sendTelegramSupportForumMessage,
    TelegramSupportForumApiError,
    type ForumDisplayState,
    type TelegramSupportForumTopicRecord,
} from "./telegram-support-forum";

export type SupportForumDatabaseClient = {
    from: (table: string) => any;
};

type SupportMessageSender = "parent" | "ai" | "superuser" | "system";
type TelegramFetch = typeof fetch;

type ForumTransportOptions = {
    forumChatId?: string | null;
    token?: string | null;
    fetchImpl?: TelegramFetch;
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
        return provisionResultForExisting(existing.topic, forumChatId);
    }

    const provisioningTopic = inserted as TelegramSupportForumTopicRecord;
    let createdThreadId: string | number | null = null;
    try {
        const created = await createTelegramSupportForumTopic({
            chatId: forumChatId,
            name: topicName,
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

    return {
        state: "ready",
        created: true,
        topic: finalized.data,
        fallbackRequired: false,
        reason: null,
        errorCode: null,
    };
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
    if (topic.topic_name !== name) {
        await editTelegramSupportForumTopic({
            chatId: forumChatId,
            messageThreadId,
            name,
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

export async function notifySupportForum(
    database: SupportForumDatabaseClient,
    input: {
        conversationId: string;
        parentName?: string | null;
        expectedParentMessageId: string | number;
        alertText: string;
        status?: SupportStatus;
        latestSenderType?: SupportMessageSender | null;
    } & ForumTransportOptions,
): Promise<ForumNotificationResult> {
    const expectedParentMessageId = positiveInteger(input.expectedParentMessageId);
    const alertText = String(input.alertText || "").trim();
    if (!expectedParentMessageId || !alertText) {
        return {
            delivered: false,
            duplicate: false,
            inFlight: false,
            telegramMessageId: null,
            topic: null,
            fallbackRequired: true,
            reason: "A parent message ID and alert text are required.",
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
    const topic = provision.topic;

    const { data: claimed, error: claimError } = await database
        .from(NOTIFICATIONS_TABLE)
        .insert({
            topic_id: topic.id,
            expected_parent_message_id: expectedParentMessageId,
            delivery_status: "sending",
        })
        .select("*")
        .single();

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
            return {
                delivered: true,
                duplicate: true,
                inFlight: false,
                telegramMessageId: existing.telegram_message_id || null,
                topic,
                fallbackRequired: false,
                reason: null,
                errorCode: null,
            };
        }
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

    let remoteMessage: Record<string, any> | null = null;
    let topicName = topic.topic_name;
    try {
        topicName = await applyRemoteTopicState(topic, {
            ...input,
            state: "needs_reply",
        });
        remoteMessage = await sendTelegramSupportForumMessage({
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
        await updateTopic(database, topic.id, {
            topic_name: topicName,
            lifecycle_status: "open",
            display_state: "needs_reply",
            expected_parent_message_id: expectedParentMessageId,
            closed_at: null,
        }).catch(() => null);
        return {
            delivered: false,
            duplicate: false,
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
    const topicUpdate = await updateTopic(database, topic.id, {
        topic_name: topicName,
        lifecycle_status: "open",
        display_state: "needs_reply",
        expected_parent_message_id: expectedParentMessageId,
        last_error_code: null,
        closed_at: null,
    });
    const finalTopic = topicUpdate.topic || {
        ...topic,
        topic_name: topicName,
        lifecycle_status: "open",
        display_state: "needs_reply",
        expected_parent_message_id: expectedParentMessageId,
        closed_at: null,
    } as TelegramSupportForumTopicRecord;
    const persistenceError = notificationUpdateError || topicUpdate.error;

    return {
        delivered: true,
        duplicate: false,
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
        last_error_code: null,
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
        last_error_code: null,
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
