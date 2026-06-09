'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';
import AppHeader from './../../components/AppHeader';
import CrossProgrammeMakeupModal, { MakeupSelectionResult } from './../../components/CrossProgrammeMakeupModal';
import './../../styles.css';
import './../../dashboard/dashboard.css';

type UserRole = 'superuser' | 'admin' | 'member';
type AttendanceStatus = 'attended' | 'missed' | 'makeup';

interface MatchPlayStudent {
    id: string;
    student_name: string;
    number_of_weeks: number;
    price_per_session: number;
    active: boolean;
    created_at?: string;
    updated_at?: string;
    makeup_target_type?: string | null;
    makeup_usage_id?: string | null;
}

interface MatchPlayAttendance {
    id: number;
    matchplay_student_id: string;
    attendance_date: string;
    status: AttendanceStatus;
    created_at: string;
    updated_at?: string;
    makeup_target_type?: 'weekend' | 'one_to_one' | 'weekday' | 'matchplay' | null;
    makeup_usage_id?: string | null;
}

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const getUserRole = (user: any): UserRole => {
    return (user?.app_metadata?.role || user?.user_metadata?.role || 'member') as UserRole;
};

const formatDate = (dateValue: string) => {
    const parsed = new Date(dateValue);
    return Number.isNaN(parsed.getTime()) ? dateValue : parsed.toLocaleDateString();
};

export default function MatchPlayAttendancePage() {
    const router = useRouter();
    const [userName, setUserName] = useState('');
    const [userRole, setUserRole] = useState<UserRole | null>(null);
    const [students, setStudents] = useState<MatchPlayStudent[]>([]);
    const [attendanceRows, setAttendanceRows] = useState<MatchPlayAttendance[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [makeupStudent, setMakeupStudent] = useState<MatchPlayStudent | null>(null);

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

    const loadData = async () => {
        try {
            setLoading(true);
            setMessage('');

            const { data: studentData, error: studentError } = await supabase
                .from('matchplay_students')
                .select('*')
                .eq('active', true)
                .order('student_name', { ascending: true });

            if (studentError) throw studentError;

            const { data: attendanceData, error: attendanceError } = await supabase
                .from('matchplay_attendance')
                .select('*')
                .order('attendance_date', { ascending: false })
                .order('id', { ascending: false });

            if (attendanceError) throw attendanceError;

            setStudents((studentData || []) as MatchPlayStudent[]);
            setAttendanceRows((attendanceData || []) as MatchPlayAttendance[]);
        } catch (err: any) {
            setMessage(err?.message || 'Failed to load MatchPlay attendance.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (userRole) loadData();
    }, [userRole]);

    const getAttendanceForStudent = (studentId: string) => {
        return attendanceRows.filter((row) => row.matchplay_student_id === studentId);
    };

    const filteredStudents = useMemo(() => {
        const normalizedSearch = searchTerm.trim().toLowerCase();
        if (!normalizedSearch) return students;

        return students.filter((student) => {
            const history = getAttendanceForStudent(student.id)
                .map((row) => `${formatDate(row.attendance_date)} ${row.status}`)
                .join(' ')
                .toLowerCase();

            return [
                student.student_name,
                `${student.number_of_weeks} weeks`,
                `S$${Number(student.price_per_session || 0).toFixed(2)}`,
                history,
            ].join(' ').toLowerCase().includes(normalizedSearch);
        });
    }, [students, attendanceRows, searchTerm]);

    const updateStudent = async (
        studentId: string,
        patch: Partial<Pick<MatchPlayStudent, 'number_of_weeks' | 'price_per_session'>>
    ) => {
        try {
            const { data, error } = await supabase
                .from('matchplay_students')
                .update({
                    ...patch,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', studentId)
                .select('*')
                .single();

            if (error) throw error;

            const updatedStudent = data as MatchPlayStudent;
            setStudents((prev) => prev.map((student) => student.id === studentId ? updatedStudent : student));
        } catch (err: any) {
            alert(err?.message || 'Failed to update MatchPlay student.');
            await loadData();
        }
    };

    const addAttendance = async (studentId: string, status: AttendanceStatus) => {
        try {
            const today = new Date().toISOString().slice(0, 10);

            const { data, error } = await supabase
                .from('matchplay_attendance')
                .insert({
                    matchplay_student_id: studentId,
                    attendance_date: today,
                    status,
                    updated_at: new Date().toISOString(),
                })
                .select('*')
                .single();

            if (error) throw error;

            setAttendanceRows((prev) => [data as MatchPlayAttendance, ...prev]);
        } catch (err: any) {
            alert(err?.message || 'Failed to record MatchPlay attendance.');
            await loadData();
        }
    };

    const completeMatchPlayMakeup = async (selection: MakeupSelectionResult) => {
        if (!makeupStudent) return;

        try {
            const { data, error } = await supabase
                .from('matchplay_attendance')
                .insert({
                    matchplay_student_id: makeupStudent.id,
                    attendance_date: selection.targetDate,
                    status: 'makeup',
                    makeup_target_type: selection.targetTrainingType,
                    makeup_usage_id: selection.usageId,
                    updated_at: new Date().toISOString(),
                })
                .select('*')
                .single();

            if (error) throw error;

            setAttendanceRows((prev) => [data as MatchPlayAttendance, ...prev]);
        } catch (err) {
            await supabase.rpc('undo_cross_programme_makeup', {
                input_usage_id: selection.usageId,
            });
            throw err;
        }
    };

    const undoLatest = async (studentId: string) => {
        const latest = getAttendanceForStudent(studentId)[0];

        if (!latest) {
            alert('Nothing to undo for this student.');
            return;
        }

        if (!confirm(`Undo latest MatchPlay attendance action on ${formatDate(latest.attendance_date)}?`)) {
            return;
        }

        try {
            const { error } = await supabase
                .from('matchplay_attendance')
                .delete()
                .eq('id', latest.id);

            if (error) throw error;

            setAttendanceRows((prev) => prev.filter((row) => row.id !== latest.id));
        } catch (err: any) {
            alert(err?.message || 'Failed to undo latest MatchPlay attendance action.');
            await loadData();
        }
    };

    const resetAttendance = async (studentId: string, studentName: string) => {
        if (!confirm(`Reset all MatchPlay attendance for ${studentName}?`)) return;

        try {
            const history = getAttendanceForStudent(studentId);

            for (const row of history) {
                if (row.status === 'makeup' && row.makeup_usage_id) {
                    const { error: undoError } = await supabase.rpc(
                        'undo_cross_programme_makeup',
                        { input_usage_id: row.makeup_usage_id }
                    );

                    if (undoError) throw undoError;
                }
            }

            const { error } = await supabase
                .from('matchplay_attendance')
                .delete()
                .eq('matchplay_student_id', studentId);

            if (error) throw error;

            setAttendanceRows((prev) =>
                prev.filter((row) => row.matchplay_student_id !== studentId)
            );
        } catch (err: any) {
            alert(err?.message || 'Failed to reset MatchPlay attendance.');
            await loadData();
        }
    };

    const removeStudent = async (studentId: string, studentName: string) => {
        if (!confirm(`Remove ${studentName} from MatchPlay? This hides them from attendance and payment pages.`)) {
            return;
        }

        try {
            const { data, error } = await supabase
                .from('matchplay_students')
                .update({
                    active: false,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', studentId)
                .select('*')
                .single();

            if (error) throw error;

            setStudents((prev) => prev.filter((student) => student.id !== (data as MatchPlayStudent).id));
        } catch (err: any) {
            alert(err?.message || 'Failed to remove MatchPlay student.');
            await loadData();
        }
    };

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
            <AppHeader title="MatchPlay Attendance" userName={userName} userRole={userRole} mode="dashboard" />

            <main
                style={{
                    position: 'relative',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 'calc(100vw - 32px)',
                    maxWidth: 1180,
                    margin: 0,
                    padding: '24px 0 48px',
                    boxSizing: 'border-box',
                }}
            >
                <div
                    className="search-box"
                    style={{
                        display: 'flex',
                        justifyContent: 'center',
                        width: '100%',
                        margin: '0 auto 28px',
                        boxSizing: 'border-box',
                    }}
                >
                    <input
                        type="text"
                        placeholder="Search by student, weeks, price, date, attended/missed..."
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                        style={{
                            width: 'min(520px, 100%)',
                            maxWidth: 520,
                            boxSizing: 'border-box',
                        }}
                    />
                </div>

                {message && <p className="dashboard-error-message">{message}</p>}
                {loading && <p className="muted">Loading MatchPlay attendance...</p>}

                {!loading && filteredStudents.length === 0 && (
                    <p className="muted">No MatchPlay students found.</p>
                )}

                {!loading && filteredStudents.length > 0 && (
                    <div
                        className="table-container"
                        style={{
                            width: '100%',
                            maxWidth: 1180,
                            margin: '0 auto',
                            overflow: 'hidden',
                            boxSizing: 'border-box',
                        }}
                    >
                        <div
                            className="table-scroll"
                            style={{
                                width: '100%',
                                maxWidth: '100%',
                                overflowX: 'auto',
                                boxSizing: 'border-box',
                            }}
                        >
                            <table
                                style={{
                                    minWidth: 1080,
                                    width: '100%',
                                    margin: '0 auto',
                                }}
                            >
                                <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Weeks</th>
                                    <th>Price / Session</th>
                                    <th>Attended</th>
                                    <th>Missed</th>
                                    <th>Actions</th>
                                    <th>Attendance History</th>
                                </tr>
                                </thead>
                                <tbody>
                                {filteredStudents.map((student) => {
                                    const history = getAttendanceForStudent(student.id);
                                    const attended = history.filter((row) => row.status === 'attended').length;
                                    const missed = history.filter((row) => row.status === 'missed').length;

                                    return (
                                        <tr key={student.id}>
                                            <td>{student.student_name}</td>
                                            <td>
                                                <input
                                                    className="weeks-input"
                                                    type="number"
                                                    min="1"
                                                    step="1"
                                                    value={student.number_of_weeks}
                                                    onChange={(event) =>
                                                        updateStudent(student.id, { number_of_weeks: Number(event.target.value) })
                                                    }
                                                />
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <span>S$</span>
                                                    <input
                                                        className="weeks-input"
                                                        type="number"
                                                        min="0"
                                                        step="0.01"
                                                        value={student.price_per_session}
                                                        onChange={(event) =>
                                                            updateStudent(student.id, { price_per_session: Number(event.target.value) })
                                                        }
                                                    />
                                                </div>
                                            </td>
                                            <td className="lessons-count">{attended}</td>
                                            <td className="missed-count">{missed}</td>
                                            <td
                                                className="actions-cell"
                                                style={{
                                                    minWidth: 330,
                                                    width: 330,
                                                    verticalAlign: 'middle',
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        gap: 8,
                                                        width: '100%',
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            display: 'flex',
                                                            flexWrap: 'nowrap',
                                                            gap: 7,
                                                            alignItems: 'center',
                                                            width: '100%',
                                                        }}
                                                    >
                                                        <button type="button" className="attendance-btn" onClick={() => addAttendance(student.id, 'attended')}>
                                                            Mark
                                                        </button>
                                                        <button type="button" className="missed-btn" onClick={() => addAttendance(student.id, 'missed')}>
                                                            Missed
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="attendance-btn"
                                                            onClick={() => setMakeupStudent(student)}
                                                            disabled={missed <= 0}
                                                        >
                                                            Makeup
                                                        </button>
                                                        <button type="button" className="undo-btn" onClick={() => undoLatest(student.id)} disabled={history.length === 0}>
                                                            Undo
                                                        </button>
                                                    </div>

                                                    <div
                                                        style={{
                                                            display: 'flex',
                                                            gap: 7,
                                                            alignItems: 'center',
                                                            justifyContent: 'flex-start',
                                                            width: '100%',
                                                        }}
                                                    >
                                                        <button
                                                            type="button"
                                                            className="reset-btn"
                                                            onClick={() => resetAttendance(student.id, student.student_name)}
                                                            disabled={history.length === 0}
                                                            style={{
                                                                flex: '0 0 auto',
                                                                width: 'auto',
                                                                minWidth: 0,
                                                                padding: '6px 12px',
                                                            }}
                                                        >
                                                            Reset
                                                        </button>

                                                        <button
                                                            type="button"
                                                            className="delete-btn"
                                                            onClick={() => removeStudent(student.id, student.student_name)}
                                                            style={{
                                                                flex: '0 0 auto',
                                                                width: 'auto',
                                                                minWidth: 0,
                                                                padding: '6px 12px',
                                                            }}
                                                        >
                                                            Remove
                                                        </button>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="attendance-history">
                                                {history.length === 0 ? (
                                                    <span className="muted">No history</span>
                                                ) : (
                                                    <ul>
                                                        {history.slice(0, 8).map((row) => (
                                                            <li key={row.id}>
                                                                {formatDate(row.attendance_date)}
                                                                {row.status === 'missed' ? ' (missed)' : ''}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                <CrossProgrammeMakeupModal
                    open={Boolean(makeupStudent)}
                    sourceTrainingType="matchplay"
                    sourceStudentId={makeupStudent?.id || ''}
                    studentName={makeupStudent?.student_name || ''}
                    onClose={() => setMakeupStudent(null)}
                    onCompleted={completeMatchPlayMakeup}
                />
            </main>
        </div>
    );
}
