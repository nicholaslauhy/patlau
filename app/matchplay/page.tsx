'use client';

import { useEffect, useState } from 'react';
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

            const role = (user.app_metadata?.role || user.user_metadata?.role || 'member') as UserRole;
            setUserRole(role);
            setUserName(user.user_metadata?.name || user.email || 'User');
        };

        checkAuth();
    }, [router]);

    return (
        <div className="container">
            <AppHeader title="MatchPlay" userName={userName} userRole={userRole} mode="dashboard" />

            <main>
                <div className="form-card" style={{ maxWidth: 720, margin: '0 auto' }}>
                    <h2>MatchPlay</h2>
                    <p className="muted">
                        Placeholder page added so the MatchPlay header button has a route. Implementation can be filled in once the MatchPlay requirements are confirmed.
                    </p>
                </div>
            </main>
        </div>
    );
}
