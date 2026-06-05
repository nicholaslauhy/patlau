'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import AppHeader from './../../components/AppHeader';
import './../../styles.css';
import './../../dashboard/dashboard.css';
import './../../payment/payment.css';

type UserRole = 'superuser' | 'admin' | 'member';
type PaymentFilter = 'all' | 'paid' | 'unpaid';

interface WeekdaySchedule {
    day: 'Monday' | 'Wednesday' | 'Thursday';
    duration: number;
}

interface WeekdayStudent {
    id: string;
    student_name: string;
    schedules: WeekdaySchedule[];
    total_payment_amount: number;
    hourly_rate: number;
    active: boolean;
}

interface WeekdayPayment {
    id: number;
    weekday_student_id: string;
    payment_month: string;
    paid: boolean;
    amount: number;
    created_at: string;
    updated_at?: string;
}

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const getReadableMonth = (monthValue: string) => {
    const [year, month] = monthValue.split('-').map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric'
    });
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

    useEffect(() => {
        const checkAuth = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.push('/');
                return;
            }

            const role = (user.app_metadata?.role || user.user_metadata?.role || 'member') as UserRole;
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
                .select('id, student_name, schedules, total_payment_amount, hourly_rate, active')
                .eq('active', true)
                .order('student_name', { ascending: true });

            if (studentError) throw studentError;

            const { data: paymentData, error: paymentError } = await supabase
                .from('weekday_payments')
                .select('*')
                .eq('payment_month', selectedMonth);

            if (paymentError) throw paymentError;

            setStudents((studentData || []) as WeekdayStudent[]);
            setPayments((paymentData || []) as WeekdayPayment[]);
        } catch (err: any) {
            console.error(err);
            setMessage(err?.message || 'Failed to load weekday payment data.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [selectedMonth]);

    const getPayment = (studentId: string) => {
        return payments.find(payment => payment.weekday_student_id === studentId);
    };

    const savePayment = async (student: WeekdayStudent, paid: boolean) => {
        try {
            const amount = Number(student.total_payment_amount || 0);
            const now = new Date().toISOString();

            const { data, error } = await supabase
                .from('weekday_payments')
                .upsert(
                    {
                        weekday_student_id: student.id,
                        payment_month: selectedMonth,
                        paid,
                        amount,
                        updated_at: now
                    },
                    { onConflict: 'weekday_student_id,payment_month' }
                )
                .select('*')
                .single();

            if (error) throw error;

            const savedPayment = data as WeekdayPayment;

            setPayments(prev => {
                const exists = prev.some(payment => payment.weekday_student_id === student.id && payment.payment_month === selectedMonth);
                if (exists) {
                    return prev.map(payment =>
                        payment.weekday_student_id === student.id && payment.payment_month === selectedMonth ? savedPayment : payment
                    );
                }
                return [...prev, savedPayment];
            });

            setLastUpdated(`${student.student_name} marked as ${paid ? 'paid' : 'unpaid'} at ${new Date().toLocaleString()}`);
        } catch (err: any) {
            alert(err?.message || 'Failed to update weekday payment.');
            await loadData();
        }
    };

    const sendMonthlySummary = async () => {
        const paidStudents = students.filter(student => getPayment(student.id)?.paid ?? false);
        const unpaidStudents = students.filter(student => !(getPayment(student.id)?.paid ?? false));
        const totalCollected = paidStudents.reduce((sum, student) => sum + Number(student.total_payment_amount || 0), 0);
        const possibleTotal = students.reduce((sum, student) => sum + Number(student.total_payment_amount || 0), 0);

        const messageText =
            `📊 Weekday Payment Summary 📊\n\n` +
            `Month: ${getReadableMonth(selectedMonth)}\n` +
            `Total Collected: S$${totalCollected.toFixed(2)}\n` +
            `Paid Students: ${paidStudents.length}\n` +
            `Unpaid Students: ${unpaidStudents.length}\n` +
            `Possible Total: S$${possibleTotal.toFixed(2)}\n\n` +
            `Paid:\n${paidStudents.length ? paidStudents.map(student => `- ${student.student_name}: S$${Number(student.total_payment_amount || 0).toFixed(2)}`).join('\n') : '- None'}\n\n` +
            `Unpaid:\n${unpaidStudents.length ? unpaidStudents.map(student => `- ${student.student_name}: S$${Number(student.total_payment_amount || 0).toFixed(2)}`).join('\n') : '- None'}`;

        const response = await fetch('/api/telegram-reminder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: messageText })
        });

        if (!response.ok) throw new Error('Failed to send Telegram summary.');
    };

    const resetMonth = async () => {
        if (!confirm(`Send ${getReadableMonth(selectedMonth)} weekday payment summary and reset paid statuses?`)) {
            return;
        }

        try {
            await sendMonthlySummary();

            const paidPaymentIds = payments.filter(payment => payment.paid).map(payment => payment.id);
            if (paidPaymentIds.length > 0) {
                const { error } = await supabase
                    .from('weekday_payments')
                    .update({ paid: false, updated_at: new Date().toISOString() })
                    .in('id', paidPaymentIds);

                if (error) throw error;
            }

            await loadData();
            setLastUpdated('Weekday payment summary sent and statuses reset.');
        } catch (err: any) {
            alert(err?.message || 'Failed to reset weekday payments.');
        }
    };

    const undoLatest = async () => {
        const latestPaid = payments
            .filter(payment => payment.paid)
            .sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime())[0];

        if (!latestPaid) {
            alert('No paid weekday payment found to undo.');
            return;
        }

        try {
            const { error } = await supabase
                .from('weekday_payments')
                .update({ paid: false, updated_at: new Date().toISOString() })
                .eq('id', latestPaid.id);

            if (error) throw error;

            await loadData();
            setLastUpdated('Latest weekday payment was undone.');
        } catch (err: any) {
            alert(err?.message || 'Failed to undo latest weekday payment.');
        }
    };

    const filteredStudents = useMemo(() => {
        const normalizedSearch = searchTerm.trim().toLowerCase();

        return students.filter(student => {
            const paid = getPayment(student.id)?.paid ?? false;
            const matchesSearch = !normalizedSearch || student.student_name.toLowerCase().includes(normalizedSearch);
            const matchesPaymentFilter =
                paymentFilter === 'all' ||
                (paymentFilter === 'paid' && paid) ||
                (paymentFilter === 'unpaid' && !paid);

            return matchesSearch && matchesPaymentFilter;
        });
    }, [students, payments, searchTerm, paymentFilter]);

    const paidStudents = students.filter(student => getPayment(student.id)?.paid ?? false);
    const totalCollected = paidStudents.reduce((sum, student) => sum + Number(student.total_payment_amount || 0), 0);
    const possibleTotal = students.reduce((sum, student) => sum + Number(student.total_payment_amount || 0), 0);

    if (userRole !== 'superuser') {
        return (
            <div className="container" style={{ padding: '3rem 1rem' }}>
                <div className="form-card" style={{ maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
                    <h1 style={{ color: '#dc2626' }}>403</h1>
                    <p>Only superusers can access weekday payment.</p>
                    <Link href="/dashboard" className="btn share-btn">Go to Dashboard</Link>
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
                        placeholder="Search weekday student..."
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
                        <button onClick={() => { setSearchTerm(''); setPaymentFilter('all'); }} className="filter-button secondary">
                            Clear Filters
                        </button>
                        <button onClick={loadData} className="filter-button">
                            Refresh
                        </button>
                    </div>
                </div>

                <div className="payment-summary">
                    <div className="summary-card">
                        <h3>Weekday Payments Collected</h3>
                        <p className="amount">S${totalCollected.toFixed(2)}</p>
                        <p className="timestamp">Monthly Tracking Period: {getReadableMonth(selectedMonth)}</p>
                        <p className="timestamp">
                            Paid: {paidStudents.length} · Unpaid: {students.length - paidStudents.length} · Possible Total: S${possibleTotal.toFixed(2)}
                        </p>
                        {lastUpdated && <p className="timestamp">{lastUpdated}</p>}

                        <div className="payment-actions">
                            <button className="payment-action-btn danger" onClick={resetMonth}>Reset Total</button>
                            <button className="payment-action-btn warning" onClick={undoLatest}>Undo Add</button>
                        </div>
                    </div>
                </div>

                <div className="search-results-display">
                    {message && <p className="dashboard-error-message">{message}</p>}
                    {loading && <p>Loading weekday payments...</p>}

                    {!loading && !message && filteredStudents.length === 0 && (
                        <p>No weekday payment records found.</p>
                    )}

                    {!loading && !message && filteredStudents.length > 0 && (
                        <div className="table-container">
                            <div className="table-scroll">
                                <table>
                                    <thead>
                                    <tr>
                                        <th>Student</th>
                                        <th>Schedule</th>
                                        <th>Payment Amount</th>
                                        <th>Payment Status</th>
                                    </tr>
                                    </thead>
                                    <tbody>
                                    {filteredStudents.map(student => {
                                        const payment = getPayment(student.id);
                                        const isPaid = payment?.paid ?? false;
                                        const scheduleText = student.schedules
                                            .map(schedule => `${schedule.day}: ${schedule.duration}h`)
                                            .join(', ');

                                        return (
                                            <tr key={student.id}>
                                                <td>{student.student_name}</td>
                                                <td>{scheduleText}</td>
                                                <td>S${Number(student.total_payment_amount || 0).toFixed(2)}</td>
                                                <td>
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={isPaid}
                                                            onChange={(e) => savePayment(student, e.target.checked)}
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
