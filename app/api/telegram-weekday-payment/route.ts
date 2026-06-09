import { NextResponse } from 'next/server';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const message = String(body?.message || body?.text || '').trim();

        if (!message) {
            return NextResponse.json(
                { error: 'Message is required.' },
                { status: 400 }
            );
        }

        const botToken = process.env.TELEGRAM_WEEKDAY_PAYMENT_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_CHAT_ID;
        const threadId = process.env.TELEGRAM_WEEKDAY_THREAD_ID;

        if (!botToken || !chatId || !threadId) {
            return NextResponse.json(
                {
                    error:
                        'Missing TELEGRAM_WEEKDAY_PAYMENT_BOT_TOKEN, TELEGRAM_CHAT_ID, or TELEGRAM_WEEKDAY_THREAD_ID.',
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
            console.error('Weekday payment Telegram error:', telegramData);

            return NextResponse.json(
                {
                    error:
                        telegramData?.description ||
                        'Failed to send Weekday payment Telegram message.',
                    details: telegramData,
                },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            result: telegramData.result,
        });
    } catch (error: any) {
        console.error('Weekday payment Telegram route error:', error);

        return NextResponse.json(
            {
                error: error?.message || 'Unexpected Telegram route error.',
            },
            { status: 500 }
        );
    }
}
