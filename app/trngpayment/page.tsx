'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import AppHeader from './../components/AppHeader';
import './../styles.css';
import './../dashboard/dashboard.css';
import './../payment/payment.css';

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type UserRole = 'superuser' | 'admin' | 'member';
type PaymentFilter = 'all' | 'paid' | 'unpaid';

interface AppUser {
    id: string;
    email: string;
    user_metadata?: {
        name?: string;
        role?: UserRole;
    };
    app_metadata?: {
        role?: UserRole;
    };
}

interface Student {
    student_id: string;
    student_name: string;
}

interface TrainingPayment {
    id: number;
    training_student_id: string;
    week_date: string;
    paid: boolean;
    created_at: string;
    updated_at?: string;
}

interface TrainingSession {
    id: number;
    session_date: string;
    student_id: string;
    coach_id: string;
    student_name: string;
    coach_name: string;
}

const TRAINING_PRICE = 80;

const getUserRole = (user: any): UserRole => {
    return (
        user?.app_metadata?.role ||
        user?.user_metadata?.role ||
        'member'
    ) as UserRole;
};

const getDisplayName = (user: AppUser) => {
    return user.user_metadata?.name || user.email || 'User';
};

const normalizeDateKey = (dateValue: string) => {
    return dateValue.slice(0, 10);
};

const getNextMonthDateKey = (monthValue: string) => {
    const [yearStr, monthStr] = monthValue.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);

    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;

    return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
};

const getReadableDate = (dateKey: string) => {
    const [year, month, day] = dateKey.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });
};

const getReadableMonth = (monthValue: string) => {
    const [year, month] = monthValue.split('-').map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric'
    });
};

export default function TrngPaymentPage() {
    const router = useRouter();
    const [userRole, setUserRole] = useState<UserRole | null>(null);
    const [userName, setUserName] = useState('');

    const [sessions, setSessions] = useState<TrainingSession[]>([]);
    const [payments, setPayments] = useState<TrainingPayment[]>([]);
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

            const startDateKey = `${selectedMonth}-01`;
            const endDateKey = getNextMonthDateKey(selectedMonth);

            const { data: rawSessions, error: sessionError } = await supabase
                .from('training_sessions')
                .select('id, session_date, student_id, coach_id')
                .gte('session_date', startDateKey)
                .lt('session_date', endDateKey)
                .order('session_date', { ascending: true })
                .order('id', { ascending: true });

            if (sessionError) throw sessionError;

            const sessionRows = ((rawSessions || []) as Array<{
                id: number;
                session_date: string;
                student_id: string;
                coach_id: string;
            }>).map(session => ({
                ...session,
                session_date: normalizeDateKey(session.session_date)
            }));

            const studentIds = [...new Set(sessionRows.map(session => session.student_id).filter(Boolean))];
            const coachIds = [...new Set(sessionRows.map(session => session.coach_id).filter(Boolean))];

            let studentsById = new Map<string, string>();
            if (studentIds.length > 0) {
                const { data: studentData, error: studentError } = await supabase
                    .from('students')
                    .select('student_id, student_name')
                    .in('student_id', studentIds);

                if (studentError) throw studentError;

                studentsById = new Map(
                    ((studentData || []) as Student[]).map(student => [student.student_id, student.student_name])
                );
            }

            let coachesById = new Map<string, string>();
            if (coachIds.length > 0) {
                const { data: authUsers } = await fetch('/api/users/list')
                    .then(res => res.json())
                    .then(json => ({ data: json.users as AppUser[] }))
                    .catch(() => ({ data: [] as AppUser[] }));

                coachesById = new Map(
                    (authUsers || []).map(coach => [coach.id, getDisplayName(coach)])
                );
            }

            const { data: paymentData, error: paymentError } = await supabase
                .from('training_payments')
                .select('*')
                .gte('week_date', startDateKey)
                .lt('week_date', endDateKey)
                .order('week_date', { ascending: true });

            if (paymentError) throw paymentError;

            setSessions(sessionRows.map(session => ({
                ...session,
                student_name: studentsById.get(session.student_id) || 'Missing student record',
                coach_name: coachesById.get(session.coach_id) || 'Unassigned coach'
            })));

            setPayments(((paymentData || []) as TrainingPayment[]).map(payment => ({
                ...payment,
                week_date: normalizeDateKey(payment.week_date)
            })));
        } catch (err: any) {
            console.error(err);
            setMessage(err?.message || 'Failed to load 1-on-1 payment data');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [selectedMonth]);

    const getPayment = (weekDate: string, studentId: string) => {
        return payments.find(p => p.week_date === weekDate && p.training_student_id === studentId);
    };

    const getSession = (weekDate: string, studentId: string) => {
        return sessions.find(s => s.session_date === weekDate && s.student_id === studentId);
    };

    const sendTrainingPaymentNotification = async (
        studentName: string,
        coachName: string,
        weekDate: string,
        isPaid: boolean
    ) => {
        const recordedAt = new Date().toISOString();
        const telegramMessage =
            `${isPaid ? '✅ 1-on-1 Payment Received!' : '↩️ 1-on-1 Payment Reversed!'}\n\n` +
            `Student: ${studentName}\n` +
            `Coach: ${coachName}\n` +
            `Session Date: ${getReadableDate(weekDate)}\n` +
            `Amount: ${isPaid ? '+' : '-'}S$${TRAINING_PRICE.toFixed(2)}\n` +
            `Recorded At: ${new Date(recordedAt).toLocaleString()}\n` +
            `Status: ${isPaid ? 'Paid' : 'Unpaid'}`;

        const response = await fetch('/api/telegram-trngpayment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: telegramMessage })
        });

        if (!response.ok) {
            throw new Error('Payment saved, but Telegram notification failed.');
        }
    };

    const buildMonthlySummaryMessage = () => {
        const paidSessions = sessions.filter(session => {
            const payment = getPayment(session.session_date, session.student_id);
            return payment?.paid ?? false;
        });

        const unpaidSessions = sessions.filter(session => {
            const payment = getPayment(session.session_date, session.student_id);
            return !(payment?.paid ?? false);
        });

        const paidLines = paidSessions.length > 0
            ? paidSessions.map(session => (
                `- ${session.student_name} (${getReadableDate(session.session_date)}, Coach: ${session.coach_name}): +S$${TRAINING_PRICE.toFixed(2)}`
            )).join('\n')
            : '- No paid 1-on-1 sessions recorded.';

        const unpaidLines = unpaidSessions.length > 0
            ? unpaidSessions.map(session => (
                `- ${session.student_name} (${getReadableDate(session.session_date)}, Coach: ${session.coach_name})`
            )).join('\n')
            : '- None';

        const totalCollected = paidSessions.length * TRAINING_PRICE;
        const possibleTotal = sessions.length * TRAINING_PRICE;

        return `📊 1-on-1 Monthly Payment Summary 📊\n\n` +
            `Month: ${getReadableMonth(selectedMonth)}\n` +
            `Total Collected: S$${totalCollected.toFixed(2)}\n` +
            `Paid Sessions: ${paidSessions.length}\n` +
            `Unpaid Sessions: ${unpaidSessions.length}\n` +
            `Possible Total: S$${possibleTotal.toFixed(2)}\n\n` +
            `Payment Details:\n${paidLines}\n\n` +
            `Unpaid / Pending:\n${unpaidLines}\n\n` +
            `Reset triggered at: ${new Date().toLocaleString()}`;
    };

    const sendMonthlySummaryNotification = async () => {
        const response = await fetch('/api/telegram-trngpayment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: buildMonthlySummaryMessage() })
        });

        if (!response.ok) {
            throw new Error('Failed to send monthly Telegram summary.');
        }
    };

    const savePayment = async (weekDate: string, studentId: string, paid: boolean) => {
        try {
            const oldPayment = getPayment(weekDate, studentId);
            const oldPaidStatus = oldPayment?.paid ?? false;
            const session = getSession(weekDate, studentId);

            if (!session) {
                throw new Error('Training session not found. Please refresh and try again.');
            }

            const now = new Date().toISOString();
            const { data, error } = await supabase
                .from('training_payments')
                .upsert(
                    {
                        training_student_id: studentId,
                        week_date: weekDate,
                        paid,
                        updated_at: now
                    },
                    { onConflict: 'training_student_id,week_date' }
                )
                .select('*')
                .single();

            if (error) throw error;

            const savedPayment = {
                ...(data as TrainingPayment),
                week_date: normalizeDateKey((data as TrainingPayment).week_date)
            };

            setPayments(prev => {
                const exists = prev.some(
                    p => p.training_student_id === studentId && p.week_date === weekDate
                );

                if (exists) {
                    return prev.map(p =>
                        p.training_student_id === studentId && p.week_date === weekDate
                            ? savedPayment
                            : p
                    );
                }

                return [...prev, savedPayment];
            });

            if (oldPaidStatus !== paid) {
                await sendTrainingPaymentNotification(
                    session.student_name,
                    session.coach_name,
                    weekDate,
                    paid
                );
            }

            setLastUpdated(`Payment updated at ${new Date().toLocaleString()}`);
        } catch (err: any) {
            alert(err?.message || 'Failed to save payment');
            await loadData();
        }
    };

    const handleResetTotal = async () => {
        if (sessions.length === 0) {
            alert('No 1-on-1 sessions found for this month.');
            return;
        }

        if (!confirm(`Send ${getReadableMonth(selectedMonth)} 1-on-1 payment summary and reset all paid statuses for this month?`)) {
            return;
        }

        try {
            setIsResetting(true);
            await sendMonthlySummaryNotification();

            const paidPayments = payments.filter(payment => payment.paid);
            if (paidPayments.length > 0) {
                const now = new Date().toISOString();
                const { error } = await supabase
                    .from('training_payments')
                    .update({ paid: false, updated_at: now })
                    .in('id', paidPayments.map(payment => payment.id));

                if (error) throw error;
            }

            await loadData();
            setLastUpdated('Monthly summary sent. Paid statuses for this month were reset.');
        } catch (err: any) {
            alert(err?.message || 'Failed to reset total');
        } finally {
            setIsResetting(false);
        }
    };

    const handleUndoAdd = async () => {
        const latestPaidPayment = payments
            .filter(payment => payment.paid)
            .sort((a, b) => {
                const aTime = new Date(a.updated_at || a.created_at).getTime();
                const bTime = new Date(b.updated_at || b.created_at).getTime();
                return bTime - aTime;
            })[0];

        if (!latestPaidPayment) {
            alert('No paid 1-on-1 payment found to undo for this month.');
            return;
        }

        const session = getSession(latestPaidPayment.week_date, latestPaidPayment.training_student_id);
        if (!session) {
            alert('Could not find the matching training session for the latest payment.');
            return;
        }

        if (!confirm(`Undo latest 1-on-1 payment for ${session.student_name} on ${getReadableDate(session.session_date)}?`)) {
            return;
        }

        try {
            setIsUndoing(true);
            const now = new Date().toISOString();
            const { error } = await supabase
                .from('training_payments')
                .update({ paid: false, updated_at: now })
                .eq('id', latestPaidPayment.id);

            if (error) throw error;

            await sendTrainingPaymentNotification(
                session.student_name,
                session.coach_name,
                session.session_date,
                false
            );

            await loadData();
            setLastUpdated(`Undid latest payment for ${session.student_name}. Notification sent.`);
        } catch (err: any) {
            alert(err?.message || 'Failed to undo latest payment');
        } finally {
            setIsUndoing(false);
        }
    };

    const filteredSessions = useMemo(() => {
        const normalizedSearch = searchTerm.trim().toLowerCase();

        return sessions.filter(session => {
            const payment = getPayment(session.session_date, session.student_id);
            const isPaid = payment?.paid ?? false;

            const matchesSearch =
                !normalizedSearch ||
                session.student_name.toLowerCase().includes(normalizedSearch) ||
                session.coach_name.toLowerCase().includes(normalizedSearch);

            const matchesPaymentFilter =
                paymentFilter === 'all' ||
                (paymentFilter === 'paid' && isPaid) ||
                (paymentFilter === 'unpaid' && !isPaid);

            return matchesSearch && matchesPaymentFilter;
        });
    }, [sessions, payments, searchTerm, paymentFilter]);

    const paidCount = sessions.filter(session => {
        const payment = getPayment(session.session_date, session.student_id);
        return payment?.paid ?? false;
    }).length;

    const unpaidCount = sessions.length - paidCount;
    const monthTotal = paidCount * TRAINING_PRICE;
    const possibleTotal = sessions.length * TRAINING_PRICE;

    if (userRole !== 'superuser') {
        return (
            <div className="container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '3rem 1rem' }}>
                <div className="form-card" style={{ maxWidth: 600, width: '100%', textAlign: 'center' }}>
                    <h1 style={{ fontSize: '3rem', margin: '0 0 1rem', color: '#dc2626' }}>403</h1>
                    <h2 style={{ fontSize: '1.5rem', margin: '0 0 1rem', color: '#374151' }}>Forbidden</h2>
                    <p style={{ margin: '0 0 1.5rem', color: '#6b7280' }}>You do not have permission to access this page. Only superusers can access 1-on-1 payment.</p>
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                        <Link href="/dashboard" className="btn share-btn">Go to Dashboard</Link>
                        <button
                            className="btn share-btn"
                            onClick={async () => {
                                await supabase.auth.signOut();
                                router.push('/');
                            }}
                        >
                            Logout
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            <AppHeader
                title="1-on-1 Payment"
                userName={userName}
                userRole={userRole}
                mode="dashboard"
            />

            <main>
                <div className="search-box">
                    <input
                        type="text"
                        placeholder="Search by student or coach..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
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
                                    onChange={(e) => setSelectedMonth(e.target.value)}
                                />
                            </label>
                        </div>

                        <div className="filter-group">
                            <label className="filter-label">
                                Payment Status
                                <select
                                    value={paymentFilter}
                                    onChange={(e) => setPaymentFilter(e.target.value as PaymentFilter)}
                                    className="filter-input"
                                >
                                    <option value="all">All Payments</option>
                                    <option value="paid">Paid Only</option>
                                    <option value="unpaid">Unpaid Only</option>
                                </select>
                            </label>
                        </div>
                    </div>

                    <div className="filter-buttons">
                        <button
                            onClick={() => {
                                setSearchTerm('');
                                setPaymentFilter('all');
                            }}
                            className="filter-button secondary"
                        >
                            Clear Filters
                        </button>
                        <button onClick={loadData} className="filter-button">
                            Refresh
                        </button>
                    </div>
                </div>

                <div className="payment-summary">
                    <div className="summary-card">
                        <h3>1-on-1 Payments Collected</h3>
                        <p className="amount">S${monthTotal.toFixed(2)}</p>
                        <p className="timestamp">Monthly Tracking Period: {getReadableMonth(selectedMonth)}</p>
                        <p className="timestamp">
                            Paid: {paidCount} · Unpaid: {unpaidCount} · Possible Total: S${possibleTotal.toFixed(2)}
                        </p>
                        {lastUpdated && <p className="timestamp">{lastUpdated}</p>}

                        <div className="payment-actions">
                            <button
                                className="payment-action-btn danger"
                                onClick={handleResetTotal}
                                disabled={isResetting || loading}
                            >
                                {isResetting ? 'Resetting...' : 'Reset Total'}
                            </button>
                            <button
                                className="payment-action-btn warning"
                                onClick={handleUndoAdd}
                                disabled={isUndoing || loading}
                            >
                                {isUndoing ? 'Undoing...' : 'Undo Add'}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="search-results-display">
                    {message && <p className="dashboard-error-message">{message}</p>}
                    {loading && <p>Loading 1-on-1 payments...</p>}

                    {!loading && !message && filteredSessions.length === 0 && (
                        <p>No 1-on-1 payment records found for this filter.</p>
                    )}

                    {!loading && !message && filteredSessions.length > 0 && (
                        <div className="table-container">
                            <div className="user-scroll">
                                <table>
                                    <thead>
                                    <tr>
                                        <th>Student</th>
                                        <th>Sunday</th>
                                        <th>Coach</th>
                                        <th>Payment Amount</th>
                                        <th>Payment Status</th>
                                    </tr>
                                    </thead>
                                    <tbody>
                                    {filteredSessions.map(session => {
                                        const payment = getPayment(session.session_date, session.student_id);
                                        const isPaid = payment?.paid ?? false;

                                        return (
                                            <tr key={session.id}>
                                                <td>{session.student_name}</td>
                                                <td>{getReadableDate(session.session_date)}</td>
                                                <td>{session.coach_name}</td>
                                                <td>S${TRAINING_PRICE.toFixed(2)}</td>
                                                <td>
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={isPaid}
                                                            onChange={(e) => savePayment(
                                                                session.session_date,
                                                                session.student_id,
                                                                e.target.checked
                                                            )}
                                                        />
                                                        {isPaid ? 'Paid' : 'Unpaid'}
                                                    </label>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
