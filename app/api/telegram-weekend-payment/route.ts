import { NextResponse } from 'next/server';

export async function POST(request: Request) {
    try {
        const { message } = await request.json();

        if (!message || typeof message !== 'string') {
            return NextResponse.json(
                { error: 'Message is required.' },
                { status: 400 }
            );
        }

        const botToken = process.env.TELEGRAM_WEEKEND_PAYMENT_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_CHAT_ID;
        const threadId = process.env.TELEGRAM_WEEKEND_THREAD_ID;

        if (!botToken) {
            return NextResponse.json(
                { error: 'Missing TELEGRAM_WEEKEND_PAYMENT_BOT_TOKEN.' },
                { status: 500 }
            );
        }

        if (!chatId) {
            return NextResponse.json(
                { error: 'Missing TELEGRAM_CHAT_ID.' },
                { status: 500 }
            );
        }

        if (!threadId) {
            return NextResponse.json(
                { error: 'Missing TELEGRAM_WEEKEND_THREAD_ID.' },
                { status: 500 }
            );
        }

        const telegramResponse = await fetch(
            `https://api.telegram.org/bot${botToken}/sendMessage`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    chat_id: chatId,
                    message_thread_id: Number(threadId),
                    text: message,
                }),
            }
        );

        const telegramData = await telegramResponse.json();

        if (!telegramResponse.ok) {
            console.error('Telegram weekend payment topic error:', telegramData);

            return NextResponse.json(
                {
                    error: 'Failed to send Telegram weekend payment topic message.',
                    details: telegramData,
                },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            result: telegramData,
        });
    } catch (error: any) {
        console.error('Telegram weekend payment topic route error:', error);

        return NextResponse.json(
            {
                error: error?.message || 'Unexpected Telegram route error.',
            },
            { status: 500 }
        );
    }
}
