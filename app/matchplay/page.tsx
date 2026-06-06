'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import AppHeader from './../components/AppHeader';
import './../styles.css';
import './../dashboard/dashboard.css';

type UserRole = 'superuser' | 'admin' | 'member';

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const getUserRole = (user: any): UserRole => {
    return (user?.app_metadata?.role || user?.user_metadata?.role || 'member') as UserRole;
};

export default function MatchPlayPage() {
    const router = useRouter();
    const [userName, setUserName] = useState('');
    const [userRole, setUserRole] = useState<UserRole | null>(null);

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
            <AppHeader title="MatchPlay" userName={userName} userRole={userRole} mode="dashboard" />

            <main>
                <div className="form-card" style={{ maxWidth: 760, margin: '24px auto', padding: 24 }}>
                    <h2 style={{ marginTop: 0 }}>MatchPlay</h2>
                    <p className="muted">Manage MatchPlay students, attendance, and monthly payments.</p>

                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 18 }}>
                        <Link href="/matchplay/add" className="btn share-btn">Add MatchPlay Student</Link>
                        <Link href="/matchplay/attendance" className="btn share-btn">MatchPlay Attendance</Link>
                        {userRole === 'superuser' && (
                            <Link href="/matchplay/payment" className="btn share-btn">MatchPlay Payment</Link>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
}
