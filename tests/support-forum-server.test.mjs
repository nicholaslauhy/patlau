import assert from "node:assert/strict";
import test from "node:test";
import {
    claimSupportForumTurn,
    deleteSupportForumTopicBeforeConversation,
    ensureSupportForumTopic,
    mirrorSupportForumCoachReply,
    notifySupportForum,
    syncSupportForumState,
} from "../app/lib/support-forum-server.ts";

const FORUM_CHAT_ID = "-1003904915951";
const CONVERSATION_ID = "7cda7535-f22d-405e-a996-12f9c30db44d";

function createMemoryDatabase() {
    const tables = {
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

        matches(row) {
            return this.filters.every(
                ([field, value]) => String(row[field]) === String(value),
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
        },
    };
}

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
    assert.equal(
        telegram.calls.filter((call) => call.method === "sendMessage").length,
        1,
    );

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
        0,
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
