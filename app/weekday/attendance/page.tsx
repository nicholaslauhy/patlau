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
type WeekdayName = 'Monday' | 'Wednesday' | 'Thursday';
type AttendanceStatus = 'attended' | 'missed' | 'makeup';

interface WeekdaySchedule {
    day: WeekdayName;
    duration_hours?: number;
    duration?: number;
}

interface WeekdayStudent {
    id: string;
    student_name: string;
    schedules: WeekdaySchedule[];
    hourly_rate: number;
    active: boolean;
    created_at?: string;
    updated_at?: string;
    makeup_target_type?: string | null;
    makeup_usage_id?: string | null;
}

interface WeekdayAttendance {
    id: number;
    weekday_student_id: string;
    attendance_date: string;
    day_name: WeekdayName;
    status: AttendanceStatus;
    duration_hours: number;
    created_at: string;
    updated_at?: string;
}

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const DAY_OPTIONS: WeekdayName[] = ['Monday', 'Wednesday', 'Thursday'];
const DAY_INDEX: Record<WeekdayName, number> = { Monday: 1, Wednesday: 3, Thursday: 4 };

const getUserRole = (user: any): UserRole => {
    return (user?.app_metadata?.role || user?.user_metadata?.role || 'member') as UserRole;
};

const formatDateLocal = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const readableDate = (dateKey: string) => {
    const [year, month, day] = dateKey.slice(0, 10).split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'numeric',
        year: '2-digit',
    });
};

const statusLabel = (status: AttendanceStatus) => {
    if (status === 'attended') return 'marked';
    return status;
};

const scheduleHours = (schedule: WeekdaySchedule) => {
    return Number(schedule.duration_hours ?? schedule.duration ?? 0) || 0;
};

export default function WeekdayAttendancePage() {
    const router = useRouter();
    const [userName, setUserName] = useState('');
    const [userRole, setUserRole] = useState<UserRole | null>(null);
    const [students, setStudents] = useState<WeekdayStudent[]>([]);
    const [attendance, setAttendance] = useState<WeekdayAttendance[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedDay, setSelectedDay] = useState<'all' | WeekdayName>('all');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [makeupContext, setMakeupContext] = useState<{ student: WeekdayStudent; day: WeekdayName; hours: number } | null>(null);
    const [rowHours, setRowHours] = useState<Record<string, number>>({});

    const today = new Date();
    const todayKey = formatDateLocal(today);
    const todayDayName = DAY_OPTIONS.find((day) => DAY_INDEX[day] === today.getDay());

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
                .from('weekday_students')
                .select('*')
                .eq('active', true)
                .order('student_name', { ascending: true });

            if (studentError) throw studentError;

            const { data: attendanceData, error: attendanceError } = await supabase
                .from('weekday_attendance')
                .select('*')
                .order('attendance_date', { ascending: false })
                .order('created_at', { ascending: false });

            if (attendanceError) throw attendanceError;

            setStudents((studentData || []) as WeekdayStudent[]);
            setAttendance(((attendanceData || []) as WeekdayAttendance[]).map((record) => ({
                ...record,
                attendance_date: record.attendance_date.slice(0, 10),
            })));
        } catch (err: any) {
            setMessage(err?.message || 'Failed to load weekday attendance.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (userRole) loadData();
    }, [userRole]);

    const rows = useMemo(() => {
        const normalizedSearch = searchTerm.trim().toLowerCase();

        return students.flatMap((student) => {
            const schedules = Array.isArray(student.schedules) ? student.schedules : [];

            return schedules
                .filter((schedule) => selectedDay === 'all' || schedule.day === selectedDay)
                .map((schedule) => {
                    const records = attendance.filter(
                        (record) => record.weekday_student_id === student.id && record.day_name === schedule.day
                    );

                    const missedHours = records
                        .filter((record) => record.status === 'missed')
                        .reduce((sum, record) => sum + Number(record.duration_hours || 0), 0);

                    const makeupHours = records
                        .filter((record) => record.status === 'makeup')
                        .reduce((sum, record) => sum + Number(record.duration_hours || 0), 0);

                    const makeupBalance = Math.max(0, missedHours - makeupHours);

                    return {
                        student,
                        schedule,
                        records,
                        makeupBalance,
                    };
                });
        }).filter((row) => {
            if (!normalizedSearch) return true;

            const searchable = [
                row.student.student_name,
                row.schedule.day,
                `${scheduleHours(row.schedule)}h`,
                ...row.records.map((record) => `${readableDate(record.attendance_date)} ${record.duration_hours}h ${record.status}`),
            ].join(' ').toLowerCase();

            return searchable.includes(normalizedSearch);
        });
    }, [students, attendance, searchTerm, selectedDay]);

    const groupedRows = DAY_OPTIONS.map((day) => ({
        day,
        rows: rows.filter((row) => row.schedule.day === day),
    })).filter((group) => selectedDay === 'all' || group.day === selectedDay);

    const getRowKey = (studentId: string, day: WeekdayName) => `${studentId}-${day}`;

    const getHoursForRow = (studentId: string, schedule: WeekdaySchedule) => {
        const key = getRowKey(studentId, schedule.day);
        return Number(rowHours[key] ?? scheduleHours(schedule) ?? 0) || 0;
    };

    const setHoursForRow = (studentId: string, day: WeekdayName, value: number) => {
        setRowHours((prev) => ({ ...prev, [getRowKey(studentId, day)]: value }));
    };

    const insertAttendance = async (
        studentId: string,
        day: WeekdayName,
        status: AttendanceStatus,
        hours: number
    ) => {
        if (status === 'makeup') {
            const student = students.find((item) => item.id === studentId);

            if (!student) {
                alert('Student not found.');
                return;
            }

            setMakeupContext({ student, day, hours });
            return;
        }

        if (hours <= 0) {
            alert('Number of hours must be more than 0.');
            return;
        }

        if ((status === 'attended' || status === 'missed') && todayDayName !== day) {
            alert(`You can only ${status === 'attended' ? 'mark attendance' : 'mark missed'} on ${day}.`);
            return;
        }

        try {
            const { data, error } = await supabase
                .from('weekday_attendance')
                .insert({
                    weekday_student_id: studentId,
                    attendance_date: todayKey,
                    day_name: day,
                    status,
                    duration_hours: hours,
                    updated_at: new Date().toISOString(),
                })
                .select('*')
                .single();

            if (error) throw error;

            setAttendance((prev) => [
                { ...(data as WeekdayAttendance), attendance_date: (data as WeekdayAttendance).attendance_date.slice(0, 10) },
                ...prev,
            ]);
        } catch (err: any) {
            alert(err?.message || 'Failed to update weekday attendance.');
            await loadData();
        }
    };

    const completeWeekdayMakeup = async (selection: MakeupSelectionResult) => {
        if (!makeupContext) return;

        try {
            const { data, error } = await supabase
                .from('weekday_attendance')
                .insert({
                    weekday_student_id: makeupContext.student.id,
                    attendance_date: selection.targetDate,
                    day_name: makeupContext.day,
                    status: 'makeup',
                    duration_hours: makeupContext.hours,
                    makeup_target_type: selection.targetTrainingType,
                    makeup_usage_id: selection.usageId,
                    updated_at: new Date().toISOString(),
                })
                .select('*')
                .single();

            if (error) throw error;

            setAttendance((prev) => [
                { ...(data as WeekdayAttendance), attendance_date: (data as WeekdayAttendance).attendance_date.slice(0, 10) },
                ...prev,
            ]);
        } catch (err) {
            await supabase.rpc('undo_cross_programme_makeup', {
                input_usage_id: selection.usageId,
            });
            throw err;
        }
    };

    const undoLatest = async (studentId: string, day: WeekdayName) => {
        const latestRecord = attendance
            .filter((record) => record.weekday_student_id === studentId && record.day_name === day)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

        if (!latestRecord) {
            alert('Nothing to undo for this student/session.');
            return;
        }

        if (!confirm(`Undo latest ${statusLabel(latestRecord.status)} record for ${day}?`)) return;

        try {
            const { error } = await supabase
                .from('weekday_attendance')
                .delete()
                .eq('id', latestRecord.id);

            if (error) throw error;

            setAttendance((prev) => prev.filter((record) => record.id !== latestRecord.id));
        } catch (err: any) {
            alert(err?.message || 'Failed to undo latest weekday attendance action.');
            await loadData();
        }
    };

    const removeSchedule = async (student: WeekdayStudent, day: WeekdayName) => {
        if (!confirm(`Remove ${student.student_name} from ${day}? Other days will stay unchanged.`)) return;

        const nextSchedules = (student.schedules || []).filter((schedule) => schedule.day !== day);

        try {
            const { data, error } = await supabase
                .from('weekday_students')
                .update({
                    schedules: nextSchedules,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', student.id)
                .select('*')
                .single();

            if (error) throw error;

            setStudents((prev) => prev.map((s) => (s.id === student.id ? (data as WeekdayStudent) : s)));
        } catch (err: any) {
            alert(err?.message || 'Failed to remove weekday session.');
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
                        You do not have permission to access Weekday. Please return to the dashboard or logout.
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
            <AppHeader title="Weekday Attendance" userName={userName} userRole={userRole} mode="dashboard" />

            <main>
                <div className="search-box">
                    <input
                        type="text"
                        placeholder="Search by student, day, date, status, or hours..."
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                    />
                </div>

                <div className="filter-box">
                    <div className="filter-grid">
                        <div className="filter-group">
                            <label className="filter-label">
                                Day
                                <select
                                    value={selectedDay}
                                    onChange={(event) => setSelectedDay(event.target.value as 'all' | WeekdayName)}
                                    className="filter-input"
                                >
                                    <option value="all">All</option>
                                    {DAY_OPTIONS.map((day) => (
                                        <option key={day} value={day}>{day}</option>
                                    ))}
                                </select>
                            </label>
                        </div>
                    </div>

                    <div className="filter-buttons">
                        <button type="button" className="filter-button" onClick={loadData}>Refresh</button>
                    </div>
                </div>

                {message && <p className="dashboard-error-message">{message}</p>}
                {loading && <p className="muted">Loading weekday attendance...</p>}

                {!loading && groupedRows.map((group) => (
                    <section key={group.day} style={{ marginTop: 22 }}>
                        <h2 style={{ marginBottom: 10 }}>{group.day}</h2>

                        {group.rows.length === 0 ? (
                            <p className="muted">No students found for {group.day}.</p>
                        ) : (
                            <div className="table-container">
                                <div className="table-scroll">
                                    <table>
                                        <thead>
                                        <tr>
                                            <th>Name</th>
                                            <th>Session Hours</th>
                                            <th>Makeup Balance</th>
                                            <th>Actions</th>
                                            <th>Attendance History</th>
                                            <th>Remove Day</th>
                                        </tr>
                                        </thead>
                                        <tbody>
                                        {group.rows.map(({ student, schedule, records, makeupBalance }) => {
                                            const hours = getHoursForRow(student.id, schedule);
                                            const canMarkScheduled = todayDayName === schedule.day;
                                            const hasRecords = records.length > 0;

                                            return (
                                                <tr key={getRowKey(student.id, schedule.day)}>
                                                    <td>{student.student_name}</td>
                                                    <td>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                            <input
                                                                className="weeks-input"
                                                                type="number"
                                                                min="0.25"
                                                                step="0.25"
                                                                value={hours}
                                                                onChange={(event) => setHoursForRow(student.id, schedule.day, Number(event.target.value))}
                                                            />
                                                            <strong>h</strong>
                                                        </div>
                                                    </td>
                                                    <td>{makeupBalance.toFixed(2)}h</td>
                                                    <td className="actions-cell">
                                                        <div className="actions-row" style={{ flexWrap: 'nowrap' }}>
                                                            <button
                                                                type="button"
                                                                className="attendance-btn"
                                                                disabled={!canMarkScheduled}
                                                                title={canMarkScheduled ? 'Mark attended' : `Can only mark on ${schedule.day}`}
                                                                onClick={() => insertAttendance(student.id, schedule.day, 'attended', hours)}
                                                            >
                                                                Mark
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="missed-btn"
                                                                disabled={!canMarkScheduled}
                                                                title={canMarkScheduled ? 'Mark missed' : `Can only mark missed on ${schedule.day}`}
                                                                onClick={() => insertAttendance(student.id, schedule.day, 'missed', hours)}
                                                            >
                                                                Missed
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="makeup-btn"
                                                                disabled={makeupBalance <= 0}
                                                                title={makeupBalance <= 0 ? 'No missed hours to makeup' : 'Record makeup hours'}
                                                                onClick={() => insertAttendance(student.id, schedule.day, 'makeup', Math.min(hours, makeupBalance))}
                                                            >
                                                                Makeup
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="undo-btn"
                                                                disabled={!hasRecords}
                                                                onClick={() => undoLatest(student.id, schedule.day)}
                                                            >
                                                                Undo
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td className="attendance-history">
                                                        {records.length === 0 ? (
                                                            <span className="muted">No history</span>
                                                        ) : (
                                                            <ul>
                                                                {records.slice(0, 8).map((record) => (
                                                                    <li key={record.id}>
                                                                        {readableDate(record.attendance_date)}, {Number(record.duration_hours).toFixed(2).replace(/\.00$/, '')}h
                                                                        {record.status !== 'attended' ? ` (${record.status})` : ''}
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        )}
                                                    </td>
                                                    <td>
                                                        <button
                                                            type="button"
                                                            className="delete-btn"
                                                            onClick={() => removeSchedule(student, schedule.day)}
                                                        >
                                                            Remove
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </section>
                ))}

                <CrossProgrammeMakeupModal
                    open={Boolean(makeupContext)}
                    sourceTrainingType="weekday"
                    sourceStudentId={makeupContext?.student.id || ''}
                    studentName={makeupContext?.student.student_name || ''}
                    onClose={() => setMakeupContext(null)}
                    onCompleted={completeWeekdayMakeup}
                />
            </main>
        </div>
    );
}
