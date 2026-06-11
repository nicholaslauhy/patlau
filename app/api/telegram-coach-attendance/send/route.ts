import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type CoachSlotInput = {
    key: string;
    label: string;
};

const ISO_DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}(?:-\d{1,2}-\d{1,2})?$/;

const makeCallbackData = (pollId: string, slotKey: string, response: 'yes' | 'remove') => {
    return `ca|${pollId}|${slotKey}|${response}`;
};

const buildKeyboard = (pollId: string, slots: CoachSlotInput[]) => {
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
    slots: CoachSlotInput[],
    responsesBySlot: Record<string, string[]>
) => {
    const slotSections = slots
        .map((slot) => `${slot.label}:\n${numberedList(responsesBySlot[slot.key] || [])}`)
        .join('\n\n');

    return `${introText.trim()}\n\n${slotSections}\n\n${venueText.trim()}`;
};

export async function POST(request: Request) {
    try {
        const bodyJson = await request.json();

        const introText = String(bodyJson.introText || '').trim();
        const venueText = String(bodyJson.venueText || '').trim();
        const pollDate = String(bodyJson.pollDate || '').trim();
        const slots = bodyJson.slots as CoachSlotInput[] | undefined;
        const topic = String(bodyJson.topic || '').trim().toLowerCase();

        if (!introText) {
            return NextResponse.json({ error: 'introText is required.' }, { status: 400 });
        }

        if (!venueText) {
            return NextResponse.json({ error: 'venueText is required.' }, { status: 400 });
        }

        if (!pollDate || !/^\d{4}-\d{2}-\d{2}$/.test(pollDate)) {
            return NextResponse.json({ error: 'pollDate must be YYYY-MM-DD.' }, { status: 400 });
        }

        if (!Array.isArray(slots) || slots.length === 0) {
            return NextResponse.json({ error: 'At least one slot is required.' }, { status: 400 });
        }

        const cleanSlots = slots
            .map((slot) => ({
                key: String(slot.key || '').trim(),
                label: String(slot.label || '').trim(),
            }))
            .filter((slot) => slot.key && slot.label);

        if (cleanSlots.length === 0) {
            return NextResponse.json({ error: 'At least one valid slot is required.' }, { status: 400 });
        }

        const invalidSlot = cleanSlots.find((slot) => !ISO_DATE_KEY_PATTERN.test(slot.key));
        if (invalidSlot) {
            return NextResponse.json(
                {
                    error: `Invalid database date key: ${invalidSlot.key}. Expected YYYY-MM-DD or YYYY-MM-DD-start-end.`,
                },
                { status: 400 }
            );
        }

        const botToken = process.env.TELEGRAM_COACH_ATTENDANCE_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_COACH_ATTENDANCE_CHAT_ID;

        const threadId =
            topic === 'saturday'
                ? process.env.TELEGRAM_COACH_ATTENDANCE_SATURDAY_THREAD_ID
                : topic === 'sunday'
                    ? process.env.TELEGRAM_COACH_ATTENDANCE_SUNDAY_THREAD_ID
                    : process.env.TELEGRAM_COACH_ATTENDANCE_THREAD_ID;

        if (!botToken) {
            return NextResponse.json({ error: 'Missing TELEGRAM_COACH_ATTENDANCE_BOT_TOKEN.' }, { status: 500 });
        }

        if (!chatId) {
            return NextResponse.json({ error: 'Missing TELEGRAM_COACH_ATTENDANCE_CHAT_ID.' }, { status: 500 });
        }

        if (!threadId) {
            return NextResponse.json(
                {
                    error:
                        topic === 'saturday'
                            ? 'Missing TELEGRAM_COACH_ATTENDANCE_SATURDAY_THREAD_ID.'
                            : topic === 'sunday'
                                ? 'Missing TELEGRAM_COACH_ATTENDANCE_SUNDAY_THREAD_ID.'
                                : 'Missing TELEGRAM_COACH_ATTENDANCE_THREAD_ID.',
                },
                { status: 500 }
            );
        }

        const { data: poll, error: pollError } = await supabaseAdmin
            .from('coach_attendance_polls')
            .insert({
                intro_text: introText,
                venue_text: venueText,
                dates: cleanSlots,
                poll_date: pollDate,
                topic,
                chat_id: String(chatId),
                thread_id: threadId ? Number(threadId) : null,
                active: true,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .select('*')
            .single();

        if (pollError || !poll) {
            throw pollError || new Error('Failed to create coach attendance poll.');
        }

        const messageText = buildMessageText(introText, venueText, cleanSlots, {});

        const telegramBody: Record<string, unknown> = {
            chat_id: chatId,
            text: messageText,
            reply_markup: buildKeyboard(poll.id, cleanSlots),
        };

        if (threadId) {
            telegramBody.message_thread_id = Number(threadId);
        }

        const telegramResponse = await fetch(
            `https://api.telegram.org/bot${botToken}/sendMessage`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(telegramBody),
            }
        );

        const telegramData = await telegramResponse.json();

        if (!telegramResponse.ok) {
            await supabaseAdmin
                .from('coach_attendance_polls')
                .delete()
                .eq('id', poll.id);

            return NextResponse.json(
                {
                    error: 'Failed to send Telegram coach attendance poll.',
                    details: telegramData,
                },
                { status: 500 }
            );
        }

        await supabaseAdmin
            .from('coach_attendance_polls')
            .update({
                message_id: telegramData?.result?.message_id,
                updated_at: new Date().toISOString(),
            })
            .eq('id', poll.id);

        return NextResponse.json({
            success: true,
            poll_id: poll.id,
            telegram: telegramData,
        });
    } catch (error: any) {
        console.error('Coach attendance send error:', error);

        return NextResponse.json(
            { error: error?.message || 'Unexpected coach attendance send error.' },
            { status: 500 }
        );
    }
}
