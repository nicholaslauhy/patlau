'use client'

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';
import AppHeader from './../../components/AppHeader';
import './../../styles.css';
import './../../dashboard/dashboard.css';
import './../../payment/payment.css';

type UserRole = 'superuser' | 'admin' | 'member';
type PaymentFilter = 'all' | 'paid' | 'unpaid';

interface MatchPlayStudent {
    id: string;
    student_name: string;
    number_of_weeks: number;
    price_per_session: number;
    active: boolean;
    created_at?: string;
    updated_at?: string;
}

interface MatchPlayPayment {
    id: number;
    matchplay_student_id: string;
    payment_month: string;
    paid: boolean;
    amount: number;
    manual_weeks?: number | null;
    manual_price_per_session?: number | null;
    created_at: string;
    updated_at?: string;
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
    return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
    });
};

export default function MatchPlayPaymentPage() {
    const router = useRouter();
    const [userName, setUserName] = useState('');
    const [userRole, setUserRole] = useState<UserRole | null>(null);
    const [students, setStudents] = useState<MatchPlayStudent[]>([]);
    const [payments, setPayments] = useState<MatchPlayPayment[]>([]);
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
    const [searchTerm, setSearchTerm] = useState('');
    const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);
    const [isResetting, setIsResetting] = useState(false);
    const [isUndoing, setIsUndoing] = useState(false);

    useEffect(() => {
        const checkAuth = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.push('/');
                return;
            }

            const role = getUserRole(user);
            setUserRole(role);
            setUserName(user.user_metadata?.name || user.email || 'User');
        };

        checkAuth();
    }, [router]);

    const loadData = async () => {
        try {
            setLoading(true);
            setMessage('');

            const { data: studentData, error: studentError } = await supabase
                .from('matchplay_students')
                .select('*')
                .eq('active', true)
                .order('student_name', { ascending: true });

            if (studentError) throw studentError;

            const { data: paymentData, error: paymentError } = await supabase
                .from('matchplay_payments')
                .select('*')
                .eq('payment_month', selectedMonth)
                .order('updated_at', { ascending: false });

            if (paymentError) throw paymentError;

            setStudents((studentData || []) as MatchPlayStudent[]);
            setPayments((paymentData || []) as MatchPlayPayment[]);
        } catch (err: any) {
            setMessage(err?.message || 'Failed to load MatchPlay payments.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (userRole) loadData();
    }, [userRole, selectedMonth]);

    const getPayment = (studentId: string) => {
        return payments.find(
            (payment) =>
                payment.matchplay_student_id === studentId &&
                payment.payment_month === selectedMonth
        );
    };

    const rows = useMemo(() => {
        const normalizedSearch = searchTerm.trim().toLowerCase();

        return students.map((student) => {
            const payment = getPayment(student.id);
            const weeks = Number(payment?.manual_weeks ?? student.number_of_weeks ?? 0);
            const pricePerSession = Number(payment?.manual_price_per_session ?? student.price_per_session ?? 0);
            const amount = weeks * pricePerSession;
            const isPaid = payment?.paid ?? false;

            return {
                student,
                payment,
                weeks,
                pricePerSession,
                amount,
                isPaid,
            };
        }).filter((row) => {
            const matchesPaymentFilter =
                paymentFilter === 'all' ||
                (paymentFilter === 'paid' && row.isPaid) ||
                (paymentFilter === 'unpaid' && !row.isPaid);

            if (!matchesPaymentFilter) return false;
            if (!normalizedSearch) return true;

            const searchable = [
                row.student.student_name,
                `${row.weeks} weeks`,
                `S$${row.pricePerSession.toFixed(2)}`,
                `S$${row.amount.toFixed(2)}`,
                row.isPaid ? 'paid' : 'unpaid',
            ].join(' ').toLowerCase();

            return searchable.includes(normalizedSearch);
        });
    }, [students, payments, selectedMonth, searchTerm, paymentFilter]);

    const paidRows = rows.filter((row) => row.isPaid);
    const unpaidRows = rows.filter((row) => !row.isPaid);
    const totalCollected = paidRows.reduce((sum, row) => sum + row.amount, 0);
    const possibleTotal = rows.reduce((sum, row) => sum + row.amount, 0);
    const totalWeeks = rows.reduce((sum, row) => sum + row.weeks, 0);

    const upsertPayment = async (
        studentId: string,
        patch: Partial<Pick<MatchPlayPayment, 'paid' | 'manual_weeks' | 'manual_price_per_session'>>
    ) => {
        const student = students.find((item) => item.id === studentId);
        if (!student) return;

        const existing = getPayment(studentId);
        const manualWeeks = patch.manual_weeks ?? existing?.manual_weeks ?? null;
        const manualPrice = patch.manual_price_per_session ?? existing?.manual_price_per_session ?? null;
        const weeks = Number(manualWeeks ?? student.number_of_weeks);
        const pricePerSession = Number(manualPrice ?? student.price_per_session);
        const amount = weeks * pricePerSession;

        try {
            const { data, error } = await supabase
                .from('matchplay_payments')
                .upsert(
                    {
                        matchplay_student_id: studentId,
                        payment_month: selectedMonth,
                        paid: patch.paid ?? existing?.paid ?? false,
                        manual_weeks: manualWeeks,
                        manual_price_per_session: manualPrice,
                        amount,
                        updated_at: new Date().toISOString(),
                    },
                    { onConflict: 'matchplay_student_id,payment_month' }
                )
                .select('*')
                .single();

            if (error) throw error;

            const savedPayment = data as MatchPlayPayment;
            setPayments((prev) => {
                const exists = prev.some((payment) => payment.id === savedPayment.id);
                if (exists) {
                    return prev.map((payment) => payment.id === savedPayment.id ? savedPayment : payment);
                }

                return [...prev, savedPayment];
            });

            if (typeof patch.paid === 'boolean') {
                const telegramMessage =
                    `${patch.paid ? '✅ MatchPlay Payment Received!' : '↩️ MatchPlay Payment Reversed!'}\n\n` +
                    `Student: ${student.student_name}\n` +
                    `Month: ${getReadableMonth(selectedMonth)}\n` +
                    `Weeks: ${weeks}\n` +
                    `Price Per Session: S$${pricePerSession.toFixed(2)}\n` +
                    `Amount: ${patch.paid ? '+' : '-'}S$${amount.toFixed(2)}\n` +
                    `Recorded At: ${new Date().toLocaleString()}\n` +
                    `Status: ${patch.paid ? 'Paid' : 'Unpaid'}`;

                await sendTelegramNotification(telegramMessage);
            }

            setLastUpdated(`Updated at ${new Date().toLocaleString()}`);
        } catch (err: any) {
            alert(err?.message || 'Failed to update MatchPlay payment.');
            await loadData();
        }
    };

    const buildMonthlySummaryMessage = () => {
        const paymentLines = rows.length > 0
            ? rows.map((row) => (
                `- ${row.student.student_name}: ${row.weeks} weeks × S$${row.pricePerSession.toFixed(2)} = S$${row.amount.toFixed(2)} (${row.isPaid ? 'Paid' : 'Unpaid'})`
            )).join('\n')
            : '- No MatchPlay payment rows for this month.';

        return `📊 MatchPlay Monthly Payment Summary 📊\n\n` +
            `Month: ${getReadableMonth(selectedMonth)}\n` +
            `Total Collected: S$${totalCollected.toFixed(2)}\n` +
            `Possible Total: S$${possibleTotal.toFixed(2)}\n` +
            `Total Weeks: ${totalWeeks}\n` +
            `Paid: ${paidRows.length}\n` +
            `Unpaid: ${unpaidRows.length}\n\n` +
            `Payment Details:\n${paymentLines}\n\n` +
            `Reset triggered at: ${new Date().toLocaleString()}`;
    };

    const sendTelegramNotification = async (telegramMessage: string) => {
        const response = await fetch('/api/telegram-matchplay-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: telegramMessage }),
        });

        if (!response.ok) {
            throw new Error('Failed to send Telegram notification.');
        }
    };

    const handleResetTotal = async () => {
        if (rows.length === 0) {
            alert('No MatchPlay payment rows found for this month.');
            return;
        }

        if (!confirm(`Send ${getReadableMonth(selectedMonth)} MatchPlay payment summary and reset all paid statuses for this month?`)) {
            return;
        }

        try {
            setIsResetting(true);

            await sendTelegramNotification(buildMonthlySummaryMessage());

            const paidPaymentIds = payments
                .filter((payment) => payment.payment_month === selectedMonth && payment.paid)
                .map((payment) => payment.id);

            if (paidPaymentIds.length > 0) {
                const { error } = await supabase
                    .from('matchplay_payments')
                    .update({
                        paid: false,
                        updated_at: new Date().toISOString(),
                    })
                    .in('id', paidPaymentIds);

                if (error) throw error;
            }

            await loadData();
            setLastUpdated('Monthly summary sent. Paid statuses for this month were reset.');
        } catch (err: any) {
            alert(err?.message || 'Failed to reset MatchPlay payment total.');
        } finally {
            setIsResetting(false);
        }
    };

    const handleUndoAdd = async () => {
        const latestPaidPayment = [...payments]
            .filter((payment) => payment.payment_month === selectedMonth && payment.paid)
            .sort((a, b) => {
                const aTime = new Date(a.updated_at || a.created_at).getTime();
                const bTime = new Date(b.updated_at || b.created_at).getTime();
                return bTime - aTime;
            })[0];

        if (!latestPaidPayment) {
            alert('No paid MatchPlay payment found to undo for this month.');
            return;
        }

        const matchingStudent = students.find((student) => student.id === latestPaidPayment.matchplay_student_id);
        const studentName = matchingStudent?.student_name || 'Unknown student';

        if (!confirm(`Undo latest MatchPlay payment for ${studentName} (${getReadableMonth(selectedMonth)})?`)) {
            return;
        }

        try {
            setIsUndoing(true);

            const { data, error } = await supabase
                .from('matchplay_payments')
                .update({
                    paid: false,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', latestPaidPayment.id)
                .select('*')
                .single();

            if (error) throw error;

            const updatedPayment = data as MatchPlayPayment;
            setPayments((prev) =>
                prev.map((payment) =>
                    payment.id === updatedPayment.id ? updatedPayment : payment
                )
            );

            const telegramMessage =
                `↩️ MatchPlay Payment Undone ↩️\n\n` +
                `Student: ${studentName}\n` +
                `Month: ${getReadableMonth(selectedMonth)}\n` +
                `Amount: -S$${Number(latestPaidPayment.amount || 0).toFixed(2)}\n` +
                `Status: Unpaid\n` +
                `Recorded At: ${new Date().toLocaleString()}`;

            await sendTelegramNotification(telegramMessage);

            setLastUpdated(`Undid latest MatchPlay payment for ${studentName}.`);
        } catch (err: any) {
            alert(err?.message || 'Failed to undo latest MatchPlay payment.');
            await loadData();
        } finally {
            setIsUndoing(false);
        }
    };

    if (userRole !== 'superuser') {
        return (
            <div className="container" style={{ padding: '3rem 1rem' }}>
                <div className="form-card" style={{ maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
                    <h1 style={{ color: '#dc2626' }}>403</h1>
                    <p>Only superusers can access MatchPlay payments.</p>
                    <Link href="/dashboard" className="btn share-btn">Back to Dashboard</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            <AppHeader title="MatchPlay Payment" userName={userName} userRole={userRole} mode="dashboard" />

            <main>
                <div className="search-box">
                    <input
                        type="text"
                        placeholder="Search by student, weeks, amount, paid/unpaid..."
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                    />
                </div>

                <div className="filter-box">
                    <div className="filter-grid">
                        <div className="filter-group">
                            <label className="filter-label">
                                Month
                                <input
                                    type="month"
                                    className="filter-input"
                                    value={selectedMonth}
                                    onChange={(event) => setSelectedMonth(event.target.value)}
                                />
                            </label>
                        </div>

                        <div className="filter-group">
                            <label className="filter-label">
                                Payment Status
                                <select
                                    className="filter-input"
                                    value={paymentFilter}
                                    onChange={(event) => setPaymentFilter(event.target.value as PaymentFilter)}
                                >
                                    <option value="all">All</option>
                                    <option value="paid">Paid</option>
                                    <option value="unpaid">Unpaid</option>
                                </select>
                            </label>
                        </div>
                    </div>

                    <div className="filter-buttons">
                        <button
                            type="button"
                            className="filter-button secondary"
                            onClick={() => {
                                setSearchTerm('');
                                setPaymentFilter('all');
                            }}
                        >
                            Clear
                        </button>
                        <button type="button" className="filter-button" onClick={loadData}>
                            Refresh
                        </button>
                    </div>
                </div>

                <div className="payment-summary">
                    <div className="summary-card">
                        <h3>MatchPlay Payments Collected</h3>
                        <p className="amount">S${totalCollected.toFixed(2)}</p>
                        <p className="timestamp">Month: {getReadableMonth(selectedMonth)}</p>
                        <p className="timestamp">
                            Paid: {paidRows.length} · Unpaid: {unpaidRows.length} · Possible Total: S${possibleTotal.toFixed(2)}
                        </p>
                        <p className="timestamp">Total Weeks: {totalWeeks}</p>
                        {lastUpdated && <p className="timestamp">{lastUpdated}</p>}

                        <div className="payment-actions">
                            <button
                                className="payment-action-btn danger"
                                onClick={handleResetTotal}
                                disabled={isResetting || loading}
                                type="button"
                            >
                                {isResetting ? 'Resetting...' : 'Reset Total'}
                            </button>

                            <button
                                className="payment-action-btn warning"
                                onClick={handleUndoAdd}
                                disabled={isUndoing || loading}
                                type="button"
                            >
                                {isUndoing ? 'Undoing...' : 'Undo Add'}
                            </button>
                        </div>
                    </div>
                </div>

                {message && <p className="dashboard-error-message">{message}</p>}
                {loading && <p className="muted">Loading MatchPlay payments...</p>}

                {!loading && rows.length === 0 && (
                    <p className="muted">No MatchPlay payment rows found.</p>
                )}

                {!loading && rows.length > 0 && (
                    <div className="table-container">
                        <div className="table-scroll">
                            <table>
                                <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Weeks</th>
                                    <th>Price / Session</th>
                                    <th>Total Amount</th>
                                    <th>Paid</th>
                                </tr>
                                </thead>
                                <tbody>
                                {rows.map((row) => (
                                    <tr key={row.student.id}>
                                        <td>{row.student.student_name}</td>
                                        <td>
                                            <input
                                                className="weeks-input"
                                                type="number"
                                                min="0"
                                                step="1"
                                                value={row.weeks}
                                                onChange={(event) =>
                                                    upsertPayment(row.student.id, { manual_weeks: Number(event.target.value) })
                                                }
                                            />
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <span>S$</span>
                                                <input
                                                    className="weeks-input"
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    value={row.pricePerSession}
                                                    onChange={(event) =>
                                                        upsertPayment(row.student.id, { manual_price_per_session: Number(event.target.value) })
                                                    }
                                                />
                                            </div>
                                        </td>
                                        <td><strong>S${row.amount.toFixed(2)}</strong></td>
                                        <td>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <input
                                                    type="checkbox"
                                                    checked={row.isPaid}
                                                    onChange={(event) =>
                                                        upsertPayment(row.student.id, { paid: event.target.checked })
                                                    }
                                                />
                                                {row.isPaid ? 'Paid' : 'Unpaid'}
                                            </label>
                                        </td>
                                    </tr>
                                ))}

                                <tr>
                                    <td><strong>Monthly Total</strong></td>
                                    <td><strong>{totalWeeks}</strong></td>
                                    <td>-</td>
                                    <td><strong>S${possibleTotal.toFixed(2)}</strong></td>
                                    <td><strong>Collected: S${totalCollected.toFixed(2)}</strong></td>
                                </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
