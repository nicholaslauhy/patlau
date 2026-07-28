import assert from "node:assert/strict";
import test from "node:test";
import {
    formatParentMessageActivity,
    latestParentMessageAt,
} from "../app/lib/support-parent-activity.ts";

test("latest parent activity ignores newer outbound and invalid rows", () => {
    const messages = [
        {
            sender_type: "parent",
            created_at: "2026-07-28T08:00:00.000Z",
        },
        {
            sender_type: "ai",
            created_at: "2026-07-28T08:05:00.000Z",
        },
        {
            sender_type: "parent",
            created_at: "not-a-date",
        },
        {
            sender_type: "superuser",
            created_at: "2026-07-28T08:10:00.000Z",
        },
        {
            sender_type: "parent",
            created_at: "2026-07-28T08:03:00.000Z",
        },
    ];

    assert.equal(
        latestParentMessageAt(messages),
        "2026-07-28T08:03:00.000Z",
    );
});

test("latest parent activity is independent of message ordering", () => {
    assert.equal(
        latestParentMessageAt([
            {
                sender_type: "parent",
                created_at: "2026-07-28T08:30:00.000Z",
            },
            {
                sender_type: "parent",
                created_at: "2026-07-28T08:15:00.000Z",
            },
        ]),
        "2026-07-28T08:30:00.000Z",
    );
});

test("latest parent activity returns null when no valid parent row exists", () => {
    assert.equal(latestParentMessageAt([]), null);
    assert.equal(
        latestParentMessageAt([
            {
                sender_type: "ai",
                created_at: "2026-07-28T08:00:00.000Z",
            },
            {
                sender_type: "parent",
                created_at: "",
            },
        ]),
        null,
    );
});

test("parent activity wording is relative, pluralized and clock-skew safe", () => {
    const now = Date.parse("2026-07-28T10:00:00.000Z");

    assert.equal(
        formatParentMessageActivity("2026-07-28T09:59:31.000Z", now),
        "Last parent message just now",
    );
    assert.equal(
        formatParentMessageActivity("2026-07-28T09:59:00.000Z", now),
        "Last parent message 1 minute ago",
    );
    assert.equal(
        formatParentMessageActivity("2026-07-28T09:48:00.000Z", now),
        "Last parent message 12 minutes ago",
    );
    assert.equal(
        formatParentMessageActivity("2026-07-28T08:00:00.000Z", now),
        "Last parent message 2 hours ago",
    );
    assert.equal(
        formatParentMessageActivity("2026-07-26T10:00:00.000Z", now),
        "Last parent message 2 days ago",
    );
    assert.equal(
        formatParentMessageActivity("2026-07-28T10:01:00.000Z", now),
        "Last parent message just now",
    );
});

test("missing or invalid parent activity is described without a presence claim", () => {
    assert.equal(
        formatParentMessageActivity(null),
        "No parent message recorded yet",
    );
    assert.equal(
        formatParentMessageActivity("invalid"),
        "No parent message recorded yet",
    );
});
