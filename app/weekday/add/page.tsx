'use client'

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import AppHeader from './../../components/AppHeader';
import './../../styles.css';
import './../../dashboard/dashboard.css';
import './../../add/add.css';

type UserRole = 'superuser' | 'admin' | 'member';
type WeekdayName = 'Monday' | 'Wednesday' | 'Thursday';

interface ScheduleRow {
    day: WeekdayName;
    duration: number | '';
}

const DAYS: WeekdayName[] = ['Monday', 'Wednesday', 'Thursday'];
const HOURLY_RATE = 80;

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function AddWeekdayStudentPage() {
    const router = useRouter();
    const [userName, setUserName] = useState('');
    const [userRole, setUserRole] = useState<UserRole | null>(null);
    const [studentName, setStudentName] = useState('');
    const [schedules, setSchedules] = useState<ScheduleRow[]>([
        { day: 'Monday', duration: 1 }
    ]);
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

    const totalHours = useMemo(() => {
        return schedules.reduce((sum, row) => sum + Number(row.duration || 0), 0);
    }, [schedules]);

    const totalPaymentAmount = totalHours * HOURLY_RATE;

    const updateSchedule = (index: number, patch: Partial<ScheduleRow>) => {
        setSchedules(prev =>
            prev.map((row, i) => i === index ? { ...row, ...patch } : row)
        );
    };

    const addScheduleRow = () => {
        const unusedDay = DAYS.find(day => !schedules.some(row => row.day === day)) || 'Monday';
        setSchedules(prev => [...prev, { day: unusedDay, duration: 1 }]);
    };

    const removeScheduleRow = (index: number) => {
        setSchedules(prev => prev.length === 1 ? prev : prev.filter((_, i) => i !== index));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (!studentName.trim()) {
            setError('Student name is required.');
            return;
        }

        const cleanSchedules = schedules.map(row => ({
            day: row.day,
            duration: Number(row.duration || 0)
        }));

        if (cleanSchedules.some(row => !row.duration || row.duration <= 0)) {
            setError('Every selected day must have a number of hours above 0.');
            return;
        }

        try {
            setIsSubmitting(true);

            const { error: insertError } = await supabase
                .from('weekday_students')
                .insert({
                    student_name: studentName.trim(),
                    schedules: cleanSchedules,
                    hourly_rate: HOURLY_RATE,
                    total_payment_amount: totalPaymentAmount,
                    active: true,
                    updated_at: new Date().toISOString()
                });

            if (insertError) throw insertError;

            router.push('/weekday/attendance');
        } catch (err: any) {
            setError(err?.message || 'Failed to add weekday student.');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (userRole === 'member') {
        return (
            <div className="container" style={{ padding: '3rem 1rem' }}>
                <div className="form-card" style={{ maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
                    <h1 style={{ color: '#dc2626' }}>403</h1>
                    <p>Only superusers and admins can add weekday students.</p>
                    <Link href="/dashboard" className="btn share-btn">Go to Dashboard</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            <AppHeader title="Add Weekday Student" userName={userName} userRole={userRole} mode="dashboard" />

            <main>
                <div className="form-card" style={{ maxWidth: 860, margin: '0 auto' }}>
                    <div style={{ marginBottom: 18 }}>
                        <h2 style={{ marginBottom: 6 }}>Add Weekday Student</h2>
                        <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
                            Add students for Monday, Wednesday, or Thursday training. Use <strong>Number of Hours</strong> for each selected day.
                            The payment amount is calculated automatically at <strong>S$80/hour</strong>.
                        </p>
                    </div>

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

                        <div
                            style={{
                                display: 'grid',
                                gap: 12,
                                padding: '16px',
                                border: '1px solid #e5e7eb',
                                borderRadius: 14,
                                background: '#f9fafb',
                                marginBottom: 16
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                                <div>
                                    <h3 style={{ margin: 0, fontSize: '1rem', color: '#111827' }}>Training Schedule</h3>
                                    <p className="muted" style={{ margin: '4px 0 0' }}>Add one row per training day.</p>
                                </div>
                                <button type="button" className="btn share-btn" onClick={addScheduleRow}>
                                    + Add Day
                                </button>
                            </div>

                            {schedules.map((row, index) => {
                                const rowAmount = Number(row.duration || 0) * HOURLY_RATE;

                                return (
                                    <div
                                        key={`${row.day}-${index}`}
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: 'minmax(150px, 1fr) minmax(150px, 1fr) minmax(120px, auto) auto',
                                            gap: 12,
                                            alignItems: 'end',
                                            padding: 12,
                                            borderRadius: 12,
                                            background: 'white',
                                            border: '1px solid #e5e7eb'
                                        }}
                                    >
                                        <label style={{ display: 'grid', gap: 6, fontWeight: 700, color: '#374151', fontSize: '0.9rem' }}>
                                            Day
                                            <select
                                                className="form-input"
                                                value={row.day}
                                                onChange={(e) => updateSchedule(index, { day: e.target.value as WeekdayName })}
                                            >
                                                {DAYS.map(day => (
                                                    <option key={day} value={day}>{day}</option>
                                                ))}
                                            </select>
                                        </label>

                                        <label style={{ display: 'grid', gap: 6, fontWeight: 700, color: '#374151', fontSize: '0.9rem' }}>
                                            Number of Hours
                                            <input
                                                className="form-input"
                                                type="number"
                                                min="0.25"
                                                step="0.25"
                                                value={row.duration}
                                                onChange={(e) => updateSchedule(index, { duration: e.target.value === '' ? '' : Number(e.target.value) })}
                                                placeholder="e.g. 1.5"
                                            />
                                        </label>

                                        <div style={{ display: 'grid', gap: 6 }}>
                                            <span style={{ fontWeight: 700, color: '#374151', fontSize: '0.9rem' }}>Amount</span>
                                            <div style={{ padding: '11px 12px', borderRadius: 10, background: '#eff6ff', color: '#1d4ed8', fontWeight: 800 }}>
                                                S${rowAmount.toFixed(2)}
                                            </div>
                                        </div>

                                        <button
                                            type="button"
                                            className="btn share-btn logout"
                                            onClick={() => removeScheduleRow(index)}
                                            disabled={schedules.length === 1}
                                            style={{ minHeight: 42 }}
                                        >
                                            Remove
                                        </button>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="filter-box" style={{ marginTop: 0, alignItems: 'center' }}>
                            <div>
                                <strong>Total Hours</strong>
                                <p className="muted" style={{ margin: '4px 0 0' }}>{totalHours.toFixed(2)} hour{totalHours === 1 ? '' : 's'}</p>
                            </div>
                            <div>
                                <strong>Total Payment</strong>
                                <p className="muted" style={{ margin: '4px 0 0' }}>S${totalPaymentAmount.toFixed(2)}</p>
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 16 }}>
                            <Link href="/weekday/attendance" className="btn share-btn">Cancel</Link>
                            <button type="submit" className="btn share-btn" disabled={isSubmitting}>
                                {isSubmitting ? 'Adding...' : 'Add Weekday Student'}
                            </button>
                        </div>
                    </form>
                </div>
            </main>
        </div>
    );
}
