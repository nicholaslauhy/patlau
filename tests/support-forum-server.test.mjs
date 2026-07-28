import assert from "node:assert/strict";
import test from "node:test";
import {
    claimSupportForumTurn,
    deleteSupportForumTopicBeforeConversation,
    ensureSupportForumTopic,
    mirrorSupportForumAutomatedMessage,
    mirrorSupportForumCoachReply,
    mirrorSupportForumParentMessage,
    notifySupportForum,
    syncSupportForumState,
} from "../app/lib/support-forum-server.ts";
import { supportImageSourceRefs } from "../app/lib/support-image-server.ts";

const FORUM_CHAT_ID = "-1003904915951";
const CONVERSATION_ID = "7cda7535-f22d-405e-a996-12f9c30db44d";
const OTHER_CONVERSATION_ID = "3de79fc3-7fbd-4f58-bf4b-a26f757595b1";
const SITE_URL = "https://patlaubmt.vercel.app";
const CONVERSATION_LINKS = [
    `Open in PatLau app: ${SITE_URL}/open-in-app/chats?conversation=${CONVERSATION_ID}`,
    `Open on website: ${SITE_URL}/chats?conversation=${CONVERSATION_ID}`,
].join("\n");

function parentForumMessage(parentName, message) {
    return `${parentName}:\n\n${message}`;
}

function createMemoryDatabase() {
    const tables = {
        support_messages: [],
        telegram_support_forum_topics: [],
        telegram_support_forum_notifications: [],
        telegram_support_forum_reply_turns: [],
    };
    let sequence = 0;

    class Query {
        constructor(table) {
            this.table = table;
            this.operation = "select";
            this.payload = null;
            this.filters = [];
            this.orFilters = [];
        }

        select() {
            return this;
        }

        insert(payload) {
            this.operation = "insert";
            this.payload = payload;
            return this;
        }

        update(payload) {
            this.operation = "update";
            this.payload = payload;
            return this;
        }

        delete() {
            this.operation = "delete";
            return this;
        }

        eq(field, value) {
            this.filters.push([field, value]);
            return this;
        }

        is(field, value) {
            this.filters.push([field, value]);
            return this;
        }

        or(expression) {
            const alternatives = String(expression)
                .split(",")
                .map((condition) => {
                    const [field, operator, ...valueParts] =
                        condition.split(".");
                    return {
                        field,
                        operator,
                        value: valueParts.join("."),
                    };
                });
            this.orFilters.push(alternatives);
            return this;
        }

        matchesAlternative(row, condition) {
            if (condition.operator === "is" && condition.value === "null") {
                return row[condition.field] === null
                    || row[condition.field] === undefined;
            }
            if (condition.operator === "lt") {
                const current = String(row[condition.field] ?? "");
                const candidate = String(condition.value || "");
                return /^[0-9]+$/.test(current)
                    && /^[0-9]+$/.test(candidate)
                    && BigInt(current) < BigInt(candidate);
            }
            throw new Error(
                `Unsupported in-memory OR condition: ${condition.operator}`,
            );
        }

        matches(row) {
            return (
                this.filters.every(
                    ([field, value]) => String(row[field]) === String(value),
                )
                && this.orFilters.every((alternatives) =>
                    alternatives.some((condition) =>
                        this.matchesAlternative(row, condition)
                    )
                )
            );
        }

        duplicate(payload) {
            const rows = tables[this.table];
            if (this.table === "telegram_support_forum_topics") {
                return rows.some(
                    (row) => row.conversation_id === payload.conversation_id,
                );
            }
            if (this.table === "telegram_support_forum_notifications") {
                return rows.some(
                    (row) =>
                        row.topic_id === payload.topic_id
                        && String(row.expected_parent_message_id)
                            === String(payload.expected_parent_message_id),
                );
            }
            if (this.table === "telegram_support_forum_reply_turns") {
                return rows.some(
                    (row) =>
                        row.conversation_id === payload.conversation_id
                        && String(row.expected_parent_message_id)
                            === String(payload.expected_parent_message_id),
                );
            }
            return false;
        }

        defaultRow(payload) {
            const now = new Date().toISOString();
            sequence += 1;
            if (this.table === "telegram_support_forum_topics") {
                return {
                    id: `topic-${sequence}`,
                    telegram_message_thread_id: null,
                    header_message_id: null,
                    expected_parent_message_id: null,
                    provisioning_token: `provision-${sequence}`,
                    provisioning_started_at: now,
                    last_error_code: null,
                    closed_at: null,
                    created_at: now,
                    updated_at: now,
                    ...payload,
                };
            }
            return {
                id: `row-${sequence}`,
                created_at: now,
                updated_at: now,
                ...payload,
            };
        }

        async execute() {
            const rows = tables[this.table];
            if (!rows) {
                return { data: null, error: { code: "42P01" } };
            }
            if (this.operation === "insert") {
                if (this.duplicate(this.payload)) {
                    return { data: null, error: { code: "23505" } };
                }
                const row = this.defaultRow(this.payload);
                rows.push(row);
                return { data: row, error: null };
            }

            const matches = rows.filter((row) => this.matches(row));
            if (this.operation === "update") {
                for (const row of matches) {
                    Object.assign(row, this.payload, {
                        updated_at: new Date().toISOString(),
                    });
                }
                return { data: matches[0] || null, error: null };
            }
            if (this.operation === "delete") {
                for (const row of matches) {
                    rows.splice(rows.indexOf(row), 1);
                }
                return { data: matches, error: null };
            }
            return { data: matches[0] || null, error: null };
        }

        maybeSingle() {
            return this.execute();
        }

        single() {
            return this.execute();
        }

        then(resolve, reject) {
            return this.execute().then(resolve, reject);
        }
    }

    return {
        tables,
        database: {
            from(table) {
                return new Query(table);
            },
        },
    };
}

function createTelegramTransport() {
    const calls = [];
    const fetchImpl = async (url, init) => {
        const method = String(url).split("/").at(-1);
        const payload = JSON.parse(init.body);
        calls.push({ method, payload });
        const result = method === "createForumTopic"
            ? { message_thread_id: 44, name: payload.name, icon_color: 7322096 }
            : method === "sendMessage" || method === "sendPhoto"
                ? { message_id: 700 + calls.length }
                : true;
        return new Response(JSON.stringify({ ok: true, result }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    };
    return {
        calls,
        options: {
            forumChatId: FORUM_CHAT_ID,
            token: "123456:test-token",
            fetchImpl,
            siteUrl: SITE_URL,
        },
    };
}

test("AI and System labels mirror verbatim without changing an open topic's workflow state", async () => {
    const { database, tables } = createMemoryDatabase();
    const telegram = createTelegramTransport();
    const common = {
        conversationId: CONVERSATION_ID,
        parentName: "Brendan",
        ...telegram.options,
    };
    assert.equal((await ensureSupportForumTopic(database, common)).state, "ready");
    const topic = tables.telegram_support_forum_topics[0];
    topic.display_state = "needs_reply";
    topic.topic_name = "Brendan · #7CDA7535";

    const callCountBeforeMirror = telegram.calls.length;
    const aiResult = await mirrorSupportForumAutomatedMessage(database, {
        ...common,
        text: "AI assistant:\n\nWeekend training continues as usual.",
    });
    const systemResult = await mirrorSupportForumAutomatedMessage(database, {
        ...common,
        text: "System:\n\nThis conversation is closed.",
    });

    assert.equal(aiResult.mirrored, true);
    assert.equal(aiResult.topic.display_state, "needs_reply");
    assert.equal(systemResult.mirrored, true);
    assert.equal(systemResult.topic.display_state, "needs_reply");
    assert.equal(topic.topic_name, "Brendan · #7CDA7535");
    const mirrorCalls = telegram.calls.slice(callCountBeforeMirror);
    assert.deepEqual(mirrorCalls, [
        {
            method: "sendMessage",
            payload: {
                chat_id: FORUM_CHAT_ID,
                message_thread_id: 44,
                text: "AI assistant:\n\nWeekend training continues as usual.",
                disable_notification: true,
            },
        },
        {
            method: "sendMessage",
            payload: {
                chat_id: FORUM_CHAT_ID,
                message_thread_id: 44,
                text: "System:\n\nThis conversation is closed.",
                disable_notification: true,
            },
        },
    ]);
});

test("forum orchestration is idempotent and keeps one topic per parent", async () => {
    const { database, tables } = createMemoryDatabase();
    const telegram = createTelegramTransport();
    const common = {
        conversationId: CONVERSATION_ID,
        parentName: "Brendan",
        ...telegram.options,
    };

    const firstProvision = await ensureSupportForumTopic(database, common);
    const duplicateProvision = await ensureSupportForumTopic(database, common);
    assert.equal(firstProvision.state, "ready");
    assert.equal(firstProvision.created, true);
    assert.equal(duplicateProvision.state, "ready");
    assert.equal(duplicateProvision.created, false);
    assert.equal(
        telegram.calls.filter((call) => call.method === "createForumTopic").length,
        1,
    );
    const mismatchedForum = await ensureSupportForumTopic(database, {
        ...common,
        forumChatId: "-1004904915951",
    });
    assert.equal(mismatchedForum.state, "failed");
    assert.equal(mismatchedForum.errorCode, "forum_group_mismatch");
    assert.equal(mismatchedForum.fallbackRequired, true);

    const firstAlert = await notifySupportForum(database, {
        ...common,
        expectedParentMessageId: 91,
        alertText: "Parent needs help with a Christmas-week schedule question.",
        status: "escalated",
        latestSenderType: "parent",
    });
    const duplicateAlert = await notifySupportForum(database, {
        ...common,
        expectedParentMessageId: 91,
        alertText: "This retry must not be sent.",
        status: "escalated",
        latestSenderType: "parent",
    });
    assert.equal(firstAlert.delivered, true);
    assert.equal(duplicateAlert.delivered, true);
    assert.equal(duplicateAlert.duplicate, true);
    const sentMessages = telegram.calls.filter(
        (call) => call.method === "sendMessage",
    );
    assert.equal(sentMessages.length, 2);
    assert.deepEqual(sentMessages[0].payload, {
        chat_id: FORUM_CHAT_ID,
        message_thread_id: 44,
        text: CONVERSATION_LINKS,
        disable_notification: true,
    });
    assert.equal(
        sentMessages[1].payload.text,
        "Parent needs help with a Christmas-week schedule question.",
    );
    const pinCalls = telegram.calls.filter(
        (call) => call.method === "pinChatMessage",
    );
    assert.equal(pinCalls.length, 1);
    assert.deepEqual(pinCalls[0].payload, {
        chat_id: FORUM_CHAT_ID,
        message_id: Number(firstProvision.topic.header_message_id),
        disable_notification: true,
    });

    const topic = tables.telegram_support_forum_topics[0];
    const firstTurn = await claimSupportForumTurn(database, {
        topicId: topic.id,
        conversationId: CONVERSATION_ID,
        expectedParentMessageId: 91,
        adminUserId: "1127073766",
        adminDisplayName: "Patrick Lau",
    });
    const competingTurn = await claimSupportForumTurn(database, {
        topicId: topic.id,
        conversationId: CONVERSATION_ID,
        expectedParentMessageId: 91,
        adminUserId: "9988776655",
        adminDisplayName: "Another coach",
    });
    assert.equal(firstTurn.claimed, true);
    assert.equal(firstTurn.claimedByCaller, true);
    assert.equal(competingTurn.claimed, false);
    assert.equal(competingTurn.claimedByCaller, false);

    const closed = await syncSupportForumState(database, {
        ...common,
        status: "resolved",
        latestSenderType: "superuser",
    });
    assert.equal(closed.synced, true);
    assert.equal(closed.topic.lifecycle_status, "closed");

    const mirrored = await mirrorSupportForumCoachReply(database, {
        ...common,
        text: "One more detail for you.",
    });
    assert.equal(mirrored.mirrored, true);
    assert.equal(mirrored.topic.display_state, "waiting_parent");
    assert.ok(telegram.calls.some((call) => call.method === "reopenForumTopic"));

    const deletion = await deleteSupportForumTopicBeforeConversation(
        database,
        common,
    );
    assert.equal(deletion.canDeleteConversation, true);
    assert.equal(deletion.deleted, true);
    assert.equal(tables.telegram_support_forum_topics.length, 1);
    assert.equal(
        tables.telegram_support_forum_topics[0].last_error_code,
        "topic_deleted_pending_conversation_delete",
    );
    assert.ok(telegram.calls.some((call) => call.method === "deleteForumTopic"));

    const settling = await ensureSupportForumTopic(database, common);
    assert.equal(settling.state, "failed");
    assert.equal(settling.errorCode, "topic_deletion_settling");
    assert.equal(
        telegram.calls.filter((call) => call.method === "createForumTopic").length,
        1,
    );

    // Simulate the versioned parent-conversation delete losing a race. Its
    // cascade never arrived, so the exact completed tombstone becomes safely
    // recoverable after the deletion window.
    tables.telegram_support_forum_topics[0].updated_at =
        new Date(Date.now() - 61_000).toISOString();
    const recovered = await ensureSupportForumTopic(database, common);
    assert.equal(recovered.state, "ready");
    assert.equal(recovered.created, true);
    assert.equal(tables.telegram_support_forum_topics.length, 1);
    assert.equal(tables.telegram_support_forum_topics[0].lifecycle_status, "open");
    assert.equal(
        telegram.calls.filter((call) => call.method === "createForumTopic").length,
        2,
    );
});

test("a failed header pin is retried without creating another links message", async () => {
    const { database, tables } = createMemoryDatabase();
    const calls = [];
    let pinAttempts = 0;
    const fetchImpl = async (url, init) => {
        const method = String(url).split("/").at(-1);
        const payload = JSON.parse(init.body);
        calls.push({ method, payload });
        if (method === "pinChatMessage" && pinAttempts++ === 0) {
            return new Response(JSON.stringify({
                ok: false,
                error_code: 400,
                description: "Bad Request: not enough rights to pin a message",
            }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
        const result = method === "createForumTopic"
            ? { message_thread_id: 44, name: payload.name, icon_color: 7322096 }
            : method === "sendMessage"
                ? { message_id: 701 }
                : true;
        return new Response(JSON.stringify({ ok: true, result }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    };
    const input = {
        conversationId: CONVERSATION_ID,
        parentName: "Brendan",
        forumChatId: FORUM_CHAT_ID,
        token: "123456:test-token",
        fetchImpl,
        siteUrl: SITE_URL,
    };

    const first = await ensureSupportForumTopic(database, input);
    const retried = await ensureSupportForumTopic(database, input);

    assert.equal(first.state, "ready");
    assert.equal(first.errorCode, "forum_header_pin_failed");
    assert.equal(retried.state, "ready");
    assert.equal(retried.errorCode, null);
    assert.equal(tables.telegram_support_forum_topics[0].last_error_code, null);
    assert.equal(
        calls.filter((call) => call.method === "sendMessage").length,
        1,
    );
    assert.equal(
        calls.filter((call) => call.method === "pinChatMessage").length,
        2,
    );
});

test("photo alerts are delivered once inside the mapped parent topic", async () => {
    const { database, tables } = createMemoryDatabase();
    const telegram = createTelegramTransport();
    const input = {
        conversationId: CONVERSATION_ID,
        parentName: "Brendan",
        expectedParentMessageId: 92,
        alertText: [
            "Parent chat needs attention",
            "Parent: Brendan",
            "Reason: A photo may involve an injury.",
        ].join("\n\n"),
        photoFileId: "AgACAgUAAxkBAAIBQ2_photo-id_123",
        status: "escalated",
        latestSenderType: "parent",
        ...telegram.options,
    };

    const first = await notifySupportForum(database, input);
    const duplicate = await notifySupportForum(database, input);
    const photoCalls = telegram.calls.filter((call) => call.method === "sendPhoto");

    assert.equal(first.delivered, true);
    assert.equal(duplicate.delivered, true);
    assert.equal(duplicate.duplicate, true);
    assert.equal(photoCalls.length, 1);
    assert.equal(
        telegram.calls.filter((call) => call.method === "sendMessage").length,
        1,
    );
    assert.equal(
        telegram.calls.find((call) => call.method === "sendMessage").payload.text,
        CONVERSATION_LINKS,
    );
    assert.deepEqual(photoCalls[0].payload, {
        chat_id: FORUM_CHAT_ID,
        message_thread_id: 44,
        photo: input.photoFileId,
        caption: input.alertText,
        protect_content: true,
    });
    assert.equal(
        String(tables.telegram_support_forum_notifications[0].telegram_message_id),
        String(first.telegramMessageId),
    );
});

test("canonical parent text is mirrored once and an escalated retry upgrades the topic", async () => {
    const { database, tables } = createMemoryDatabase();
    const telegram = createTelegramTransport();
    const parentMessage = {
        id: 101,
        conversation_id: CONVERSATION_ID,
        sender_type: "parent",
        content: "Is there training during Christmas week?",
        source_refs: [],
    };
    tables.support_messages.push(parentMessage);
    const common = {
        conversationId: CONVERSATION_ID,
        parentName: "Brendan",
        expectedParentMessageId: parentMessage.id,
        ...telegram.options,
    };

    const first = await mirrorSupportForumParentMessage(database, {
        ...common,
        status: "ai_active",
    });
    const firstDisplayState = first.topic?.display_state;
    const escalatedDuplicate = await mirrorSupportForumParentMessage(database, {
        ...common,
        status: "escalated",
    });
    const sentMessages = telegram.calls.filter(
        (call) => call.method === "sendMessage",
    );

    assert.equal(first.delivered, true);
    assert.equal(first.duplicate, false);
    assert.equal(firstDisplayState, "ai_handling");
    assert.equal(escalatedDuplicate.delivered, true);
    assert.equal(escalatedDuplicate.duplicate, true);
    assert.equal(escalatedDuplicate.topic.display_state, "needs_reply");
    assert.equal(tables.telegram_support_forum_topics[0].display_state, "needs_reply");
    assert.equal(sentMessages.length, 2);
    assert.deepEqual(sentMessages[0].payload, {
        chat_id: FORUM_CHAT_ID,
        message_thread_id: 44,
        text: CONVERSATION_LINKS,
        disable_notification: true,
    });
    assert.deepEqual(sentMessages[1].payload, {
        chat_id: FORUM_CHAT_ID,
        message_thread_id: 44,
        text: parentForumMessage("Brendan", parentMessage.content),
    });
    assert.equal(
        telegram.calls.filter((call) => call.method === "pinChatMessage").length,
        1,
    );
    assert.equal(
        telegram.calls.filter((call) => call.method === "editForumTopic").length,
        1,
    );
    assert.equal(tables.telegram_support_forum_notifications.length, 1);
});

test("stored parent slash commands are mirrored with the parent's name", async () => {
    const { database, tables } = createMemoryDatabase();
    const telegram = createTelegramTransport();
    const commands = ["/start", "/help", "/status", "/close"];

    for (const [index, command] of commands.entries()) {
        const messageId = 150 + index;
        tables.support_messages.push({
            id: messageId,
            conversation_id: CONVERSATION_ID,
            sender_type: "parent",
            content: command,
            source_refs: [],
        });
        const result = await mirrorSupportForumParentMessage(database, {
            conversationId: CONVERSATION_ID,
            parentName: "Brendan",
            expectedParentMessageId: messageId,
            status: "ai_active",
            ...telegram.options,
        });
        assert.equal(result.delivered, true);
        assert.equal(result.duplicate, false);
    }

    const expectedMirrors = commands.map((command) =>
        parentForumMessage("Brendan", command)
    );
    const mirroredText = telegram.calls
        .filter((call) => call.method === "sendMessage")
        .map((call) => call.payload.text)
        .filter((text) => expectedMirrors.includes(text));

    assert.deepEqual(mirroredText, expectedMirrors);
    assert.equal(tables.telegram_support_forum_notifications.length, commands.length);
});

test("a rapid second parent message waits for topic provisioning instead of being lost", async () => {
    const { database, tables } = createMemoryDatabase();
    const telegram = createTelegramTransport();
    const now = new Date().toISOString();
    tables.support_messages.push({
        id: 105,
        conversation_id: CONVERSATION_ID,
        sender_type: "parent",
        content: "One more question while the topic is opening.",
        source_refs: [],
    });
    tables.telegram_support_forum_topics.push({
        id: "topic-in-flight",
        conversation_id: CONVERSATION_ID,
        telegram_forum_chat_id: FORUM_CHAT_ID,
        telegram_message_thread_id: null,
        header_message_id: null,
        topic_name: "Brendan",
        lifecycle_status: "provisioning",
        display_state: "ai_handling",
        expected_parent_message_id: null,
        provisioning_token: "provision-in-flight",
        provisioning_started_at: now,
        last_error_code: null,
        closed_at: null,
        created_at: now,
        updated_at: now,
    });
    setTimeout(() => {
        Object.assign(tables.telegram_support_forum_topics[0], {
            telegram_message_thread_id: 44,
            lifecycle_status: "open",
            updated_at: new Date().toISOString(),
        });
    }, 90);

    const result = await mirrorSupportForumParentMessage(database, {
        conversationId: CONVERSATION_ID,
        parentName: "Brendan",
        expectedParentMessageId: 105,
        status: "ai_active",
        ...telegram.options,
    });

    assert.equal(result.delivered, true);
    assert.equal(
        telegram.calls.filter((call) => call.method === "createForumTopic").length,
        0,
    );
    assert.deepEqual(
        telegram.calls
            .filter((call) => call.method === "sendMessage")
            .map((call) => call.payload.text),
        [
            CONVERSATION_LINKS,
            parentForumMessage(
                "Brendan",
                "One more question while the topic is opening.",
            ),
        ],
    );
});

test("out-of-order Telegram completions never move the forum reply target backwards", async () => {
    const { database, tables } = createMemoryDatabase();
    const calls = [];
    const completions = [];
    const olderMessage = {
        id: 201,
        conversation_id: CONVERSATION_ID,
        sender_type: "parent",
        content: "This older message will finish sending last.",
        source_refs: [],
    };
    const newerMessage = {
        id: 202,
        conversation_id: CONVERSATION_ID,
        sender_type: "parent",
        content: "This newer message will finish sending first.",
        source_refs: [],
    };
    tables.support_messages.push(olderMessage, newerMessage);

    const fetchImpl = async (url, init) => {
        const method = String(url).split("/").at(-1);
        const payload = JSON.parse(init.body);
        calls.push({ method, payload });
        if (
            method === "sendMessage"
            && payload.text === parentForumMessage("Brendan", olderMessage.content)
        ) {
            await new Promise((resolve) => setTimeout(resolve, 80));
            completions.push(olderMessage.id);
            return new Response(JSON.stringify({
                ok: true,
                result: { message_id: 801 },
            }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }
        if (
            method === "sendMessage"
            && payload.text === parentForumMessage("Brendan", newerMessage.content)
        ) {
            completions.push(newerMessage.id);
            return new Response(JSON.stringify({
                ok: true,
                result: { message_id: 802 },
            }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }
        const result = method === "createForumTopic"
            ? { message_thread_id: 44, name: payload.name, icon_color: 7322096 }
            : method === "sendMessage"
                ? { message_id: 700 }
                : true;
        return new Response(JSON.stringify({ ok: true, result }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    };
    const options = {
        forumChatId: FORUM_CHAT_ID,
        token: "123456:test-token",
        fetchImpl,
        siteUrl: SITE_URL,
    };
    const provision = await ensureSupportForumTopic(database, {
        conversationId: CONVERSATION_ID,
        parentName: "Brendan",
        status: "ai_active",
        latestSenderType: "parent",
        ...options,
    });
    assert.equal(provision.state, "ready");

    const [olderResult, newerResult] = await Promise.all([
        mirrorSupportForumParentMessage(database, {
            conversationId: CONVERSATION_ID,
            parentName: "Brendan",
            expectedParentMessageId: olderMessage.id,
            status: "ai_active",
            ...options,
        }),
        mirrorSupportForumParentMessage(database, {
            conversationId: CONVERSATION_ID,
            parentName: "Brendan",
            expectedParentMessageId: newerMessage.id,
            status: "ai_active",
            ...options,
        }),
    ]);

    assert.equal(olderResult.delivered, true);
    assert.equal(newerResult.delivered, true);
    assert.deepEqual(completions, [newerMessage.id, olderMessage.id]);
    assert.equal(
        String(tables.telegram_support_forum_topics[0].expected_parent_message_id),
        String(newerMessage.id),
    );
    assert.equal(
        String(olderResult.topic.expected_parent_message_id),
        String(newerMessage.id),
    );
    assert.equal(
        calls.filter(
            (call) =>
                call.method === "sendMessage"
                && [
                    parentForumMessage("Brendan", olderMessage.content),
                    parentForumMessage("Brendan", newerMessage.content),
                ]
                    .includes(call.payload.text),
        ).length,
        2,
    );
});

test("a delivered duplicate repairs a missing forum reply target without reposting", async () => {
    const { database, tables } = createMemoryDatabase();
    const telegram = createTelegramTransport();
    const parentMessage = {
        id: 203,
        conversation_id: CONVERSATION_ID,
        sender_type: "parent",
        content: "Please restore the reply target without sending me twice.",
        source_refs: [],
    };
    tables.support_messages.push(parentMessage);
    const input = {
        conversationId: CONVERSATION_ID,
        parentName: "Brendan",
        expectedParentMessageId: parentMessage.id,
        status: "ai_active",
        ...telegram.options,
    };

    const first = await mirrorSupportForumParentMessage(database, input);
    assert.equal(first.delivered, true);
    tables.telegram_support_forum_topics[0].expected_parent_message_id = null;

    const duplicate = await mirrorSupportForumParentMessage(database, input);

    assert.equal(duplicate.delivered, true);
    assert.equal(duplicate.duplicate, true);
    assert.equal(
        String(tables.telegram_support_forum_topics[0].expected_parent_message_id),
        String(parentMessage.id),
    );
    assert.equal(
        telegram.calls.filter(
            (call) =>
                call.method === "sendMessage"
                && call.payload.text
                    === parentForumMessage("Brendan", parentMessage.content),
        ).length,
        1,
    );
});

test("a delayed AI mirror cannot downgrade a newer needs-reply topic state", async () => {
    const { database, tables } = createMemoryDatabase();
    const calls = [];
    let releaseParentDelivery;
    let markParentDeliveryStarted;
    const parentDeliveryGate = new Promise((resolve) => {
        releaseParentDelivery = resolve;
    });
    const parentDeliveryStarted = new Promise((resolve) => {
        markParentDeliveryStarted = resolve;
    });
    const parentMessage = {
        id: 204,
        conversation_id: CONVERSATION_ID,
        sender_type: "parent",
        content: "This AI-handled copy will finish after escalation.",
        source_refs: [],
    };
    tables.support_messages.push(parentMessage);
    const fetchImpl = async (url, init) => {
        const method = String(url).split("/").at(-1);
        const payload = JSON.parse(init.body);
        calls.push({ method, payload });
        if (
            method === "sendMessage"
            && payload.text === parentForumMessage("Brendan", parentMessage.content)
        ) {
            markParentDeliveryStarted();
            await parentDeliveryGate;
            return new Response(JSON.stringify({
                ok: true,
                result: { message_id: 803 },
            }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }
        const result = method === "createForumTopic"
            ? { message_thread_id: 44, name: payload.name, icon_color: 7322096 }
            : method === "sendMessage"
                ? { message_id: 700 }
                : true;
        return new Response(JSON.stringify({ ok: true, result }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    };
    const options = {
        forumChatId: FORUM_CHAT_ID,
        token: "123456:test-token",
        fetchImpl,
        siteUrl: SITE_URL,
    };
    const provision = await ensureSupportForumTopic(database, {
        conversationId: CONVERSATION_ID,
        parentName: "Brendan",
        status: "ai_active",
        latestSenderType: "parent",
        ...options,
    });
    assert.equal(provision.state, "ready");

    const delayedMirror = mirrorSupportForumParentMessage(database, {
        conversationId: CONVERSATION_ID,
        parentName: "Brendan",
        expectedParentMessageId: parentMessage.id,
        status: "ai_active",
        ...options,
    });
    await parentDeliveryStarted;
    const escalated = await syncSupportForumState(database, {
        conversationId: CONVERSATION_ID,
        parentName: "Brendan",
        status: "escalated",
        latestSenderType: "parent",
        ...options,
    });
    releaseParentDelivery();
    const mirrorResult = await delayedMirror;

    assert.equal(escalated.synced, true);
    assert.equal(mirrorResult.delivered, true);
    assert.equal(
        tables.telegram_support_forum_topics[0].display_state,
        "needs_reply",
    );
    assert.equal(mirrorResult.topic.display_state, "needs_reply");
    assert.equal(
        calls.filter((call) => call.method === "editForumTopic").length,
        1,
    );
});

test("a definite temporary Telegram rejection is safely reclaimed and retried", async () => {
    const { database, tables } = createMemoryDatabase();
    const calls = [];
    let parentDeliveryAttempts = 0;
    const parentMessage = {
        id: 301,
        conversation_id: CONVERSATION_ID,
        sender_type: "parent",
        content: "Please keep this message even if Telegram briefly rejects it.",
        source_refs: [],
    };
    tables.support_messages.push(parentMessage);
    const fetchImpl = async (url, init) => {
        const method = String(url).split("/").at(-1);
        const payload = JSON.parse(init.body);
        calls.push({ method, payload });
        if (
            method === "sendMessage"
            && payload.text === parentForumMessage("Brendan", parentMessage.content)
        ) {
            parentDeliveryAttempts += 1;
            if (parentDeliveryAttempts === 1) {
                return new Response(JSON.stringify({
                    ok: false,
                    error_code: 503,
                    description: "Service Unavailable",
                }), {
                    status: 503,
                    headers: { "Content-Type": "application/json" },
                });
            }
            return new Response(JSON.stringify({
                ok: true,
                result: { message_id: 901 },
            }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }
        const result = method === "createForumTopic"
            ? { message_thread_id: 44, name: payload.name, icon_color: 7322096 }
            : method === "sendMessage"
                ? { message_id: 700 }
                : true;
        return new Response(JSON.stringify({ ok: true, result }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    };

    const result = await mirrorSupportForumParentMessage(database, {
        conversationId: CONVERSATION_ID,
        parentName: "Brendan",
        expectedParentMessageId: parentMessage.id,
        status: "ai_active",
        forumChatId: FORUM_CHAT_ID,
        token: "123456:test-token",
        fetchImpl,
        siteUrl: SITE_URL,
    });

    assert.equal(result.delivered, true);
    assert.equal(result.duplicate, true);
    assert.equal(parentDeliveryAttempts, 2);
    assert.equal(tables.telegram_support_forum_notifications.length, 1);
    assert.equal(
        tables.telegram_support_forum_notifications[0].delivery_status,
        "delivered",
    );
    assert.equal(
        tables.telegram_support_forum_notifications[0].failure_code,
        null,
    );
    assert.equal(
        String(tables.telegram_support_forum_topics[0].expected_parent_message_id),
        String(parentMessage.id),
    );
});

test("an ambiguous Telegram failure is never reclaimed because delivery may have occurred", async () => {
    const { database, tables } = createMemoryDatabase();
    const telegram = createTelegramTransport();
    const parentMessage = {
        id: 302,
        conversation_id: CONVERSATION_ID,
        sender_type: "parent",
        content: "Do not duplicate this possibly delivered message.",
        source_refs: [],
    };
    tables.support_messages.push(parentMessage);
    const provision = await ensureSupportForumTopic(database, {
        conversationId: CONVERSATION_ID,
        parentName: "Brendan",
        status: "ai_active",
        latestSenderType: "parent",
        ...telegram.options,
    });
    assert.equal(provision.state, "ready");
    const now = new Date().toISOString();
    tables.telegram_support_forum_notifications.push({
        id: "ambiguous-notification",
        topic_id: provision.topic.id,
        expected_parent_message_id: parentMessage.id,
        delivery_status: "failed",
        telegram_message_id: null,
        delivered_at: null,
        failure_code: "telegram_notify_ambiguous",
        created_at: now,
        updated_at: now,
    });

    const result = await mirrorSupportForumParentMessage(database, {
        conversationId: CONVERSATION_ID,
        parentName: "Brendan",
        expectedParentMessageId: parentMessage.id,
        status: "ai_active",
        ...telegram.options,
    });

    assert.equal(result.delivered, false);
    assert.equal(result.duplicate, true);
    assert.equal(result.inFlight, false);
    assert.equal(result.errorCode, "telegram_notify_ambiguous");
    assert.equal(
        telegram.calls.filter(
            (call) =>
                call.method === "sendMessage"
                && call.payload.text
                    === parentForumMessage("Brendan", parentMessage.content),
        ).length,
        0,
    );
    assert.equal(
        tables.telegram_support_forum_notifications[0].delivery_status,
        "failed",
    );
});

test("canonical parent photos are mirrored with their stored caption and file reference", async () => {
    const { database, tables } = createMemoryDatabase();
    const telegram = createTelegramTransport();
    const photoFileId = "AgACAgUAAxkBAAIBQ2_canonical-photo-id";
    const parentMessage = {
        id: 102,
        conversation_id: CONVERSATION_ID,
        sender_type: "parent",
        content: "[Photo]\nMy son got scratched during training.",
        source_refs: supportImageSourceRefs(photoFileId),
    };
    tables.support_messages.push(parentMessage);

    const result = await mirrorSupportForumParentMessage(database, {
        conversationId: CONVERSATION_ID,
        parentName: "Brendan",
        expectedParentMessageId: parentMessage.id,
        status: "escalated",
        ...telegram.options,
    });
    const photoCalls = telegram.calls.filter(
        (call) => call.method === "sendPhoto",
    );

    assert.equal(result.delivered, true);
    assert.equal(result.duplicate, false);
    assert.equal(photoCalls.length, 1);
    assert.deepEqual(photoCalls[0].payload, {
        chat_id: FORUM_CHAT_ID,
        message_thread_id: 44,
        photo: photoFileId,
        caption: parentForumMessage(
            "Brendan",
            "My son got scratched during training.",
        ),
        protect_content: true,
    });
    assert.equal(
        telegram.calls.filter((call) => call.method === "sendMessage").length,
        1,
    );
    assert.equal(
        telegram.calls.find((call) => call.method === "sendMessage").payload.text,
        CONVERSATION_LINKS,
    );
});

test("parent mirroring rejects cross-conversation and non-parent rows before Telegram delivery", async () => {
    const { database, tables } = createMemoryDatabase();
    const telegram = createTelegramTransport();
    tables.support_messages.push(
        {
            id: 103,
            conversation_id: OTHER_CONVERSATION_ID,
            sender_type: "parent",
            content: "Message from another parent conversation.",
            source_refs: [],
        },
        {
            id: 104,
            conversation_id: CONVERSATION_ID,
            sender_type: "ai",
            content: "This is not a parent message.",
            source_refs: [],
        },
    );

    const crossConversation = await mirrorSupportForumParentMessage(database, {
        conversationId: CONVERSATION_ID,
        parentName: "Brendan",
        expectedParentMessageId: 103,
        status: "escalated",
        ...telegram.options,
    });
    const wrongSender = await mirrorSupportForumParentMessage(database, {
        conversationId: CONVERSATION_ID,
        parentName: "Brendan",
        expectedParentMessageId: 104,
        status: "escalated",
        ...telegram.options,
    });

    for (const result of [crossConversation, wrongSender]) {
        assert.equal(result.delivered, false);
        assert.equal(result.duplicate, false);
        assert.equal(result.errorCode, "parent_message_mirror_mismatch");
        assert.equal(result.fallbackRequired, false);
    }
    assert.equal(telegram.calls.length, 0);
    assert.equal(tables.telegram_support_forum_topics.length, 0);
    assert.equal(tables.telegram_support_forum_notifications.length, 0);
});

test("an unconfigured forum returns a private-fallback result without touching the database", async () => {
    const database = {
        from() {
            throw new Error("The database must not be touched.");
        },
    };
    const result = await ensureSupportForumTopic(database, {
        conversationId: CONVERSATION_ID,
        parentName: "Brendan",
        forumChatId: null,
        token: null,
    });
    assert.equal(result.state, "unconfigured");
    assert.equal(result.fallbackRequired, true);
});

test("conversation deletion remains available when forum SQL was never installed", async () => {
    const database = {
        from(table) {
            assert.equal(table, "telegram_support_forum_topics");
            const query = {
                select() {
                    return query;
                },
                eq() {
                    return query;
                },
                async maybeSingle() {
                    return {
                        data: null,
                        error: {
                            code: "PGRST205",
                            message: "Could not find the table public.telegram_support_forum_topics in the schema cache",
                        },
                    };
                },
            };
            return query;
        },
    };
    const result = await deleteSupportForumTopicBeforeConversation(database, {
        conversationId: CONVERSATION_ID,
    });
    assert.equal(result.canDeleteConversation, true);
    assert.equal(result.noTopic, true);
    assert.equal(result.deleted, false);
});

test("status changes remain warning-free when forum SQL was never installed", async () => {
    const database = {
        from(table) {
            assert.equal(table, "telegram_support_forum_topics");
            const query = {
                select() {
                    return query;
                },
                eq() {
                    return query;
                },
                async maybeSingle() {
                    return {
                        data: null,
                        error: {
                            code: "42P01",
                            message: 'relation "telegram_support_forum_topics" does not exist',
                        },
                    };
                },
            };
            return query;
        },
    };
    const result = await syncSupportForumState(database, {
        conversationId: CONVERSATION_ID,
        parentName: "Brendan",
        status: "resolved",
    });
    assert.equal(result.synced, true);
    assert.equal(result.noTopic, true);
    assert.equal(result.errorCode, null);
});

test("removing or rotating the forum configuration never sends to a stored old group", async () => {
    const { database } = createMemoryDatabase();
    const telegram = createTelegramTransport();
    const common = {
        conversationId: CONVERSATION_ID,
        parentName: "Brendan",
        ...telegram.options,
    };
    assert.equal((await ensureSupportForumTopic(database, common)).state, "ready");
    const initialCallCount = telegram.calls.length;

    const disabledSync = await syncSupportForumState(database, {
        ...common,
        forumChatId: null,
        status: "resolved",
    });
    const disabledMirror = await mirrorSupportForumCoachReply(database, {
        ...common,
        forumChatId: null,
        text: "This must not reach the disabled forum.",
    });
    assert.equal(disabledSync.synced, true);
    assert.equal(disabledSync.noTopic, true);
    assert.equal(disabledMirror.mirrored, false);
    assert.equal(disabledMirror.noTopic, true);
    assert.equal(telegram.calls.length, initialCallCount);

    const rotatedForumId = "-1004904915951";
    const mismatchedProvision = await ensureSupportForumTopic(database, {
        ...common,
        forumChatId: rotatedForumId,
    });
    const mismatchedSync = await syncSupportForumState(database, {
        ...common,
        forumChatId: rotatedForumId,
        status: "resolved",
    });
    const mismatchedMirror = await mirrorSupportForumCoachReply(database, {
        ...common,
        forumChatId: rotatedForumId,
        text: "This must not reach the old forum.",
    });
    assert.equal(mismatchedProvision.errorCode, "forum_group_mismatch");
    assert.equal(mismatchedProvision.fallbackRequired, true);
    assert.equal(mismatchedSync.errorCode, "forum_group_mismatch");
    assert.equal(mismatchedMirror.errorCode, "forum_group_mismatch");
    assert.equal(telegram.calls.length, initialCallCount);
});
