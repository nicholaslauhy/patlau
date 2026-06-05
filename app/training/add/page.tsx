'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import AppHeader from './../../components/AppHeader';
import './../../styles.css';
import './../../dashboard/dashboard.css';
import './../../add/add.css';

type UserRole = 'superuser' | 'admin' | 'member';

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function AddOneToOneStudentPage() {
    const router = useRouter();
    const [userName, setUserName] = useState('');
    const [userRole, setUserRole] = useState<UserRole | null>(null);
    const [studentName, setStudentName] = useState('');
    const [paymentAmount, setPaymentAmount] = useState<number | ''>(80);
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (!studentName.trim()) {
            setError('Student name is required.');
            return;
        }

        const amount = Number(paymentAmount);
        if (!amount || amount <= 0) {
            setError('Payment amount must be more than 0.');
            return;
        }

        try {
            setIsSubmitting(true);

            const { error: insertError } = await supabase
                .from('one_to_one_students')
                .insert({
                    student_name: studentName.trim(),
                    payment_amount: amount,
                    active: true,
                    updated_at: new Date().toISOString()
                });

            if (insertError) throw insertError;

            router.push('/training');
        } catch (err: any) {
            setError(err?.message || 'Failed to add 1-1 student.');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (userRole === 'member') {
        return (
            <div className="container" style={{ padding: '3rem 1rem' }}>
                <div className="form-card" style={{ maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
                    <h1 style={{ color: '#dc2626' }}>403</h1>
                    <p>Only superusers and admins can add 1-1 students.</p>
                    <Link href="/dashboard" className="btn share-btn">Go to Dashboard</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            <AppHeader title="Add 1-1 Student" userName={userName} userRole={userRole} mode="dashboard" />

            <main>
                <div className="form-card" style={{ maxWidth: 720, margin: '0 auto' }}>
                    <h2>Add 1-1 Student</h2>
                    <p className="muted">
                        This is separate from the weekend students database. These students will appear in the 1-1 Training dropdown.
                    </p>

                    {error && <div className="error-message">{error}</div>}

                    <form onSubmit={handleSubmit}>
                        <div className="form-group">
                            <label htmlFor="studentName">Name</label>
                            <input
                                id="studentName"
                                className="form-input"
                                value={studentName}
                                onChange={(e) => setStudentName(e.target.value)}
                                placeholder="Student name"
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="paymentAmount">Payment Amount (S$)</label>
                            <input
                                id="paymentAmount"
                                className="form-input"
                                type="number"
                                min="0"
                                step="0.01"
                                value={paymentAmount}
                                onChange={(e) => setPaymentAmount(e.target.value === '' ? '' : Number(e.target.value))}
                                placeholder="80"
                            />
                        </div>

                        <button className="login-btn" type="submit" disabled={isSubmitting}>
                            {isSubmitting ? 'Adding...' : 'Add 1-1 Student'}
                        </button>
                    </form>
                </div>
            </main>
        </div>
    );
}
