import assert from "node:assert/strict";
import test from "node:test";
import {
    telegramReceiptPresentation,
} from "../app/lib/support-telegram-receipts.ts";

test("Telegram receipts use the same four compact states as the app", () => {
    assert.deepEqual(
        [
            telegramReceiptPresentation("sending"),
            telegramReceiptPresentation("sent"),
            telegramReceiptPresentation(
                "parent_replied",
                "sent",
                "28 Jul, 9:15 pm",
            ),
            telegramReceiptPresentation("failed"),
        ].map(({ icon, label }) => `${icon} ${label}`),
        [
            "... Sending",
            "\u2713 Sent",
            "\u2713\u2713 Received",
            "! Failed",
        ],
    );
});

test("failed receipt details preserve the blocked-parent explanation", () => {
    assert.equal(
        telegramReceiptPresentation("failed", "blocked").title,
        "Telegram could not deliver this because the parent blocked the bot.",
    );
});

test("Received remains tied to a later parent message", () => {
    assert.equal(
        telegramReceiptPresentation(
            "parent_replied",
            "sent",
            "28 Jul, 9:15 pm",
        ).title,
        "The parent sent a later message at 28 Jul, 9:15 pm, confirming that this message was received.",
    );
});
