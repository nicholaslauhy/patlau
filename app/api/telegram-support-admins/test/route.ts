import { NextRequest, NextResponse } from 'next/server';
import { getOptionalAuditActor, writeAuditEvent } from '../../../lib/audit-server';
import { serverAdmin } from '../../../lib/server-auth';
import { sendSupportTelegramMessage } from '../../../lib/support-server';
import {
    normalizeTelegramSupportChatId,
    TELEGRAM_SUPPORT_CHAT_ID_PATTERN,
} from '../../../lib/telegram-support-admin-policy';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
    const actor = await getOptionalAuditActor(request);
    if (!actor) {
        await writeAuditEvent({
            request,
            actor: null,
            eventKind: 'security',
            category: 'support',
            eventType: 'support.telegram_admin.test_denied',
            action: 'test_telegram_support_admin',
            outcome: 'denied',
            summary: 'An unauthenticated Telegram support administrator test was denied.',
            actorSource: 'anonymous',
            targetTable: 'telegram_support_admins',
        });
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (actor.role !== 'superuser') {
        await writeAuditEvent({
            request,
            actor,
            eventKind: 'security',
            category: 'support',
            eventType: 'support.telegram_admin.test_denied',
            action: 'test_telegram_support_admin',
            outcome: 'denied',
            summary: 'A user without permission attempted to test a Telegram support administrator.',
            targetTable: 'telegram_support_admins',
            metadata: { reason: 'insufficient_role' },
        });
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    try {
        const body = await request.json();
        const id = typeof body.id === 'string' ? body.id.trim() : '';
        if (!UUID_PATTERN.test(id)) {
            return NextResponse.json({ error: 'A valid administrator is required.' }, { status: 400 });
        }

        const { data, error } = await serverAdmin
            .from('telegram_support_admins')
            .select('id,telegram_chat_id,display_name,active')
            .eq('id', id)
            .maybeSingle();
        if (error) throw error;
        if (!data) return NextResponse.json({ error: 'Telegram administrator not found.' }, { status: 404 });
        const chatId = normalizeTelegramSupportChatId(data.telegram_chat_id);
        if (!TELEGRAM_SUPPORT_CHAT_ID_PATTERN.test(chatId)) {
            return NextResponse.json(
                { error: 'This entry is not a private Telegram user account.' },
                { status: 409 },
            );
        }
        const isDeploymentFallback = chatId === normalizeTelegramSupportChatId(
            process.env.TELEGRAM_PARENT_SUPPORT_ADMIN_CHAT_ID,
        );
        if (!data.active && !isDeploymentFallback) {
            return NextResponse.json(
                { error: 'Enable this administrator before sending a test.' },
                { status: 409 },
            );
        }

        await sendSupportTelegramMessage(
            chatId,
            'PatLau support notification test successful. You will receive alerts here when a parent conversation needs Coach Patrick.',
        );

        await writeAuditEvent({
            request,
            actor,
            eventKind: 'activity',
            category: 'support',
            eventType: 'support.telegram_admin.test_sent',
            action: 'test_telegram_support_admin',
            outcome: 'success',
            summary: `Sent a Telegram support notification test to ${data.display_name}.`,
            actorSource: 'settings',
            targetTable: 'telegram_support_admins',
            targetRecordId: { telegram_support_admin_id: id },
            targetLabel: data.display_name,
        });

        const response = NextResponse.json({ ok: true });
        response.headers.set('Cache-Control', 'no-store');
        return response;
    } catch (error) {
        console.error('Failed to send a Telegram support administrator test.');
        await writeAuditEvent({
            request,
            actor,
            category: 'support',
            eventType: 'support.telegram_admin.test_failed',
            action: 'test_telegram_support_admin',
            outcome: 'failure',
            summary: 'Failed to deliver a Telegram support administrator test.',
            targetTable: 'telegram_support_admins',
            metadata: { reason: 'telegram_delivery_failed' },
        });
        return NextResponse.json(
            { error: 'Telegram could not deliver the test. Ask this person to open the bot and send /start first.' },
            { status: 502 },
        );
    }
}
