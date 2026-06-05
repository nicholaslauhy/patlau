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

    if (userRole === 'member') {
        return (
            <div className="container" style={{ padding: '3rem 1rem' }}>
                <div className="form-card" style={{ maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
                    <h1 style={{ color: '#dc2626' }}>403</h1>
                    <p>Only admins and superusers can send coach attendance polls.</p>
                    <Link href="/dashboard" className="btn share-btn">Back to Dashboard</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            <AppHeader title="Coach Attendance" userName={userName} userRole={userRole} mode="dashboard" />

            <main>
                <div
                    className="form-card"
                    style={{
                        maxWidth: 1120,
                        width: '100%',
                        margin: '24px auto',
                        padding: 24,
                        overflow: 'hidden',
                        boxSizing: 'border-box',
                    }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <div>
                            <h2 style={{ marginTop: 0, marginBottom: 6 }}>Send Weekend Coach Attendance Poll</h2>
                            <p className="muted" style={{ marginTop: 0 }}>
                                Choose Saturday or Sunday. Coaches will tap the buttons to add or remove their Telegram handle from each list.
                            </p>
                        </div>

                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {presets.map((preset) => (
                                <button
                                    key={preset.id}
                                    type="button"
                                    className="btn share-btn"
                                    onClick={() => setActivePresetId(preset.id)}
                                    style={{
                                        background: activePresetId === preset.id ? '#2563eb' : undefined,
                                        color: activePresetId === preset.id ? 'white' : undefined,
                                    }}
                                >
                                    {preset.title}
                                </button>
                            ))}
                        </div>
                    </div>

                    {message && (
                        <div
                            className={message.toLowerCase().includes('success') ? 'success-message' : 'error-message'}
                            style={{ marginTop: 16 }}
                        >
                            {message}
                        </div>
                    )}

                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
                            gap: 22,
                            marginTop: 20,
                            alignItems: 'stretch',
                        }}
                    >
                        <section
                            style={{
                                minWidth: 0,
                                border: '1px solid #e5e7eb',
                                borderRadius: 16,
                                padding: 18,
                                background: '#ffffff',
                                boxSizing: 'border-box',
                            }}
                        >
                            <h3 style={{ marginTop: 0 }}>{activePreset.title}</h3>
                            <p className="muted">{activePreset.description}</p>

                            <div className="form-group">
                                <label>Opening Message</label>
                                <textarea
                                    className="form-input"
                                    rows={3}
                                    value={activePreset.introText}
                                    onChange={(event) => updatePreset({ introText: event.target.value })}
                                    style={{ resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
                                />
                            </div>

                            <div style={{ marginTop: 18 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                                    <h4 style={{ margin: 0 }}>
                                        {activePreset.id === 'saturday' ? 'Date Option' : 'Timing Options'}
                                    </h4>
                                    <button type="button" className="btn share-btn" onClick={addSlot}>
                                        Add Option
                                    </button>
                                </div>

                                <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
                                    {activePreset.slots.map((slot, index) => (
                                        <div
                                            key={`${slot.key}-${index}`}
                                            style={{
                                                display: 'grid',
                                                gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) auto',
                                                gap: 10,
                                                alignItems: 'end',
                                                padding: 12,
                                                borderRadius: 12,
                                                border: '1px solid #e5e7eb',
                                                background: '#f9fafb',
                                                boxSizing: 'border-box',
                                            }}
                                        >
                                            <label style={{ display: 'grid', gap: 6, fontWeight: 700, minWidth: 0 }}>
                                                Internal Key
                                                <input
                                                    className="filter-input"
                                                    value={slot.key}
                                                    onChange={(event) => updateSlot(index, { key: event.target.value })}
                                                    style={{ width: '100%', boxSizing: 'border-box' }}
                                                />
                                            </label>

                                            <label style={{ display: 'grid', gap: 6, fontWeight: 700, minWidth: 0 }}>
                                                Display Label
                                                <input
                                                    className="filter-input"
                                                    value={slot.label}
                                                    onChange={(event) => updateSlot(index, { label: event.target.value })}
                                                    style={{ width: '100%', boxSizing: 'border-box' }}
                                                />
                                            </label>

                                            <button
                                                type="button"
                                                className="delete-btn"
                                                onClick={() => removeSlot(index)}
                                                disabled={activePreset.slots.length === 1}
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="form-group" style={{ marginTop: 18 }}>
                                <label>Venue / Closing Message</label>
                                <textarea
                                    className="form-input"
                                    rows={5}
                                    value={activePreset.venueText}
                                    onChange={(event) => updatePreset({ venueText: event.target.value })}
                                    style={{ resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
                                />
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 20 }}>
                                <button type="button" className="btn share-btn" onClick={sendPoll} disabled={sending}>
                                    {sending ? 'Sending...' : `Send ${activePreset.title}`}
                                </button>
                            </div>
                        </section>

                        <section
                            style={{
                                minWidth: 0,
                                border: '1px solid #e5e7eb',
                                borderRadius: 16,
                                padding: 18,
                                background: '#ffffff',
                                boxSizing: 'border-box',
                                display: 'flex',
                                flexDirection: 'column',
                            }}
                        >
                            <h3 style={{ marginTop: 0 }}>Preview</h3>
                            <div
                                style={{
                                    flex: 1,
                                    minHeight: 520,
                                    maxHeight: 720,
                                    overflow: 'auto',
                                    border: '1px solid #dbeafe',
                                    borderRadius: 14,
                                    background: '#f8fafc',
                                    padding: 16,
                                    boxSizing: 'border-box',
                                    width: '100%',
                                }}
                            >
                <pre
                    style={{
                        margin: 0,
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'anywhere',
                        wordBreak: 'break-word',
                        lineHeight: 1.5,
                        fontFamily: 'inherit',
                        color: '#111827',
                    }}
                >
                  {previewText}
                </pre>
                            </div>
                        </section>
                    </div>
                </div>
            </main>
        </div>
    );
}
