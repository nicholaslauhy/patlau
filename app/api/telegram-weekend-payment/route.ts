import { NextResponse } from 'next/server';

const getConfig = () => {
    const botToken = process.env.TELEGRAM_WEEKEND_PAYMENT_BOT_TOKEN;
    const chatId =
        process.env.TELEGRAM_WEEKEND_PAYMENT_CHAT_ID ||
        process.env.TELEGRAM_CHAT_ID;
    const threadId =
        process.env.TELEGRAM_WEEKEND_PAYMENT_THREAD_ID ||
        process.env.TELEGRAM_WEEKEND_THREAD_ID;

    return { botToken, chatId, threadId };
};

export async function GET() {
    const { botToken, chatId, threadId } = getConfig();

    if (!botToken || !chatId || !threadId) {
        return NextResponse.json(
            {
                success: false,
                configured: {
                    botToken: Boolean(botToken),
                    chatId: Boolean(chatId),
                    threadId: Boolean(threadId),
                },
                error:
                    'Weekend Telegram environment variables are incomplete.',
            },
            { status: 500 }
        );
    }

    try {
        const botResponse = await fetch(
            `https://api.telegram.org/bot${botToken}/getMe`,
            { cache: 'no-store' }
        );
        const botPayload = await botResponse.json();

        if (!botResponse.ok || !botPayload?.ok) {
            return NextResponse.json(
                {
                    success: false,
                    configured: {
                        botToken: true,
                        chatId: true,
                        threadId: true,
                    },
                    error:
                        botPayload?.description ||
                        'Telegram rejected the Weekend bot token.',
                },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            configured: {
                botToken: true,
                chatId: true,
                threadId: true,
            },
            bot: {
                id: botPayload.result.id,
                username: botPayload.result.username,
                name: botPayload.result.first_name,
            },
            destination: {
                chatId,
                threadId: Number(threadId),
            },
        });
    } catch (error: any) {
        return NextResponse.json(
            {
                success: false,
                error: error?.message || 'Weekend Telegram diagnostic failed.',
            },
            { status: 500 }
        );
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const message = String(body?.message || body?.text || '').trim();
        const { botToken, chatId, threadId } = getConfig();

        if (!message) {
            return NextResponse.json(
                { success: false, error: 'Message is required.' },
                { status: 400 }
            );
        }

        if (!botToken || !chatId || !threadId) {
            return NextResponse.json(
                {
                    success: false,
                    configured: {
                        botToken: Boolean(botToken),
                        chatId: Boolean(chatId),
                        threadId: Boolean(threadId),
                    },
                    error:
                        'Missing Weekend Telegram bot token, chat ID, or thread ID.',
                },
                { status: 500 }
            );
        }

        const telegramResponse = await fetch(
            `https://api.telegram.org/bot${botToken}/sendMessage`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                cache: 'no-store',
                body: JSON.stringify({
                    chat_id: chatId,
                    message_thread_id: Number(threadId),
                    text: message,
                }),
            }
        );

        const telegramData = await telegramResponse.json();

        if (!telegramResponse.ok || !telegramData?.ok) {
            console.error('Weekend Telegram sendMessage failed:', telegramData);

            return NextResponse.json(
                {
                    success: false,
                    error:
                        telegramData?.description ||
                        'Telegram rejected the Weekend payment message.',
                    details: telegramData,
                    destination: {
                        chatId,
                        threadId: Number(threadId),
                    },
                },
                { status: 502 }
            );
        }

        return NextResponse.json({
            success: true,
            result: telegramData.result,
            destination: {
                chatId,
                threadId: Number(threadId),
            },
        });
    } catch (error: any) {
        console.error('Weekend Telegram route failed:', error);

        return NextResponse.json(
            {
                success: false,
                error:
                    error?.message ||
                    'Unexpected Weekend Telegram notification error.',
            },
            { status: 500 }
        );
    }
}
