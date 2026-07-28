import assert from "node:assert/strict";
import test from "node:test";
import {
    chatScrollEdges,
    countNewlyAppendedMessageIds,
} from "../app/lib/support-chat-scroll.ts";

test("chat scrolling follows only when the viewport is near the bottom", () => {
    assert.deepEqual(
        chatScrollEdges({
            scrollTop: 1452,
            scrollHeight: 2000,
            clientHeight: 500,
        }),
        { atTop: false, atBottom: true },
    );
    assert.deepEqual(
        chatScrollEdges({
            scrollTop: 900,
            scrollHeight: 2000,
            clientHeight: 500,
        }),
        { atTop: false, atBottom: false },
    );
});

test("chat scroll edges handle the top and a conversation without overflow", () => {
    assert.deepEqual(
        chatScrollEdges({
            scrollTop: 0,
            scrollHeight: 2000,
            clientHeight: 500,
        }),
        { atTop: true, atBottom: false },
    );
    assert.deepEqual(
        chatScrollEdges({
            scrollTop: 0,
            scrollHeight: 400,
            clientHeight: 500,
        }),
        { atTop: true, atBottom: true },
    );
});

test("the below counter counts only genuinely appended message IDs", () => {
    assert.equal(countNewlyAppendedMessageIds([1, 2, 3], [1, 2, 3]), 0);
    assert.equal(
        countNewlyAppendedMessageIds([1, 2, 3], [1, 2, 3, 4, 5]),
        2,
    );
    assert.equal(countNewlyAppendedMessageIds([], [1, 2]), 0);
    assert.equal(countNewlyAppendedMessageIds([1, 2], [20, 21]), 0);
    assert.equal(countNewlyAppendedMessageIds([1, 2], [2, 1, 3]), 0);
});
