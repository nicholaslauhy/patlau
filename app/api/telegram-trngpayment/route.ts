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

        const botToken = process.env.TELEGRAM_TRNGPAYMENT_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_CHAT_IDS;

        if (!botToken) {
            return NextResponse.json(
                { error: 'Missing TELEGRAM_TRNGPAYMENT_BOT_TOKEN.' },
                { status: 500 }
            );
        }

        if (!chatId) {
            return NextResponse.json(
                { error: 'Missing TELEGRAM_CHAT_ID.' },
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
                    text: message,
                }),
            }
        );

        const telegramData = await telegramResponse.json();

        if (!telegramResponse.ok) {
            console.error('Telegram trngpayment error:', telegramData);

            return NextResponse.json(
                {
                    error: 'Failed to send Telegram 1-on-1 payment message.',
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
        console.error('Telegram trngpayment route error:', error);

        return NextResponse.json(
            {
                error: error?.message || 'Unexpected Telegram route error.',
            },
            { status: 500 }
        );
    }
}