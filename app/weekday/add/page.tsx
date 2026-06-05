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
type WeekdayName = 'Monday' | 'Wednesday' | 'Thursday';

interface WeekdaySchedule {
    day: WeekdayName;
    duration_hours: number;
}

const WEEKDAY_OPTIONS: WeekdayName[] = ['Monday', 'Wednesday', 'Thursday'];
const HOURLY_RATE = 80;

const getUserRole = (user: any): UserRole => {
    return (user?.app_metadata?.role || user?.user_metadata?.role || 'member') as UserRole;
};

export default function AddWeekdayStudentPage() {
    const router = useRouter();
    const [userName, setUserName] = useState('');
    const [userRole, setUserRole] = useState<UserRole | null>(null);
    const [studentName, setStudentName] = useState('');
    const [schedules, setSchedules] = useState<WeekdaySchedule[]>([
        { day: 'Monday', duration_hours: 1 },
    ]);
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

    const weeklyHours = useMemo(() => {
        return schedules.reduce((sum, item) => sum + (Number(item.duration_hours) || 0), 0);
    }, [schedules]);

    const estimatedWeeklyAmount = weeklyHours * HOURLY_RATE;
    const estimatedFourWeekAmount = estimatedWeeklyAmount * 4;

    const usedDays = schedules.map((item) => item.day);

    const updateSchedule = (index: number, patch: Partial<WeekdaySchedule>) => {
        setSchedules((prev) =>
            prev.map((item, i) =>
                i === index
                    ? {
                        ...item,
                        ...patch,
                    }
                    : item
            )
        );
    };

    const addSchedule = () => {
        const nextDay = WEEKDAY_OPTIONS.find((day) => !usedDays.includes(day));
        if (!nextDay) {
            alert('All available weekday sessions have already been added.');
            return;
        }

        setSchedules((prev) => [...prev, { day: nextDay, duration_hours: 1 }]);
    };

    const removeSchedule = (index: number) => {
        setSchedules((prev) => prev.filter((_, i) => i !== index));
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError('');

        if (!studentName.trim()) {
            setError('Student name is required.');
            return;
        }

        if (schedules.length === 0) {
            setError('Please add at least one weekday training session.');
            return;
        }

        const cleanedSchedules = schedules.map((item) => ({
            day: item.day,
            duration_hours: Number(item.duration_hours) || 0,
        }));

        if (cleanedSchedules.some((item) => item.duration_hours <= 0)) {
            setError('Number of hours must be more than 0 for every session.');
            return;
        }

        const uniqueDays = new Set(cleanedSchedules.map((item) => item.day));
        if (uniqueDays.size !== cleanedSchedules.length) {
            setError('Each weekday can only be added once per student.');
            return;
        }

        try {
            setIsSubmitting(true);

            const { error: insertError } = await supabase
                .from('weekday_students')
                .insert({
                    student_name: studentName.trim(),
                    schedules: cleanedSchedules,
                    hourly_rate: HOURLY_RATE,
                    total_payment_amount: estimatedFourWeekAmount,
                    active: true,
                    updated_at: new Date().toISOString(),
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
                    <p>Only admins and superusers can add weekday students.</p>
                    <Link href="/dashboard" className="btn share-btn">Back to Dashboard</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            <AppHeader title="Add Weekday Student" userName={userName} userRole={userRole} mode="dashboard" />

            <main>
                <form
                    onSubmit={handleSubmit}
                    className="form-card"
                    style={{ maxWidth: 820, margin: '24px auto', padding: 24 }}
                >
                    <h2 style={{ marginTop: 0 }}>Weekday Student Details</h2>
                    <p className="muted" style={{ marginTop: -6 }}>
                        Add one student once, then attach their Monday / Wednesday / Thursday sessions separately.
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

                    <div style={{ marginTop: 22 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                            <div>
                                <h3 style={{ margin: 0 }}>Training Sessions</h3>
                                <p className="muted" style={{ margin: '4px 0 0' }}>
                                    Standard rate: S${HOURLY_RATE}/hour. Add each weekday separately.
                                </p>
                            </div>

                            <button
                                type="button"
                                className="btn share-btn"
                                onClick={addSchedule}
                                disabled={schedules.length >= WEEKDAY_OPTIONS.length}
                            >
                                Add Session
                            </button>
                        </div>

                        <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
                            {schedules.map((schedule, index) => {
                                const availableDays = WEEKDAY_OPTIONS.filter(
                                    (day) => day === schedule.day || !usedDays.includes(day)
                                );

                                return (
                                    <div
                                        key={`${schedule.day}-${index}`}
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: 'minmax(180px, 1fr) minmax(180px, 1fr) auto',
                                            gap: 12,
                                            alignItems: 'end',
                                            border: '1px solid #e5e7eb',
                                            borderRadius: 14,
                                            padding: 14,
                                            background: '#f9fafb',
                                        }}
                                    >
                                        <label style={{ display: 'grid', gap: 6, fontWeight: 700 }}>
                                            Day
                                            <select
                                                className="filter-input"
                                                value={schedule.day}
                                                onChange={(event) => updateSchedule(index, { day: event.target.value as WeekdayName })}
                                            >
                                                {availableDays.map((day) => (
                                                    <option key={day} value={day}>{day}</option>
                                                ))}
                                            </select>
                                        </label>

                                        <label style={{ display: 'grid', gap: 6, fontWeight: 700 }}>
                                            Number of Hours
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <input
                                                    className="filter-input"
                                                    type="number"
                                                    min="0.25"
                                                    step="0.25"
                                                    value={schedule.duration_hours}
                                                    onChange={(event) =>
                                                        updateSchedule(index, { duration_hours: Number(event.target.value) })
                                                    }
                                                    style={{ width: '100%' }}
                                                />
                                                <span style={{ fontWeight: 800, color: '#2563eb' }}>h</span>
                                            </div>
                                        </label>

                                        <button
                                            type="button"
                                            className="delete-btn"
                                            onClick={() => removeSchedule(index)}
                                            disabled={schedules.length === 1}
                                        >
                                            Remove
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
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
                        <strong>Estimated payment</strong>
                        <span>Weekly hours: {weeklyHours.toFixed(2)}h</span>
                        <span>Weekly amount: S${estimatedWeeklyAmount.toFixed(2)}</span>
                        <span>Simple 4-week estimate: S${estimatedFourWeekAmount.toFixed(2)}</span>
                        <small className="muted">
                            Actual monthly payment is calculated on the payment page using the real number of Mondays, Wednesdays, and Thursdays in the selected month.
                        </small>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 22 }}>
                        <Link href="/weekday/attendance" className="btn share-btn">Cancel</Link>
                        <button type="submit" className="btn share-btn" disabled={isSubmitting}>
                            {isSubmitting ? 'Adding...' : 'Add Weekday Student'}
                        </button>
                    </div>
                </form>
            </main>
        </div>
    );
}
