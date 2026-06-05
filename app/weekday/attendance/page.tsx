'use client'

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';
import AppHeader from './../../components/AppHeader';
import './../../styles.css';
import './../../dashboard/dashboard.css';

type UserRole = 'superuser' | 'admin' | 'member';
type WeekdayName = 'Monday' | 'Wednesday' | 'Thursday';
type WeekdayStatus = 'attended' | 'missed' | 'makeup';

interface WeekdaySchedule {
    day: WeekdayName;
    duration: number;
}

interface WeekdayStudent {
    id: string;
    student_name: string;
    schedules: WeekdaySchedule[];
    total_payment_amount: number;
    active: boolean;
}

interface WeekdayAttendanceRecord {
    id: number;
    weekday_student_id: string;
    attendance_date: string;
    day_name: WeekdayName;
    status: WeekdayStatus;
    duration_hours: number;
    created_at: string;
}

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const getDateKey = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const getMonthRange = (monthValue: string) => {
    const [yearStr, monthStr] = monthValue.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    return {
        start: `${monthValue}-01`,
        end: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`
    };
};

const readableDate = (dateKey: string) => {
    const [year, month, day] = dateKey.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short'
    });
};

export default function WeekdayAttendancePage() {
    const router = useRouter();
    const [userName, setUserName] = useState('');
    const [userRole, setUserRole] = useState<UserRole | null>(null);
    const [students, setStudents] = useState<WeekdayStudent[]>([]);
    const [records, setRecords] = useState<WeekdayAttendanceRecord[]>([]);
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
    const [selectedDay, setSelectedDay] = useState<'all' | 'Monday' | 'Wednesday' | 'Thursday'>('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');

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

    const loadData = async () => {
        try {
            setLoading(true);
            setMessage('');

            const { start, end } = getMonthRange(selectedMonth);

            const { data: studentData, error: studentError } = await supabase
                .from('weekday_students')
                .select('id, student_name, schedules, total_payment_amount, active')
                .eq('active', true)
                .order('student_name', { ascending: true });

            if (studentError) throw studentError;

            const { data: attendanceData, error: attendanceError } = await supabase
                .from('weekday_attendance')
                .select('*')
                .gte('attendance_date', start)
                .lt('attendance_date', end)
                .order('attendance_date', { ascending: false })
                .order('created_at', { ascending: false });

            if (attendanceError) throw attendanceError;

            setStudents((studentData || []) as WeekdayStudent[]);
            setRecords(((attendanceData || []) as WeekdayAttendanceRecord[]).map(record => ({
                ...record,
                attendance_date: record.attendance_date.slice(0, 10)
            })));
        } catch (err: any) {
            console.error(err);
            setMessage(err?.message || 'Failed to load weekday attendance.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [selectedMonth]);

    const todaysDayName = new Date().toLocaleDateString(undefined, { weekday: 'long' }) as WeekdayName;

    const filteredStudents = useMemo(() => {
        const normalizedSearch = searchTerm.trim().toLowerCase();

        return students.filter(student => {
            const studentRecords = records.filter(record => record.weekday_student_id === student.id);
            const scheduleText = student.schedules
                .map(schedule => `${schedule.day} ${schedule.duration}h`)
                .join(' ')
                .toLowerCase();

            const historyText = studentRecords
                .map(record => `${readableDate(record.attendance_date)} ${record.day_name} ${record.status} ${record.duration_hours}h`)
                .join(' ')
                .toLowerCase();

            const matchesDay = selectedDay === 'all' || student.schedules.some(schedule => schedule.day === selectedDay);
            const matchesSearch =
                !normalizedSearch ||
                student.student_name.toLowerCase().includes(normalizedSearch) ||
                scheduleText.includes(normalizedSearch) ||
                historyText.includes(normalizedSearch) ||
                String(student.total_payment_amount).includes(normalizedSearch);

            return matchesDay && matchesSearch;
        });
    }, [students, records, selectedDay, searchTerm]);

    const getScheduleForSelectedDay = (student: WeekdayStudent) => {
        const day = selectedDay === 'all' ? todaysDayName : selectedDay;
        return student.schedules.find(schedule => schedule.day === day);
    };

    const addAttendance = async (student: WeekdayStudent, status: WeekdayStatus) => {
        const schedule = getScheduleForSelectedDay(student);

        if (!schedule) {
            alert(`This student does not have training on ${selectedDay === 'all' ? todaysDayName : selectedDay}.`);
            return;
        }

        const dateKey = getDateKey(new Date());

        try {
            const { data, error } = await supabase
                .from('weekday_attendance')
                .insert({
                    weekday_student_id: student.id,
                    attendance_date: dateKey,
                    day_name: schedule.day,
                    status,
                    duration_hours: schedule.duration,
                    updated_at: new Date().toISOString()
                })
                .select('*')
                .single();

            if (error) throw error;

            if (data) {
                setRecords(prev => [{ ...data, attendance_date: String(data.attendance_date).slice(0, 10) } as WeekdayAttendanceRecord, ...prev]);
            }
        } catch (err: any) {
            alert(err?.message || `Failed to mark ${status}.`);
        }
    };

    const undoLatest = async (studentId: string) => {
        const latest = records.find(record => record.weekday_student_id === studentId);

        if (!latest) {
            alert('No weekday attendance action to undo for this month.');
            return;
        }

        if (!confirm(`Undo latest weekday attendance entry on ${readableDate(latest.attendance_date)}?`)) {
            return;
        }

        try {
            const { error } = await supabase
                .from('weekday_attendance')
                .delete()
                .eq('id', latest.id);

            if (error) throw error;

            setRecords(prev => prev.filter(record => record.id !== latest.id));
        } catch (err: any) {
            alert(err?.message || 'Failed to undo weekday attendance.');
        }
    };

    if (userRole === 'member') {
        return (
            <div className="container" style={{ padding: '3rem 1rem' }}>
                <div className="form-card" style={{ maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
                    <h1 style={{ color: '#dc2626' }}>403</h1>
                    <p>Only superusers and admins can access weekday attendance.</p>
                    <Link href="/dashboard" className="btn share-btn">Go to Dashboard</Link>
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
                        placeholder="Search by student, day, status, date, hours..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                <div className="filter-box">
                    <div className="filter-grid">
                        <div className="filter-group">
                            <label className="filter-label">
                                Month
                                <input
                                    type="month"
                                    className="filter-input"
                                    value={selectedMonth}
                                    onChange={(e) => setSelectedMonth(e.target.value)}
                                />
                            </label>
                        </div>

                        <div className="filter-group">
                            <label className="filter-label">
                                Day
                                <select
                                    className="filter-input"
                                    value={selectedDay}
                                    onChange={(e) => setSelectedDay(e.target.value as any)}
                                >
                                    <option value="all">All</option>
                                    <option value="Monday">Monday</option>
                                    <option value="Wednesday">Wednesday</option>
                                    <option value="Thursday">Thursday</option>
                                </select>
                            </label>
                        </div>
                    </div>

                    <div className="filter-buttons">
                        <button className="filter-button secondary" onClick={loadData}>Refresh</button>
                    </div>
                </div>

                {message && <p className="dashboard-error-message">{message}</p>}
                {loading && <p>Loading weekday attendance...</p>}
                {!loading && !message && filteredStudents.length === 0 && <p className="muted">No weekday students found.</p>}

                {!loading && filteredStudents.length > 0 && (
                    <div className="table-container">
                        <div className="table-scroll">
                            <table>
                                <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Schedule</th>
                                    <th>Actions</th>
                                    <th>This Month History</th>
                                </tr>
                                </thead>
                                <tbody>
                                {filteredStudents.map(student => {
                                    const studentRecords = records.filter(record => record.weekday_student_id === student.id);
                                    const scheduleText = student.schedules
                                        .map(schedule => `${schedule.day}: ${schedule.duration}h`)
                                        .join(', ');

                                    return (
                                        <tr key={student.id}>
                                            <td>{student.student_name}</td>
                                            <td>{scheduleText}</td>
                                            <td className="actions-cell">
                                                <div className="actions-row">
                                                    <button className="attendance-btn" onClick={() => addAttendance(student, 'attended')}>Mark</button>
                                                    <button className="missed-btn" onClick={() => addAttendance(student, 'missed')}>Missed</button>
                                                    <button className="makeup-btn" onClick={() => addAttendance(student, 'makeup')}>Makeup</button>
                                                    <button className="undo-btn" onClick={() => undoLatest(student.id)} disabled={studentRecords.length === 0}>Undo</button>
                                                </div>
                                            </td>
                                            <td className="attendance-history">
                                                {studentRecords.length === 0 ? (
                                                    <span className="muted">No records</span>
                                                ) : (
                                                    <ul>
                                                        {studentRecords.slice(0, 8).map(record => (
                                                            <li key={record.id}>
                                                                {readableDate(record.attendance_date)} — {record.day_name} — {record.status} ({Number(record.duration_hours).toFixed(2)}h)
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
            </main>
        </div>
    );
}
