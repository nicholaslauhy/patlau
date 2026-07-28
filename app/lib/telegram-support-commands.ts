export const TELEGRAM_SUPPORT_PARENT_COMMANDS = [
    { command: "start", description: "Start or restart parent support" },
    { command: "help", description: "See how parent support works" },
    { command: "status", description: "Check your conversation status" },
    { command: "close", description: "Close this conversation" },
] as const;

export const TELEGRAM_SUPPORT_FORUM_COMMANDS = [
    { command: "forumid", description: "Show this private support forum ID" },
] as const;

const TELEGRAM_COMMAND_TARGETS = [
    { scope: { type: "default" }, commands: TELEGRAM_SUPPORT_PARENT_COMMANDS },
    { scope: { type: "all_private_chats" }, commands: TELEGRAM_SUPPORT_PARENT_COMMANDS },
    { scope: { type: "all_group_chats" }, commands: TELEGRAM_SUPPORT_FORUM_COMMANDS },
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
] as const;

type TelegramFetch = (
    input: string | URL | Request,
    init?: RequestInit,
) => Promise<Response>;

/**
 * Keep Telegram's visible command menu aligned with the commands accepted by
 * the parent-support webhook. The private-chat scope overrides an older
 * default menu configured through BotFather, while updating the default scope
 * prevents the retired command from appearing elsewhere.
 */
export async function setTelegramSupportCommands(
    botToken: string,
    fetchImplementation: TelegramFetch = fetch,
) {
    if (!botToken) throw new Error("Missing Telegram parent-support bot token.");

    await Promise.all(TELEGRAM_COMMAND_TARGETS.map(async (target) => {
        const response = await fetchImplementation(
            `https://api.telegram.org/bot${botToken}/setMyCommands`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: AbortSignal.timeout(10_000),
                body: JSON.stringify({
                    commands: target.commands,
                    ...target,
                }),
            },
        );
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.ok) {
            throw new Error("Telegram could not update the parent-support command menu.");
        }
    }));
}

let commandsAreSynced = false;
let commandSyncPromise: Promise<void> | null = null;

/**
 * Synchronize once per warm server instance. A rejected attempt is not cached,
 * so a later webhook can retry without interrupting parent support.
 */
export async function ensureTelegramSupportCommands() {
    if (commandsAreSynced) return;
    if (commandSyncPromise) return commandSyncPromise;

    commandSyncPromise = setTelegramSupportCommands(
        process.env.TELEGRAM_PARENT_SUPPORT_BOT_TOKEN || "",
    )
        .then(() => {
            commandsAreSynced = true;
        })
        .finally(() => {
            commandSyncPromise = null;
        });

    return commandSyncPromise;
}
