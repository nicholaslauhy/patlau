'use client';

import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import AppHeader from './../components/AppHeader';
import CrossProgrammeMakeupModal, { MakeupSelectionResult } from './../components/CrossProgrammeMakeupModal';
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
    user_metadata?: { name?: string; role?: UserRole };
    app_metadata?: { role?: UserRole };
}

interface OneToOneStudent {
    id: string;
    student_name: string;
    payment_amount: number;
    active: boolean;
}

interface OneToOneSession {
    id: number;
    session_date: string;
    student_id: string;
    coach_id: string;
    removed_from_training?: boolean;
    removed_at?: string | null;
    payment_exempt?: boolean;
    payment_exempt_at?: string | null;
    attendance_status?: 'scheduled' | 'attended' | 'missed' | 'makeup';
    makeup_target_type?: string | null;
    makeup_usage_id?: string | null;
    attendance_updated_at?: string | null;
    created_at?: string;
    updated_at?: string;
}

interface DraftSession {
    studentId: string;
    coachId: string;
}

const getUserRole = (user: any): UserRole => (
    user?.app_metadata?.role || user?.user_metadata?.role || 'member'
) as UserRole;

const getDisplayName = (user: AppUser) => user.user_metadata?.name || user.email || 'User';

const formatDateLocal = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const normalizeDateKey = (dateValue: string) => dateValue.slice(0, 10);

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
    gridTemplateColumns: 'minmax(160px, 1.1fr) auto minmax(160px, 1.1fr) auto',
    gap: '12px',
    alignItems: 'end',
    padding: '12px',
    borderRadius: '12px',
    background: '#f9fafb',
    marginTop: '10px'
};

const addRowStyle: CSSProperties = {
    ...rowStyle,
    marginTop: '16px',
    border: '1px dashed #cbd5e1',
    background: '#ffffff'
};

const selectGroupStyle: CSSProperties = { display: 'grid', gap: '6px', minWidth: 0 };
const selectLabelStyle: CSSProperties = {
    fontSize: '0.72rem',
    fontWeight: 800,
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: '0.04em'
};
const relationArrowStyle: CSSProperties = {
    alignSelf: 'center',
    justifySelf: 'center',
    fontSize: '1.35rem',
    fontWeight: 900,
    color: '#2563eb',
    paddingBottom: '8px'
};

export default function TrainingPage() {
    const router = useRouter();

    const [userName, setUserName] = useState('');
    const [userRole, setUserRole] = useState<UserRole | null>(null);
    const [students, setStudents] = useState<OneToOneStudent[]>([]);
    const [coaches, setCoaches] = useState<AppUser[]>([]);
    const [sessions, setSessions] = useState<OneToOneSession[]>([]);
    const [draftSessions, setDraftSessions] = useState<Record<string, DraftSession>>({});
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [makeupSession, setMakeupSession] = useState<OneToOneSession | null>(null);
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

    const loadData = async () => {
        try {
            setLoading(true);
            setMessage('');

            const { data: studentData, error: studentError } = await supabase
                .from('one_to_one_students')
                .select('id, student_name, payment_amount, active')
                .eq('active', true)
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
                .from('one_to_one_sessions')
                .select('id, session_date, student_id, coach_id, removed_from_training, removed_at, attendance_status, attendance_updated_at, makeup_target_type, makeup_usage_id, created_at, updated_at')
                .or('removed_from_training.is.null,removed_from_training.eq.false')
                .gte('session_date', startDateKey)
                .lt('session_date', endDateKey)
                .order('session_date', { ascending: true })
                .order('id', { ascending: true });

            if (sessionError) throw sessionError;

            setStudents((studentData || []) as OneToOneStudent[]);
            setCoaches(coachList);
            setSessions(((sessionData || []) as OneToOneSession[]).map(session => ({
                ...session,
                session_date: normalizeDateKey(session.session_date)
            })));
        } catch (err: any) {
            console.error(err);
            setMessage(err?.message || 'Failed to load 1-1 training data');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [selectedMonth]);

    const getSessionsForDate = (date: string) => sessions.filter(s => s.session_date === date);

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
            alert('Please select both a coach and a student.');
            return;
        }

        const alreadyAdded = sessions.some(
            s => s.session_date === sessionDate && s.student_id === draft.studentId
        );

        if (alreadyAdded) {
            alert('This 1-1 student has already been added for this Sunday.');
            return;
        }

        try {
            const selectedStudent = students.find(student => student.id === draft.studentId);
            const paymentAmount = Number(selectedStudent?.payment_amount || 80);

            const { data: existingRows, error: existingError } = await supabase
                .from('one_to_one_sessions')
                .select('id, session_date, student_id, coach_id, removed_from_training, removed_at, payment_exempt, payment_exempt_at, attendance_status, attendance_updated_at, makeup_target_type, makeup_usage_id, created_at, updated_at')
                .eq('session_date', sessionDate)
                .eq('student_id', draft.studentId)
                .limit(1);

            if (existingError) throw existingError;

            const existingSession = existingRows?.[0];

            let savedSession: OneToOneSession;

            if (existingSession) {
                const { data, error } = await supabase
                    .from('one_to_one_sessions')
                    .update({
                        coach_id: draft.coachId,
                        removed_from_training: false,
                        removed_at: null,
                        payment_exempt: false,
                        payment_exempt_at: null,
                        attendance_status: 'scheduled',
                        attendance_updated_at: null,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', existingSession.id)
                    .select('id, session_date, student_id, coach_id, removed_from_training, removed_at, attendance_status, attendance_updated_at, makeup_target_type, makeup_usage_id, created_at, updated_at')
                    .single();

                if (error) throw error;

                savedSession = {
                    ...(data as OneToOneSession),
                    session_date: normalizeDateKey((data as OneToOneSession).session_date)
                };
            } else {
                const { data, error } = await supabase
                    .from('one_to_one_sessions')
                    .insert({
                        session_date: sessionDate,
                        student_id: draft.studentId,
                        coach_id: draft.coachId,
                        removed_from_training: false,
                        removed_at: null,
                        payment_exempt: false,
                        payment_exempt_at: null,
                        attendance_status: 'scheduled',
                        attendance_updated_at: null,
                        updated_at: new Date().toISOString()
                    })
                    .select('id, session_date, student_id, coach_id, removed_from_training, removed_at, attendance_status, attendance_updated_at, makeup_target_type, makeup_usage_id, created_at, updated_at')
                    .single();

                if (error) throw error;

                savedSession = {
                    ...(data as OneToOneSession),
                    session_date: normalizeDateKey((data as OneToOneSession).session_date)
                };
            }

            const { error: paymentError } = await supabase
                .from('training_payments')
                .upsert(
                    {
                        training_student_id: draft.studentId,
                        week_date: sessionDate,
                        paid: false,
                        amount: paymentAmount,
                        updated_at: new Date().toISOString()
                    },
                    { onConflict: 'training_student_id,week_date' }
                );

            if (paymentError) throw paymentError;

            setSessions(prev => {
                const withoutDuplicate = prev.filter(session => session.id !== savedSession.id);

                return [...withoutDuplicate, savedSession].sort((a, b) => {
                    const dateCompare = a.session_date.localeCompare(b.session_date);
                    return dateCompare !== 0 ? dateCompare : a.id - b.id;
                });
            });

            setDraftSessions(prev => ({
                ...prev,
                [sessionDate]: { studentId: '', coachId: '' }
            }));
        } catch (err: any) {
            alert(err?.message || 'Failed to add 1-1 training session');
        }
    };

    const updateSession = async (
        sessionId: number,
        patch: Partial<Pick<OneToOneSession, 'student_id' | 'coach_id'>>
    ) => {
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
                    alert('This 1-1 student has already been added for this Sunday.');
                    return;
                }
            }

            const { data, error } = await supabase
                .from('one_to_one_sessions')
                .update({ ...patch, updated_at: new Date().toISOString() })
                .eq('id', sessionId)
                .select('id, session_date, student_id, coach_id, removed_from_training, removed_at, attendance_status, attendance_updated_at, makeup_target_type, makeup_usage_id, created_at, updated_at')
                .single();

            if (error) throw error;

            const updatedSession = {
                ...(data as OneToOneSession),
                session_date: normalizeDateKey((data as OneToOneSession).session_date)
            };

            if (patch.student_id) {
                const selectedStudent = students.find(student => student.id === patch.student_id);
                const paymentAmount = Number(selectedStudent?.payment_amount || 80);

                const { error: paymentError } = await supabase
                    .from('training_payments')
                    .upsert(
                        {
                            training_student_id: patch.student_id,
                            week_date: updatedSession.session_date,
                            paid: false,
                            amount: paymentAmount,
                            updated_at: new Date().toISOString()
                        },
                        { onConflict: 'training_student_id,week_date' }
                    );

                if (paymentError) throw paymentError;
            }

            setSessions(prev => prev.map(s => s.id === sessionId ? updatedSession : s));
        } catch (err: any) {
            alert(err?.message || 'Failed to update 1-1 training session');
        }
    };

    const updateAttendanceStatus = async (
        sessionId: number,
        nextStatus: 'scheduled' | 'attended' | 'missed'
    ) => {
        const session = sessions.find((item) => item.id === sessionId);
        if (!session) return;

        const currentStatus = session.attendance_status || 'scheduled';

        if (currentStatus === nextStatus) {
            alert(`This lesson is already marked as ${nextStatus}.`);
            return;
        }

        if (currentStatus === 'makeup' && nextStatus !== 'scheduled') {
            alert('Please press Undo first to return the makeup lesson to Missed.');
            return;
        }

        const actionText =
            currentStatus === 'makeup' && nextStatus === 'scheduled'
                ? 'undo this makeup and return it to Missed'
                : nextStatus === 'missed'
                    ? 'mark this lesson as missed'
                    : nextStatus === 'attended'
                        ? 'mark this lesson as attended'
                        : 'undo the attendance status';

        if (!window.confirm(`Are you sure you want to ${actionText}?`)) {
            return;
        }

        try {
            if (currentStatus === 'makeup' && nextStatus === 'scheduled') {
                const { data, error } = await supabase.rpc(
                    'undo_one_to_one_makeup_status',
                    {
                        input_session_id: sessionId,
                    }
                );

                if (error) throw error;

                const updatedRow = Array.isArray(data) ? data[0] : data;

                if (!updatedRow) {
                    throw new Error('The 1-1 makeup could not be undone.');
                }

                const updatedSession = {
                    ...(updatedRow as OneToOneSession),
                    session_date: normalizeDateKey(
                        (updatedRow as OneToOneSession).session_date
                    ),
                };

                setSessions((prev) =>
                    prev.map((item) =>
                        item.id === sessionId ? updatedSession : item
                    )
                );

                return;
            }

            const { data, error } = await supabase
                .from('one_to_one_sessions')
                .update({
                    attendance_status: nextStatus,
                    attendance_updated_at:
                        nextStatus === 'scheduled' ? null : new Date().toISOString(),
                    makeup_target_type: null,
                    makeup_usage_id: null,
                    updated_at: new Date().toISOString()
                })
                .eq('id', sessionId)
                .select(
                    'id, session_date, student_id, coach_id, removed_from_training, removed_at, payment_exempt, payment_exempt_at, attendance_status, attendance_updated_at, makeup_target_type, makeup_usage_id, created_at, updated_at'
                )
                .single();

            if (error) throw error;

            const updatedSession = {
                ...(data as OneToOneSession),
                session_date: normalizeDateKey(
                    (data as OneToOneSession).session_date
                )
            };

            setSessions((prev) =>
                prev.map((item) =>
                    item.id === sessionId ? updatedSession : item
                )
            );
        } catch (err: any) {
            alert(err?.message || 'Failed to update 1-1 attendance.');
        }
    };

    const completeOneToOneMakeup = async (selection: MakeupSelectionResult) => {
        if (!makeupSession) return;

        try {
            const { data, error } = await supabase
                .from('one_to_one_sessions')
                .update({
                    attendance_status: 'makeup',
                    attendance_updated_at: new Date().toISOString(),
                    makeup_target_type: selection.targetTrainingType,
                    makeup_usage_id: selection.usageId,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', makeupSession.id)
                .select(
                    'id, session_date, student_id, coach_id, removed_from_training, removed_at, payment_exempt, payment_exempt_at, attendance_status, attendance_updated_at, makeup_target_type, makeup_usage_id, created_at, updated_at'
                )
                .single();

            if (error) throw error;

            setSessions((prev) =>
                prev.map((item) =>
                    item.id === makeupSession.id
                        ? {
                            ...(data as OneToOneSession),
                            session_date: normalizeDateKey((data as OneToOneSession).session_date),
                        }
                        : item
                )
            );
        } catch (err) {
            await supabase.rpc('undo_cross_programme_makeup', {
                input_usage_id: selection.usageId,
            });
            throw err;
        }
    };

    const deleteSession = async (sessionId: number) => {
        const confirmed = window.confirm(
            'Remove this pair from the 1-on-1 training attendance page?\n\nThis will NOT remove it from /trngpayment because the student still has to pay for the booked lesson.'
        );
        if (!confirmed) return;

        try {
            const { error } = await supabase
                .from('one_to_one_sessions')
                .update({
                    removed_from_training: true,
                    removed_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .eq('id', sessionId);

            if (error) throw error;

            setSessions(prev => prev.filter(s => s.id !== sessionId));
        } catch (err: any) {
            alert(err?.message || 'Failed to remove 1-1 training session');
        }
    };

    const studentName = (id: string) => students.find(s => s.id === id)?.student_name || 'Missing 1-1 student';
    const coachName = (id: string) => coaches.find(c => c.id === id) ? getDisplayName(coaches.find(c => c.id === id)!) : 'Unassigned coach';

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
            <AppHeader title="1-on-1 Training" userName={userName} userRole={userRole} mode="dashboard" />

            <main className="training-page-main">
                <div className="filter-box training-toolbar">
                    <div className="filter-grid training-toolbar-grid">
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
                    <div className="filter-buttons training-toolbar-actions">
                        <Link href="/training/add" className="filter-button" style={{ textAlign: 'center', textDecoration: 'none' }}>
                            Add 1-1 Student
                        </Link>
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
                                                <div style={selectGroupStyle}>
                                                    <span style={selectLabelStyle}>Coach</span>
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
                                                </div>

                                                <span style={relationArrowStyle}>→</span>

                                                <div style={selectGroupStyle}>
                                                    <span style={selectLabelStyle}>1-1 Student</span>
                                                    <select
                                                        className="student-field-select"
                                                        value={session.student_id}
                                                        onChange={(e) => updateSession(session.id, { student_id: e.target.value })}
                                                        aria-label="1-1 Student"
                                                    >
                                                        <option value="">Select 1-1 student</option>
                                                        {students.map((s) => (
                                                            <option key={s.id} value={s.id}>
                                                                {s.student_name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>

                                                <button className="btn share-btn logout" onClick={() => deleteSession(session.id)} type="button">
                                                    Remove
                                                </button>

                                                <div
                                                    style={{
                                                        gridColumn: '1 / -1',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'space-between',
                                                        gap: '12px',
                                                        flexWrap: 'wrap',
                                                        paddingTop: '10px',
                                                        borderTop: '1px solid #e5e7eb'
                                                    }}
                                                >
                                                    <div>
                            <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#64748b' }}>
                              ATTENDANCE
                            </span>
                                                        <div style={{ marginTop: '4px', fontWeight: 800, color: '#111827' }}>
                                                            {session.attendance_status === 'makeup'
                                                                ? `MAKEUP${session.makeup_target_type && session.makeup_target_type !== 'one_to_one'
                                                                    ? `, ${session.makeup_target_type === 'weekend' ? 'WEEKEND' : session.makeup_target_type.toUpperCase()}`
                                                                    : ''}`
                                                                : (session.attendance_status || 'scheduled').toUpperCase()}
                                                        </div>
                                                    </div>

                                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                                        <button
                                                            type="button"
                                                            className="btn share-btn"
                                                            onClick={() => updateAttendanceStatus(session.id, 'attended')}
                                                            disabled={
                                                                (session.attendance_status || 'scheduled') === 'attended'
                                                                || session.attendance_status === 'makeup'
                                                            }
                                                        >
                                                            Attended
                                                        </button>

                                                        <button
                                                            type="button"
                                                            className="btn share-btn logout"
                                                            onClick={() => updateAttendanceStatus(session.id, 'missed')}
                                                            disabled={
                                                                (session.attendance_status || 'scheduled') === 'missed'
                                                                || session.attendance_status === 'makeup'
                                                            }
                                                        >
                                                            Missed
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="btn share-btn"
                                                            onClick={() => setMakeupSession(session)}
                                                            disabled={(session.attendance_status || 'scheduled') !== 'missed'}
                                                        >
                                                            Makeup
                                                        </button>

                                                        <button
                                                            type="button"
                                                            className="btn share-btn"
                                                            onClick={() => updateAttendanceStatus(session.id, 'scheduled')}
                                                            disabled={(session.attendance_status || 'scheduled') === 'scheduled'}
                                                        >
                                                            Undo
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div style={addRowStyle}>
                                    <div style={selectGroupStyle}>
                                        <span style={selectLabelStyle}>Coach</span>
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
                                    </div>

                                    <span style={relationArrowStyle}>→</span>

                                    <div style={selectGroupStyle}>
                                        <span style={selectLabelStyle}>1-1 Student</span>
                                        <select
                                            className="student-field-select"
                                            value={draft.studentId}
                                            onChange={(e) => updateDraft(dateKey, { studentId: e.target.value })}
                                            aria-label="Add 1-1 student"
                                        >
                                            <option value="">Choose 1-1 student</option>
                                            {students.map((s) => (
                                                <option key={s.id} value={s.id}>
                                                    {s.student_name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    <button className="btn share-btn" onClick={() => createSession(dateKey)} type="button">
                                        Add Pair
                                    </button>
                                </div>
                            </section>
                        );
                    })}
                </div>

                <CrossProgrammeMakeupModal
                    open={Boolean(makeupSession)}
                    sourceTrainingType="one_to_one"
                    sourceStudentId={makeupSession?.student_id || ''}
                    studentName={students.find((student) => student.id === makeupSession?.student_id)?.student_name || ''}
                    onClose={() => setMakeupSession(null)}
                    onCompleted={completeOneToOneMakeup}
                />
            </main>
        </div>
    );
}
