import assert from "node:assert/strict";
import test from "node:test";
import {
    decideSupportImageTriage,
    decideSupportImageProcessingContext,
    parseSupportImageTriage,
    triageSupportImageCaption,
} from "../app/lib/support-image-policy.ts";

test("image triage parser accepts validated model JSON, including fenced output", () => {
    assert.deepEqual(
        parseSupportImageTriage('```json\n{"categories":["schedule","date"],"confidence":0.91,"readable":true,"summary":"Saturday timetable"}\n```'),
        {
            categories: ["schedule", "date"],
            confidence: 0.91,
            readable: true,
            summary: "Saturday timetable",
        },
    );
});

test("image triage parser rejects malformed or unsupported model output", () => {
    assert.equal(parseSupportImageTriage("not json"), null);
    assert.equal(parseSupportImageTriage({ categories: ["invented"], confidence: 0.8, readable: true }), null);
    assert.equal(parseSupportImageTriage({ categories: ["venue"], confidence: 1.2, readable: true }), null);
    assert.equal(parseSupportImageTriage({ categories: [], confidence: 0.8, readable: true }), null);
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

test("injury and complaint captions bypass routine image handling", () => {
    assert.deepEqual(
        triageSupportImageCaption("My child was injured and is bleeding"),
        {
            categories: ["injury"],
            confidence: 1,
            readable: true,
            summary: "The caption requires human review.",
        },
    );
    assert.deepEqual(
        triageSupportImageCaption("I need to make a complaint and request a refund"),
        {
            categories: ["complaint"],
            confidence: 1,
            readable: true,
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
