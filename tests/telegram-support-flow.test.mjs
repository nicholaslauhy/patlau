import assert from "node:assert/strict";
import test from "node:test";
import {
    CLOSED_CONVERSATION_MESSAGE,
    COACH_REPLY_GUIDANCE,
    REOPENED_CONVERSATION_MESSAGE,
    coachHandoffKeyboard,
    coachReplyCloseKeyboard,
    formatCoachReply,
    formatAiReply,
    formatSystemMessage,
    normaliseCoachReferences,
    parentExplicitlyRequestsCoach,
    parentConversationStatusMessage,
    parentIsDissatisfied,
    reopenConversationKeyboard,
    shouldOfferDelayedFeedback,
} from "../app/lib/telegram-support-flow.ts";

test("AI messages use a disclaimer while Coach replies avoid personal attribution", () => {
    assert.equal(
        formatAiReply("I will connect you with a coach."),
        "I will connect you with Coach Patrick.\n\nThis is an automated AI-generated message based on the information provided.",
    );
    assert.equal(
        normaliseCoachReferences("Your coach will reply."),
        "Coach Patrick will reply.",
    );
    assert.equal(normaliseCoachReferences("Coach Nicholas will reply."), "Coach Patrick will reply.");
    assert.equal(normaliseCoachReferences("Coach can review this."), "Coach Patrick can review this.");
    assert.equal(normaliseCoachReferences("What is the coach-to-player ratio?"), "What is the coach-to-player ratio?");
    assert.equal(
        formatSystemMessage("This conversation is closed."),
        "This conversation is closed.",
    );
    assert.equal(
        formatCoachReply("I have checked this for you."),
        "I have checked this for you.",
    );
    assert.equal(
        formatCoachReply("Saturday training begins at 2pm.", true),
        `Saturday training begins at 2pm.\n\n${COACH_REPLY_GUIDANCE}`,
    );
    const longReply = formatAiReply("a".repeat(5000));
    assert.equal(longReply.length, 3900);
    assert.match(longReply, /This is an automated AI-generated message based on the information provided\.$/);
    const longCoachReply = formatCoachReply("a".repeat(5000), true);
    assert.equal(longCoachReply.length, 3900);
    assert.match(longCoachReply, /Use \/status to check the conversation, or \/close to close it\.$/);
});

test("explicit requests for a person or Coach Patrick are detected", () => {
    assert.equal(parentExplicitlyRequestsCoach("/human"), false);
    assert.equal(parentExplicitlyRequestsCoach("Can you connect me to Coach Patrick?"), true);
    assert.equal(parentExplicitlyRequestsCoach("I want to speak with a person"), true);
    assert.equal(parentExplicitlyRequestsCoach("I need a human"), true);
    assert.equal(parentExplicitlyRequestsCoach("Coach Patrick please"), true);
    assert.equal(parentExplicitlyRequestsCoach("I need Coach Patrick now."), true);
    assert.equal(parentExplicitlyRequestsCoach("What time is Coach Patrick's class?"), false);
    assert.equal(parentExplicitlyRequestsCoach("I need the coach schedule and fee."), false);
    assert.equal(parentExplicitlyRequestsCoach("What time is weekend training?"), false);
});

test("Coach Patrick handoff and close controls use explicit, scoped callbacks", () => {
    const conversationId = "3de79fc3-7fbd-4f58-bf4b-a26f757595b1";
    assert.deepEqual(coachHandoffKeyboard(conversationId), {
        inline_keyboard: [[
            { text: "Yes, connect me", callback_data: `ps|handoff_yes|${conversationId}` },
            { text: "No, continue with AI", callback_data: `ps|handoff_no|${conversationId}` },
        ]],
    });
    assert.deepEqual(coachReplyCloseKeyboard(conversationId), {
        inline_keyboard: [[{
            text: "Close conversation",
            callback_data: `ps|close|${conversationId}`,
        }]],
    });
});

test("parent-facing statuses explain Coach Patrick escalation without internal state names", () => {
    assert.match(parentConversationStatusMessage("escalated"), /^Escalated to Coach Patrick\./);
    assert.match(parentConversationStatusMessage("human_active"), /^Escalated to Coach Patrick\./);
    assert.doesNotMatch(parentConversationStatusMessage("human_active"), /human[_ ]active/i);
    assert.match(parentConversationStatusMessage("waiting_parent"), /AI assistant/i);
});

test("dissatisfaction and agitation are detected without escalating ordinary questions", () => {
    assert.equal(parentIsDissatisfied("This is not helpful and I am frustrated."), true);
    assert.equal(parentIsDissatisfied("You are not helping; I already asked."), true);
    assert.equal(parentIsDissatisfied("That didn't answer what I asked."), true);
    assert.equal(parentIsDissatisfied("My child is upset about missing class; what is the makeup policy?"), false);
    assert.equal(parentIsDissatisfied("Where is Saturday training?"), false);
});

test("feedback controls are delayed and only recur every third AI answer", () => {
    assert.equal(shouldOfferDelayedFeedback(0), false);
    assert.equal(shouldOfferDelayedFeedback(1), false);
    assert.equal(shouldOfferDelayedFeedback(2), true);
    assert.equal(shouldOfferDelayedFeedback(3), false);
    assert.equal(shouldOfferDelayedFeedback(5), true);
});

test("closed conversations provide a safe, explicit Telegram reopen action", () => {
    const conversationId = "3de79fc3-7fbd-4f58-bf4b-a26f757595b1";
    assert.match(CLOSED_CONVERSATION_MESSAGE, /conversation is closed/i);
    assert.match(CLOSED_CONVERSATION_MESSAGE, /send a new message/i);
    assert.match(REOPENED_CONVERSATION_MESSAGE, /conversation reopened/i);
    assert.deepEqual(reopenConversationKeyboard(conversationId), {
        inline_keyboard: [[{
            text: "Reopen conversation",
            callback_data: `ps|reopen|${conversationId}`,
        }]],
    });
});
