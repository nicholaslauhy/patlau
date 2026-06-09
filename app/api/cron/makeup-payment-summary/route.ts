import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const previousMonth = () => {
    const date = new Date();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - 1);

    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

const readableMonth = (key: string) => {
    const [year, month] = key.split('-').map(Number);

    return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-SG', {
        month: 'long',
        year: 'numeric',
        timeZone: 'Asia/Singapore',
    });
};

const money = (value: number) => `S$${Number(value || 0).toFixed(2)}`;

export async function GET(request: Request) {
    try {
        const cronSecret = process.env.CRON_SECRET;
        const authorization = request.headers.get('authorization');

        if (cronSecret && authorization !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
        }

        const url = new URL(request.url);
        const paymentMonth = url.searchParams.get('month') || previousMonth();

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const token = process.env.TELEGRAM_MAKEUP_PAYMENT_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_MAKEUP_PAYMENT_CHAT_ID;
        const threadId = process.env.TELEGRAM_MAKEUP_PAYMENT_THREAD_ID;

        if (!supabaseUrl || !serviceRoleKey || !token || !chatId || !threadId) {
            throw new Error('Missing cron environment variables.');
        }

        const supabase = createClient(supabaseUrl, serviceRoleKey, {
            auth: { persistSession: false },
        });

        const { data, error } = await supabase
            .from('makeup_payment_events')
            .select('*, master_students(display_name)')
            .eq('payment_month', paymentMonth)
            .order('created_at', { ascending: true });

        if (error) throw error;

        const netByStudent = new Map<string, { name: string; amount: number }>();

        for (const event of data || []) {
            const key = String(event.master_student_id);
            const current = netByStudent.get(key) || {
                name: event.master_students?.display_name || 'Unknown student',
                amount: 0,
            };

            current.amount += event.event_type === 'received'
                ? Number(event.amount || 0)
                : -Number(event.amount || 0);

            netByStudent.set(key, current);
        }

        const details = [...netByStudent.values()]
            .filter((row) => row.amount !== 0);

        const total = details.reduce((sum, row) => sum + row.amount, 0);
        const lines = details.length
            ? details.map((row) => `- ${row.name}: ${money(row.amount)}`).join('\n')
            : '- No net makeup top-up payments recorded.';

        const text =
            `📊 Monthly Makeup Payment Summary\n\n` +
            `Month: ${readableMonth(paymentMonth)}\n` +
            `Net Collected: ${money(total)}\n` +
            `Students: ${details.length}\n\n` +
            `Details:\n${lines}`;

        const telegramResponse = await fetch(
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

        const telegramPayload = await telegramResponse.json();

        if (!telegramResponse.ok) {
            throw new Error(
                telegramPayload?.description || 'Monthly Telegram summary failed.'
            );
        }

        return NextResponse.json({
            success: true,
            paymentMonth,
            total,
            students: details.length,
        });
    } catch (error: any) {
        return NextResponse.json(
            { error: error?.message || 'Monthly summary failed.' },
            { status: 500 }
        );
    }
}
