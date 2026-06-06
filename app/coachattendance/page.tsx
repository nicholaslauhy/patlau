'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import AppHeader from './../components/AppHeader';
import './../styles.css';
import './../dashboard/dashboard.css';

type UserRole = 'superuser' | 'admin' | 'member';

type PollSlot = {
    key: string;
    label: string;
};

type PollPreset = {
    id: 'saturday' | 'sunday';
    title: string;
    description: string;
    introText: string;
    venueText: string;
    slots: PollSlot[];
};

const DEFAULT_PRESETS: PollPreset[] = [
    {
        id: 'saturday',
        title: 'Saturday Coaching',
        description: 'For Saturday weekend training coach attendance.',
        introText: 'Hi coaches! Please let me know your available dates for 6th June:',
        venueText:
            'The venue will be at NYGH. Please come earlier, about 1.30 to set up the courts, prep the hall.\nStart warm up at 2pm. Thanks so much!',
        slots: [
            { key: '2026-06-06', label: '6/6/2026' },
        ],
    },
    {
        id: 'sunday',
        title: 'Sunday Coaching',
        description: 'For Sunday weekend training coach attendance.',
        introText: 'Hi coaches! Please let me know your availability for 14th June:',
        venueText:
            'The venue will be at NYGH. Please come earlier to set up the courts and prep the hall.\nThanks so much!',
        slots: [
            { key: '2026-06-14-8-12', label: '8-12pm' },
            { key: '2026-06-14-10-12', label: '10-12pm' },
            { key: '2026-06-14-1-5', label: '1-5pm' },
        ],
    },
];

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const getUserRole = (user: any): UserRole => {
    return (user?.app_metadata?.role || user?.user_metadata?.role || 'member') as UserRole;
};

const emptyListPreview = (slots: PollSlot[]) => {
    return slots
        .map((slot) => `${slot.label}:\nNo one yet`)
        .join('\n\n');
};

export default function CoachAttendancePage() {
    const router = useRouter();
    const [userName, setUserName] = useState('');
    const [userRole, setUserRole] = useState<UserRole | null>(null);
    const [presets, setPresets] = useState<PollPreset[]>(DEFAULT_PRESETS);
    const [activePresetId, setActivePresetId] = useState<'saturday' | 'sunday'>('saturday');
    const [sending, setSending] = useState(false);
    const [message, setMessage] = useState('');

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

    const activePreset = presets.find((preset) => preset.id === activePresetId) || presets[0];

    const previewText = useMemo(() => {
        return `${activePreset.introText.trim()}\n\n${emptyListPreview(activePreset.slots)}\n\n${activePreset.venueText.trim()}`;
    }, [activePreset]);

    const updatePreset = (patch: Partial<PollPreset>) => {
        setPresets((prev) =>
            prev.map((preset) =>
                preset.id === activePresetId
                    ? { ...preset, ...patch }
                    : preset
            )
        );
    };

    const updateSlot = (index: number, patch: Partial<PollSlot>) => {
        setPresets((prev) =>
            prev.map((preset) => {
                if (preset.id !== activePresetId) return preset;

                return {
                    ...preset,
                    slots: preset.slots.map((slot, i) =>
                        i === index ? { ...slot, ...patch } : slot
                    ),
                };
            })
        );
    };

    const addSlot = () => {
        setPresets((prev) =>
            prev.map((preset) => {
                if (preset.id !== activePresetId) return preset;

                const nextIndex = preset.slots.length + 1;
                return {
                    ...preset,
                    slots: [
                        ...preset.slots,
                        {
                            key: `${preset.id}-slot-${Date.now()}`,
                            label: preset.id === 'saturday' ? `Date ${nextIndex}` : `Timing ${nextIndex}`,
                        },
                    ],
                };
            })
        );
    };

    const removeSlot = (index: number) => {
        setPresets((prev) =>
            prev.map((preset) => {
                if (preset.id !== activePresetId) return preset;

                if (preset.slots.length === 1) return preset;

                return {
                    ...preset,
                    slots: preset.slots.filter((_, i) => i !== index),
                };
            })
        );
    };

    const sendPoll = async () => {
        setMessage('');

        if (!activePreset.introText.trim()) {
            setMessage('Intro message is required.');
            return;
        }

        if (!activePreset.venueText.trim()) {
            setMessage('Venue message is required.');
            return;
        }

        if (activePreset.slots.length === 0) {
            setMessage('Please add at least one voting option.');
            return;
        }

        try {
            setSending(true);

            const response = await fetch('/api/telegram-coach-attendance/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    topic: activePreset.id,
                    introText: activePreset.introText,
                    venueText: activePreset.venueText,
                    slots: activePreset.slots,
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data?.error || 'Failed to send coach attendance poll.');
            }

            setMessage(`${activePreset.title} poll sent successfully.`);
        } catch (err: any) {
            setMessage(err?.message || 'Failed to send coach attendance poll.');
        } finally {
            setSending(false);
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

    if (userRole !== 'admin' && userRole !== 'superuser') {
        return (
            <div className="container" style={{ padding: '3rem 1rem' }}>
                <div className="form-card" style={{ maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>
                    <h1 style={{ color: '#dc2626', fontSize: '3rem', marginBottom: '0.5rem' }}>403</h1>
                    <h2 style={{ marginTop: 0 }}>Forbidden</h2>
                    <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>
                        Only admins and superusers can access Coach Attendance and craft attendance messages.
                    </p>

                    <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                        <Link href="/dashboard" className="btn share-btn">
                            Return to Dashboard
                        </Link>

                        <button
                            type="button"
                            className="btn share-btn logout"
                            onClick={handleForbiddenLogout}
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
                title="Coach Attendance"
                userName={userName}
                userRole={userRole}
                mode="dashboard"
            />

            <main style={{ padding: '28px 16px 48px' }}>
                <section
                    style={{
                        maxWidth: 1100,
                        margin: '0 auto',
                        border: '1px solid #dbe4f0',
                        borderRadius: 22,
                        background: '#ffffff',
                        boxShadow: '0 18px 45px rgba(15, 23, 42, 0.08)',
                        overflow: 'hidden',
                    }}
                >
                    <div
                        style={{
                            padding: '28px 30px 22px',
                            borderBottom: '1px solid #e5e7eb',
                            background: 'linear-gradient(180deg, #f8fbff 0%, #ffffff 100%)',
                        }}
                    >
                        <div
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'flex-start',
                                gap: 20,
                                flexWrap: 'wrap',
                            }}
                        >
                            <div style={{ minWidth: 0 }}>
                                <div
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 8,
                                        padding: '7px 11px',
                                        borderRadius: 999,
                                        background: '#eff6ff',
                                        color: '#1d4ed8',
                                        fontSize: '0.78rem',
                                        fontWeight: 800,
                                        letterSpacing: '0.02em',
                                        marginBottom: 12,
                                    }}
                                >
                                    WEEKEND COACHING
                                </div>

                                <h1
                                    style={{
                                        margin: 0,
                                        fontSize: 'clamp(1.65rem, 2.5vw, 2.15rem)',
                                        lineHeight: 1.15,
                                        color: '#0f172a',
                                    }}
                                >
                                    Send Coach Attendance Poll
                                </h1>

                                <p
                                    style={{
                                        margin: '10px 0 0',
                                        color: '#64748b',
                                        maxWidth: 700,
                                        lineHeight: 1.6,
                                    }}
                                >
                                    Choose Saturday or Sunday, customise the message, then send it to the correct Telegram topic.
                                </p>
                            </div>

                            <div
                                style={{
                                    display: 'inline-flex',
                                    gap: 6,
                                    padding: 5,
                                    borderRadius: 14,
                                    background: '#f1f5f9',
                                    border: '1px solid #e2e8f0',
                                }}
                            >
                                {presets.map((preset) => {
                                    const isActive = activePresetId === preset.id;

                                    return (
                                        <button
                                            key={preset.id}
                                            type="button"
                                            onClick={() => setActivePresetId(preset.id)}
                                            style={{
                                                border: 'none',
                                                borderRadius: 10,
                                                padding: '10px 16px',
                                                cursor: 'pointer',
                                                fontWeight: 800,
                                                fontSize: '0.9rem',
                                                background: isActive ? '#2563eb' : 'transparent',
                                                color: isActive ? '#ffffff' : '#334155',
                                                boxShadow: isActive ? '0 6px 14px rgba(37, 99, 235, 0.24)' : 'none',
                                                transition: 'all 0.18s ease',
                                            }}
                                        >
                                            {preset.title}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {message && (
                            <div
                                className={message.toLowerCase().includes('success') ? 'success-message' : 'error-message'}
                                style={{
                                    marginTop: 18,
                                    borderRadius: 12,
                                    padding: '11px 14px',
                                }}
                            >
                                {message}
                            </div>
                        )}
                    </div>

                    <div
                        style={{
                            padding: 30,
                            display: 'grid',
                            gap: 24,
                            background: '#f8fafc',
                        }}
                    >
                        <section
                            style={{
                                border: '1px solid #dbe4f0',
                                borderRadius: 18,
                                background: '#ffffff',
                                padding: 24,
                                boxShadow: '0 8px 24px rgba(15, 23, 42, 0.05)',
                            }}
                        >
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    gap: 16,
                                    alignItems: 'flex-start',
                                    flexWrap: 'wrap',
                                    marginBottom: 22,
                                }}
                            >
                                <div>
                                    <h2 style={{ margin: 0, color: '#0f172a', fontSize: '1.35rem' }}>
                                        {activePreset.title}
                                    </h2>
                                    <p style={{ margin: '6px 0 0', color: '#64748b', lineHeight: 1.5 }}>
                                        {activePreset.description}
                                    </p>
                                </div>

                                <div
                                    style={{
                                        padding: '8px 11px',
                                        borderRadius: 10,
                                        background: '#f8fafc',
                                        border: '1px solid #e2e8f0',
                                        color: '#475569',
                                        fontSize: '0.82rem',
                                        fontWeight: 700,
                                    }}
                                >
                                    {activePreset.slots.length} voting option{activePreset.slots.length === 1 ? '' : 's'}
                                </div>
                            </div>

                            <div style={{ display: 'grid', gap: 22 }}>
                                <div>
                                    <label
                                        style={{
                                            display: 'block',
                                            marginBottom: 8,
                                            fontWeight: 800,
                                            color: '#1e293b',
                                        }}
                                    >
                                        Opening message
                                    </label>

                                    <textarea
                                        className="form-input"
                                        rows={4}
                                        value={activePreset.introText}
                                        onChange={(event) => updatePreset({ introText: event.target.value })}
                                        style={{
                                            width: '100%',
                                            boxSizing: 'border-box',
                                            resize: 'vertical',
                                            minHeight: 118,
                                            borderRadius: 12,
                                            padding: 14,
                                            lineHeight: 1.55,
                                            background: '#fbfdff',
                                        }}
                                    />
                                </div>

                                <div>
                                    <div
                                        style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            gap: 12,
                                            alignItems: 'center',
                                            flexWrap: 'wrap',
                                            marginBottom: 12,
                                        }}
                                    >
                                        <div>
                                            <h3 style={{ margin: 0, fontSize: '1rem', color: '#1e293b' }}>
                                                {activePreset.id === 'saturday' ? 'Date option' : 'Timing options'}
                                            </h3>
                                            <p style={{ margin: '5px 0 0', color: '#64748b', fontSize: '0.84rem' }}>
                                                These labels appear in the Telegram poll.
                                            </p>
                                        </div>

                                        <button
                                            type="button"
                                            onClick={addSlot}
                                            style={{
                                                border: '1px solid #bfdbfe',
                                                borderRadius: 10,
                                                padding: '9px 13px',
                                                background: '#eff6ff',
                                                color: '#1d4ed8',
                                                fontWeight: 800,
                                                cursor: 'pointer',
                                            }}
                                        >
                                            + Add option
                                        </button>
                                    </div>

                                    <div style={{ display: 'grid', gap: 10 }}>
                                        {activePreset.slots.map((slot, index) => (
                                            <div
                                                key={`${slot.key}-${index}`}
                                                style={{
                                                    display: 'grid',
                                                    gridTemplateColumns: 'minmax(0, 1fr) auto',
                                                    gap: 12,
                                                    alignItems: 'center',
                                                    padding: 14,
                                                    borderRadius: 14,
                                                    border: '1px solid #e2e8f0',
                                                    background: '#f8fafc',
                                                }}
                                            >
                                                <div style={{ minWidth: 0 }}>
                                                    <label
                                                        style={{
                                                            display: 'block',
                                                            fontSize: '0.8rem',
                                                            fontWeight: 800,
                                                            color: '#475569',
                                                            marginBottom: 7,
                                                        }}
                                                    >
                                                        {activePreset.id === 'saturday' ? 'Date label' : 'Timing label'}
                                                    </label>

                                                    <input
                                                        className="filter-input"
                                                        value={slot.label}
                                                        onChange={(event) => updateSlot(index, { label: event.target.value })}
                                                        style={{
                                                            width: '100%',
                                                            boxSizing: 'border-box',
                                                            borderRadius: 10,
                                                            background: '#ffffff',
                                                        }}
                                                    />
                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={() => removeSlot(index)}
                                                    disabled={activePreset.slots.length === 1}
                                                    style={{
                                                        border: '1px solid #fecaca',
                                                        borderRadius: 10,
                                                        padding: '9px 12px',
                                                        background: activePreset.slots.length === 1 ? '#f8fafc' : '#fff1f2',
                                                        color: activePreset.slots.length === 1 ? '#94a3b8' : '#dc2626',
                                                        fontWeight: 800,
                                                        cursor: activePreset.slots.length === 1 ? 'not-allowed' : 'pointer',
                                                    }}
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <label
                                        style={{
                                            display: 'block',
                                            marginBottom: 8,
                                            fontWeight: 800,
                                            color: '#1e293b',
                                        }}
                                    >
                                        Venue and closing message
                                    </label>

                                    <textarea
                                        className="form-input"
                                        rows={5}
                                        value={activePreset.venueText}
                                        onChange={(event) => updatePreset({ venueText: event.target.value })}
                                        style={{
                                            width: '100%',
                                            boxSizing: 'border-box',
                                            resize: 'vertical',
                                            minHeight: 132,
                                            borderRadius: 12,
                                            padding: 14,
                                            lineHeight: 1.55,
                                            background: '#fbfdff',
                                        }}
                                    />
                                </div>
                            </div>

                            <div
                                style={{
                                    marginTop: 24,
                                    paddingTop: 20,
                                    borderTop: '1px solid #e5e7eb',
                                    display: 'flex',
                                    justifyContent: 'flex-end',
                                }}
                            >
                                <button
                                    type="button"
                                    onClick={sendPoll}
                                    disabled={sending}
                                    style={{
                                        minWidth: 220,
                                        border: 'none',
                                        borderRadius: 12,
                                        padding: '12px 18px',
                                        background: sending ? '#93c5fd' : '#2563eb',
                                        color: '#ffffff',
                                        fontWeight: 900,
                                        cursor: sending ? 'not-allowed' : 'pointer',
                                        boxShadow: sending ? 'none' : '0 8px 18px rgba(37, 99, 235, 0.22)',
                                    }}
                                >
                                    {sending ? 'Sending…' : `Send ${activePreset.title}`}
                                </button>
                            </div>
                        </section>

                        <section
                            style={{
                                border: '1px solid #dbe4f0',
                                borderRadius: 18,
                                background: '#ffffff',
                                padding: 24,
                                boxShadow: '0 8px 24px rgba(15, 23, 42, 0.05)',
                            }}
                        >
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    gap: 12,
                                    alignItems: 'center',
                                    marginBottom: 14,
                                    flexWrap: 'wrap',
                                }}
                            >
                                <div>
                                    <h2 style={{ margin: 0, color: '#0f172a', fontSize: '1.25rem' }}>
                                        Telegram preview
                                    </h2>
                                    <p style={{ margin: '5px 0 0', color: '#64748b', fontSize: '0.86rem' }}>
                                        This is how the message will appear before coaches respond.
                                    </p>
                                </div>

                                <div
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 7,
                                        padding: '7px 10px',
                                        borderRadius: 999,
                                        background: '#ecfdf5',
                                        color: '#047857',
                                        fontSize: '0.78rem',
                                        fontWeight: 800,
                                    }}
                                >
                                    ● Live preview
                                </div>
                            </div>

                            <div
                                style={{
                                    border: '1px solid #bfdbfe',
                                    borderRadius: 16,
                                    background: '#f8fbff',
                                    padding: 20,
                                    minHeight: 300,
                                    maxHeight: 520,
                                    overflowY: 'auto',
                                    overflowX: 'hidden',
                                }}
                            >
                <pre
                    style={{
                        margin: 0,
                        width: '100%',
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'break-word',
                        wordBreak: 'normal',
                        lineHeight: 1.65,
                        fontFamily: 'inherit',
                        fontSize: '0.96rem',
                        color: '#0f172a',
                        textAlign: 'left',
                    }}
                >
                  {previewText}
                </pre>
                            </div>
                        </section>
                    </div>
                </section>
            </main>
        </div>
    );
}
