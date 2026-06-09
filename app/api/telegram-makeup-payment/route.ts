import { NextResponse } from 'next/server';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const text = String(body?.text || '').trim();

        if (!text) {
            return NextResponse.json({ error: 'Text is required.' }, { status: 400 });
        }

        const token = process.env.TELEGRAM_MAKEUP_PAYMENT_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_MAKEUP_PAYMENT_CHAT_ID;
        const threadId = process.env.TELEGRAM_MAKEUP_PAYMENT_THREAD_ID;

        if (!token || !chatId || !threadId) {
            return NextResponse.json(
                {
                    error:
                        'Missing TELEGRAM_MAKEUP_PAYMENT_BOT_TOKEN, TELEGRAM_MAKEUP_PAYMENT_CHAT_ID, or TELEGRAM_MAKEUP_PAYMENT_THREAD_ID.',
                },
                { status: 500 }
            );
        }

        const response = await fetch(
            `https://api.telegram.org/bot${token}/sendMessage`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    message_thread_id: Number(threadId),
                    text,
                }),
            }
        );

        const payload = await response.json();

        if (!response.ok) {
            return NextResponse.json(
                { error: payload?.description || 'Telegram sendMessage failed.' },
                { status: 500 }
            );
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json(
            { error: error?.message || 'Unexpected Telegram error.' },
            { status: 500 }
        );
    }
}
