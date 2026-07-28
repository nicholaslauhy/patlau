import assert from "node:assert/strict";
import test from "node:test";
import {
    decideSupportImageTriage,
    decideSupportImageProcessingContext,
    parseSupportImageTriage,
    selectSupportImageModel,
    SUPPORT_IMAGE_INPUT_DETAIL,
    SUPPORT_IMAGE_TRIAGE_CATEGORIES,
    SUPPORT_IMAGE_TRIAGE_RESPONSE_SCHEMA,
    SUPPORT_IMAGE_VISIBLE_FINDINGS,
    supportImageEscalationMessage,
    supportImageFailureDiagnostic,
    triageSupportImageCaption,
} from "../app/lib/support-image-policy.ts";
import {
    AI_MESSAGE_DISCLAIMER,
    formatAiReply,
    formatCoachReply,
} from "../app/lib/telegram-support-flow.ts";

test("image triage response schema uses only supported strict-schema keywords", () => {
    assert.equal(
        Object.hasOwn(SUPPORT_IMAGE_TRIAGE_RESPONSE_SCHEMA.properties.categories, "uniqueItems"),
        false,
    );
    assert.deepEqual(
        SUPPORT_IMAGE_TRIAGE_RESPONSE_SCHEMA.properties.categories.items.enum,
        SUPPORT_IMAGE_TRIAGE_CATEGORIES,
    );
    assert.deepEqual(
        SUPPORT_IMAGE_TRIAGE_RESPONSE_SCHEMA.required,
        ["categories", "confidence", "readable", "visibleFinding", "summary"],
    );
    assert.deepEqual(
        SUPPORT_IMAGE_TRIAGE_RESPONSE_SCHEMA.properties.visibleFinding.enum,
        SUPPORT_IMAGE_VISIBLE_FINDINGS,
    );
});

test("image model configuration prefers the dedicated model and preserves small-image detail", () => {
    assert.equal(selectSupportImageModel("vision-model", "support-model"), "vision-model");
    assert.equal(selectSupportImageModel(" ", "support-model"), "support-model");
    assert.equal(selectSupportImageModel(undefined, undefined), "gpt-5.6-terra");
    assert.equal(SUPPORT_IMAGE_INPUT_DETAIL, "original");
});

test("image triage parser accepts validated model JSON, including fenced output", () => {
    assert.deepEqual(
        parseSupportImageTriage('```json\n{"categories":["schedule","date"],"confidence":0.91,"readable":true,"visibleFinding":"none","summary":"Saturday timetable"}\n```'),
        {
            categories: ["schedule", "date"],
            confidence: 0.91,
            readable: true,
            visibleFinding: "none",
            summary: "Saturday timetable",
        },
    );
});

test("image triage parser deduplicates categories after structured output", () => {
    assert.deepEqual(
        parseSupportImageTriage({
            categories: ["schedule", "schedule", "date"],
            confidence: 0.9,
            readable: true,
            visibleFinding: "none",
            summary: "A routine schedule question.",
        }),
        {
            categories: ["schedule", "date"],
            confidence: 0.9,
            readable: true,
            visibleFinding: "none",
            summary: "A routine schedule question.",
        },
    );
});

test("image triage parser rejects malformed or unsupported model output", () => {
    assert.equal(parseSupportImageTriage("not json"), null);
    assert.equal(parseSupportImageTriage({ categories: ["invented"], confidence: 0.8, readable: true }), null);
    assert.equal(parseSupportImageTriage({ categories: ["venue"], confidence: 1.2, readable: true }), null);
    assert.equal(parseSupportImageTriage({ categories: [], confidence: 0.8, readable: true }), null);
    assert.equal(parseSupportImageTriage({
        categories: ["injury"],
        confidence: 0.9,
        readable: true,
        visibleFinding: "broken_bone_diagnosis",
    }), null);
});

test("image failure diagnostics retain only bounded non-sensitive metadata", () => {
    assert.deepEqual(
        supportImageFailureDiagnostic({
            stage: "openai_response",
            status: 400,
            code: "invalid_json_schema",
            param: "text.format.schema",
        }),
        {
            stage: "openai_response",
            status: 400,
            code: "invalid_json_schema",
            param: "text.format.schema",
        },
    );
    assert.deepEqual(
        supportImageFailureDiagnostic({
            stage: "openai_response",
            status: 999,
            code: "unsafe\ncaption contents",
            param: "x".repeat(100),
        }),
        { stage: "openai_response" },
    );
});

test("safety-sensitive image topics are escalated immediately", () => {
    for (const category of ["injury", "medical", "safety", "complaint", "refund", "dispute", "abuse", "urgent", "personal_record"]) {
        assert.equal(
            decideSupportImageTriage({ categories: [category], confidence: 0.95, readable: true }),
            "escalate_immediately",
            category,
        );
    }
});

test("routine, readable image topics remain with the AI", () => {
    for (const category of ["schedule", "date", "venue", "fees", "general_coaching"]) {
        assert.equal(
            decideSupportImageTriage({ categories: [category], confidence: 0.9, readable: true }),
            "ai_can_answer",
            category,
        );
    }
});

test("uncertain, unreadable, low-confidence, and invalid image analysis fails safe to Coach Patrick", () => {
    assert.equal(decideSupportImageTriage(null), "escalate_immediately");
    assert.equal(decideSupportImageTriage({ categories: ["uncertain"], confidence: 0.9, readable: true }), "escalate_immediately");
    assert.equal(decideSupportImageTriage({ categories: ["unreadable"], confidence: 0.9, readable: true }), "escalate_immediately");
    assert.equal(decideSupportImageTriage({ categories: ["medical"], confidence: 0.9, readable: false }), "escalate_immediately");
    assert.equal(decideSupportImageTriage({ categories: ["schedule"], confidence: 0.4, readable: true }), "escalate_immediately");
});

test("injury image handoff is compassionate, image-aware, and non-diagnostic", () => {
    const first = supportImageEscalationMessage({
        categories: ["injury"],
        confidence: 0.98,
        readable: true,
        visibleFinding: "scratch",
        summary: "PRIVATE_CANARY: a definitive diagnosis and parent@email.test",
    });
    const second = supportImageEscalationMessage({
        categories: ["injury"],
        confidence: 0.98,
        readable: true,
        visibleFinding: "scratch",
        summary: "A completely different model summary.",
    });

    assert.equal(first, second, "free-form model summaries must never affect parent-facing copy");
    assert.match(first, /sorry this happened/i);
    assert.match(first, /I can see what looks like a scratch in the photo/i);
    assert.doesNotMatch(first, /serious|severity/i);
    assert.match(first, /AI assistant is now paused/i);
    assert.match(first, /Coach Patrick will take over the conversation from here/i);
    assert.match(first, /Please wait for his reply/i);
    assert.match(first, /may need urgent medical attention|immediate danger/i);
    assert.doesNotMatch(first, /PRIVATE_CANARY|parent@email|definitive diagnosis|sent (?:by|from)/i);
});

test("validated visible findings use controlled acknowledgements", () => {
    const cases = [
        ["scratch", /what looks like a scratch/],
        ["bruise", /what looks like a bruise/],
        ["cut", /what looks like a cut/],
        ["swelling", /what looks like some swelling/],
        ["bleeding", /what looks like some bleeding/],
        ["burn", /what may be a burn/],
        ["skin_irritation", /what looks like skin irritation/],
    ];

    for (const [visibleFinding, expected] of cases) {
        const message = supportImageEscalationMessage({
            categories: ["injury"],
            confidence: 0.95,
            readable: true,
            visibleFinding,
            summary: "Untrusted free-form model summary.",
        });
        assert.match(message, expected, visibleFinding);
        assert.doesNotMatch(message, /serious|severity|diagnos|Untrusted free-form/i);
    }

    for (const visibleFinding of ["none", "unclear"]) {
        const message = supportImageEscalationMessage({
            categories: ["injury"],
            confidence: 0.8,
            readable: true,
            visibleFinding,
        });
        assert.match(message, /may involve an injury or safety concern/i);
        assert.doesNotMatch(message, /I can see what looks like/i);
    }
});

test("image handoff is labelled as automated while Coach replies remain raw", () => {
    const handoff = supportImageEscalationMessage({
        categories: ["injury"],
        confidence: 0.98,
        readable: true,
        visibleFinding: "scratch",
    });
    const deliveredHandoff = formatAiReply(handoff);
    const coachReply = "Please clean the area and let me know how your child is doing.";

    assert.match(deliveredHandoff, /AI assistant is now paused/i);
    assert.ok(deliveredHandoff.endsWith(AI_MESSAGE_DISCLAIMER));
    assert.equal(formatCoachReply(coachReply), coachReply);
    assert.doesNotMatch(formatCoachReply(coachReply), /automated|sent (?:by|from)/i);
});

test("failed image analysis stays honest while handing over to Coach Patrick", () => {
    const message = supportImageEscalationMessage(null, true);

    assert.match(message, /couldn't safely determine what this photo shows/i);
    assert.match(message, /AI assistant is now paused/i);
    assert.match(message, /Coach Patrick will take over the conversation from here/i);
    assert.match(message, /Please wait for his reply/i);
    assert.doesNotMatch(message, /injury|scratch|wound|diagnos|sent (?:by|from)/i);
});

test("complaint image handoff pauses the AI without medical wording", () => {
    const message = supportImageEscalationMessage({
        categories: ["complaint"],
        confidence: 0.96,
        readable: true,
        visibleFinding: "none",
        summary: "Complaint details that must not be repeated.",
    });

    assert.match(message, /AI assistant is now paused/i);
    assert.match(message, /Coach Patrick will take over the conversation from here/i);
    assert.match(message, /Please wait for his reply/i);
    assert.doesNotMatch(message, /medical|emergency|Complaint details|sent (?:by|from)/i);
});

test("injury and complaint captions bypass routine image handling", () => {
    assert.deepEqual(
        triageSupportImageCaption("My child was injured and is bleeding"),
        {
            categories: ["injury"],
            confidence: 1,
            readable: true,
            visibleFinding: "unclear",
            summary: "The caption requires human review.",
        },
    );
    assert.deepEqual(
        triageSupportImageCaption("I need to make a complaint and request a refund"),
        {
            categories: ["complaint"],
            confidence: 1,
            readable: true,
            visibleFinding: "unclear",
            summary: "The caption requires human review.",
        },
    );
    assert.equal(triageSupportImageCaption("What are the training dates?"), null);
});

test("slow image work cannot continue after a newer message, lost lease, or Coach takeover", () => {
    assert.equal(
        decideSupportImageProcessingContext({
            ownsLease: false,
            isLatestParentMessage: true,
            status: "ai_active",
        }),
        "retry",
    );
    assert.equal(
        decideSupportImageProcessingContext({
            ownsLease: true,
            isLatestParentMessage: false,
            status: "ai_active",
        }),
        "superseded",
    );
    for (const status of ["escalated", "human_active"]) {
        assert.equal(
            decideSupportImageProcessingContext({
                ownsLease: true,
                isLatestParentMessage: true,
                status,
            }),
            "coach_active",
        );
    }
    assert.equal(
        decideSupportImageProcessingContext({
            ownsLease: true,
            isLatestParentMessage: true,
            status: "waiting_parent",
        }),
        "continue",
    );
});
