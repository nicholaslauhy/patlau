'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import AppHeader from './../components/AppHeader';
import './../styles.css';
import './../dashboard/dashboard.css';

type UserRole = 'superuser' | 'admin' | 'member';

interface AttendanceVote {
    id: number;
    poll_id: string;
    date_key: string;
    telegram_handle: string | null;
    display_name: string | null;
    response: string;
    updated_at: string;
    coach_attendance_polls?: {
        intro_text: string;
        venue_text: string;
        active: boolean;
        created_at: string;
    };
}

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const normalizeHandle = (value: string) => {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return '';
    return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
};

const getShiftDetails = (dateKey: string) => {
    const match = dateKey.match(
        /^(\d{4})-(\d{2})-(\d{2})(?:-(\d{1,2})-(\d{1,2}))?$/
    );

    if (!match) {
        return {
            dateLabel: dateKey,
            timeLabel: 'Timing unavailable',
            payment: 0,
            monthKey: '',
        };
    }

    const [, year, month, day, startHourRaw, endHourRaw] = match;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    const dayOfWeek = date.getDay();
    const monthKey = `${year}-${month}`;

    const dateLabel = date.toLocaleDateString('en-SG', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });

    // Saturday polls do not contain a timing key.
    // Every Saturday coaching shift is automatically 2-6pm at S$70.
    if (!startHourRaw || !endHourRaw) {
        if (dayOfWeek === 6) {
            return {
                dateLabel,
                timeLabel: '2-6pm',
                payment: 70,
                monthKey,
            };
        }

        return {
            dateLabel,
            timeLabel: 'Timing unavailable',
            payment: 0,
            monthKey,
        };
    }

    const startHour = Number(startHourRaw);
    const endHour = Number(endHourRaw);
    const shiftKey = `${startHour}-${endHour}`;

    const shiftRules: Record<string, { label: string; payment: number }> = {
        '8-12': { label: '8am-12pm', payment: 70 },
        '1-5': { label: '1-5pm', payment: 70 },
        '12-1': { label: '12-1pm', payment: 40 },
        '10-12': { label: '10-12pm', payment: 35 },
        '2-6': { label: '2-6pm', payment: 70 },
    };

    const rule = shiftRules[shiftKey];

    return {
        dateLabel,
        timeLabel: rule?.label || `${startHour}-${endHour}`,
        payment: rule?.payment || 0,
        monthKey,
    };
};

const money = (value: number) => `S$${Number(value || 0).toFixed(2)}`;

export default function MyAttendancePage() {
    const router = useRouter();
    const [userRole, setUserRole] = useState<UserRole | null>(null);
    const [userName, setUserName] = useState('');
    const [userId, setUserId] = useState('');
    const [telegramHandle, setTelegramHandle] = useState('');
    const [votes, setVotes] = useState<AttendanceVote[]>([]);
    const [message, setMessage] = useState('');
    const [loading, setLoading] = useState(false);
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const date = new Date();
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    });

    const loadVotes = async (handle: string) => {
        if (!handle) {
            setVotes([]);
            return;
        }

        const { data, error } = await supabase
            .from('coach_attendance_votes')
            .select('*, coach_attendance_polls(intro_text, venue_text, active, created_at)')
            .eq('response', 'yes')
            .ilike('telegram_handle', handle)
            .order('updated_at', { ascending: false });

        if (error) throw error;
        setVotes((data || []) as AttendanceVote[]);
    };

    useEffect(() => {
        let channel: ReturnType<typeof supabase.channel> | null = null;

        const initialise = async () => {
            try {
                setLoading(true);

                const { data: { user }, error } = await supabase.auth.getUser();

                if (error || !user) {
                    await supabase.auth.signOut();
                    router.push('/');
                    return;
                }

                const role = (
                    user.app_metadata?.role ||
                    user.user_metadata?.role ||
                    'member'
                ) as UserRole;

                setUserRole(role);
                setUserName(user.user_metadata?.name || user.email || 'User');
                setUserId(user.id);

                const { data: profile, error: profileError } = await supabase
                    .from('coach_profiles')
                    .select('*')
                    .eq('auth_user_id', user.id)
                    .maybeSingle();

                if (profileError) throw profileError;

                const handle = normalizeHandle(profile?.telegram_handle || '');
                setTelegramHandle(handle);
                await loadVotes(handle);

                channel = supabase
                    .channel(`my-coach-attendance-${user.id}`)
                    .on(
                        'postgres_changes',
                        {
                            event: '*',
                            schema: 'public',
                            table: 'coach_attendance_votes',
                        },
                        () => loadVotes(handle)
                    )
                    .subscribe();
            } catch (err: any) {
                setMessage(err?.message || 'Failed to load coaching attendance.');
            } finally {
                setLoading(false);
            }
        };

        initialise();

        return () => {
            if (channel) {
                supabase.removeChannel(channel);
            }
        };
    }, [router]);

    const saveHandle = async () => {
        const normalized = normalizeHandle(telegramHandle);

        if (!normalized) {
            setMessage('Enter your Telegram handle first.');
            return;
        }

        try {
            setLoading(true);
            setMessage('');

            const { error } = await supabase
                .from('coach_profiles')
                .upsert(
                    {
                        auth_user_id: userId,
                        telegram_handle: normalized,
                        updated_at: new Date().toISOString(),
                    },
                    { onConflict: 'auth_user_id' }
                );

            if (error) throw error;

            setTelegramHandle(normalized);
            await loadVotes(normalized);
            setMessage('Telegram handle saved.');
        } catch (err: any) {
            setMessage(err?.message || 'Failed to save Telegram handle.');
        } finally {
            setLoading(false);
        }
    };

    const filteredVotes = useMemo(() => {
        return votes.filter((vote) => {
            const details = getShiftDetails(vote.date_key);
            return !selectedMonth || details.monthKey === selectedMonth;
        });
    }, [votes, selectedMonth]);

    const groupedVotes = useMemo(() => {
        return filteredVotes.reduce<Record<string, AttendanceVote[]>>((groups, vote) => {
            const key = vote.date_key || 'Unknown date';
            groups[key] = groups[key] || [];
            groups[key].push(vote);
            return groups;
        }, {});
    }, [filteredVotes]);

    const monthlyTotal = useMemo(() => {
        return Object.keys(groupedVotes).reduce((sum, dateKey) => {
            return sum + getShiftDetails(dateKey).payment;
        }, 0);
    }, [groupedVotes]);

    if (userRole === null) {
        return <div className="container" style={{ padding: 40 }}>Loading...</div>;
    }

    return (
        <div className="container">
            <AppHeader
                title="My Coaching Attendance"
                userName={userName}
                userRole={userRole}
                mode="dashboard"
            />

            <main style={{ padding: '24px 16px 48px' }}>
                <section className="form-card" style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
                    <div style={{ textAlign: 'center' }}>
                        <h1 style={{ margin: 0 }}>My Coaching Attendance</h1>
                        <p className="muted" style={{ margin: '8px auto 0', maxWidth: 680 }}>
                            Your confirmed coaching shifts and estimated pay appear here.
                            Saturday is automatically treated as 2-6pm. Withdrawing from the Telegram poll removes the entry automatically.
                        </p>
                    </div>

                    <div style={{ maxWidth: 520, margin: '24px auto', display: 'grid', gap: 10 }}>
                        <label style={{ fontWeight: 800 }}>Telegram handle</label>
                        <div style={{ display: 'flex', gap: 10 }}>
                            <input
                                className="form-input"
                                value={telegramHandle}
                                onChange={(event) => setTelegramHandle(event.target.value)}
                                placeholder="@yourusername"
                            />
                            <button
                                type="button"
                                className="btn share-btn"
                                onClick={saveHandle}
                                disabled={loading}
                            >
                                Save
                            </button>
                        </div>
                        {message && <p className="muted" style={{ margin: 0 }}>{message}</p>}
                    </div>

                    <section
                        style={{
                            maxWidth: 560,
                            margin: '0 auto 24px',
                            display: 'grid',
                            gap: 14,
                        }}
                    >
                        <label
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 9,
                                fontWeight: 800,
                                color: '#0f172a',
                            }}
                        >
              <span style={{ fontSize: '0.95rem', textAlign: 'center' }}>
                Month
              </span>

                            <input
                                type="month"
                                className="form-input"
                                value={selectedMonth}
                                onChange={(event) => setSelectedMonth(event.target.value)}
                                style={{
                                    width: '100%',
                                    minHeight: 48,
                                    boxSizing: 'border-box',
                                    background: '#ffffff',
                                }}
                            />
                        </label>

                        <div
                            style={{
                                border: '1px solid #bfdbfe',
                                borderRadius: 14,
                                padding: '18px 16px',
                                background: '#eff6ff',
                                textAlign: 'center',
                            }}
                        >
                            <div
                                style={{
                                    color: '#475569',
                                    fontWeight: 800,
                                    fontSize: '0.95rem',
                                }}
                            >
                                Estimated Coaching Pay
                            </div>

                            <div
                                style={{
                                    marginTop: 8,
                                    fontSize: '2rem',
                                    lineHeight: 1.1,
                                    fontWeight: 900,
                                    color: '#1d4ed8',
                                }}
                            >
                                {money(monthlyTotal)}
                            </div>

                            <div
                                style={{
                                    marginTop: 7,
                                    color: '#64748b',
                                    fontSize: '0.9rem',
                                    fontWeight: 700,
                                }}
                            >
                                {Object.keys(groupedVotes).length} shift
                                {Object.keys(groupedVotes).length === 1 ? '' : 's'}
                            </div>
                        </div>
                    </section>

                    <div style={{ display: 'grid', gap: 16 }}>
                        {Object.keys(groupedVotes).length === 0 ? (
                            <div style={{ textAlign: 'center', padding: 36, color: '#64748b' }}>
                                No coaching attendance has been recorded for this Telegram handle.
                            </div>
                        ) : (
                            Object.entries(groupedVotes).map(([dateKey, dateVotes]) => (
                                <article
                                    key={dateKey}
                                    style={{
                                        border: '1px solid #dbe4f0',
                                        borderRadius: 14,
                                        padding: 20,
                                        background: '#f8fafc',
                                        textAlign: 'center',
                                    }}
                                >
                                    {(() => {
                                        const { dateLabel, timeLabel, payment } = getShiftDetails(dateKey);

                                        return (
                                            <>
                                                <h2 style={{ margin: 0 }}>{dateLabel}</h2>

                                                <p
                                                    style={{
                                                        margin: '8px 0 0',
                                                        fontSize: '1.05rem',
                                                        fontWeight: 800,
                                                        color: '#2563eb',
                                                    }}
                                                >
                                                    {timeLabel}
                                                </p>

                                                <p
                                                    style={{
                                                        margin: '9px 0 0',
                                                        fontSize: '1.05rem',
                                                        fontWeight: 900,
                                                        color: '#7c3aed',
                                                    }}
                                                >
                                                    {payment > 0 ? money(payment) : 'Payment unavailable'}
                                                </p>

                                                <p
                                                    style={{
                                                        margin: '10px 0 0',
                                                        color: '#047857',
                                                        fontWeight: 800,
                                                    }}
                                                >
                                                    Attending
                                                </p>
                                            </>
                                        );
                                    })()}
                                </article>
                            ))
                        )}
                    </div>
                </section>
            </main>
        </div>
    );
}
