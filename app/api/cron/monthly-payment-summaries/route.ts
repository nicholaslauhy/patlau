import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const previousMonthKey = () => {
    const date = new Date();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - 1);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

const nextMonthKey = (monthKey: string) => {
    const [year, month] = monthKey.split('-').map(Number);
    const date = new Date(Date.UTC(year, month, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

const readableMonth = (monthKey: string) => {
    const [year, month] = monthKey.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-SG', {
        month: 'long',
        year: 'numeric',
        timeZone: 'Asia/Singapore',
    });
};

const money = (value: number) => `S$${Number(value || 0).toFixed(2)}`;

export async function GET(request: Request) {
    try {
        const secret = process.env.CRON_SECRET;
        if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !serviceRoleKey) {
            throw new Error('Missing Supabase server environment variables.');
        }

        const origin = new URL(request.url).origin;
        const monthKey = previousMonthKey();
        const startDate = `${monthKey}-01`;
        const endDate = `${nextMonthKey(monthKey)}-01`;

        const supabase = createClient(supabaseUrl, serviceRoleKey, {
            auth: { persistSession: false },
        });

        const results: Record<string, string> = {};

        const sendOnce = async (
            programme: 'one_to_one' | 'weekday' | 'matchplay',
            endpoint: string,
            message: string
        ) => {
            const { error: claimError } = await supabase
                .from('payment_summary_log')
                .insert({ programme, period_key: monthKey });

            if (claimError) {
                if (claimError.code === '23505') {
                    results[programme] = 'already sent';
                    return;
                }
                throw claimError;
            }

            const response = await fetch(`${origin}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message }),
            });

            if (!response.ok) {
                await supabase
                    .from('payment_summary_log')
                    .delete()
                    .eq('programme', programme)
                    .eq('period_key', monthKey);

                throw new Error(`Failed to send ${programme} Telegram summary.`);
            }

            results[programme] = 'sent';
        };

        const { data: oneRows, error: oneError } = await supabase
            .from('training_payments')
            .select('amount, paid')
            .gte('week_date', startDate)
            .lt('week_date', endDate);

        if (oneError) throw oneError;

        const onePaid = (oneRows || []).filter((row) => row.paid);
        const oneTotal = onePaid.reduce((sum, row) => sum + Number(row.amount || 0), 0);

        await sendOnce(
            'one_to_one',
            '/api/telegram-trngpayment',
            `📊 1-on-1 Monthly Payment Summary\n\n` +
            `Month: ${readableMonth(monthKey)}\n` +
            `Total Collected: ${money(oneTotal)}\n` +
            `Paid Transactions: ${onePaid.length}\n` +
            `Unpaid Transactions: ${(oneRows || []).length - onePaid.length}\n\n` +
            `Payment records were preserved.`
        );

        const { data: weekdayRows, error: weekdayError } = await supabase
            .from('weekday_payments')
            .select('amount, paid')
            .eq('payment_month', monthKey);

        if (weekdayError) throw weekdayError;

        const weekdayPaid = (weekdayRows || []).filter((row) => row.paid);
        const weekdayTotal = weekdayPaid.reduce(
            (sum, row) => sum + Number(row.amount || 0),
            0
        );

        await sendOnce(
            'weekday',
            '/api/telegram-weekday-payment',
            `📊 Weekday Monthly Payment Summary\n\n` +
            `Month: ${readableMonth(monthKey)}\n` +
            `Total Collected: ${money(weekdayTotal)}\n` +
            `Paid Transactions: ${weekdayPaid.length}\n` +
            `Unpaid Transactions: ${(weekdayRows || []).length - weekdayPaid.length}\n\n` +
            `Payment records were preserved.`
        );

        const { data: matchRows, error: matchError } = await supabase
            .from('matchplay_payments')
            .select('amount, paid')
            .eq('payment_month', monthKey);

        if (matchError) throw matchError;

        const matchPaid = (matchRows || []).filter((row) => row.paid);
        const matchTotal = matchPaid.reduce(
            (sum, row) => sum + Number(row.amount || 0),
            0
        );

        await sendOnce(
            'matchplay',
            '/api/telegram-matchplay-payment',
            `📊 MatchPlay Monthly Payment Summary\n\n` +
            `Month: ${readableMonth(monthKey)}\n` +
            `Total Collected: ${money(matchTotal)}\n` +
            `Paid Transactions: ${matchPaid.length}\n` +
            `Unpaid Transactions: ${(matchRows || []).length - matchPaid.length}\n\n` +
            `Payment records were preserved.`
        );

        return NextResponse.json({ success: true, monthKey, results });
    } catch (error: any) {
        return NextResponse.json(
            { error: error?.message || 'Monthly payment summary failed.' },
            { status: 500 }
        );
    }
}
