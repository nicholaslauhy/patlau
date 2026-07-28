import assert from "node:assert/strict";
import test from "node:test";
import {
    buildTelegramSupportForumTopicTitle,
    claimTelegramSupportForumReplyReceipt,
    closeTelegramSupportForumTopic,
    createTelegramSupportForumTopic,
    deleteTelegramSupportForumTopic,
    deriveTelegramSupportForumDisplayState,
    editTelegramSupportForumTopic,
    finishTelegramSupportForumReplyReceipt,
    getConfiguredTelegramSupportForumChatId,
    getTelegramSupportForumSetupError,
    isTelegramSupportForumConfigured,
    loadForumTopicByConversation,
    loadForumTopicByThread,
    parseTelegramSupportForumMessage,
    reactToTelegramSupportForumMessage,
    reopenTelegramSupportForumTopic,
    resolveTelegramSupportForumReplyTarget,
    sendTelegramSupportForumMessage,
} from "../app/lib/telegram-support-forum.ts";

const FORUM_CHAT_ID = "-1003904915951";
const CONVERSATION_ID = "7cda7535-f22d-405e-a996-12f9c30db44d";

test("forum configuration accepts only a -100 Telegram supergroup ID", () => {
    assert.equal(getConfiguredTelegramSupportForumChatId(` ${FORUM_CHAT_ID} `), FORUM_CHAT_ID);
    assert.equal(getConfiguredTelegramSupportForumChatId("1127073766"), null);
    assert.equal(getConfiguredTelegramSupportForumChatId("-3904915951"), null);
    assert.equal(getConfiguredTelegramSupportForumChatId("-100123"), null);
    assert.equal(isTelegramSupportForumConfigured(FORUM_CHAT_ID), true);
    assert.equal(isTelegramSupportForumConfigured("not-a-group"), false);

    assert.match(
        getTelegramSupportForumSetupError({ forumChatId: "", botToken: "token" }) || "",
        /supergroup ID/,
    );
    assert.match(
        getTelegramSupportForumSetupError({ forumChatId: FORUM_CHAT_ID, botToken: "" }) || "",
        /bot token/,
    );
    assert.equal(
        getTelegramSupportForumSetupError({ forumChatId: FORUM_CHAT_ID, botToken: "token" }),
        null,
    );
});

test("conversation status maps to clear topic states and safe 128-character titles", () => {
    assert.equal(deriveTelegramSupportForumDisplayState("escalated"), "needs_reply");
    assert.equal(
        deriveTelegramSupportForumDisplayState("human_active", "parent"),
        "needs_reply",
    );
    assert.equal(
        deriveTelegramSupportForumDisplayState("human_active", "superuser"),
        "waiting_parent",
    );
    assert.equal(
        deriveTelegramSupportForumDisplayState("human_active", "system"),
        "coach_active",
    );
    assert.equal(
        deriveTelegramSupportForumDisplayState("waiting_parent", "superuser"),
        "waiting_parent",
    );
    assert.equal(deriveTelegramSupportForumDisplayState("ai_active"), "ai_handling");
    assert.equal(deriveTelegramSupportForumDisplayState("resolved"), "closed");
    assert.equal(deriveTelegramSupportForumDisplayState("closed_parent"), "closed");

    const title = buildTelegramSupportForumTopicTitle({
        conversationId: CONVERSATION_ID,
        parentName: `\n Brendan ${"Lau ".repeat(80)}\u0000`,
        state: "needs_reply",
    });
    assert.ok(Array.from(title).length <= 128);
    assert.match(title, /^🔴 Needs reply · Brendan/);
    assert.match(title, /#7CDA7535$/);
    assert.doesNotMatch(title, /[\n\u0000]/);
});

test("only authorized plain text in a configured forum topic becomes a reply", () => {
    const validMessage = {
        message_id: 701,
        message_thread_id: 44,
        is_topic_message: true,
        chat: {
            id: Number(FORUM_CHAT_ID),
            type: "supergroup",
            is_forum: true,
        },
        from: {
            id: 1127073766,
            is_bot: false,
            first_name: "Patrick",
            last_name: "Lau",
        },
        reply_to_message: {
            message_id: 699,
        },
        text: "Saturday training continues as usual.",
    };
    const options = {
        forumChatId: FORUM_CHAT_ID,
        authorizedAdminUserIds: ["1127073766"],
    };

    assert.deepEqual(parseTelegramSupportForumMessage(validMessage, options), {
        forumChatId: FORUM_CHAT_ID,
        messageThreadId: "44",
        telegramMessageId: "701",
        replyToTelegramMessageId: "699",
        adminUserId: "1127073766",
        adminDisplayName: "Patrick Lau",
        content: "Saturday training continues as usual.",
    });

    const rejected = [
        { ...validMessage, chat: { ...validMessage.chat, id: -1001111111111 } },
        { ...validMessage, chat: { ...validMessage.chat, type: "group" } },
        { ...validMessage, chat: { ...validMessage.chat, is_forum: false } },
        { ...validMessage, is_topic_message: false },
        { ...validMessage, message_thread_id: undefined },
        { ...validMessage, message_thread_id: 1 },
        { ...validMessage, sender_chat: { id: Number(FORUM_CHAT_ID) } },
        { ...validMessage, from: { ...validMessage.from, is_bot: true } },
        { ...validMessage, from: { ...validMessage.from, id: 99887766 } },
        { ...validMessage, text: "/close" },
        { ...validMessage, text: "" },
        { ...validMessage, text: undefined, caption: "Photo caption" },
    ];
    for (const candidate of rejected) {
        assert.equal(parseTelegramSupportForumMessage(candidate, options), null);
    }
});

test("Bot API helpers call the forum methods with the exact group and topic payloads", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
        const method = String(url).split("/").at(-1);
        const body = JSON.parse(init.body);
        calls.push({ method, body });
        const result = method === "createForumTopic"
            ? { message_thread_id: 44, name: body.name, icon_color: 7322096 }
            : method === "sendMessage"
                ? { message_id: 701 }
                : true;
        return new Response(JSON.stringify({ ok: true, result }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    };
    const transport = { token: "123456:test-token", fetchImpl };

    const created = await createTelegramSupportForumTopic({
        chatId: FORUM_CHAT_ID,
        name: "🔴 Needs reply · Brendan · #7CDA75",
        ...transport,
    });
    assert.equal(created.message_thread_id, 44);
    await sendTelegramSupportForumMessage({
        chatId: FORUM_CHAT_ID,
        messageThreadId: 44,
        text: "Anything typed here is sent to this parent.",
        disableNotification: true,
        ...transport,
    });
    await editTelegramSupportForumTopic({
        chatId: FORUM_CHAT_ID,
        messageThreadId: 44,
        name: "🟡 Waiting for parent · Brendan · #7CDA75",
        ...transport,
    });
    await closeTelegramSupportForumTopic({
        chatId: FORUM_CHAT_ID,
        messageThreadId: 44,
        ...transport,
    });
    await reopenTelegramSupportForumTopic({
        chatId: FORUM_CHAT_ID,
        messageThreadId: 44,
        ...transport,
    });
    await reactToTelegramSupportForumMessage({
        chatId: FORUM_CHAT_ID,
        messageId: 701,
        ...transport,
    });
    await deleteTelegramSupportForumTopic({
        chatId: FORUM_CHAT_ID,
        messageThreadId: 44,
        ...transport,
    });

    assert.deepEqual(calls.map((call) => call.method), [
        "createForumTopic",
        "sendMessage",
        "editForumTopic",
        "closeForumTopic",
        "reopenForumTopic",
        "setMessageReaction",
        "deleteForumTopic",
    ]);
    assert.deepEqual(calls[1].body, {
        chat_id: FORUM_CHAT_ID,
        message_thread_id: 44,
        text: "Anything typed here is sent to this parent.",
        disable_notification: true,
    });
    assert.deepEqual(calls[5].body, {
        chat_id: FORUM_CHAT_ID,
        message_id: 701,
        reaction: [{ type: "emoji", emoji: "✅" }],
        is_big: false,
    });
});

function createQueryResultDatabase(result) {
    const calls = [];
    const database = {
        from(table) {
            calls.push(["from", table]);
            const chain = {
                select(value) {
                    calls.push(["select", value]);
                    return chain;
                },
                eq(field, value) {
                    calls.push(["eq", field, value]);
                    return chain;
                },
                in(field, value) {
                    calls.push(["in", field, value]);
                    return chain;
                },
                order(field, value) {
                    calls.push(["order", field, value]);
                    return chain;
                },
                limit(value) {
                    calls.push(["limit", value]);
                    return chain;
                },
                async maybeSingle() {
                    calls.push(["maybeSingle"]);
                    return result;
                },
            };
            return chain;
        },
    };
    return { database, calls };
}

test("topic mappings load only from the configured group and current topic states", async () => {
    const topic = {
        id: "0f389032-6790-44b7-93eb-7381a9d8a2c2",
        conversation_id: CONVERSATION_ID,
        telegram_forum_chat_id: FORUM_CHAT_ID,
        telegram_message_thread_id: 44,
        header_message_id: 45,
        topic_name: "🔴 Needs reply · Brendan · #7CDA7535",
        lifecycle_status: "open",
        display_state: "needs_reply",
        expected_parent_message_id: 91,
        provisioning_token: "f0fb9b11-6c0c-4ea8-a8f7-ee0152759760",
        provisioning_started_at: "2026-07-28T00:00:00.000Z",
        last_error_code: null,
        closed_at: null,
        created_at: "2026-07-28T00:00:00.000Z",
        updated_at: "2026-07-28T00:00:00.000Z",
    };
    const byConversation = createQueryResultDatabase({ data: topic, error: null });
    assert.equal(
        await loadForumTopicByConversation(
            byConversation.database,
            CONVERSATION_ID,
            FORUM_CHAT_ID,
        ),
        topic,
    );
    assert.ok(byConversation.calls.some((call) => (
        call[0] === "eq"
        && call[1] === "telegram_forum_chat_id"
        && call[2] === FORUM_CHAT_ID
    )));

    const byThread = createQueryResultDatabase({ data: topic, error: null });
    assert.equal(
        await loadForumTopicByThread(byThread.database, FORUM_CHAT_ID, 44),
        topic,
    );
    assert.ok(byThread.calls.some((call) => (
        call[0] === "eq"
        && call[1] === "telegram_message_thread_id"
        && call[2] === "44"
    )));
    assert.equal(
        await loadForumTopicByThread(byThread.database, "1127073766", 44),
        null,
    );
});

test("forum reply targets resolve only through the verified topic mappings", async () => {
    const calls = [];
    const database = {
        from(table) {
            return {
                select() {
                    return this;
                },
                eq(field, value) {
                    calls.push({ table, field, value: String(value) });
                    return this;
                },
                async maybeSingle() {
                    if (table === "telegram_support_forum_notifications") {
                        return {
                            data: { expected_parent_message_id: 91 },
                            error: null,
                        };
                    }
                    if (table === "support_messages") {
                        return { data: { id: 91 }, error: null };
                    }
                    return { data: null, error: null };
                },
            };
        },
    };

    assert.equal(
        await resolveTelegramSupportForumReplyTarget(
            database,
            "topic-1",
            "699",
            "conversation-a",
        ),
        "91",
    );
    assert.deepEqual(calls, [
        { table: "telegram_support_forum_notifications", field: "topic_id", value: "topic-1" },
        { table: "telegram_support_forum_notifications", field: "telegram_message_id", value: "699" },
        { table: "support_messages", field: "id", value: "91" },
        { table: "support_messages", field: "conversation_id", value: "conversation-a" },
    ]);
    assert.equal(
        await resolveTelegramSupportForumReplyTarget(
            database,
            "topic-1",
            null,
            "conversation-a",
        ),
        null,
    );
});

test("forum reply targets fall back to reply receipts and reject another conversation", async () => {
    const requestedTables = [];
    const database = {
        from(table) {
            requestedTables.push(table);
            return {
                select() {
                    return this;
                },
                eq() {
                    return this;
                },
                async maybeSingle() {
                    if (table === "telegram_support_forum_notifications") {
                        return { data: null, error: null };
                    }
                    if (table === "telegram_support_forum_reply_receipts") {
                        return { data: { support_message_id: 92 }, error: null };
                    }
                    // The canonical message lookup is conversation-scoped.
                    // A missing row represents a mapped message from a
                    // different parent conversation.
                    return { data: null, error: null };
                },
            };
        },
    };

    assert.equal(
        await resolveTelegramSupportForumReplyTarget(
            database,
            "topic-1",
            "700",
            "conversation-a",
        ),
        null,
    );
    assert.deepEqual(requestedTables, [
        "telegram_support_forum_notifications",
        "telegram_support_forum_reply_receipts",
        "support_messages",
    ]);
});

test("forum reply receipt claims are idempotent and completion records delivery", async () => {
    const receipt = {
        id: "622ff43e-f341-48a4-a661-05b829a0cad9",
        topic_id: "0f389032-6790-44b7-93eb-7381a9d8a2c2",
        telegram_message_id: 701,
        telegram_admin_user_id: "1127073766",
        telegram_admin_display_name: "Patrick Lau",
        support_message_id: null,
        telegram_parent_message_id: null,
        delivery_status: "received",
        delivery_error: null,
        delivered_at: null,
        created_at: "2026-07-28T00:00:00.000Z",
        updated_at: "2026-07-28T00:00:00.000Z",
    };
    let insertAttempts = 0;
    let completionValues = null;
    const database = {
        from(table) {
            assert.equal(table, "telegram_support_forum_reply_receipts");
            return {
                insert(values) {
                    assert.deepEqual(values, {
                        topic_id: receipt.topic_id,
                        telegram_message_id: "701",
                        telegram_admin_user_id: "1127073766",
                        telegram_admin_display_name: "Patrick Lau",
                        delivery_status: "received",
                    });
                    insertAttempts += 1;
                    return {
                        select() {
                            return {
                                async single() {
                                    return insertAttempts === 1
                                        ? { data: receipt, error: null }
                                        : { data: null, error: { code: "23505" } };
                                },
                            };
                        },
                    };
                },
                select() {
                    const chain = {
                        eq() {
                            return chain;
                        },
                        async single() {
                            return { data: receipt, error: null };
                        },
                    };
                    return chain;
                },
                update(values) {
                    completionValues = values;
                    const chain = {
                        eq() {
                            return chain;
                        },
                        in() {
                            return chain;
                        },
                        select() {
                            return chain;
                        },
                        async maybeSingle() {
                            return { data: { id: receipt.id }, error: null };
                        },
                    };
                    return chain;
                },
            };
        },
    };
    const input = {
        topicId: receipt.topic_id,
        telegramMessageId: 701,
        adminUserId: "1127073766",
        adminDisplayName: "Patrick Lau",
    };

    const first = await claimTelegramSupportForumReplyReceipt(database, input);
    const duplicate = await claimTelegramSupportForumReplyReceipt(database, input);
    assert.equal(first.claimed, true);
    assert.equal(duplicate.claimed, false);
    assert.equal(duplicate.receipt.id, receipt.id);

    assert.equal(await finishTelegramSupportForumReplyReceipt(database, {
        receiptId: receipt.id,
        status: "delivered",
        supportMessageId: 812,
        parentTelegramMessageId: 991,
    }), true);
    assert.equal(completionValues.delivery_status, "delivered");
    assert.equal(completionValues.support_message_id, 812);
    assert.equal(completionValues.telegram_parent_message_id, 991);
    assert.equal(completionValues.delivery_error, null);
    assert.match(completionValues.delivered_at, /^\d{4}-\d{2}-\d{2}T/);
});
