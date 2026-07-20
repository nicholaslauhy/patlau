import { NextResponse } from 'next/server';
import { recordTelegramDelivery } from '../../lib/telegram-audit';
import { authorizeTelegramSender } from '../../lib/telegram-auth';

export async function POST(request: Request) {
    try {
        const authorization = await authorizeTelegramSender(
            request,
            ['superuser'],
            'one_to_one_payment'
        );
        if ('status' in authorization) {
            return NextResponse.json(
                { error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' },
                { status: authorization.status }
            );
        }

        const body = await request.json();
        const message = String(body?.message || body?.text || '').trim();

        if (!message) {
            return NextResponse.json(
                { error: 'Message is required.' },
                { status: 400 }
            );
        }

        const botToken = process.env.TELEGRAM_TRNGPAYMENT_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_CHAT_ID;
        const threadId = process.env.TELEGRAM_TRNGPAYMENT_THREAD_ID;

        if (!botToken || !chatId || !threadId) {
            return NextResponse.json(
                {
                    error:
                        'Missing TELEGRAM_TRNGPAYMENT_BOT_TOKEN, TELEGRAM_CHAT_ID, or TELEGRAM_TRNGPAYMENT_THREAD_ID.',
                },
                { status: 500 }
            );
        }

        const telegramResponse = await fetch(
            `https://api.telegram.org/bot${botToken}/sendMessage`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    message_thread_id: Number(threadId),
                    text: message,
                }),
            }
        );

        const telegramData = await telegramResponse.json();

        if (!telegramResponse.ok) {
            console.error('1-on-1 payment Telegram error:', telegramData);
            await recordTelegramDelivery({
                request,
                programme: 'one_to_one_payment',
                category: 'payments',
                outcome: 'failure',
                error: telegramData?.description || 'Telegram rejected the message',
            });

            return NextResponse.json(
                {
                    error:
                        telegramData?.description ||
                        'Failed to send 1-on-1 payment Telegram message.',
                    details: telegramData,
                },
                { status: 500 }
            );
        }

        await recordTelegramDelivery({
            request,
            programme: 'one_to_one_payment',
            category: 'payments',
            outcome: 'success',
            providerMessageId: telegramData.result?.message_id,
        });
        return NextResponse.json({
            success: true,
            result: telegramData.result,
        });
    } catch (error: any) {
        console.error('1-on-1 payment Telegram route error:', error);
        await recordTelegramDelivery({ request, programme: 'one_to_one_payment', category: 'payments', outcome: 'failure', error });

        return NextResponse.json(
            {
                error: error?.message || 'Unexpected Telegram route error.',
            },
            { status: 500 }
        );
    }
}
