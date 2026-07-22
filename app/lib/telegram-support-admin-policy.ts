// Parent-support administrators are individual Telegram users. Negative IDs
// belong to groups/channels and could expose parent messages to many people.
export const TELEGRAM_SUPPORT_CHAT_ID_PATTERN = /^[0-9]{5,20}$/;

export interface TelegramSupportAdminRow {
    telegram_chat_id: string;
    active: boolean;
}

export interface TelegramSupportAdminRecord extends TelegramSupportAdminRow {
    id: string;
    display_name: string;
    created_at?: string | null;
    updated_at?: string | null;
}

export function normalizeTelegramSupportChatId(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

export function validateTelegramSupportAdminInput(chatIdValue: unknown, displayNameValue: unknown) {
    const telegramChatId = normalizeTelegramSupportChatId(chatIdValue);
    const displayName = typeof displayNameValue === 'string' ? displayNameValue.trim() : '';

    if (!TELEGRAM_SUPPORT_CHAT_ID_PATTERN.test(telegramChatId)) {
        return {
            error: 'Enter a valid private Telegram user ID containing 5 to 20 digits.',
            telegramChatId,
            displayName,
        };
    }

    if (displayName.length < 1 || displayName.length > 80) {
        return {
            error: 'Display name must contain between 1 and 80 characters.',
            telegramChatId,
            displayName,
        };
    }

    return { error: null, telegramChatId, displayName };
}

export function resolveTelegramSupportAdminChatIds(
    rows: TelegramSupportAdminRow[],
    fallbackValue?: string | null,
) {
    const normalizedRows = rows
        .map((row) => ({
            telegram_chat_id: normalizeTelegramSupportChatId(row.telegram_chat_id),
            active: row.active === true,
        }))
        .filter((row) => TELEGRAM_SUPPORT_CHAT_ID_PATTERN.test(row.telegram_chat_id));
    const activeIds = normalizedRows
        .filter((row) => row.active)
        .map((row) => row.telegram_chat_id);
    const fallbackId = normalizeTelegramSupportChatId(fallbackValue);

    // The deployment fallback remains active until its environment variable is
    // removed. This keeps alerts available if the table is briefly unavailable.
    if (TELEGRAM_SUPPORT_CHAT_ID_PATTERN.test(fallbackId)) {
        activeIds.push(fallbackId);
    }

    return [...new Set(activeIds)];
}

export function maskTelegramSupportChatId(value: string) {
    const normalized = normalizeTelegramSupportChatId(value);
    if (!normalized) return 'Not available';
    const digits = normalized;
    const visible = digits.slice(-4);
    return `${'\u2022'.repeat(Math.max(4, digits.length - visible.length))}${visible}`;
}

export function buildPublicTelegramSupportAdmin(
    row: TelegramSupportAdminRecord,
    fallbackValue?: string | null,
) {
    const chatId = normalizeTelegramSupportChatId(row.telegram_chat_id);
    const fallbackId = normalizeTelegramSupportChatId(fallbackValue);
    const deploymentFallback = Boolean(
        TELEGRAM_SUPPORT_CHAT_ID_PATTERN.test(fallbackId)
        && chatId === fallbackId,
    );

    return {
        id: String(row.id),
        display_name: String(row.display_name || 'Telegram administrator'),
        active: deploymentFallback || row.active === true,
        chat_id_hint: maskTelegramSupportChatId(chatId),
        deployment_fallback: deploymentFallback,
        created_at: row.created_at || null,
        updated_at: row.updated_at || null,
    };
}

export async function fanOutTelegramSupportNotification(
    chatIds: string[],
    send: (chatId: string) => Promise<unknown>,
) {
    const uniqueIds = [...new Set(chatIds)];
    const results = await Promise.allSettled(uniqueIds.map((chatId) => send(chatId)));
    const failed = results.filter((result) => result.status === 'rejected').length;
    return {
        attempted: uniqueIds.length,
        delivered: uniqueIds.length - failed,
        failed,
    };
}
