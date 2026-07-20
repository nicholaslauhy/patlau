import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { auditRateLimitExceeded, safeAuditError, writeAuditEvent } from '../../../lib/audit-server';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type VoteResponse = 'yes' | 'remove';

type CoachSlot = {
    key: string;
    label: string;
};

const getWebhookSecret = () => {
    const dedicated = process.env.TELEGRAM_COACH_ATTENDANCE_WEBHOOK_SECRET;
    if (dedicated) return dedicated;

    // Existing installations can derive an isolated coach secret from the
    // parent-support secret without exposing or reusing that raw value.
    const parentSupportSecret = process.env.TELEGRAM_PARENT_SUPPORT_WEBHOOK_SECRET;
    return parentSupportSecret
        ? createHmac('sha256', parentSupportSecret)
            .update('coach-attendance-webhook')
            .digest('hex')
        : '';
};

const secretsMatch = (received: string, expected: string) => {
    const receivedBuffer = Buffer.from(received);
    const expectedBuffer = Buffer.from(expected);
    return receivedBuffer.length === expectedBuffer.length
        && timingSafeEqual(receivedBuffer, expectedBuffer);
};

const getHandle = (from: any) => {
    if (from?.username) return `@${from.username}`;

    const fullName = [from?.first_name, from?.last_name].filter(Boolean).join(' ').trim();
    return fullName || `user_${from?.id}`;
};

const makeCallbackData = (pollId: string, slotKey: string, response: VoteResponse) => {
    return `ca|${pollId}|${slotKey}|${response}`;
};

const buildKeyboard = (pollId: string, slots: CoachSlot[]) => {
    return {
        inline_keyboard: slots.flatMap((slot) => [
            [
                {
                    text: `✅ Available: ${slot.label}`,
                    callback_data: makeCallbackData(pollId, slot.key, 'yes'),
                },
            ],
            [
                {
                    text: `↩️ Remove me: ${slot.label}`,
                    callback_data: makeCallbackData(pollId, slot.key, 'remove'),
                },
            ],
        ]),
    };
};

const numberedList = (names: string[]) => {
    if (names.length === 0) return 'No one yet';
    return names.map((name, index) => `${index + 1}. ${name}`).join('\n');
};

const buildMessageText = (
    introText: string,
    venueText: string,
    slots: CoachSlot[],
    responsesBySlot: Record<string, string[]>
) => {
    const slotSections = slots
        .map((slot) => `${slot.label}:\n${numberedList(responsesBySlot[slot.key] || [])}`)
        .join('\n\n');

    return `${introText.trim()}\n\n${slotSections}\n\n${venueText.trim()}`;
};

const answerCallbackQuery = async (callbackQueryId: string, text: string) => {
    const botToken = process.env.TELEGRAM_COACH_ATTENDANCE_BOT_TOKEN;
    if (!botToken) return;

    await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            callback_query_id: callbackQueryId,
            text,
            show_alert: false,
        }),
    });
};

const editPollMessage = async (poll: any) => {
    const botToken = process.env.TELEGRAM_COACH_ATTENDANCE_BOT_TOKEN;
    if (!botToken) throw new Error('Missing TELEGRAM_COACH_ATTENDANCE_BOT_TOKEN.');

    const { data: votes, error: votesError } = await supabaseAdmin
        .from('coach_attendance_votes')
        .select('*')
        .eq('poll_id', poll.id)
        .eq('response', 'yes')
        .order('updated_at', { ascending: true });

    if (votesError) throw votesError;

    const slots = Array.isArray(poll.dates) ? poll.dates : [];
    const responsesBySlot: Record<string, string[]> = {};

    slots.forEach((slot: CoachSlot) => {
        responsesBySlot[slot.key] = [];
    });

    (votes || []).forEach((vote: any) => {
        if (!responsesBySlot[vote.date_key]) {
            responsesBySlot[vote.date_key] = [];
        }

        const displayName = vote.telegram_handle || vote.display_name || String(vote.telegram_user_id);
        responsesBySlot[vote.date_key].push(displayName);
    });

    const messageText = buildMessageText(
        poll.intro_text,
        poll.venue_text || '',
        slots,
        responsesBySlot
    );

    const telegramResponse = await fetch(
        `https://api.telegram.org/bot${botToken}/editMessageText`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: poll.chat_id,
                message_id: poll.message_id,
                text: messageText,
                reply_markup: buildKeyboard(poll.id, slots),
            }),
        }
    );

    const telegramData = await telegramResponse.json();

    if (!telegramResponse.ok) {
        console.error('Failed to edit coach attendance poll:', telegramData);
    }
};

export async function POST(request: Request) {
    try {
        const expectedSecret = getWebhookSecret();
        const receivedSecret = request.headers.get('x-telegram-bot-api-secret-token') || '';
        if (!expectedSecret || !secretsMatch(receivedSecret, expectedSecret)) {
            const deniedAuditLimited = await auditRateLimitExceeded({
                request,
                eventType: 'telegram.coach_attendance.webhook_denied',
                targetLabel: 'coach attendance webhook',
                limit: 5,
                windowMs: 10 * 60_000,
            });

            if (!deniedAuditLimited) {
                await writeAuditEvent({
                    request,
                    eventKind: 'security',
                    category: 'coach_attendance',
                    eventType: 'telegram.coach_attendance.webhook_denied',
                    action: 'process_webhook',
                    outcome: 'denied',
                    summary: expectedSecret
                        ? 'A coach-attendance webhook with an invalid secret was denied'
                        : 'Coach-attendance webhook processing is unavailable because its secret is not configured',
                    actorSource: 'telegram_webhook',
                    targetTable: 'telegram',
                    targetLabel: 'coach attendance webhook',
                    metadata: { reason: expectedSecret ? 'invalid_webhook_secret' : 'missing_webhook_secret' },
                });
            } else {
                await writeAuditEvent({
                    request,
                    eventKind: 'security',
                    category: 'coach_attendance',
                    eventType: 'telegram.coach_attendance.webhook_denied.rate_limited',
                    action: 'process_webhook',
                    outcome: 'denied',
                    summary: 'Repeated invalid coach-attendance webhook requests were suppressed',
                    actorSource: 'telegram_webhook',
                    targetTable: 'telegram',
                    targetLabel: 'coach attendance webhook',
                });
            }
            return NextResponse.json(
                { error: expectedSecret ? 'Unauthorized' : 'Webhook is not configured' },
                { status: expectedSecret ? 401 : 503 },
            );
        }

        const update = await request.json();
        const callbackQuery = update.callback_query;

        if (!callbackQuery) {
            return NextResponse.json({ ok: true, ignored: true });
        }

        const callbackData = String(callbackQuery.data || '');
        const [prefix, pollId, slotKey, responseRaw] = callbackData.split('|');

        if (prefix !== 'ca' || !pollId || !slotKey || !['yes', 'remove'].includes(responseRaw)) {
            await answerCallbackQuery(callbackQuery.id, 'Invalid response.');
            return NextResponse.json({ ok: true, ignored: true });
        }

        const response = responseRaw as VoteResponse;
        const from = callbackQuery.from;
        const telegramUserId = String(from?.id || '');
        const telegramHandle = from?.username ? `@${from.username}` : null;
        const displayName = getHandle(from);

        const { data: poll, error: pollError } = await supabaseAdmin
            .from('coach_attendance_polls')
            .select('*')
            .eq('id', pollId)
            .eq('active', true)
            .single();

        if (pollError || !poll) {
            await answerCallbackQuery(callbackQuery.id, 'This poll is no longer active.');
            return NextResponse.json({ ok: true, ignored: true });
        }

        const slots = Array.isArray(poll.dates) ? poll.dates as CoachSlot[] : [];
        const slotExists = slots.some((slot) => slot.key === slotKey);

        if (!slotExists) {
            await answerCallbackQuery(callbackQuery.id, 'This option no longer exists. Please use the latest poll.');
            return NextResponse.json({ ok: true, ignored: true });
        }

        if (response === 'remove') {
            await supabaseAdmin
                .from('coach_attendance_votes')
                .delete()
                .eq('poll_id', pollId)
                .eq('date_key', slotKey)
                .eq('telegram_user_id', telegramUserId);
        } else {
            await supabaseAdmin
                .from('coach_attendance_votes')
                .upsert(
                    {
                        poll_id: pollId,
                        date_key: slotKey,
                        telegram_user_id: telegramUserId,
                        telegram_handle: telegramHandle,
                        display_name: displayName,
                        response: 'yes',
                        updated_at: new Date().toISOString(),
                    },
                    {
                        onConflict: 'poll_id,date_key,telegram_user_id',
                    }
                );
        }

        await editPollMessage(poll);

        await answerCallbackQuery(
            callbackQuery.id,
            response === 'yes' ? 'Added your name ✅' : 'Removed your name ↩️'
        );

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error('Coach attendance webhook error:', safeAuditError(error));

        return NextResponse.json(
            { error: 'Unexpected coach attendance webhook error.' },
            { status: 500 }
        );
    }
}
