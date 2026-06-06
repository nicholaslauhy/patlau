'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';
import AppHeader from './../../components/AppHeader';
import './../../styles.css';
import './../../dashboard/dashboard.css';

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type UserRole = 'superuser' | 'admin' | 'member';

const DEFAULT_WEEKS = 4;
const DEFAULT_PRICE_PER_SESSION = 80;

const getUserRole = (user: any): UserRole => {
    return (user?.app_metadata?.role || user?.user_metadata?.role || 'member') as UserRole;
};

export default function AddMatchPlayStudentPage() {
    const router = useRouter();
    const [userName, setUserName] = useState('');
    const [userRole, setUserRole] = useState<UserRole | null>(null);
    const [studentName, setStudentName] = useState('');
    const [numberOfWeeks, setNumberOfWeeks] = useState(DEFAULT_WEEKS);
    const [pricePerSession, setPricePerSession] = useState(DEFAULT_PRICE_PER_SESSION);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');

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

    const estimatedAmount = useMemo(() => {
        return (Number(numberOfWeeks) || 0) * (Number(pricePerSession) || 0);
    }, [numberOfWeeks, pricePerSession]);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError('');

        if (!studentName.trim()) {
            setError('Student name is required.');
            return;
        }

        if ((Number(numberOfWeeks) || 0) <= 0) {
            setError('Number of weeks must be more than 0.');
            return;
        }

        if ((Number(pricePerSession) || 0) <= 0) {
            setError('Price per session must be more than 0.');
            return;
        }

        try {
            setIsSubmitting(true);

            const { error: insertError } = await supabase
                .from('matchplay_students')
                .insert({
                    student_name: studentName.trim(),
                    number_of_weeks: Number(numberOfWeeks),
                    price_per_session: Number(pricePerSession),
                    active: true,
                    updated_at: new Date().toISOString(),
                });

            if (insertError) throw insertError;

            router.push('/matchplay/attendance');
        } catch (err: any) {
            setError(err?.message || 'Failed to add MatchPlay student.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleForbiddenLogout = async () => {
        await supabase.auth.signOut();
        router.push('/');
    };


    if (userRole !== 'superuser') {
        return (
            <div className="container" style={{ padding: '3rem 1rem' }}>
                <div className="form-card" style={{ maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>
                    <h1 style={{ color: '#dc2626', fontSize: '3rem', marginBottom: '0.5rem' }}>403</h1>
                    <h2 style={{ marginTop: 0 }}>Forbidden</h2>
                    <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>
                        You do not have permission to access MatchPlay. Please return to the dashboard or logout.
                    </p>
                    <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                        <Link href="/dashboard" className="btn share-btn">Return to Dashboard</Link>
                        <button type="button" className="btn share-btn logout" onClick={handleForbiddenLogout}>
                            Logout
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            <AppHeader title="Add MatchPlay Student" userName={userName} userRole={userRole} mode="dashboard" />

            <main>
                <form
                    onSubmit={handleSubmit}
                    className="form-card"
                    style={{ maxWidth: 760, margin: '24px auto', padding: 24 }}
                >
                    <h2 style={{ marginTop: 0 }}>MatchPlay Student Details</h2>
                    <p className="muted" style={{ marginTop: -6 }}>
                        Add a MatchPlay student with their number of weeks and price per session.
                    </p>

                    {error && <div className="error-message" style={{ marginBottom: 16 }}>{error}</div>}

                    <div className="form-group">
                        <label htmlFor="studentName">Name</label>
                        <input
                            id="studentName"
                            className="form-input"
                            value={studentName}
                            onChange={(event) => setStudentName(event.target.value)}
                            placeholder="Student name"
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="numberOfWeeks">Number of Weeks</label>
                        <input
                            id="numberOfWeeks"
                            className="form-input"
                            type="number"
                            min="1"
                            step="1"
                            value={numberOfWeeks}
                            onChange={(event) => setNumberOfWeeks(Number(event.target.value))}
                        />
                        <small className="muted">Default is {DEFAULT_WEEKS} weeks.</small>
                    </div>

                    <div className="form-group">
                        <label htmlFor="pricePerSession">Price Per Session (S$)</label>
                        <input
                            id="pricePerSession"
                            className="form-input"
                            type="number"
                            min="0"
                            step="0.01"
                            value={pricePerSession}
                            onChange={(event) => setPricePerSession(Number(event.target.value))}
                        />
                        <small className="muted">Default is S${DEFAULT_PRICE_PER_SESSION} per session, but it can differ by student.</small>
                    </div>

                    <div
                        style={{
                            marginTop: 20,
                            padding: 16,
                            borderRadius: 14,
                            background: '#eff6ff',
                            border: '1px solid #bfdbfe',
                            display: 'grid',
                            gap: 6,
                        }}
                    >
                        <strong>Estimated Payment</strong>
                        <span>{Number(numberOfWeeks) || 0} weeks × S${(Number(pricePerSession) || 0).toFixed(2)}</span>
                        <span>Total: S${estimatedAmount.toFixed(2)}</span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 22 }}>
                        <Link href="/matchplay/attendance" className="btn share-btn">Cancel</Link>
                        <button type="submit" className="btn share-btn" disabled={isSubmitting}>
                            {isSubmitting ? 'Adding...' : 'Add MatchPlay Student'}
                        </button>
                    </div>
                </form>
            </main>
        </div>
    );
}
