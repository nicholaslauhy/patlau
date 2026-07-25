import assert from "node:assert/strict";
import test from "node:test";
import {
    chatReturnPath,
    safeChatReturnPath,
} from "../app/lib/auth-return.ts";

const conversationId = "3de79fc3-7fbd-4f58-bf4b-a26f757595b1";

test("chat return paths preserve a valid conversation UUID", () => {
    const path = `/chats?conversation=${conversationId}`;
    assert.equal(chatReturnPath(conversationId), path);
    assert.equal(safeChatReturnPath(path), path);
});

test("chat return paths reject open redirects and ambiguous destinations", () => {
    for (const value of [
        "https://attacker.example/chats?conversation=" + conversationId,
        "//attacker.example/chats?conversation=" + conversationId,
        "/dashboard",
        "/chats?conversation=not-a-uuid",
        `/chats?conversation=${conversationId}&admin=true`,
        `/chats?conversation=${conversationId}&conversation=${conversationId}`,
        `/chats?conversation=${conversationId}#messages`,
    ]) {
        assert.equal(safeChatReturnPath(value), null, value);
    }
});
