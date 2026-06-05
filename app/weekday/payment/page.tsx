'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';
import AppHeader from './../../components/AppHeader';
import './../../styles.css';
import './../../dashboard/dashboard.css';
import './../../payment/payment.css';

type UserRole = 'superuser' | 'admin' | 'member';
type WeekdayName = 'Monday' | 'Wednesday' | 'Thursday';
type PaymentFilter = 'all' | 'paid' | 'unpaid';

interface WeekdaySchedule {
    day: WeekdayName;
    duration_hours?: number;
    duration?: number;
}

interface WeekdayStudent {
    id: string;
    student_name: string;
    schedules: WeekdaySchedule[];
    hourly_rate: number;
    active: boolean;
}

interface WeekdayPayment {
    id: number;
    weekday_student_id: string;
    payment_month: string;
    day_name: WeekdayName;
    paid: boolean;
    amount: number;
    scheduled_hours?: number | null;
    manual_hours?: number | null;
    created_at: string;
    updated_at?: string;
}

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const DAY_OPTIONS: WeekdayName[] = ['Monday', 'Wednesday', 'Thursday'];
const DAY_INDEX: Record<WeekdayName, number> = { Monday: 1, Wednesday: 3, Thursday: 4 };
const DEFAULT_HOURLY_RATE = 80;

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

const scheduleHours = (schedule: WeekdaySchedule) => {
    return Number(schedule.duration_hours ?? schedule.duration ?? 0) || 0;
};

const countWeekdayInMonth = (monthValue: string, day: WeekdayName) => {
    const [year, month] = monthValue.split('-').map(Number);
    const date = new Date(year, month - 1, 1);
    const countUntil = new Date(year, month, 0);
    let count = 0;

    while (date <= countUntil) {
        if (date.getDay() === DAY_INDEX[day]) count += 1;
        date.setDate(date.getDate() + 1);
    }

    return count;
};

export default function WeekdayPaymentPage() {
    const router = useRouter();
    const [userName, setUserName] = useState('');
    const [userRole, setUserRole] = useState<UserRole | null>(null);
    const [students, setStudents] = useState<WeekdayStudent[]>([]);
    const [payments, setPayments] = useState<WeekdayPayment[]>([]);
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
                .from('weekday_students')
                .select('*')
                .eq('active', true)
                .order('student_name', { ascending: true });

            if (studentError) throw studentError;

            const { data: paymentData, error: paymentError } = await supabase
                .from('weekday_payments')
                .select('*')
                .eq('payment_month', selectedMonth)
                .order('day_name', { ascending: true });

            if (paymentError) throw paymentError;

            setStudents((studentData || []) as WeekdayStudent[]);
            setPayments((paymentData || []) as WeekdayPayment[]);
        } catch (err: any) {
            setMessage(err?.message || 'Failed to load weekday payments.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (userRole) loadData();
    }, [userRole, selectedMonth]);

    const getPayment = (studentId: string, day: WeekdayName) => {
        return payments.find(
            (payment) =>
                payment.weekday_student_id === studentId &&
                payment.payment_month === selectedMonth &&
                payment.day_name === day
        );
    };

    const rows = useMemo(() => {
        const normalizedSearch = searchTerm.trim().toLowerCase();

        return students.flatMap((student) => {
            const schedules = Array.isArray(student.schedules) ? student.schedules : [];

            return schedules.map((schedule) => {
                const rate = Number(student.hourly_rate || DEFAULT_HOURLY_RATE);
                const weeklyHours = scheduleHours(schedule);
                const occurrences = countWeekdayInMonth(selectedMonth, schedule.day);
                const scheduledMonthlyHours = weeklyHours * occurrences;
                const payment = getPayment(student.id, schedule.day);
                const payableHours = Number(payment?.manual_hours ?? scheduledMonthlyHours);
                const amount = payableHours * rate;
                const isPaid = payment?.paid ?? false;

                return {
                    student,
                    schedule,
                    rate,
                    occurrences,
                    scheduledMonthlyHours,
                    payableHours,
                    amount,
                    isPaid,
                    payment,
                };
            });
        }).filter((row) => {
            const matchesPaymentFilter =
                paymentFilter === 'all' ||
                (paymentFilter === 'paid' && row.isPaid) ||
                (paymentFilter === 'unpaid' && !row.isPaid);

            if (!matchesPaymentFilter) return false;

            if (!normalizedSearch) return true;

            const searchable = [
                row.student.student_name,
                row.schedule.day,
                `${row.payableHours}h`,
                `S$${row.amount.toFixed(2)}`,
                row.isPaid ? 'paid' : 'unpaid',
            ].join(' ').toLowerCase();

            return searchable.includes(normalizedSearch);
        });
    }, [students, payments, selectedMonth, searchTerm, paymentFilter]);

    const groupedRows = DAY_OPTIONS.map((day) => ({
        day,
        rows: rows.filter((row) => row.schedule.day === day),
    }));

    const paidRows = rows.filter((row) => row.isPaid);
    const unpaidRows = rows.filter((row) => !row.isPaid);
    const totalCollected = paidRows.reduce((sum, row) => sum + row.amount, 0);
    const possibleTotal = rows.reduce((sum, row) => sum + row.amount, 0);
    const totalSessions = rows.reduce((sum, row) => sum + row.occurrences, 0);
    const totalPayableHours = rows.reduce((sum, row) => sum + row.payableHours, 0);

    const monthlySummaryRows = useMemo(() => {
        const summaryMap = new Map<string, {
            studentId: string;
            studentName: string;
            days: WeekdayName[];
            sessions: number;
            scheduledHours: number;
            payableHours: number;
            amount: number;
            paidRows: number;
            totalRows: number;
        }>();

        rows.forEach((row) => {
            const existing = summaryMap.get(row.student.id) || {
                studentId: row.student.id,
                studentName: row.student.student_name,
                days: [],
                sessions: 0,
                scheduledHours: 0,
                payableHours: 0,
                amount: 0,
                paidRows: 0,
                totalRows: 0,
            };

            existing.days.push(row.schedule.day);
            existing.sessions += row.occurrences;
            existing.scheduledHours += row.scheduledMonthlyHours;
            existing.payableHours += row.payableHours;
            existing.amount += row.amount;
            existing.paidRows += row.isPaid ? 1 : 0;
            existing.totalRows += 1;

            summaryMap.set(row.student.id, existing);
        });

        return Array.from(summaryMap.values())
            .map((summary) => ({
                ...summary,
                days: Array.from(new Set(summary.days)),
                isPaidAll: summary.totalRows > 0 && summary.paidRows === summary.totalRows,
            }))
            .sort((a, b) => a.studentName.localeCompare(b.studentName));
    }, [rows]);

    const summaryPaidAllCount = monthlySummaryRows.filter((row) => row.isPaidAll).length;
    const summaryNotPaidAllCount = monthlySummaryRows.filter((row) => !row.isPaidAll).length;

    const buildMonthlySummaryMessage = () => {
        const studentLines = monthlySummaryRows.length > 0
            ? monthlySummaryRows.map((summary) => (
                `- ${summary.studentName}: ${summary.days.join(', ')} | ` +
                `${summary.sessions} session${summary.sessions === 1 ? '' : 's'} | ` +
                `${summary.payableHours.toFixed(2).replace(/\.00$/, '')}h | ` +
                `S$${summary.amount.toFixed(2)} | ${summary.isPaidAll ? 'Paid' : 'Unpaid'}`
            )).join('\n')
            : '- No weekday payment records for this month.';

        return `📊 Weekday Monthly Payment Summary 📊\n\n` +
            `Month: ${getReadableMonth(selectedMonth)}\n` +
            `Total Collected: S$${totalCollected.toFixed(2)}\n` +
            `Possible Total: S$${possibleTotal.toFixed(2)}\n` +
            `Total Sessions: ${totalSessions}\n` +
            `Total Payable Hours: ${totalPayableHours.toFixed(2).replace(/\.00$/, '')}h\n` +
            `Paid: ${summaryPaidAllCount}\n` +
            `Unpaid: ${summaryNotPaidAllCount}\n\n` +
            `Payment Details:\n${studentLines}\n\n` +
            `Reset triggered at: ${new Date().toLocaleString()}`;
    };

    const sendWeekdayTelegramNotification = async (message: string) => {
        const response = await fetch('/api/telegram-reminder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message }),
        });

        if (!response.ok) {
            throw new Error('Failed to send Telegram notification.');
        }
    };

    const handleResetTotal = async () => {
        if (rows.length === 0) {
            alert('No weekday payment rows found for this month.');
            return;
        }

        if (!confirm(`Send ${getReadableMonth(selectedMonth)} weekday payment summary and reset all paid statuses for this month?`)) {
            return;
        }

        try {
            setIsResetting(true);

            await sendWeekdayTelegramNotification(buildMonthlySummaryMessage());

            const paidPaymentIds = payments
                .filter((payment) => payment.payment_month === selectedMonth && payment.paid)
                .map((payment) => payment.id);

            if (paidPaymentIds.length > 0) {
                const { error } = await supabase
                    .from('weekday_payments')
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
            alert(err?.message || 'Failed to reset weekday payment total.');
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
            alert('No paid weekday payment found to undo for this month.');
            return;
        }

        const matchingStudent = students.find((student) => student.id === latestPaidPayment.weekday_student_id);
        const studentName = matchingStudent?.student_name || 'Unknown student';

        const studentPaidRows = payments.filter(
            (payment) =>
                payment.weekday_student_id === latestPaidPayment.weekday_student_id &&
                payment.payment_month === selectedMonth &&
                payment.paid
        );

        const paidDays = studentPaidRows
            .map((payment) => payment.day_name)
            .filter(Boolean)
            .join(', ');

        const totalUndoAmount = studentPaidRows.reduce(
            (sum, payment) => sum + Number(payment.amount || 0),
            0
        );

        if (!confirm(`Undo latest weekday payment for ${studentName} (${getReadableMonth(selectedMonth)})?\n\nThis will set all paid weekday rows for this student back to unpaid.\n\nDays: ${paidDays || 'None'}`)) {
            return;
        }

        try {
            setIsUndoing(true);

            const { data, error } = await supabase
                .from('weekday_payments')
                .update({
                    paid: false,
                    updated_at: new Date().toISOString(),
                })
                .eq('weekday_student_id', latestPaidPayment.weekday_student_id)
                .eq('payment_month', selectedMonth)
                .eq('paid', true)
                .select('*');

            if (error) throw error;

            const updatedPayments = (data || []) as WeekdayPayment[];

            setPayments((prev) =>
                prev.map((payment) => {
                    const updatedPayment = updatedPayments.find((item) => item.id === payment.id);
                    return updatedPayment || payment;
                })
            );

            const message =
                `↩️ Weekday Payment Undone ↩️\n\n` +
                `Student: ${studentName}\n` +
                `Month: ${getReadableMonth(selectedMonth)}\n` +
                `Days Undone: ${paidDays || 'None'}\n` +
                `Amount: -S$${totalUndoAmount.toFixed(2)}\n` +
                `Status: Unpaid\n` +
                `Recorded At: ${new Date().toLocaleString()}`;

            await sendWeekdayTelegramNotification(message);

            setLastUpdated(`Undid all weekday payment rows for ${studentName}.`);
        } catch (err: any) {
            alert(err?.message || 'Failed to undo latest weekday payment.');
            await loadData();
        } finally {
            setIsUndoing(false);
        }
    };

    const setStudentMonthPaid = async (studentId: string, paid: boolean) => {
        const targetRows = rows.filter((row) => row.student.id === studentId);

        if (targetRows.length === 0) {
            alert('No weekday sessions found for this student.');
            return;
        }

        try {
            const now = new Date().toISOString();

            const payload = targetRows.map((row) => ({
                weekday_student_id: row.student.id,
                payment_month: selectedMonth,
                day_name: row.schedule.day,
                paid,
                scheduled_hours: row.scheduledMonthlyHours,
                manual_hours: row.payment?.manual_hours ?? null,
                amount: row.amount,
                updated_at: now,
            }));

            const { data, error } = await supabase
                .from('weekday_payments')
                .upsert(payload, { onConflict: 'weekday_student_id,payment_month,day_name' })
                .select('*');

            if (error) throw error;

            const savedPayments = (data || []) as WeekdayPayment[];

            setPayments((prev) => {
                const savedKeySet = new Set(
                    savedPayments.map((payment) =>
                        `${payment.weekday_student_id}-${payment.payment_month}-${payment.day_name}`
                    )
                );

                const unchanged = prev.filter((payment) =>
                    !savedKeySet.has(`${payment.weekday_student_id}-${payment.payment_month}-${payment.day_name}`)
                );

                return [...unchanged, ...savedPayments];
            });

            const studentName = targetRows[0]?.student.student_name || 'Student';
            setLastUpdated(`${studentName} marked as ${paid ? 'Paid' : 'Unpaid'} at ${new Date().toLocaleString()}`);
        } catch (err: any) {
            alert(err?.message || 'Failed to update student weekday payment status.');
            await loadData();
        }
    };

    const upsertPayment = async (
        studentId: string,
        day: WeekdayName,
        patch: Partial<Pick<WeekdayPayment, 'paid' | 'manual_hours'>>,
        scheduledHours: number,
        rate: number
    ) => {
        const existing = getPayment(studentId, day);
        const manualHours = patch.manual_hours ?? existing?.manual_hours ?? null;
        const payableHours = Number(manualHours ?? scheduledHours);
        const amount = payableHours * rate;

        try {
            const { data, error } = await supabase
                .from('weekday_payments')
                .upsert(
                    {
                        weekday_student_id: studentId,
                        payment_month: selectedMonth,
                        day_name: day,
                        paid: patch.paid ?? existing?.paid ?? false,
                        scheduled_hours: scheduledHours,
                        manual_hours: manualHours,
                        amount,
                        updated_at: new Date().toISOString(),
                    },
                    { onConflict: 'weekday_student_id,payment_month,day_name' }
                )
                .select('*')
                .single();

            if (error) throw error;

            const savedPayment = data as WeekdayPayment;
            setPayments((prev) => {
                const exists = prev.some((p) => p.id === savedPayment.id);
                if (exists) {
                    return prev.map((p) => (p.id === savedPayment.id ? savedPayment : p));
                }

                return [...prev, savedPayment];
            });

            setLastUpdated(`Updated at ${new Date().toLocaleString()}`);
        } catch (err: any) {
            alert(err?.message || 'Failed to update weekday payment.');
            await loadData();
        }
    };

    if (userRole !== 'superuser') {
        return (
            <div className="container" style={{ padding: '3rem 1rem' }}>
                <div className="form-card" style={{ maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
                    <h1 style={{ color: '#dc2626' }}>403</h1>
                    <p>Only superusers can access weekday payments.</p>
                    <Link href="/dashboard" className="btn share-btn">Back to Dashboard</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            <AppHeader title="Weekday Payment" userName={userName} userRole={userRole} mode="dashboard" />

            <main>
                <div className="search-box">
                    <input
                        type="text"
                        placeholder="Search by student, day, amount, paid/unpaid..."
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
                                    value={paymentFilter}
                                    onChange={(event) => setPaymentFilter(event.target.value as PaymentFilter)}
                                    className="filter-input"
                                >
                                    <option value="all">All</option>
                                    <option value="paid">Paid Only</option>
                                    <option value="unpaid">Unpaid Only</option>
                                </select>
                            </label>
                        </div>
                    </div>
                    <div className="filter-buttons">
                        <button type="button" className="filter-button" onClick={loadData}>Refresh</button>
                    </div>
                </div>

                <div className="payment-summary">
                    <div className="summary-card">
                        <h3>Weekday Payments Collected</h3>
                        <p className="amount">S${totalCollected.toFixed(2)}</p>
                        <p className="timestamp">Month: {getReadableMonth(selectedMonth)}</p>
                        <p className="timestamp">
                            Paid: {summaryPaidAllCount} · Unpaid: {summaryNotPaidAllCount} · Possible Total: S${possibleTotal.toFixed(2)}
                        </p>
                        <p className="timestamp">
                            Total Sessions: {totalSessions} · Total Payable Hours: {totalPayableHours.toFixed(2).replace(/\.00$/, '')}h
                        </p>
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
                {loading && <p className="muted">Loading weekday payments...</p>}

                {!loading && groupedRows.map((group) => (
                    <section key={group.day} style={{ marginTop: 22 }}>
                        <h2>{group.day}</h2>

                        {group.rows.length === 0 ? (
                            <p className="muted">No payment rows found for {group.day}.</p>
                        ) : (
                            <div className="table-container">
                                <div className="table-scroll">
                                    <table>
                                        <thead>
                                        <tr>
                                            <th>Name</th>
                                            <th>Sessions This Month</th>
                                            <th>Default Monthly Hours</th>
                                            <th>Payable Hours</th>
                                            <th>Rate</th>
                                            <th>Amount</th>
                                        </tr>
                                        </thead>
                                        <tbody>
                                        {group.rows.map((row) => (
                                            <tr key={`${row.student.id}-${row.schedule.day}`}>
                                                <td>{row.student.student_name}</td>
                                                <td>{row.occurrences}</td>
                                                <td>{row.scheduledMonthlyHours.toFixed(2).replace(/\.00$/, '')}h</td>
                                                <td>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                        <input
                                                            className="weeks-input"
                                                            type="number"
                                                            min="0"
                                                            step="0.25"
                                                            value={row.payableHours}
                                                            onChange={(event) =>
                                                                upsertPayment(
                                                                    row.student.id,
                                                                    row.schedule.day,
                                                                    { manual_hours: Number(event.target.value) },
                                                                    row.scheduledMonthlyHours,
                                                                    row.rate
                                                                )
                                                            }
                                                        />
                                                        <strong>h</strong>
                                                    </div>
                                                </td>
                                                <td>S${row.rate.toFixed(2)}/h</td>
                                                <td>S${row.amount.toFixed(2)}</td>
                                            </tr>
                                        ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </section>
                ))}

                {!loading && rows.length > 0 && (
                    <section style={{ marginTop: 30 }}>
                        <div
                            className="summary-card"
                            style={{
                                marginBottom: 14,
                                border: '1px solid #dbeafe',
                                background: '#f8fbff',
                            }}
                        >
                            <h2 style={{ marginTop: 0 }}>Monthly Weekday Payment Summary</h2>
                            <p className="timestamp">
                                This combines Monday, Wednesday, and Thursday into one monthly total per student.
                            </p>
                            <p className="timestamp">
                                Paid: {summaryPaidAllCount} · Unpaid: {summaryNotPaidAllCount}
                            </p>
                        </div>

                        <div className="table-container">
                            <div className="table-scroll">
                                <table>
                                    <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Days</th>
                                        <th>Total Sessions</th>
                                        <th>Default Monthly Hours</th>
                                        <th>Payable Hours</th>
                                        <th>Total Amount</th>
                                        <th>Paid</th>
                                    </tr>
                                    </thead>
                                    <tbody>
                                    {monthlySummaryRows.map((summary) => (
                                        <tr key={summary.studentName}>
                                            <td>{summary.studentName}</td>
                                            <td>{summary.days.join(', ')}</td>
                                            <td>{summary.sessions}</td>
                                            <td>{summary.scheduledHours.toFixed(2).replace(/\.00$/, '')}h</td>
                                            <td>{summary.payableHours.toFixed(2).replace(/\.00$/, '')}h</td>
                                            <td><strong>S${summary.amount.toFixed(2)}</strong></td>
                                            <td>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={summary.isPaidAll}
                                                        onChange={(event) => setStudentMonthPaid(summary.studentId, event.target.checked)}
                                                        disabled={loading}
                                                    />
                                                    {summary.isPaidAll ? 'Paid' : 'Unpaid'}
                                                </label>
                                            </td>
                                        </tr>
                                    ))}

                                    <tr>
                                        <td><strong>Monthly Total</strong></td>
                                        <td>-</td>
                                        <td><strong>{totalSessions}</strong></td>
                                        <td>-</td>
                                        <td><strong>{totalPayableHours.toFixed(2).replace(/\.00$/, '')}h</strong></td>
                                        <td><strong>S${possibleTotal.toFixed(2)}</strong></td>
                                        <td>
                                            <strong>
                                                Collected: S${totalCollected.toFixed(2)}
                                            </strong>
                                        </td>
                                    </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </section>
                )}
            </main>
        </div>
    );
}
