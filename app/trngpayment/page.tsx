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

interface OneToOneStudent {
    id: string;
    student_name: string;
    payment_amount: number;
    active?: boolean;
}

interface TrainingPayment {
    id: number;
    training_student_id: string;
    week_date: string;
    paid: boolean;
    amount?: number | null;
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
    payment_amount: number;
    removed_from_training?: boolean;
    removed_at?: string | null;
    payment_exempt?: boolean;
    payment_exempt_at?: string | null;
}

const DEFAULT_TRAINING_PRICE = 80;

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
    const [counterResetAt, setCounterResetAt] = useState<string | null>(null);

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

    const loadCounterState = async () => {
        const { data, error } = await supabase
            .from('payment_counter_state')
            .select('reset_at')
            .eq('programme', 'one_to_one')
            .eq('period_key', selectedMonth)
            .maybeSingle();

        if (error) throw error;
        setCounterResetAt(data?.reset_at || null);
    };

    const loadData = async () => {
        try {
            setLoading(true);
            setMessage('');

            const startDateKey = `${selectedMonth}-01`;
            const endDateKey = getNextMonthDateKey(selectedMonth);

            const { data: rawSessions, error: sessionError } = await supabase
                .from('one_to_one_sessions')
                .select('id, session_date, student_id, coach_id, removed_from_training, removed_at, payment_exempt, payment_exempt_at, created_at, updated_at')
                .or('payment_exempt.is.null,payment_exempt.eq.false')
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
                removed_from_training?: boolean;
                removed_at?: string | null;
            }>).map(session => ({
                ...session,
                session_date: normalizeDateKey(session.session_date)
            }));

            const studentIds = [...new Set(sessionRows.map(session => session.student_id).filter(Boolean))];
            const coachIds = [...new Set(sessionRows.map(session => session.coach_id).filter(Boolean))];

            let studentsById = new Map<string, OneToOneStudent>();
            if (studentIds.length > 0) {
                const { data: studentData, error: studentError } = await supabase
                    .from('one_to_one_students')
                    .select('id, student_name, payment_amount, active')
                    .in('id', studentIds);

                if (studentError) throw studentError;

                studentsById = new Map(
                    ((studentData || []) as OneToOneStudent[]).map(student => [student.id, student])
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

            const hydratedSessions = sessionRows.map(session => {
                const student = studentsById.get(session.student_id);

                return {
                    ...session,
                    student_name: student?.student_name || 'Missing 1-1 student record',
                    coach_name: coachesById.get(session.coach_id) || 'Unassigned coach',
                    payment_amount: Number(student?.payment_amount || DEFAULT_TRAINING_PRICE)
                };
            });

            const normalizedPayments = ((paymentData || []) as TrainingPayment[]).map(payment => ({
                ...payment,
                week_date: normalizeDateKey(payment.week_date)
            }));

            setSessions(hydratedSessions);
            setPayments(normalizedPayments);
        } catch (err: any) {
            console.error(err);
            setMessage(err?.message || 'Failed to load 1-on-1 payment data');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (userRole) loadData();
    }, [selectedMonth, userRole]);

    const getPayment = (weekDate: string, studentId: string) => {
        return payments.find(p => p.week_date === weekDate && p.training_student_id === studentId);
    };

    const getSession = (weekDate: string, studentId: string) => {
        return sessions.find(s => s.session_date === weekDate && s.student_id === studentId);
    };

    const getSessionAmount = (session: TrainingSession, payment?: TrainingPayment) => {
        return Number(payment?.amount ?? session.payment_amount ?? DEFAULT_TRAINING_PRICE);
    };

    const updateStudentPaymentAmount = async (studentId: string, amount: number) => {
        const safeAmount = Number(amount) || 0;

        if (safeAmount <= 0) {
            alert('Payment amount must be more than 0.');
            return;
        }

        try {
            const { data, error } = await supabase
                .from('one_to_one_students')
                .update({
                    payment_amount: safeAmount,
                    updated_at: new Date().toISOString()
                })
                .eq('id', studentId)
                .select('id, student_name, payment_amount, active')
                .single();

            if (error) throw error;

            const updatedStudent = data as OneToOneStudent;

            setSessions(prev =>
                prev.map(session =>
                    session.student_id === studentId
                        ? {
                            ...session,
                            student_name: updatedStudent.student_name,
                            payment_amount: Number(updatedStudent.payment_amount || DEFAULT_TRAINING_PRICE)
                        }
                        : session
                )
            );

            const sessionPaymentIds = payments
                .filter(payment => payment.training_student_id === studentId && !payment.paid)
                .map(payment => payment.id);

            if (sessionPaymentIds.length > 0) {
                await supabase
                    .from('training_payments')
                    .update({ amount: safeAmount, updated_at: new Date().toISOString() })
                    .in('id', sessionPaymentIds);
            }

            setLastUpdated(`Updated ${updatedStudent.student_name}'s 1-on-1 payment amount.`);
        } catch (err: any) {
            alert(err?.message || 'Failed to update 1-on-1 payment amount.');
            await loadData();
        }
    };

    const deletePaymentRecord = async (payment: TrainingPayment | undefined, session: TrainingSession) => {
        const confirmed = confirm(
            `Delete this payment transaction for ${session.student_name} on ${getReadableDate(session.session_date)}?\n\nThis means the student does NOT need to pay for this lesson anymore. The lesson will be removed from /trngpayment totals, but the training record will still remain in the attendance/training system.`
        );

        if (!confirmed) return;

        try {
            if (payment) {
                const { error: deleteError } = await supabase
                    .from('training_payments')
                    .delete()
                    .eq('id', payment.id);

                if (deleteError) throw deleteError;
            }

            const { error: sessionError } = await supabase
                .from('one_to_one_sessions')
                .update({
                    payment_exempt: true,
                    payment_exempt_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .eq('id', session.id);

            if (sessionError) throw sessionError;

            setPayments(prev => payment ? prev.filter(item => item.id !== payment.id) : prev);
            setSessions(prev => prev.filter(item => item.id !== session.id));
            setLastUpdated(`Deleted payment transaction for ${session.student_name}. They no longer need to pay for this lesson.`);
        } catch (err: any) {
            alert(err?.message || 'Failed to delete payment transaction.');
            await loadData();
        }
    };

    const sendTrainingPaymentNotification = async (
        studentName: string,
        coachName: string,
        weekDate: string,
        amount: number,
        isPaid: boolean
    ) => {
        const recordedAt = new Date().toISOString();
        const telegramMessage =
            `${isPaid ? '✅ 1-on-1 Payment Received!' : '↩️ 1-on-1 Payment Reversed!'}\n\n` +
            `Student: ${studentName}\n` +
            `Coach: ${coachName}\n` +
            `Session Date: ${getReadableDate(weekDate)}\n` +
            `Amount: ${isPaid ? '+' : '-'}S$${amount.toFixed(2)}\n` +
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
            ? paidSessions.map(session => {
                const payment = getPayment(session.session_date, session.student_id);
                const amount = getSessionAmount(session, payment);
                const removedNote = session.removed_from_training ? ' [removed from attendance]' : '';
                return `- ${session.student_name} (${getReadableDate(session.session_date)}, Coach: ${session.coach_name}${removedNote}): +S$${amount.toFixed(2)}`;
            }).join('\n')
            : '- No paid 1-on-1 sessions recorded.';

        const unpaidLines = unpaidSessions.length > 0
            ? unpaidSessions.map(session => {
                const payment = getPayment(session.session_date, session.student_id);
                const amount = getSessionAmount(session, payment);
                const removedNote = session.removed_from_training ? ' [removed from attendance]' : '';
                return `- ${session.student_name} (${getReadableDate(session.session_date)}, Coach: ${session.coach_name}${removedNote}): S$${amount.toFixed(2)}`;
            }).join('\n')
            : '- None';

        const totalCollected = paidSessions.reduce((sum, session) => {
            const payment = getPayment(session.session_date, session.student_id);
            return sum + getSessionAmount(session, payment);
        }, 0);

        const possibleTotal = sessions.reduce((sum, session) => {
            const payment = getPayment(session.session_date, session.student_id);
            return sum + getSessionAmount(session, payment);
        }, 0);

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

            const amount = getSessionAmount(session, oldPayment);
            const now = new Date().toISOString();

            const { data, error } = await supabase
                .from('training_payments')
                .upsert(
                    {
                        training_student_id: studentId,
                        week_date: weekDate,
                        paid,
                        amount,
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
                    amount,
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
        if (!confirm(
            `Send ${getReadableMonth(selectedMonth)} 1-on-1 payment summary and reset only the displayed counter?`
        )) {
            return;
        }

        try {
            setIsResetting(true);

            await sendMonthlySummaryNotification();

            const resetAt = new Date().toISOString();
            const { data: { user } } = await supabase.auth.getUser();

            const { error } = await supabase
                .from('payment_counter_state')
                .upsert(
                    {
                        programme: 'one_to_one',
                        period_key: selectedMonth,
                        reset_at: resetAt,
                        reset_by: user?.id || null,
                        updated_at: resetAt,
                    },
                    { onConflict: 'programme,period_key' }
                );

            if (error) throw error;

            setCounterResetAt(resetAt);
            setLastUpdated(
                'Monthly summary sent. Counter reset to S$0.00. Existing payment statuses were preserved.'
            );
        } catch (err: any) {
            alert(err?.message || 'Failed to reset 1-on-1 payment counter.');
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
            alert('Could not find the matching 1-on-1 session for the latest payment.');
            return;
        }

        const amount = getSessionAmount(session, latestPaidPayment);

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
                amount,
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
            const amount = getSessionAmount(session, payment);

            const matchesSearch =
                !normalizedSearch ||
                session.student_name.toLowerCase().includes(normalizedSearch) ||
                session.coach_name.toLowerCase().includes(normalizedSearch) ||
                `s$${amount.toFixed(2)}`.toLowerCase().includes(normalizedSearch) ||
                (session.removed_from_training ? 'removed attendance hidden' : 'active attendance').includes(normalizedSearch);

            const matchesPaymentFilter =
                paymentFilter === 'all' ||
                (paymentFilter === 'paid' && isPaid) ||
                (paymentFilter === 'unpaid' && !isPaid);

            return matchesSearch && matchesPaymentFilter;
        });
    }, [sessions, payments, searchTerm, paymentFilter]);

    const paidSessions = sessions.filter(session => {
        const payment = getPayment(session.session_date, session.student_id);
        return payment?.paid ?? false;
    });

    const paidCount = paidSessions.length;
    const unpaidCount = sessions.length - paidCount;
    const monthTotal = paidSessions.reduce((sum, session) => {
        const payment = getPayment(session.session_date, session.student_id);
        return sum + getSessionAmount(session, payment);
    }, 0);
    const possibleTotal = sessions.reduce((sum, session) => {
        const payment = getPayment(session.session_date, session.student_id);
        return sum + getSessionAmount(session, payment);
    }, 0);

    const counterTotal = paidSessions
        .filter((session) => {
            if (!counterResetAt) return true;
            const payment = getPayment(session.session_date, session.student_id);
            if (!payment) return false;
            return new Date(payment.updated_at || payment.created_at).getTime()
                >= new Date(counterResetAt).getTime();
        })
        .reduce((sum, session) => {
            const payment = getPayment(session.session_date, session.student_id);
            return sum + getSessionAmount(session, payment);
        }, 0);

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
                        placeholder="Search by student, coach, amount, or removed..."
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
                            type="button"
                            className="filter-button secondary"
                            onClick={() => {
                                setSearchTerm('');
                                setPaymentFilter('all');
                            }}
                        >
                            Clear
                        </button>
                        <button
                            type="button"
                            className="filter-button"
                            onClick={loadData}
                        >
                            Refresh
                        </button>
                    </div>
                </div>

                <div className="payment-summary">
                    <div className="summary-card">
                        <h3>1-on-1 Payments Collected</h3>
                        <p className="amount">S${counterTotal.toFixed(2)}</p>
                        <p className="timestamp">Month: {getReadableMonth(selectedMonth)}</p>
                        <p className="timestamp">
                            Paid Sessions: {paidCount} · Unpaid Sessions: {unpaidCount} · Possible Total: S${possibleTotal.toFixed(2)}
                        </p>
                        {lastUpdated && <p className="timestamp">{lastUpdated}</p>}

                        <div className="payment-actions">
                            <button
                                type="button"
                                className="payment-action-btn danger"
                                onClick={handleResetTotal}
                                disabled={isResetting || loading}
                            >
                                {isResetting ? 'Resetting...' : 'Reset Total'}
                            </button>

                            <button
                                type="button"
                                className="payment-action-btn warning"
                                onClick={handleUndoAdd}
                                disabled={isUndoing || loading}
                            >
                                {isUndoing ? 'Undoing...' : 'Undo Add'}
                            </button>
                        </div>
                    </div>
                </div>

                {message && <p className="dashboard-error-message">{message}</p>}
                {loading && <p className="muted">Loading 1-on-1 payments...</p>}

                {!loading && filteredSessions.length === 0 && (
                    <p className="muted">No 1-on-1 sessions found for this month.</p>
                )}

                {!loading && filteredSessions.length > 0 && (
                    <div className="table-container">
                        <div className="table-scroll">
                            <table>
                                <thead>
                                <tr>
                                    <th>Student</th>
                                    <th>Sunday</th>
                                    <th>Coach</th>
                                    <th>Training Status</th>
                                    <th>Payment Amount</th>
                                    <th>Payment Status</th>
                                    <th>Actions</th>
                                </tr>
                                </thead>
                                <tbody>
                                {filteredSessions.map(session => {
                                    const payment = getPayment(session.session_date, session.student_id);
                                    const isPaid = payment?.paid ?? false;
                                    const amount = getSessionAmount(session, payment);

                                    return (
                                        <tr key={session.id}>
                                            <td>{session.student_name}</td>
                                            <td>{getReadableDate(session.session_date)}</td>
                                            <td>{session.coach_name}</td>
                                            <td>
                                                {session.removed_from_training ? (
                                                    <span
                                                        style={{
                                                            display: 'inline-flex',
                                                            padding: '6px 10px',
                                                            borderRadius: 999,
                                                            fontWeight: 800,
                                                            fontSize: '0.82rem',
                                                            color: '#92400e',
                                                            background: '#fef3c7',
                                                            whiteSpace: 'nowrap'
                                                        }}
                                                    >
                              Removed from attendance
                            </span>
                                                ) : (
                                                    <span
                                                        style={{
                                                            display: 'inline-flex',
                                                            padding: '6px 10px',
                                                            borderRadius: 999,
                                                            fontWeight: 800,
                                                            fontSize: '0.82rem',
                                                            color: '#047857',
                                                            background: '#d1fae5',
                                                            whiteSpace: 'nowrap'
                                                        }}
                                                    >
                              Active
                            </span>
                                                )}
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <span>S$</span>
                                                    <input
                                                        className="weeks-input"
                                                        type="number"
                                                        min="0"
                                                        step="0.01"
                                                        value={amount}
                                                        onChange={(event) =>
                                                            updateStudentPaymentAmount(
                                                                session.student_id,
                                                                Number(event.target.value)
                                                            )
                                                        }
                                                    />
                                                </div>
                                            </td>
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
                                            <td>
                                                <button
                                                    type="button"
                                                    className="delete-btn"
                                                    onClick={() => payment ? deletePaymentRecord(payment, session) : alert('No payment transaction exists for this row yet.')}
                                                >
                                                    Delete Transaction
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}

                                <tr>
                                    <td><strong>Monthly Total</strong></td>
                                    <td>-</td>
                                    <td>-</td>
                                    <td>-</td>
                                    <td><strong>S${possibleTotal.toFixed(2)}</strong></td>
                                    <td><strong>Collected: S${monthTotal.toFixed(2)}</strong></td>
                                    <td>-</td>
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
