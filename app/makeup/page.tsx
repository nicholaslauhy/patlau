'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import AppHeader from './../components/AppHeader';
import './../styles.css';
import './../dashboard/dashboard.css';

type UserRole = 'superuser' | 'admin' | 'member';
type TrainingType = 'weekend' | 'one_to_one' | 'weekday' | 'matchplay';
type CreditStatus = 'available' | 'used' | 'void';

interface MasterStudent {
    id: string;
    display_name: string;
}

interface MakeupCredit {
    id: string;
    master_student_id: string;
    source_training_type: TrainingType;
    source_date: string;
    source_label: string;
    credit_value: number;
    credit_hours: number | null;
    status: CreditStatus;
    created_at: string;
    master_students?: MasterStudent;
}

interface MakeupUsage {
    id: string;
    master_student_id: string;
    target_training_type: TrainingType;
    target_date: string;
    target_label: string;
    target_value: number;
    credit_value_used: number;
    top_up_amount: number;
    payment_status: 'not_required' | 'unpaid' | 'paid';
    created_at: string;
    master_students?: MasterStudent;
    makeup_credits?: {
        id: string;
        source_training_type: TrainingType;
        source_date: string;
        source_label: string;
        credit_value: number;
        status: CreditStatus;
    };
}

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const TRAINING_LABELS: Record<TrainingType, string> = {
    weekend: 'Weekend',
    one_to_one: '1-1',
    weekday: 'Weekday',
    matchplay: 'MatchPlay',
};

const getUserRole = (user: any): UserRole => {
    return (user?.app_metadata?.role || user?.user_metadata?.role || 'member') as UserRole;
};

const money = (value: number) => `S$${Number(value || 0).toFixed(2)}`;

const readableDate = (value: string) => {
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
};

export default function MakeupCreditsPage() {
    const router = useRouter();
    const [userRole, setUserRole] = useState<UserRole | null>(null);
    const [userName, setUserName] = useState('');
    const [credits, setCredits] = useState<MakeupCredit[]>([]);
    const [usages, setUsages] = useState<MakeupUsage[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [showUsedVoid, setShowUsedVoid] = useState(false);
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

                setUserRole(getUserRole(user));
                setUserName(user.user_metadata?.name || user.email || 'User');
            } catch {
                await supabase.auth.signOut();
                router.push('/');
            }
        };

        checkAuth();
    }, [router]);

    const loadData = async () => {
        try {
            setLoading(true);
            setMessage('');

            const [{ data: creditData, error: creditError }, { data: usageData, error: usageError }] = await Promise.all([
                supabase
                    .from('makeup_credits')
                    .select('*, master_students(*)')
                    .order('created_at', { ascending: false }),
                supabase
                    .from('makeup_usages')
                    .select('*, master_students(*), makeup_credits(*)')
                    .order('created_at', { ascending: false }),
            ]);

            if (creditError) throw creditError;
            if (usageError) throw usageError;

            setCredits((creditData || []) as MakeupCredit[]);
            setUsages((usageData || []) as MakeupUsage[]);
        } catch (err: any) {
            setMessage(err?.message || 'Failed to load makeup records.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (userRole === 'admin' || userRole === 'superuser') {
            loadData();
        }
    }, [userRole]);

    const availableCredits = useMemo(() => {
        const search = searchTerm.trim().toLowerCase();

        return credits.filter((credit) => {
            if (credit.status !== 'available') return false;

            const searchable = [
                credit.master_students?.display_name,
                TRAINING_LABELS[credit.source_training_type],
                credit.source_label,
                credit.source_date,
                money(credit.credit_value),
            ].join(' ').toLowerCase();

            return !search || searchable.includes(search);
        });
    }, [credits, searchTerm]);

    const historicalCredits = useMemo(() => {
        if (!showUsedVoid) return [];

        const search = searchTerm.trim().toLowerCase();

        return credits.filter((credit) => {
            if (credit.status === 'available') return false;

            const searchable = [
                credit.master_students?.display_name,
                TRAINING_LABELS[credit.source_training_type],
                credit.source_label,
                credit.source_date,
                money(credit.credit_value),
                credit.status,
            ].join(' ').toLowerCase();

            return !search || searchable.includes(search);
        });
    }, [credits, searchTerm, showUsedVoid]);

    const usageByCreditId = useMemo(() => {
        const map = new Map<string, MakeupUsage>();

        for (const usage of usages) {
            const creditId = usage.makeup_credits?.id;
            if (creditId) {
                map.set(creditId, usage);
            }
        }

        return map;
    }, [usages]);

    const recentUsages = useMemo(() => {
        const search = searchTerm.trim().toLowerCase();

        return usages.filter((usage) => {
            const sourceType = usage.makeup_credits?.source_training_type;
            const searchable = [
                usage.master_students?.display_name,
                sourceType ? TRAINING_LABELS[sourceType] : '',
                TRAINING_LABELS[usage.target_training_type],
                usage.target_label,
                usage.target_date,
                money(usage.top_up_amount),
            ].join(' ').toLowerCase();

            return !search || searchable.includes(search);
        });
    }, [usages, searchTerm]);

    const voidCredit = async (creditId: string) => {
        if (!confirm('Void this available makeup credit? Use this only if the missed credit was created by mistake.')) {
            return;
        }

        try {
            const { error } = await supabase
                .from('makeup_credits')
                .update({
                    status: 'void',
                    updated_at: new Date().toISOString(),
                })
                .eq('id', creditId)
                .eq('status', 'available');

            if (error) throw error;

            await loadData();
        } catch (err: any) {
            alert(err?.message || 'Failed to void makeup credit.');
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
                    <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>
                        Only superusers can access the Makeup system.
                    </p>

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
            <AppHeader title="Makeup Credits" userName={userName} userRole={userRole} mode="dashboard" />

            <main className="makeup-page-main">
                <section className="form-card makeup-system-card">
                    <div style={{ textAlign: 'center' }}>
                        <h1 style={{ margin: 0 }}>Global Makeup System</h1>
                        <p className="muted" style={{ margin: '8px auto 0', maxWidth: 780 }}>
                            Credits are created automatically when a lesson is marked Missed. Use the Makeup button inside the relevant attendance page to choose the target programme.
                        </p>

                        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
                            <Link href="/makeup/payment" className="btn share-btn">
                                Makeup Payment
                            </Link>
                        </div>
                    </div>

                    {message && <div className="error-message" style={{ marginTop: 16 }}>{message}</div>}

                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 12,
                            flexWrap: 'wrap',
                            marginTop: 22,
                        }}
                    >
                        <input
                            className="filter-input"
                            placeholder="Search student, source, target, label..."
                            value={searchTerm}
                            onChange={(event) => setSearchTerm(event.target.value)}
                            style={{ minWidth: 280, flex: '1 1 320px' }}
                        />

                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                            <label style={{ display: 'flex', gap: 7, alignItems: 'center', fontWeight: 700 }}>
                                <input
                                    type="checkbox"
                                    checked={showUsedVoid}
                                    onChange={(event) => setShowUsedVoid(event.target.checked)}
                                />
                                Show used/void
                            </label>

                            <button type="button" className="btn share-btn" onClick={loadData} disabled={loading}>
                                Refresh
                            </button>
                        </div>
                    </div>

                    <section style={{ marginTop: 24 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', gap: 12 }}>
                            <div>
                                <h2 style={{ margin: 0 }}>Available Makeup Credits</h2>
                                <p className="muted" style={{ margin: '5px 0 0' }}>
                                    Used credits disappear from this table immediately.
                                </p>
                            </div>
                            <strong>{availableCredits.length} available</strong>
                        </div>

                        <div className="table-container" style={{ marginTop: 14 }}>
                            <div className="table-scroll">
                                <table>
                                    <thead>
                                    <tr>
                                        <th>Student</th>
                                        <th>Missed From</th>
                                        <th>Missed Date</th>
                                        <th>Credit</th>
                                        <th>Action</th>
                                    </tr>
                                    </thead>
                                    <tbody>
                                    {availableCredits.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} style={{ textAlign: 'center', color: '#64748b' }}>
                                                No available makeup credits.
                                            </td>
                                        </tr>
                                    ) : (
                                        availableCredits.map((credit) => (
                                            <tr key={credit.id}>
                                                <td>{credit.master_students?.display_name || 'Unknown student'}</td>
                                                <td>
                                                    <strong>{TRAINING_LABELS[credit.source_training_type]}</strong>
                                                    <br />
                                                    <span className="muted">{credit.source_label}</span>
                                                </td>
                                                <td>{readableDate(credit.source_date)}</td>
                                                <td>
                                                    <strong>{money(credit.credit_value)}</strong>
                                                    {credit.credit_hours ? <div className="muted">{credit.credit_hours}h</div> : null}
                                                </td>
                                                <td>
                                                    <button type="button" className="delete-btn" onClick={() => voidCredit(credit.id)}>
                                                        Void
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </section>

                    <section style={{ marginTop: 30 }}>
                        <h2 style={{ marginBottom: 14 }}>Recent Makeup Usage</h2>

                        <div className="table-container">
                            <div className="table-scroll">
                                <table>
                                    <thead>
                                    <tr>
                                        <th>Student</th>
                                        <th>Changed From → To</th>
                                        <th>Makeup Date</th>
                                        <th>Target Value</th>
                                        <th>Credit Used</th>
                                        <th>Top-up</th>
                                        <th>Payment</th>
                                    </tr>
                                    </thead>
                                    <tbody>
                                    {recentUsages.length === 0 ? (
                                        <tr>
                                            <td colSpan={7} style={{ textAlign: 'center', color: '#64748b' }}>
                                                No makeup usage yet.
                                            </td>
                                        </tr>
                                    ) : (
                                        recentUsages.map((usage) => {
                                            const sourceType = usage.makeup_credits?.source_training_type;

                                            return (
                                                <tr key={usage.id}>
                                                    <td>{usage.master_students?.display_name || 'Unknown student'}</td>
                                                    <td>
                                                        <strong>
                                                            {sourceType ? TRAINING_LABELS[sourceType] : 'Unknown'}
                                                            {' → '}
                                                            {TRAINING_LABELS[usage.target_training_type]}
                                                        </strong>
                                                        <br />
                                                        <span className="muted">{usage.target_label}</span>
                                                    </td>
                                                    <td>{readableDate(usage.target_date)}</td>
                                                    <td>{money(usage.target_value)}</td>
                                                    <td>{money(usage.credit_value_used)}</td>
                                                    <td>
                                                        <strong style={{ color: usage.top_up_amount > 0 ? '#dc2626' : '#047857' }}>
                                                            {money(usage.top_up_amount)}
                                                        </strong>
                                                    </td>
                                                    <td>{usage.payment_status}</td>
                                                </tr>
                                            );
                                        })
                                    )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </section>

                    {showUsedVoid && (
                        <section style={{ marginTop: 30 }}>
                            <h2 style={{ marginBottom: 14 }}>Used / Void Credit History</h2>

                            <div className="table-container">
                                <div className="table-scroll">
                                    <table>
                                        <thead>
                                        <tr>
                                            <th>Student</th>
                                            <th>Changed From → To</th>
                                            <th>Date</th>
                                            <th>Credit</th>
                                            <th>Status</th>
                                        </tr>
                                        </thead>
                                        <tbody>
                                        {historicalCredits.length === 0 ? (
                                            <tr>
                                                <td colSpan={5} style={{ textAlign: 'center', color: '#64748b' }}>
                                                    No used or void credits.
                                                </td>
                                            </tr>
                                        ) : (
                                            historicalCredits.map((credit) => (
                                                <tr key={credit.id}>
                                                    <td>{credit.master_students?.display_name || 'Unknown student'}</td>
                                                    <td>
                                                        {(() => {
                                                            const linkedUsage = usageByCreditId.get(credit.id);

                                                            return (
                                                                <>
                                                                    <strong>
                                                                        {TRAINING_LABELS[credit.source_training_type]}
                                                                        {' → '}
                                                                        {linkedUsage
                                                                            ? TRAINING_LABELS[linkedUsage.target_training_type]
                                                                            : credit.status === 'void'
                                                                                ? 'Void'
                                                                                : 'Unknown'}
                                                                    </strong>
                                                                    <br />
                                                                    <span className="muted">
                                      {linkedUsage?.target_label || credit.source_label}
                                    </span>
                                                                </>
                                                            );
                                                        })()}
                                                    </td>
                                                    <td>{readableDate(credit.source_date)}</td>
                                                    <td>{money(credit.credit_value)}</td>
                                                    <td>
                                                        <strong style={{ color: credit.status === 'used' ? '#047857' : '#9a3412' }}>
                                                            {credit.status.toUpperCase()}
                                                        </strong>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </section>
                    )}
                </section>
            </main>
        </div>
    );
}
