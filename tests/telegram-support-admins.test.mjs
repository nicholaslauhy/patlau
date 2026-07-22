import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildPublicTelegramSupportAdmin,
    fanOutTelegramSupportNotification,
    maskTelegramSupportChatId,
    resolveTelegramSupportAdminChatIds,
    validateTelegramSupportAdminInput,
} from '../app/lib/telegram-support-admin-policy.ts';

test('Telegram support admin input preserves private user IDs and rejects group IDs', () => {
    assert.deepEqual(
        validateTelegramSupportAdminInput(' 1127073766 ', ' Coach Patrick '),
        { error: null, telegramChatId: '1127073766', displayName: 'Coach Patrick' },
    );
    assert.match(validateTelegramSupportAdminInput('-1003904915951', 'Support group').error || '', /private Telegram user ID/);
    assert.match(validateTelegramSupportAdminInput('1234', 'Short').error || '', /private Telegram user ID/);
    assert.match(validateTelegramSupportAdminInput('123456', ' ').error || '', /Display name/);
    assert.equal(validateTelegramSupportAdminInput('12345678901234567890', 'Twenty digits').error, null);
    assert.match(validateTelegramSupportAdminInput('123456789012345678901', 'Too long').error || '', /private Telegram user ID/);
    assert.equal(validateTelegramSupportAdminInput('123456', 'A'.repeat(80)).error, null);
    assert.match(validateTelegramSupportAdminInput('123456', 'A'.repeat(81)).error || '', /Display name/);
});

test('active database admins and the deployment fallback are deduplicated', () => {
    assert.deepEqual(
        resolveTelegramSupportAdminChatIds([
            { telegram_chat_id: '111111', active: true },
            { telegram_chat_id: '222222', active: false },
            { telegram_chat_id: '111111', active: true },
        ], '333333'),
        ['111111', '333333'],
    );
    assert.deepEqual(
        resolveTelegramSupportAdminChatIds([
            { telegram_chat_id: '111111', active: true },
        ], '111111'),
        ['111111'],
    );
});

test('the deployment fallback remains active until its environment variable is removed', () => {
    assert.deepEqual(
        resolveTelegramSupportAdminChatIds([
            { telegram_chat_id: '1127073766', active: false },
            { telegram_chat_id: '22334455', active: true },
        ], '1127073766'),
        ['22334455', '1127073766'],
    );
    assert.deepEqual(resolveTelegramSupportAdminChatIds([], '1127073766'), ['1127073766']);
});

test('notification fan-out attempts every unique admin when one delivery fails', async () => {
    const attempted = [];
    const result = await fanOutTelegramSupportNotification(
        ['111111', '222222', '111111', '333333'],
        async (chatId) => {
            attempted.push(chatId);
            if (chatId === '222222') throw new Error('blocked');
        },
    );

    assert.deepEqual(attempted.sort(), ['111111', '222222', '333333']);
    assert.deepEqual(result, { attempted: 3, delivered: 2, failed: 1 });
});

test('chat ID hints reveal only the final four digits', () => {
    assert.equal(maskTelegramSupportChatId('1127073766'), '••••••3766');
    assert.equal(maskTelegramSupportChatId('12345'), '••••2345');
});

test('public administrator records never expose the full Telegram user ID', () => {
    const rawId = '1127073766';
    const record = buildPublicTelegramSupportAdmin({
        id: 'f50f5a37-035a-4f37-b71c-47a4665f5894',
        telegram_chat_id: rawId,
        display_name: 'Coach Patrick',
        active: false,
        created_at: '2026-07-22T00:00:00.000Z',
    }, rawId);

    assert.equal(record.chat_id_hint, '••••••3766');
    assert.equal(record.active, true);
    assert.equal(record.deployment_fallback, true);
    assert.doesNotMatch(JSON.stringify(record), new RegExp(rawId));
});

test('empty and all-failed notification fan-out results are explicit', async () => {
    assert.deepEqual(
        await fanOutTelegramSupportNotification([], async () => undefined),
        { attempted: 0, delivered: 0, failed: 0 },
    );
    assert.deepEqual(
        await fanOutTelegramSupportNotification(['111111', '222222'], async () => {
            throw new Error('blocked');
        }),
        { attempted: 2, delivered: 0, failed: 2 },
    );
});
