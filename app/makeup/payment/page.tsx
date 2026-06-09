'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import AppHeader from './../../components/AppHeader';
import './../../styles.css';
import './../../dashboard/dashboard.css';
import './../../payment/payment.css';

type UserRole = 'superuser' | 'admin' | 'member';

interface MasterStudent {
    id: string;
    display_name: string;
}

interface MakeupUsage {
    target_training_type: string;
    target_date: string;
    target_label: string;
    credit_value_used: number;
    target_value: number;
}

interface MakeupTopupPayment {
    id: string;
    makeup_usage_id: string;
    master_student_id: string;
    amount: number;
    paid: boolean;
    payment_month: string;
    created_at: string;
    updated_at?: string;
    master_students?: MasterStudent;
    makeup_usages?: MakeupUsage;
}

interface CounterState {
    payment_month: string;
    reset_at: string;
}

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const getUserRole = (user: any): UserRole => {
    return (user?.app_metadata?.role || user?.user_metadata?.role || 'member') as UserRole;
};

const getReadableMonth = (monthValue: string) => {
    const [year, month] = monthValue.split('-').map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString('en-SG', {
        month: 'long',
        year: 'numeric',
    });
};

const money = (value: number) => `S$${Number(value || 0).toFixed(2)}`;

export default function MakeupPaymentPage() {
    const router = useRouter();
    const [userRole, setUserRole] = useState<UserRole | null>(null);
    const [userName, setUserName] = useState('');
    const [payments, setPayments] = useState<MakeupTopupPayment[]>([]);
    const [counterState, setCounterState] = useState<CounterState | null>(null);
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const date = new Date();
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    });
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [lastUpdated, setLastUpdated] = useState('');

    useEffect(() => {
        const checkAuth = async () => {
            try {
                const { data: { user }, error } = await supabase.auth.getUser();

                if (error || !user) {
                    await supabase.auth.signOut();
                    router.push('/');
                    return;
                }

                setUserRole(getUserRole(user));
                setUserName(user.user_metadata?.name || user.email || 'User');
            } catch {
                await supabase.auth.signOut();
                router.push('/');
            }
        };

        checkAuth();
    }, [router]);

    const loadData = async () => {
        try {
            setLoading(true);
            setMessage('');

            const [paymentResult, counterResult] = await Promise.all([
                supabase
                    .from('makeup_topup_payments')
                    .select('*, master_students(*), makeup_usages(*)')
                    .eq('payment_month', selectedMonth)
                    .order('created_at', { ascending: false }),
                supabase
                    .from('makeup_payment_counter_state')
                    .select('*')
                    .eq('payment_month', selectedMonth)
                    .maybeSingle(),
            ]);

            if (paymentResult.error) throw paymentResult.error;
            if (counterResult.error) throw counterResult.error;

            setPayments((paymentResult.data || []) as MakeupTopupPayment[]);
            setCounterState((counterResult.data || null) as CounterState | null);
        } catch (err: any) {
            setMessage(err?.message || 'Failed to load makeup payments.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (userRole === 'superuser') {
            loadData();
        }
    }, [userRole, selectedMonth]);

    const rows = useMemo(() => {
        const query = searchTerm.trim().toLowerCase();

        return payments.filter((payment) => {
            const searchable = [
                payment.master_students?.display_name,
                payment.makeup_usages?.target_training_type,
                payment.makeup_usages?.target_label,
                money(payment.amount),
                payment.paid ? 'paid' : 'unpaid',
            ].join(' ').toLowerCase();

            return !query || searchable.includes(query);
        });
    }, [payments, searchTerm]);

    const paidRows = payments.filter((payment) => payment.paid);
    const unpaidRows = payments.filter((payment) => !payment.paid);
    const totalPaid = paidRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const totalUnpaid = unpaidRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const possibleTotal = totalPaid + totalUnpaid;

    const counterTotal = useMemo(() => {
        const resetAt = counterState?.reset_at
            ? new Date(counterState.reset_at).getTime()
            : 0;

        return paidRows
            .filter((payment) => {
                const updated = new Date(payment.updated_at || payment.created_at).getTime();
                return updated >= resetAt;
            })
            .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    }, [paidRows, counterState]);

    const sendTelegram = async (text: string) => {
        const response = await fetch('/api/telegram-makeup-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
        });

        const payload = await response.json();

        if (!response.ok) {
            throw new Error(payload?.error || 'Telegram notification failed.');
        }
    };

    const addPaymentEvent = async (
        payment: MakeupTopupPayment,
        eventType: 'received' | 'reversed'
    ) => {
        const { data: { user } } = await supabase.auth.getUser();

        const { error } = await supabase
            .from('makeup_payment_events')
            .insert({
                makeup_topup_payment_id: payment.id,
                master_student_id: payment.master_student_id,
                payment_month: payment.payment_month,
                amount: Number(payment.amount || 0),
                event_type: eventType,
                actor_user_id: user?.id || null,
            });

        if (error) throw error;
    };

    const setPaidStatus = async (paymentId: string, paid: boolean) => {
        const original = payments.find((payment) => payment.id === paymentId);
        if (!original || original.paid === paid) return;

        try {
            const { data, error } = await supabase
                .from('makeup_topup_payments')
                .update({
                    paid,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', paymentId)
                .select('*, master_students(*), makeup_usages(*)')
                .single();

            if (error) throw error;

            const updated = data as MakeupTopupPayment;
            await addPaymentEvent(updated, paid ? 'received' : 'reversed');

            const student = updated.master_students?.display_name || 'Unknown student';
            const target = updated.makeup_usages?.target_training_type || 'Unknown';

            await sendTelegram(
                `${paid ? '✅ Makeup Top-up Payment Received' : '↩️ Makeup Top-up Payment Reversed'}\n\n` +
                `Student: ${student}\n` +
                `Month: ${getReadableMonth(updated.payment_month)}\n` +
                `Target Programme: ${target}\n` +
                `Amount: ${money(updated.amount)}\n` +
                `Status: ${paid ? 'Paid' : 'Unpaid'}`
            );

            setPayments((previous) =>
                previous.map((payment) => payment.id === paymentId ? updated : payment)
            );
            setLastUpdated(`Updated ${new Date().toLocaleString('en-SG')}`);
        } catch (err: any) {
            alert(err?.message || 'Failed to update payment.');
            await loadData();
        }
    };

    const resetTotal = async () => {
        if (!confirm(
            `Reset the displayed makeup-payment counter for ${getReadableMonth(selectedMonth)}?\n\n` +
            'This does not change any Paid/Unpaid records.'
        )) {
            return;
        }

        try {
            const { data: { user } } = await supabase.auth.getUser();
            const resetAt = new Date().toISOString();

            const { error } = await supabase
                .from('makeup_payment_counter_state')
                .upsert(
                    {
                        payment_month: selectedMonth,
                        reset_at: resetAt,
                        reset_by: user?.id || null,
                        updated_at: resetAt,
                    },
                    { onConflict: 'payment_month' }
                );

            if (error) throw error;

            setCounterState({ payment_month: selectedMonth, reset_at: resetAt });
            setLastUpdated('Counter reset to S$0.00. Payment statuses were preserved.');
        } catch (err: any) {
            alert(err?.message || 'Failed to reset total.');
        }
    };

    const undoAdd = async () => {
        const resetAt = counterState?.reset_at
            ? new Date(counterState.reset_at).getTime()
            : 0;

        const latest = [...paidRows]
            .filter((payment) =>
                new Date(payment.updated_at || payment.created_at).getTime() >= resetAt
            )
            .sort((a, b) =>
                new Date(b.updated_at || b.created_at).getTime() -
                new Date(a.updated_at || a.created_at).getTime()
            )[0];

        if (!latest) {
            alert('There is no paid makeup transaction after the last counter reset.');
            return;
        }

        const student = latest.master_students?.display_name || 'Unknown student';

        if (!confirm(`Undo the latest payment added for ${student}?`)) return;

        await setPaidStatus(latest.id, false);
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
        router.push('/');
    };

    if (userRole === null) {
        return <div className="container" style={{ padding: 40 }}>Checking access...</div>;
    }

    if (userRole !== 'superuser') {
        return (
            <div className="container" style={{ padding: '3rem 1rem' }}>
                <div className="form-card" style={{ maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>
                    <h1 style={{ color: '#dc2626', fontSize: '3rem', marginBottom: 8 }}>403</h1>
                    <h2>Forbidden</h2>
                    <p className="muted">Only superusers can access Makeup Payment.</p>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
                        <Link href="/dashboard" className="btn share-btn">Return to Dashboard</Link>
                        <button type="button" className="btn share-btn logout" onClick={handleLogout}>Logout</button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            <AppHeader
                title="Makeup Payment"
                userName={userName}
                userRole={userRole}
                mode="dashboard"
            />

            <main style={{ padding: '24px 16px 48px' }}>
                <section className="form-card" style={{ maxWidth: 1120, margin: '0 auto', padding: 24 }}>
                    <div style={{ textAlign: 'center' }}>
                        <h1 style={{ margin: 0 }}>Makeup Top-up Payments</h1>
                        <p className="muted" style={{ margin: '8px auto 0', maxWidth: 760 }}>
                            Payment changes and monthly summaries are sent to the Makeup Attendance Telegram topic.
                        </p>
                        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
                            <Link href="/makeup" className="btn share-btn">Back to Makeup Credits</Link>
                        </div>
                    </div>

                    {message && <div className="error-message" style={{ marginTop: 16 }}>{message}</div>}

                    <div className="payment-summary" style={{ marginTop: 22 }}>
                        <div className="summary-card">
                            <h3>{getReadableMonth(selectedMonth)} Counter</h3>
                            <p className="amount">{money(counterTotal)}</p>
                            <p className="timestamp">
                                Total paid: {money(totalPaid)} · Outstanding: {money(totalUnpaid)} · Possible: {money(possibleTotal)}
                            </p>
                            {lastUpdated && <p className="timestamp">{lastUpdated}</p>}

                            <div className="payment-actions">
                                <button
                                    type="button"
                                    className="payment-action-btn danger"
                                    onClick={resetTotal}
                                    disabled={loading}
                                >
                                    Reset Total
                                </button>
                                <button
                                    type="button"
                                    className="payment-action-btn warning"
                                    onClick={undoAdd}
                                    disabled={loading}
                                >
                                    Undo Add
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="filter-box">
                        <div className="filter-grid">
                            <label className="filter-label">
                                Month
                                <input
                                    type="month"
                                    className="filter-input"
                                    value={selectedMonth}
                                    onChange={(event) => setSelectedMonth(event.target.value)}
                                />
                            </label>

                            <label className="filter-label">
                                Search
                                <input
                                    className="filter-input"
                                    placeholder="Student, target, amount..."
                                    value={searchTerm}
                                    onChange={(event) => setSearchTerm(event.target.value)}
                                />
                            </label>
                        </div>

                        <div className="filter-buttons">
                            <button
                                type="button"
                                className="filter-button"
                                onClick={loadData}
                                disabled={loading}
                            >
                                Refresh
                            </button>
                        </div>
                    </div>

                    <div className="table-container">
                        <div className="table-scroll">
                            <table>
                                <thead>
                                <tr>
                                    <th>Student</th>
                                    <th>Makeup Target</th>
                                    <th>Credit Used</th>
                                    <th>Target Value</th>
                                    <th>Top-up</th>
                                    <th>Paid</th>
                                </tr>
                                </thead>
                                <tbody>
                                {rows.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} style={{ textAlign: 'center', color: '#64748b' }}>
                                            No makeup top-up payments found.
                                        </td>
                                    </tr>
                                ) : (
                                    rows.map((payment) => (
                                        <tr key={payment.id}>
                                            <td>{payment.master_students?.display_name || 'Unknown student'}</td>
                                            <td>
                                                <strong>{payment.makeup_usages?.target_training_type || 'Unknown'}</strong>
                                                <br />
                                                <span className="muted">
                            {payment.makeup_usages?.target_date} · {payment.makeup_usages?.target_label}
                          </span>
                                            </td>
                                            <td>{money(Number(payment.makeup_usages?.credit_value_used || 0))}</td>
                                            <td>{money(Number(payment.makeup_usages?.target_value || 0))}</td>
                                            <td><strong>{money(payment.amount)}</strong></td>
                                            <td>
                                                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 700 }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={payment.paid}
                                                        onChange={(event) => setPaidStatus(payment.id, event.target.checked)}
                                                    />
                                                    {payment.paid ? 'Paid' : 'Unpaid'}
                                                </label>
                                            </td>
                                        </tr>
                                    ))
                                )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>
            </main>
        </div>
    );
}
