'use client';

import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import AppHeader from './../components/AppHeader';
import './../styles.css';
import './../dashboard/dashboard.css';

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type UserRole = 'superuser' | 'admin' | 'member';

interface AppUser {
    id: string;
    email: string;
    user_metadata?: {
        name?: string;
        role?: UserRole;
    };
    app_metadata?: {
        role?: UserRole;
    };
}

interface Student {
    student_id: string;
    student_name: string;
}

interface TrainingSession {
    id: number;
    session_date: string;
    student_id: string;
    coach_id: string;
    created_at?: string;
    updated_at?: string;
}

interface DraftSession {
    studentId: string;
    coachId: string;
}

const getUserRole = (user: any): UserRole => {
    return (
        user?.app_metadata?.role ||
        user?.user_metadata?.role ||
        'member'
    ) as UserRole;
};

const getDisplayName = (user: AppUser) => {
    return user.user_metadata?.name || user.email || 'User';
};

const formatDateLocal = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const normalizeDateKey = (dateValue: string) => {
    return dateValue.slice(0, 10);
};

const getNextMonthDateKey = (monthValue: string) => {
    const [yearStr, monthStr] = monthValue.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);

    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;

    return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
};

const cardStyle: CSSProperties = {
    background: 'white',
    border: '1px solid #e5e7eb',
    borderRadius: '16px',
    padding: '20px',
    boxShadow: '0 4px 14px rgba(0,0,0,0.06)'
};

const rowStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr auto',
    gap: '12px',
    alignItems: 'center',
    padding: '12px',
    borderRadius: '12px',
    background: '#f9fafb',
    marginTop: '10px'
};

export default function TrainingPage() {
    const router = useRouter();

    const [userName, setUserName] = useState('');
    const [userRole, setUserRole] = useState<UserRole | null>(null);

    const [students, setStudents] = useState<Student[]>([]);
    const [coaches, setCoaches] = useState<AppUser[]>([]);
    const [sessions, setSessions] = useState<TrainingSession[]>([]);
    const [draftSessions, setDraftSessions] = useState<Record<string, DraftSession>>({});
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });

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

    const sundays = useMemo(() => {
        const [yearStr, monthStr] = selectedMonth.split('-');
        const year = Number(yearStr);
        const month = Number(monthStr) - 1;

        const first = new Date(year, month, 1);
        const last = new Date(year, month + 1, 0);

        const days: Date[] = [];
        const cur = new Date(first);
        while (cur <= last) {
            if (cur.getDay() === 0) days.push(new Date(cur));
            cur.setDate(cur.getDate() + 1);
        }
        return days;
    }, [selectedMonth]);

    const studentNameById = useMemo(() => {
        return new Map(students.map(student => [student.student_id, student.student_name]));
    }, [students]);

    const loadData = async () => {
        try {
            setLoading(true);
            setMessage('');

            const { data: studentData, error: studentError } = await supabase
                .from('students')
                .select('student_id, student_name')
                .order('student_name', { ascending: true });

            if (studentError) throw studentError;

            const { data: authUsers, error: userError } = await fetch('/api/users/list')
                .then(res => res.json())
                .then(json => ({ data: json.users as AppUser[], error: null }))
                .catch(err => ({ data: null, error: err }));

            if (userError) throw userError;

            const coachList = (authUsers || [])
                .filter(u => {
                    const role = (u.app_metadata?.role || u.user_metadata?.role || 'member') as UserRole;
                    return role === 'member' || role === 'admin' || role === 'superuser';
                })
                .sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b)));

            const startDateKey = `${selectedMonth}-01`;
            const endDateKey = getNextMonthDateKey(selectedMonth);

            const { data: sessionData, error: sessionError } = await supabase
                .from('training_sessions')
                .select('id, session_date, student_id, coach_id, created_at, updated_at')
                .gte('session_date', startDateKey)
                .lt('session_date', endDateKey)
                .order('session_date', { ascending: true })
                .order('id', { ascending: true });

            if (sessionError) throw sessionError;

            setStudents(studentData || []);
            setCoaches(coachList);
            setSessions(((sessionData || []) as TrainingSession[]).map(session => ({
                ...session,
                session_date: normalizeDateKey(session.session_date)
            })));
        } catch (err: any) {
            console.error(err);
            setMessage(err?.message || 'Failed to load training data');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [selectedMonth]);

    const getSessionsForDate = (date: string) => {
        return sessions.filter(s => s.session_date === date);
    };

    const updateDraft = (date: string, patch: Partial<DraftSession>) => {
        setDraftSessions(prev => ({
            ...prev,
            [date]: {
                studentId: prev[date]?.studentId || '',
                coachId: prev[date]?.coachId || '',
                ...patch
            }
        }));
    };

    const createSession = async (sessionDate: string) => {
        const draft = draftSessions[sessionDate];

        if (!draft?.studentId || !draft?.coachId) {
            alert('Please select both a student and a coach.');
            return;
        }

        const alreadyAdded = sessions.some(
            s => s.session_date === sessionDate && s.student_id === draft.studentId
        );

        if (alreadyAdded) {
            alert('This student has already been added for this Sunday.');
            return;
        }

        try {
            const { data, error } = await supabase
                .from('training_sessions')
                .insert({
                    session_date: sessionDate,
                    student_id: draft.studentId,
                    coach_id: draft.coachId
                })
                .select('id, session_date, student_id, coach_id, created_at, updated_at')
                .single();

            if (error) throw error;

            const newSession = {
                ...(data as TrainingSession),
                session_date: normalizeDateKey((data as TrainingSession).session_date)
            };

            setSessions(prev =>
                [...prev, newSession].sort((a, b) => {
                    const dateCompare = a.session_date.localeCompare(b.session_date);
                    return dateCompare !== 0 ? dateCompare : a.id - b.id;
                })
            );

            setDraftSessions(prev => ({
                ...prev,
                [sessionDate]: { studentId: '', coachId: '' }
            }));
        } catch (err: any) {
            alert(err?.message || 'Failed to add training session');
        }
    };

    const updateSession = async (sessionId: number, patch: Partial<Pick<TrainingSession, 'student_id' | 'coach_id'>>) => {
        try {
            const currentSession = sessions.find(s => s.id === sessionId);
            if (!currentSession) return;

            if (patch.student_id) {
                const duplicate = sessions.some(
                    s =>
                        s.id !== sessionId &&
                        s.session_date === currentSession.session_date &&
                        s.student_id === patch.student_id
                );

                if (duplicate) {
                    alert('This student has already been added for this Sunday.');
                    return;
                }
            }

            const { data, error } = await supabase
                .from('training_sessions')
                .update(patch)
                .eq('id', sessionId)
                .select('id, session_date, student_id, coach_id, created_at, updated_at')
                .single();

            if (error) throw error;

            const updatedSession = {
                ...(data as TrainingSession),
                session_date: normalizeDateKey((data as TrainingSession).session_date)
            };

            setSessions(prev => prev.map(s => s.id === sessionId ? updatedSession : s));
        } catch (err: any) {
            alert(err?.message || 'Failed to update training session');
        }
    };

    const deleteSession = async (sessionId: number) => {
        const confirmed = window.confirm('Remove this student from 1-on-1 training for this Sunday?');
        if (!confirmed) return;

        try {
            const { error } = await supabase
                .from('training_sessions')
                .delete()
                .eq('id', sessionId);

            if (error) throw error;

            setSessions(prev => prev.filter(s => s.id !== sessionId));
        } catch (err: any) {
            alert(err?.message || 'Failed to remove training session');
        }
    };

    if (userRole === 'member' || !userRole) {
        return (
            <div className="container" style={{ padding: '2rem' }}>
                <h1 className="page-title">403</h1>
                <p>You do not have permission to access this page.</p>
                <Link href="/dashboard" className="btn share-btn">Back to Dashboard</Link>
            </div>
        );
    }

    return (
        <div className="container">
            <AppHeader
                title="1-on-1 Training"
                userName={userName}
                userRole={userRole}
                mode="dashboard"
            />

            <main>
                <div className="filter-box" style={{ width: '100%' }}>
                    <div className="filter-grid">
                        <div className="filter-group">
                            <label className="filter-label">Month</label>
                            <input
                                type="month"
                                className="filter-input"
                                value={selectedMonth}
                                onChange={(e) => setSelectedMonth(e.target.value)}
                            />
                        </div>
                    </div>
                </div>

                {message && <p className="error-message">{message}</p>}
                {loading && <p className="muted">Loading...</p>}

                <div style={{ display: 'grid', gap: '18px', marginTop: '20px' }}>
                    {sundays.map((d) => {
                        const dateKey = formatDateLocal(d);
                        const dateSessions = getSessionsForDate(dateKey);
                        const draft = draftSessions[dateKey] || { studentId: '', coachId: '' };

                        return (
                            <section key={dateKey} style={cardStyle}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
                                    <div>
                                        <h2 style={{ margin: 0, fontSize: '1.15rem', color: '#111827' }}>
                                            {d.toLocaleDateString(undefined, {
                                                weekday: 'long',
                                                day: 'numeric',
                                                month: 'long',
                                                year: 'numeric'
                                            })}
                                        </h2>
                                        <p className="timestamp" style={{ textAlign: 'left', margin: '6px 0 0' }}>
                                            {dateSessions.length} student{dateSessions.length === 1 ? '' : 's'} added
                                        </p>
                                    </div>
                                </div>

                                {dateSessions.length > 0 && (
                                    <div style={{ marginTop: '14px' }}>
                                        {dateSessions.map((session) => (
                                            <div key={session.id} style={rowStyle}>
                                                <select
                                                    className="student-field-select"
                                                    value={session.student_id}
                                                    onChange={(e) => updateSession(session.id, { student_id: e.target.value })}
                                                    aria-label="Student"
                                                >
                                                    <option value="">Select student</option>
                                                    {students.map((s) => (
                                                        <option key={s.student_id} value={s.student_id}>
                                                            {s.student_name}
                                                        </option>
                                                    ))}
                                                </select>

                                                <select
                                                    className="student-field-select"
                                                    value={session.coach_id}
                                                    onChange={(e) => updateSession(session.id, { coach_id: e.target.value })}
                                                    aria-label="Coach"
                                                >
                                                    <option value="">Assign coach</option>
                                                    {coaches.map((coach) => (
                                                        <option key={coach.id} value={coach.id}>
                                                            {getDisplayName(coach)}
                                                        </option>
                                                    ))}
                                                </select>

                                                <button
                                                    className="btn share-btn logout"
                                                    onClick={() => deleteSession(session.id)}
                                                    type="button"
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: '1fr 1fr auto',
                                        gap: '12px',
                                        alignItems: 'center',
                                        marginTop: '16px',
                                        padding: '14px',
                                        borderRadius: '14px',
                                        border: '1px dashed #cbd5e1',
                                        background: '#ffffff'
                                    }}
                                >
                                    <select
                                        className="student-field-select"
                                        value={draft.studentId}
                                        onChange={(e) => updateDraft(dateKey, { studentId: e.target.value })}
                                        aria-label="Add student"
                                    >
                                        <option value="">Choose student</option>
                                        {students.map((s) => (
                                            <option key={s.student_id} value={s.student_id}>
                                                {s.student_name}
                                            </option>
                                        ))}
                                    </select>

                                    <select
                                        className="student-field-select"
                                        value={draft.coachId}
                                        onChange={(e) => updateDraft(dateKey, { coachId: e.target.value })}
                                        aria-label="Assign coach"
                                    >
                                        <option value="">Choose coach</option>
                                        {coaches.map((coach) => (
                                            <option key={coach.id} value={coach.id}>
                                                {getDisplayName(coach)}
                                            </option>
                                        ))}
                                    </select>

                                    <button
                                        className="btn share-btn"
                                        onClick={() => createSession(dateKey)}
                                        type="button"
                                    >
                                        Add Student
                                    </button>
                                </div>
                            </section>
                        );
                    })}
                </div>
            </main>
        </div>
    );
}
