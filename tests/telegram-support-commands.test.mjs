import assert from "node:assert/strict";
import test from "node:test";
import {
    TELEGRAM_SUPPORT_PARENT_COMMANDS,
    setTelegramSupportCommands,
} from "../app/lib/telegram-support-commands.ts";

test("the Telegram parent menu exposes only the four supported commands", () => {
    assert.deepEqual(
        TELEGRAM_SUPPORT_PARENT_COMMANDS.map(({ command }) => command),
        ["start", "help", "status", "close"],
    );
    assert.equal(
        TELEGRAM_SUPPORT_PARENT_COMMANDS.some(({ command }) => command === "human"),
        false,
    );
});

test("command synchronization replaces both default and private-chat menus", async () => {
    const requests = [];
    await setTelegramSupportCommands("TEST_TOKEN", async (input, init) => {
        requests.push({
            url: String(input),
            method: init?.method,
            body: JSON.parse(String(init?.body || "{}")),
        });
        return new Response(JSON.stringify({ ok: true, result: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    });

    assert.equal(requests.length, 4);
    assert.deepEqual(
        requests.map(({ body }) => ({
            scope: body.scope,
            language_code: body.language_code,
        })),
        [
            { scope: { type: "default" }, language_code: undefined },
            { scope: { type: "all_private_chats" }, language_code: undefined },
            { scope: { type: "default" }, language_code: "en" },
            { scope: { type: "all_private_chats" }, language_code: "en" },
        ],
    );
    for (const request of requests) {
        assert.equal(request.method, "POST");
        assert.match(request.url, /\/setMyCommands$/);
        assert.deepEqual(request.body.commands, TELEGRAM_SUPPORT_PARENT_COMMANDS);
    }
});

test("command synchronization reports a stable error without exposing Telegram details", async () => {
    await assert.rejects(
        () => setTelegramSupportCommands("VERY_SECRET_TOKEN", async () => (
            new Response(
                JSON.stringify({ ok: false, description: "token VERY_SECRET_TOKEN was rejected" }),
                {
                    status: 401,
                    headers: { "Content-Type": "application/json" },
                },
            )
        )),
        (error) => {
            assert.match(error.message, /could not update/i);
            assert.doesNotMatch(error.message, /VERY_SECRET_TOKEN/);
            return true;
        },
    );
});
