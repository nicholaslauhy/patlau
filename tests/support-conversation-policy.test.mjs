import assert from "node:assert/strict";
import test from "node:test";
import {
    COACH_FOLLOW_UP_REOPENED_MESSAGE,
    canCloseAfterCoachReply,
    isSubstantiveCoachReply,
} from "../app/lib/support-conversation-policy.ts";
import { REOPENED_CONVERSATION_MESSAGE } from "../app/lib/telegram-support-flow.ts";

test("substantive Coach Patrick replies exclude greetings and acknowledgements", () => {
    for (const reply of [
        "hi",
        "hello",
        "hey",
        "hi there",
        "good morning",
        "hello how can I help",
        "noted thanks",
        "okay",
        "你好",
        "谢谢",
        "selamat pagi",
        "こんにちは",
        "வணக்கம்",
    ]) {
        assert.equal(isSubstantiveCoachReply(reply), false, reply);
    }

    assert.equal(
        isSubstantiveCoachReply("Saturday training will continue as usual from 2pm to 4pm."),
        true,
    );
    assert.equal(isSubstantiveCoachReply("星期六训练照常进行，下午2点开始。"), true);
});

test("a close action is available only after the latest parent message has a substantive Coach reply", () => {
    const messages = [
        { sender_type: "parent", content: "Is training on this Saturday?", created_at: "2026-07-25T09:00:00.000Z" },
    ];

    assert.equal(canCloseAfterCoachReply(messages), false);

    messages.push({ sender_type: "superuser", content: "Hi", created_at: "2026-07-25T09:01:00.000Z" });
    assert.equal(canCloseAfterCoachReply(messages), false);

    messages.push({
        sender_type: "superuser",
        content: "Yes. Saturday training is running as usual from 2pm to 4pm at NYGH.",
        created_at: "2026-07-25T09:02:00.000Z",
    });
    assert.equal(canCloseAfterCoachReply(messages), true);

    messages.push({ sender_type: "parent", content: "Thank you. What should my child bring?", created_at: "2026-07-25T09:03:00.000Z" });
    assert.equal(canCloseAfterCoachReply(messages), false);
});

test("conversation close eligibility handles messages supplied newest-first when timestamps are present", () => {
    assert.equal(canCloseAfterCoachReply([
        { sender_type: "superuser", content: "Please bring a racket, water bottle, and suitable sports shoes.", created_at: "2026-07-25T09:02:00.000Z" },
        { sender_type: "parent", content: "What should my child bring?", created_at: "2026-07-25T09:01:00.000Z" },
    ]), true);
});

test("a parent message received while a Coach reply is being delivered requires a fresh reply", () => {
    assert.equal(canCloseAfterCoachReply([
        { sender_type: "parent", content: "Is training on Saturday?", created_at: "2026-07-25T09:00:00.000Z" },
        // The reply is inserted later, but retains the time at which sending began.
        { sender_type: "superuser", content: "Saturday training is at 2pm.", created_at: "2026-07-25T09:01:00.000Z" },
        { sender_type: "parent", content: "Is the venue still NYGH?", created_at: "2026-07-25T09:01:01.000Z" },
    ]), false);
});

test("an older client reply without a verified parent-message precondition cannot enable closing", () => {
    assert.equal(canCloseAfterCoachReply([
        { sender_type: "parent", content: "What time is training?", created_at: "2026-07-25T09:00:00.000Z" },
        {
            sender_type: "superuser",
            content: "Saturday training begins at 2pm.",
            telegram_delivery_status: "sent_unverified_context",
            created_at: "2026-07-25T09:01:00.000Z",
        },
    ]), false);
});

test("reopening as Coach Patrick requires a new substantive follow-up before closing again", () => {
    const messages = [
        { sender_type: "parent", content: "Is training on Saturday?", created_at: "2026-07-25T09:00:00.000Z" },
        { sender_type: "superuser", content: "Saturday training begins at 2pm.", created_at: "2026-07-25T09:01:00.000Z" },
        { sender_type: "system", content: COACH_FOLLOW_UP_REOPENED_MESSAGE, created_at: "2026-07-25T09:02:00.000Z" },
    ];
    assert.equal(canCloseAfterCoachReply(messages), false);

    messages.push({
        sender_type: "superuser",
        content: "Correction: this Saturday's session begins at 3pm.",
        created_at: "2026-07-25T09:03:00.000Z",
    });
    assert.equal(canCloseAfterCoachReply(messages), true);
});

test("either reopen marker prevents an older Coach reply from enabling close", () => {
    for (const reopenMarker of [
        REOPENED_CONVERSATION_MESSAGE,
        COACH_FOLLOW_UP_REOPENED_MESSAGE,
    ]) {
        const messages = [
            { sender_type: "parent", content: "Is training on Saturday?", created_at: "2026-07-25T09:00:00.000Z" },
            { sender_type: "superuser", content: "Saturday training begins at 2pm and ends at 4pm.", created_at: "2026-07-25T09:01:00.000Z" },
            { sender_type: "system", content: reopenMarker, created_at: "2026-07-25T09:02:00.000Z" },
        ];

        assert.equal(canCloseAfterCoachReply(messages), false, reopenMarker);

        messages.push({
            sender_type: "superuser",
            content: "I have confirmed that the session will continue at the usual venue.",
            created_at: "2026-07-25T09:03:00.000Z",
        });
        assert.equal(canCloseAfterCoachReply(messages), true, reopenMarker);
    }
});
