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
    makeup_usages?: {
        target_training_type: string;
        target_date: string;
        target_label: string;
        credit_value_used: number;
        target_value: number;
    };
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

const money = (value: number) => `S$${Number(value || 0).toFixed(2)}`;

export default function MakeupPaymentPage() {
    const router = useRouter();
    const [userRole, setUserRole] = useState<UserRole | null>(null);
    const [userName, setUserName] = useState('');
    const [payments, setPayments] = useState<MakeupTopupPayment[]>([]);
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');

    useEffect(() => {
        const checkAuth = async () => {
            try {
                const { data: { user }, error } = await supabase.auth.getUser();

                if (error || !user) {
                    await supabase.auth.signOut();
                    router.push('/');
                    return;
                }

                const role = getUserRole(user);
                setUserRole(role);
                setUserName(user.user_metadata?.name || user.email || 'User');
            } catch {
                await supabase.auth.signOut();
                router.push('/');
            }
        };

        checkAuth();
    }, [router]);

    const loadPayments = async () => {
        try {
            setLoading(true);
            setMessage('');

            const { data, error } = await supabase
                .from('makeup_topup_payments')
                .select('*, master_students(*), makeup_usages(*)')
                .eq('payment_month', selectedMonth)
                .order('created_at', { ascending: false });

            if (error) throw error;

            setPayments((data || []) as MakeupTopupPayment[]);
        } catch (err: any) {
            setMessage(err?.message || 'Failed to load makeup top-up payments.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (userRole === 'superuser') {
            loadPayments();
        }
    }, [userRole, selectedMonth]);

    const rows = useMemo(() => {
        const normalizedSearch = searchTerm.trim().toLowerCase();

        return payments.filter((payment) => {
            const searchable = [
                payment.master_students?.display_name,
                payment.makeup_usages?.target_training_type,
                payment.makeup_usages?.target_label,
                money(payment.amount),
                payment.paid ? 'paid' : 'unpaid',
            ].join(' ').toLowerCase();

            return !normalizedSearch || searchable.includes(normalizedSearch);
        });
    }, [payments, searchTerm]);

    const totalPaid = payments.filter((p) => p.paid).reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const totalUnpaid = payments.filter((p) => !p.paid).reduce((sum, p) => sum + Number(p.amount || 0), 0);

    const updatePaid = async (paymentId: string, paid: boolean) => {
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

            setPayments((prev) => prev.map((payment) => payment.id === paymentId ? data as MakeupTopupPayment : payment));
        } catch (err: any) {
            alert(err?.message || 'Failed to update payment.');
            await loadPayments();
        }
    };

    const handleForbiddenLogout = async () => {
        await supabase.auth.signOut();
        router.push('/');
    };

    if (userRole === null) {
        return (
            <div className="container" style={{ padding: '3rem 1rem' }}>
                <div className="form-card" style={{ maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
                    <p className="muted">Checking access...</p>
                </div>
            </div>
        );
    }

    if (userRole !== 'superuser') {
        return (
            <div className="container" style={{ padding: '3rem 1rem' }}>
                <div className="form-card" style={{ maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>
                    <h1 style={{ color: '#dc2626', fontSize: '3rem', marginBottom: '0.5rem' }}>403</h1>
                    <h2 style={{ marginTop: 0 }}>Forbidden</h2>
                    <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>Only superusers can access Makeup Payment.</p>
                    <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                        <Link href="/dashboard" className="btn share-btn">Return to Dashboard</Link>
                        <button type="button" className="btn share-btn logout" onClick={handleForbiddenLogout}>Logout</button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            <AppHeader title="Makeup Payment" userName={userName} userRole={userRole} mode="dashboard" />

            <main style={{ padding: '24px 16px 48px' }}>
                <section className="form-card" style={{ maxWidth: 1120, margin: '0 auto', padding: 24 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <div>
                            <h1 style={{ margin: 0 }}>Makeup Top-up Payments</h1>
                            <p className="muted" style={{ marginTop: 8 }}>
                                Top-ups are created when a student uses a lower-value missed lesson to make up into a higher-value lesson.
                            </p>
                        </div>

                        <Link href="/makeup" className="btn share-btn">Back to Makeup Credits</Link>
                    </div>

                    {message && <div className="error-message" style={{ marginTop: 16 }}>{message}</div>}

                    <div className="payment-summary" style={{ marginTop: 20 }}>
                        <div className="summary-card">
                            <h3>{getReadableMonth(selectedMonth)} Makeup Top-ups</h3>
                            <p className="amount">{money(totalPaid)}</p>
                            <p className="timestamp">Unpaid: {money(totalUnpaid)} · Paid: {money(totalPaid)}</p>
                        </div>
                    </div>

                    <div className="filter-box">
                        <div className="filter-grid">
                            <label className="filter-label">
                                Month
                                <input type="month" className="filter-input" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} />
                            </label>

                            <label className="filter-label">
                                Search
                                <input className="filter-input" placeholder="Student, target, amount..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                            </label>
                        </div>

                        <div className="filter-buttons">
                            <button type="button" className="filter-button" onClick={loadPayments} disabled={loading}>
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
                                                <strong>{payment.makeup_usages?.target_training_type}</strong>
                                                <br />
                                                <span className="muted">{payment.makeup_usages?.target_date} · {payment.makeup_usages?.target_label}</span>
                                            </td>
                                            <td>{money(Number(payment.makeup_usages?.credit_value_used || 0))}</td>
                                            <td>{money(Number(payment.makeup_usages?.target_value || 0))}</td>
                                            <td><strong>{money(payment.amount)}</strong></td>
                                            <td>
                                                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 700 }}>
                                                    <input type="checkbox" checked={payment.paid} onChange={(e) => updatePaid(payment.id, e.target.checked)} />
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
