import assert from "node:assert/strict";
import test from "node:test";
import {
    TELEGRAM_SUPPORT_ADMIN_FORCE_REPLY_MARKUP,
    claimTelegramSupportAdminReplyReceipt,
    extractTelegramSupportAdminReply,
    storeTelegramSupportAdminNotification,
    telegramSupportAdminNotificationIsExpired,
} from "../app/lib/telegram-support-admin-replies.ts";

const notification = {
    id: "3e7dca9f-17f8-4bc1-bfa6-dc86ecce99ab",
    telegram_admin_id: "90914721-f68b-44f1-84b9-c15b107fa96b",
    admin_display_name: "Coach Patrick",
    telegram_chat_id: "1127073766",
    telegram_message_id: 91,
    conversation_id: "22def700-26e1-4ed6-b424-0261506fcbe5",
    expected_parent_message_id: 187,
    created_at: "2026-07-28T00:00:00.000Z",
    expires_at: "2026-10-26T00:00:00.000Z",
};

test("a private reply to the exact alert yields a webhook integration envelope", () => {
    assert.deepEqual(extractTelegramSupportAdminReply({
        message_id: 123,
        text: "Saturday training continues as usual.",
        chat: { id: 1127073766, type: "private" },
        from: { id: 1127073766 },
        reply_to_message: { message_id: 91 },
    }), {
        adminChatId: "1127073766",
        adminUserId: "1127073766",
        adminMessageId: "123",
        repliedNotificationMessageId: "91",
        content: "Saturday training continues as usual.",
    });
});

test("group replies, mismatched senders, and ordinary messages are not treated as admin replies", () => {
    const base = {
        message_id: 123,
        text: "Reply",
        chat: { id: 1127073766, type: "private" },
        from: { id: 1127073766 },
        reply_to_message: { message_id: 91 },
    };
    assert.equal(extractTelegramSupportAdminReply({
        ...base,
        chat: { ...base.chat, type: "group" },
    }), null);
    assert.equal(extractTelegramSupportAdminReply({
        ...base,
        from: { id: 99887766 },
    }), null);
    assert.equal(extractTelegramSupportAdminReply({
        ...base,
        reply_to_message: undefined,
    }), null);
});

test("administrator alerts use Telegram ForceReply without adding parent-facing labels", () => {
    assert.deepEqual(TELEGRAM_SUPPORT_ADMIN_FORCE_REPLY_MARKUP, {
        force_reply: true,
        selective: false,
        input_field_placeholder: "Type Coach Patrick's reply to the parent",
    });
});

test("notification expiry is deterministic and fails closed for invalid timestamps", () => {
    assert.equal(
        telegramSupportAdminNotificationIsExpired(notification, Date.parse("2026-07-28T00:00:00.000Z")),
        false,
    );
    assert.equal(
        telegramSupportAdminNotificationIsExpired(notification, Date.parse("2026-10-26T00:00:00.000Z")),
        true,
    );
    assert.equal(
        telegramSupportAdminNotificationIsExpired({ expires_at: "not-a-date" }),
        true,
    );
});

test("a delivered alert stores the exact administrator, conversation, and parent turn mapping", async () => {
    const calls = [];
    const database = {
        from(table) {
            assert.equal(table, "telegram_support_admin_notifications");
            return {
                upsert(values, options) {
                    calls.push({ values, options });
                    return {
                        select(fields) {
                            assert.equal(fields, "id");
                            return {
                                async single() {
                                    return { data: { id: notification.id }, error: null };
                                },
                            };
                        },
                    };
                },
            };
        },
    };

    const id = await storeTelegramSupportAdminNotification(database, {
        recipient: {
            id: notification.telegram_admin_id,
            telegramChatId: notification.telegram_chat_id,
            displayName: notification.admin_display_name,
            deploymentFallback: false,
        },
        telegramMessageId: notification.telegram_message_id,
        conversationId: notification.conversation_id,
        expectedParentMessageId: notification.expected_parent_message_id,
    });

    assert.equal(id, notification.id);
    assert.deepEqual(calls, [{
        values: {
            telegram_admin_id: notification.telegram_admin_id,
            admin_display_name: notification.admin_display_name,
            telegram_chat_id: notification.telegram_chat_id,
            telegram_message_id: String(notification.telegram_message_id),
            conversation_id: notification.conversation_id,
            expected_parent_message_id: notification.expected_parent_message_id,
        },
        options: { onConflict: "telegram_chat_id,telegram_message_id" },
    }]);
});

test("reply receipt claims make a retried Telegram webhook idempotent", async () => {
    const storedReceipt = {
        id: "66d8330b-9f66-4acf-aac3-3d77af81cd3a",
        notification_id: notification.id,
        telegram_admin_id: notification.telegram_admin_id,
        admin_display_name: notification.admin_display_name,
        telegram_chat_id: notification.telegram_chat_id,
        telegram_message_id: 123,
        conversation_id: notification.conversation_id,
        expected_parent_message_id: notification.expected_parent_message_id,
        support_message_id: null,
        parent_telegram_message_id: null,
        status: "processing",
        failure_code: null,
        created_at: "2026-07-28T00:00:00.000Z",
        updated_at: "2026-07-28T00:00:00.000Z",
    };
    let insertAttempts = 0;
    const database = {
        from(table) {
            assert.equal(table, "telegram_support_admin_reply_receipts");
            return {
                insert() {
                    insertAttempts += 1;
                    return {
                        select() {
                            return {
                                async single() {
                                    return insertAttempts === 1
                                        ? { data: storedReceipt, error: null }
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
                            return { data: storedReceipt, error: null };
                        },
                    };
                    return chain;
                },
            };
        },
    };

    const first = await claimTelegramSupportAdminReplyReceipt(database, {
        notification,
        adminMessageId: 123,
    });
    const retried = await claimTelegramSupportAdminReplyReceipt(database, {
        notification,
        adminMessageId: 123,
    });

    assert.equal(first.claimed, true);
    assert.equal(retried.claimed, false);
    assert.equal(retried.receipt.id, storedReceipt.id);
});
