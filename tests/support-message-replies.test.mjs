import assert from "node:assert/strict";
import test from "node:test";
import {
    buildPublicSupportMessage,
    buildPublicSupportMessages,
    extractTelegramReplyToMessageId,
    insertSupportMessageWithReplyFallback,
    resolveSupportReplyTargetId,
} from "../app/lib/support-message-replies.ts";
import { supportImageSourceRefs } from "../app/lib/support-image-server.ts";

test("Telegram reply extraction accepts only a positive message ID", () => {
    assert.equal(
        extractTelegramReplyToMessageId({
            reply_to_message: { message_id: 491 },
        }),
        "491",
    );
    assert.equal(
        extractTelegramReplyToMessageId({
            reply_to_message: { message_id: " 492 " },
        }),
        "492",
    );
    for (const messageId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "", "1x", null]) {
        assert.equal(
            extractTelegramReplyToMessageId({
                reply_to_message: { message_id: messageId },
            }),
            null,
        );
    }
    assert.equal(extractTelegramReplyToMessageId({}), null);
    assert.equal(extractTelegramReplyToMessageId(null), null);
});

test("reply target resolution is constrained by conversation and Telegram message ID", async () => {
    const calls = [];
    const database = {
        from(table) {
            calls.push(["from", table]);
            const chain = {
                select(fields) {
                    calls.push(["select", fields]);
                    return chain;
                },
                eq(field, value) {
                    calls.push(["eq", field, value]);
                    return chain;
                },
                async maybeSingle() {
                    calls.push(["maybeSingle"]);
                    return { data: { id: 81 }, error: null };
                },
            };
            return chain;
        },
    };

    assert.equal(await resolveSupportReplyTargetId(database, {
        conversationId: "conversation-a",
        telegramMessageId: 491,
    }), 81);
    assert.deepEqual(calls.filter((call) => call[0] === "eq"), [
        ["eq", "conversation_id", "conversation-a"],
        ["eq", "telegram_message_id", "491"],
    ]);

    assert.equal(await resolveSupportReplyTargetId(database, {
        conversationId: "",
        telegramMessageId: 491,
    }), null);

    const missingDatabase = {
        from() {
            const chain = {
                select() {
                    return chain;
                },
                eq() {
                    return chain;
                },
                async maybeSingle() {
                    return { data: null, error: null };
                },
            };
            return chain;
        },
    };
    assert.equal(await resolveSupportReplyTargetId(missingDatabase, {
        conversationId: "conversation-a",
        telegramMessageId: 999,
    }), null);
});

function insertDatabase(results) {
    const attempts = [];
    return {
        attempts,
        database: {
            from(table) {
                assert.equal(table, "support_messages");
                return {
                    insert(values) {
                        attempts.push(values);
                        return {
                            select(fields) {
                                assert.equal(fields, "*");
                                return {
                                    async single() {
                                        return results[attempts.length - 1];
                                    },
                                };
                            },
                        };
                    },
                };
            },
        },
    };
}

test("message insert retries only when optional reply context is unavailable", async () => {
    const values = {
        conversation_id: "conversation-a",
        direction: "inbound",
        sender_type: "parent",
        content: "Is this the session you mean?",
    };
    const fallback = insertDatabase([
        {
            data: null,
            error: {
                code: "PGRST204",
                message: "Could not find the 'reply_to_message_id' column of 'support_messages' in the schema cache",
            },
        },
        { data: { id: 92, ...values }, error: null },
    ]);
    const result = await insertSupportMessageWithReplyFallback(
        fallback.database,
        values,
        81,
    );

    assert.deepEqual(fallback.attempts, [
        { ...values, reply_to_message_id: 81 },
        values,
    ]);
    assert.deepEqual(values, {
        conversation_id: "conversation-a",
        direction: "inbound",
        sender_type: "parent",
        content: "Is this the session you mean?",
    });
    assert.equal(result.data.id, 92);
    assert.equal(result.error, null);
    assert.equal(result.replyContextStored, false);
    assert.equal(result.usedLegacyReplyFallback, true);

    const unrelatedFailure = insertDatabase([
        {
            data: null,
            error: {
                code: "PGRST204",
                message: "Could not find the 'different_column' column in the schema cache",
            },
        },
    ]);
    const failed = await insertSupportMessageWithReplyFallback(
        unrelatedFailure.database,
        values,
        81,
    );
    assert.equal(unrelatedFailure.attempts.length, 1);
    assert.equal(failed.error.code, "PGRST204");
    assert.equal(failed.usedLegacyReplyFallback, false);

    const deletedTarget = insertDatabase([
        {
            data: null,
            error: {
                code: "23503",
                message: "insert or update on table \"support_messages\" violates foreign key constraint \"support_messages_reply_same_conversation_fk\"",
                details: "Key (conversation_id, reply_to_message_id)=(conversation-a, 81) is not present in table \"support_messages\".",
            },
        },
        { data: { id: 93, ...values }, error: null },
    ]);
    const recoveredFromDeletedTarget =
        await insertSupportMessageWithReplyFallback(
            deletedTarget.database,
            values,
            81,
        );
    assert.deepEqual(deletedTarget.attempts, [
        { ...values, reply_to_message_id: 81 },
        values,
    ]);
    assert.equal(recoveredFromDeletedTarget.data.id, 93);
    assert.equal(recoveredFromDeletedTarget.error, null);
    assert.equal(recoveredFromDeletedTarget.replyContextStored, false);
    assert.equal(recoveredFromDeletedTarget.usedLegacyReplyFallback, true);

    const unrelatedForeignKeyFailure = insertDatabase([
        {
            data: null,
            error: {
                code: "23503",
                message: "violates foreign key constraint \"support_messages_conversation_id_fkey\"",
                details: "Key (conversation_id)=(missing) is not present in table \"support_conversations\".",
            },
        },
    ]);
    const unrelatedForeignKey =
        await insertSupportMessageWithReplyFallback(
            unrelatedForeignKeyFailure.database,
            values,
            81,
        );
    assert.equal(unrelatedForeignKeyFailure.attempts.length, 1);
    assert.equal(unrelatedForeignKey.error.code, "23503");
    assert.equal(unrelatedForeignKey.usedLegacyReplyFallback, false);

    const ordinaryFailure = insertDatabase([
        { data: null, error: { code: "23505", message: "duplicate" } },
    ]);
    await insertSupportMessageWithReplyFallback(
        ordinaryFailure.database,
        values,
        81,
    );
    assert.equal(ordinaryFailure.attempts.length, 1);
});

test("successful reply-aware and ordinary inserts make only one database attempt", async () => {
    const values = {
        conversation_id: "conversation-a",
        content: "Reply",
    };
    const replyAware = insertDatabase([
        { data: { id: 2 }, error: null },
    ]);
    const withReply = await insertSupportMessageWithReplyFallback(
        replyAware.database,
        values,
        1,
    );
    assert.equal(replyAware.attempts.length, 1);
    assert.equal(replyAware.attempts[0].reply_to_message_id, 1);
    assert.equal(withReply.replyContextStored, true);
    assert.equal(withReply.usedLegacyReplyFallback, false);

    const ordinary = insertDatabase([
        { data: { id: 3 }, error: null },
    ]);
    const withoutReply = await insertSupportMessageWithReplyFallback(
        ordinary.database,
        values,
        null,
    );
    assert.equal(ordinary.attempts.length, 1);
    assert.equal("reply_to_message_id" in ordinary.attempts[0], false);
    assert.equal(withoutReply.replyContextStored, false);
});

function message(overrides) {
    return {
        id: 1,
        conversation_id: "conversation-a",
        direction: "inbound",
        sender_type: "parent",
        sender_user_id: null,
        content: "Original",
        source_refs: [],
        telegram_delivery_status: "received",
        created_at: "2026-07-28T01:00:00.000Z",
        ...overrides,
    };
}

test("public projections whitelist fields and map only same-conversation replies", () => {
    const xss = `<img src=x onerror="alert('not executed')">`;
    const longContent = "Long reply ".repeat(1200);
    const rows = [
        message({
            id: 1,
            content: xss,
            source_refs: [
                "Published policy",
                "patlau-internal:future:v9:do-not-expose",
            ],
            telegram_message_id: "491",
            private_future_column: "secret",
        }),
        message({
            id: 2,
            direction: "outbound",
            sender_type: "superuser",
            sender_user_id: "1ed72bf5-e57e-4e0e-b83e-67603bb090c8",
            content: longContent,
            reply_to_message_id: 1,
            telegram_message_id: "492",
        }),
        message({
            id: 3,
            content: "[Photo] Scratch on a hand",
            source_refs: supportImageSourceRefs("AgACAgUAAxkBAAIBQ2_photo-id_123"),
        }),
        message({
            id: 4,
            direction: "outbound",
            sender_type: "superuser",
            content: "Thank you for sending the photo.",
            reply_to_message_id: 3,
        }),
        message({
            id: 5,
            content: "Missing original",
            reply_to_message_id: 999,
        }),
        message({
            id: 10,
            conversation_id: "conversation-b",
            content: "Other parent's private message",
        }),
        message({
            id: 6,
            content: "Cross-conversation reference",
            reply_to_message_id: 10,
        }),
    ];

    const projected = buildPublicSupportMessages(rows);
    assert.equal(projected[0].content, xss);
    assert.deepEqual(projected[0].source_refs, ["Published policy"]);
    assert.equal(projected[1].content, longContent);
    assert.deepEqual(projected[1].reply_preview, {
        message_id: 1,
        sender_type: "parent",
        text: xss,
        has_image: false,
    });
    assert.equal(projected[2].has_image, true);
    assert.deepEqual(projected[2].source_refs, []);
    assert.deepEqual(projected[3].reply_preview, {
        message_id: 3,
        sender_type: "parent",
        text: "[Photo] Scratch on a hand",
        has_image: true,
    });
    assert.equal(projected[4].reply_preview, null);
    assert.equal(projected[6].reply_preview, null);

    const serialized = JSON.stringify(projected);
    assert.doesNotMatch(serialized, /telegram_message_id/);
    assert.doesNotMatch(serialized, /reply_to_message_id/);
    assert.doesNotMatch(serialized, /patlau-internal:/i);
    assert.doesNotMatch(serialized, /private_future_column/);
    assert.doesNotMatch(
        JSON.stringify(projected[6]),
        /Other parent's private message/,
    );

    assert.deepEqual(buildPublicSupportMessage(rows[3], rows), projected[3]);
    assert.equal(buildPublicSupportMessage({ id: 999 }, rows), null);
    assert.deepEqual(buildPublicSupportMessages(null), []);
});
