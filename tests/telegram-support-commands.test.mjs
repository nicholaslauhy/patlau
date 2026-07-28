import assert from "node:assert/strict";
import test from "node:test";
import {
    TELEGRAM_SUPPORT_FORUM_COMMANDS,
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
    assert.equal(
        TELEGRAM_SUPPORT_PARENT_COMMANDS.find(({ command }) => command === "close")?.description,
        "Close this conversation",
    );
});

test("the private forum menu exposes only the safe setup command", () => {
    assert.deepEqual(
        TELEGRAM_SUPPORT_FORUM_COMMANDS.map(({ command }) => command),
        ["forumid"],
    );
});

test("command synchronization keeps parent and private-forum menus separate", async () => {
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

    assert.equal(requests.length, 6);
    assert.deepEqual(
        requests.map(({ body }) => ({
            scope: body.scope,
            language_code: body.language_code,
            commands: body.commands,
        })),
        [
            {
                scope: { type: "default" },
                language_code: undefined,
                commands: TELEGRAM_SUPPORT_PARENT_COMMANDS,
            },
            {
                scope: { type: "all_private_chats" },
                language_code: undefined,
                commands: TELEGRAM_SUPPORT_PARENT_COMMANDS,
            },
            {
                scope: { type: "all_group_chats" },
                language_code: undefined,
                commands: TELEGRAM_SUPPORT_FORUM_COMMANDS,
            },
            {
                scope: { type: "default" },
                language_code: "en",
                commands: TELEGRAM_SUPPORT_PARENT_COMMANDS,
            },
            {
                scope: { type: "all_private_chats" },
                language_code: "en",
                commands: TELEGRAM_SUPPORT_PARENT_COMMANDS,
            },
            {
                scope: { type: "all_group_chats" },
                language_code: "en",
                commands: TELEGRAM_SUPPORT_FORUM_COMMANDS,
            },
        ],
    );
    for (const request of requests) {
        assert.equal(request.method, "POST");
        assert.match(request.url, /\/setMyCommands$/);
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
