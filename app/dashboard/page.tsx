'use client'

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import './../styles.css';
import './dashboard.css';
import { Student } from '../../types/supabase';

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function DashboardPage() {
  const router = useRouter();

  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<Student[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDay, setSelectedDay] = useState('all');
  const [selectedTimeslot, setSelectedTimeslot] = useState('all');
  const [selectedLevel, setSelectedLevel] = useState('all');
  const [userName, setUserName] = useState('');
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [userRole, setUserRole] = useState<'superuser' | 'admin' | 'member' | null>(null);

  const days = ['all', 'Saturday', 'Sunday'];
  const timeslots = ['all', '8-10am', '10-12pm', '1-3pm', '2-4pm', '3-5pm', '4-6pm'];
  const levels = ['all', 'Beginner', 'Intermediate', 'Advanced'];

  // Fetch user info on mount
  useEffect(() => {
    const loadUserName = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.user_metadata?.name) {
          setUserName(user.user_metadata.name);
        }
      } catch (err) {
        console.error('Failed to load user name:', err);
      }
    };
    loadUserName();
  }, []);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          router.push('/');
          return;
        }
        const role = (user.user_metadata?.role as 'superuser' | 'admin' | 'member') || 'member';
        setUserRole(role);
      } catch (err) {
        router.push('/');
      }
    };
    checkAuth();
  }, [router]);

  const logAuditAction = async (studentId: string, action: 'mark' | 'makeup' | 'undo' | 'delete' | 'reset') => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) return;

      await fetch('/api/audit/log-attendance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ student_id: studentId, action })
      });
    } catch (err) {
      console.error('Failed to log audit:', err);
    }
  };

  const fetchData = async () => {
    setIsLoading(true);
    setMessage(null);
    try {
      let query = supabase.from('students').select('*');

      if (selectedDay !== 'all') query = query.eq('student_day', selectedDay);
      if (selectedTimeslot !== 'all') query = query.eq('student_timeslot', selectedTimeslot);
      if (selectedLevel !== 'all') query = query.eq('student_levelofplay', selectedLevel);

      const { data, error } = await query;

      if (error) {
        setSearchResults([]);
        setMessage('Failed to load student records.');
        return;
      }

      if (Array.isArray(data) && data.length > 0) {
        setSearchResults(data);
      } else {
        setSearchResults([]);
        setMessage('No student records found.');
      }
    } catch {
      setSearchResults([]);
      setMessage('Failed to load student records.');
    } finally {
      setIsLoading(false);
    }
  };

  const deleteStudent = async (studentId: string, studentName?: string) => {
    if (!confirm(`Delete ${studentName ?? 'this student'}? This cannot be undone.`)) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) throw new Error('Not authenticated');

      const response = await fetch('/api/students/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ student_id: studentId })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Delete failed');
      }

      await logAuditAction(studentId, 'delete');
      fetchData();
    } catch (err: any) {
      alert(`Delete failed: ${err?.message ?? 'Unknown error'}`);
    }
  };

  const handleDeleteLastAttendance = async (studentId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Get current user's ID
      const currentUserId = user.id;

      // Fetch the student data
      const { data: studentData, error: fetchError } = await supabase
          .from('students')
          .select('*')
          .eq('student_id', studentId)
          .single();

      if (fetchError || !studentData) throw fetchError || new Error('Student not found');

      if (!studentData.attendance_records || studentData.attendance_records.length === 0) {
        alert('No attendance records to undo.');
        return;
      }

      // Check who performed the last mark/makeup action
      const { data: auditLogs, error: auditError } = await supabase
          .from('student_audit')
          .select('*')
          .eq('student_id', studentId)
          .in('action', ['mark', 'makeup'])
          .order('created_at', { ascending: false })
          .limit(1);

      if (auditError) throw auditError;

      // Check if there's an audit log and if current user performed it
      if (auditLogs && auditLogs.length > 0) {
        const lastAction = auditLogs[0];
        if (lastAction.created_by !== currentUserId) {
          alert('You can only undo actions you have committed.');
          return;
        }
      }

      // Perform the undo
      const updatedRecords = [...(studentData.attendance_records || [])];
      updatedRecords.pop();

      const { data: updatedStudent, error } = await supabase
          .from('students')
          .update({
            attendance_records: updatedRecords,
            weeks_completed: Math.max(0, updatedRecords.length),
            updated_at: new Date().toISOString()
          })
          .eq('student_id', studentId)
          .select()
          .single();

      if (error || !updatedStudent) throw error || new Error('Update failed');

      setSearchResults(prev => prev.map(s => s.student_id === studentId ? updatedStudent : s));
      await logAuditAction(studentId, 'undo');
    } catch (err: any) {
      alert(`Failed to undo attendance: ${err?.message ?? 'Unknown error'}`);
    }
  };

  const handleAttendanceClick = async (studentId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: studentData, error: fetchError } = await supabase
          .from('students')
          .select('*')
          .eq('student_id', studentId)
          .single();

      if (fetchError || !studentData) throw fetchError || new Error('Student not found');

      const today = new Date().getDay();
      const isStudentDay =
          (today === 6 && studentData.student_day === 'Saturday') ||
          (today === 0 && studentData.student_day === 'Sunday');

      if (!isStudentDay) {
        alert(`Can only mark attendance on ${studentData.student_day}`);
        return;
      }

      const newWeeksCompleted = Math.min((studentData.weeks_completed || 0) + 1, studentData.total_weeks);
      const newAttendance = [...(studentData.attendance_records || []), new Date().toISOString()];

      const { data: updatedStudent, error } = await supabase
          .from('students')
          .update({
            attendance_records: newAttendance,
            weeks_completed: newWeeksCompleted,
            updated_at: new Date().toISOString()
          })
          .eq('student_id', studentId)
          .select()
          .single();

      if (error || !updatedStudent) throw error || new Error('Update failed');

      setSearchResults(prev => prev.map(s => s.student_id === studentId ? updatedStudent : s));
      await logAuditAction(studentId, 'mark');
    } catch (err: any) {
      alert(`Failed to record attendance: ${err?.message ?? 'Unknown error'}`);
    }
  };

  const handleMakeupAttendance = async (studentId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: studentData, error: fetchError } = await supabase
          .from('students')
          .select('*')
          .eq('student_id', studentId)
          .single();

      if (fetchError || !studentData) throw fetchError || new Error('Student not found');

      const newWeeksCompleted = Math.min((studentData.weeks_completed || 0) + 1, studentData.total_weeks);
      const newAttendance = [...(studentData.attendance_records || []), new Date().toISOString()];

      const { data: updatedStudent, error } = await supabase
          .from('students')
          .update({
            attendance_records: newAttendance,
            weeks_completed: newWeeksCompleted,
            updated_at: new Date().toISOString()
          })
          .eq('student_id', studentId)
          .select()
          .single();

      if (error || !updatedStudent) throw error || new Error('Update failed');

      setSearchResults(prev => prev.map(s => s.student_id === studentId ? updatedStudent : s));
      await logAuditAction(studentId, 'makeup');
    } catch (err: any) {
      alert(`Failed to record makeup attendance: ${err?.message ?? 'Unknown error'}`);
    }
  };

  const handleResetCourse = async (studentId: string) => {
    try {
      if (!confirm('Reset this course? This will clear all attendance records.')) return;

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: updatedStudent, error } = await supabase
          .from('students')
          .update({
            attendance_records: [],
            weeks_completed: 0,
            updated_at: new Date().toISOString()
          })
          .eq('student_id', studentId)
          .select()
          .single();

      if (error || !updatedStudent) throw error || new Error('Reset failed');

      setSearchResults(prev => prev.map(s => s.student_id === studentId ? updatedStudent : s));
      await logAuditAction(studentId, 'reset');
    } catch (err: any) {
      alert(`Failed to reset course: ${err?.message ?? 'Unknown error'}`);
    }
  };

  useEffect(() => {
    const handler = setTimeout(async () => {
      const term = searchTerm.trim();
      if (term.length === 0) {
        fetchData();
        return;
      }

      try {
        const response = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ searchTerm: term }),
        });

        if (!response.ok) {
          setSearchResults([]);
          setMessage('Search failed.');
          return;
        }

        const data = await response.json();
        setSearchResults(data.results || []);
      } catch {
        setSearchResults([]);
        setMessage('Search failed.');
      }
    }, 300);

    return () => clearTimeout(handler);
  }, [searchTerm]);

  useEffect(() => {
    fetchData();
  }, [selectedDay, selectedTimeslot, selectedLevel]);

  // Check if day/timeslot/level are editable based on user role
  const canEditStudentFields = userRole === 'superuser';
  const isSuperuser = userRole === 'superuser';

  return (
      <div className="container">
        <header className="dashboard-header">
          <div className="header-left">
            <div className="brand" style={{ position: 'relative' }}>
              <button
                  className="account-avatar-btn"
                  onClick={() => setShowAccountMenu(!showAccountMenu)}
                  title="View account"
              >
                👤
              </button>
              {showAccountMenu && (
                  <div className="account-menu">
                    <p className="account-name">{userName || 'User'}</p>
                    <p className="account-role">{userRole?.toUpperCase() || 'MEMBER'}</p>
                    <Link href="/settings" className="account-menu-link" onClick={() => setShowAccountMenu(false)}>
                      ⚙️ Settings
                    </Link>
                  </div>
              )}
            </div>
            <h1 className="page-title">Dashboard</h1>
          </div>

          <div className="user-controls">
            {(userRole === 'admin' || userRole === 'superuser') && (
                <Link href="/attendance" className="btn share-btn">Attendance</Link>
            )}
            {(userRole === 'admin' || userRole === 'superuser') && (
                <Link href="/payment" className="btn share-btn">Payment</Link>
            )}
            {(userRole === 'admin' || userRole === 'superuser') && (
                <Link href="/add" className="btn share-btn">Add Student</Link>
            )}
            <button
                className="btn share-btn logout"
                onClick={async () => {
                  const { error } = await supabase.auth.signOut();
                  if (error) {
                    alert('Logout failed');
                  } else {
                    router.push('/');
                  }
                }}
            >
              Logout
            </button>
          </div>
        </header>

        <main>
          <div className="search-box">
            <input
                aria-label="Search students"
                type="text"
                placeholder="Search students"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="filter-box">
            <div className="filter-grid">
              <div className="filter-group">
                <label className="filter-label">
                  Day
                  <select value={selectedDay} onChange={(e) => setSelectedDay(e.target.value)} className="filter-input">
                    {days.map(d => <option key={d} value={d}>{d === 'all' ? 'All Days' : d}</option>)}
                  </select>
                </label>
              </div>

              <div className="filter-group">
                <label className="filter-label">
                  Timeslot
                  <select value={selectedTimeslot} onChange={(e) => setSelectedTimeslot(e.target.value)} className="filter-input">
                    {timeslots.map(t => <option key={t} value={t}>{t === 'all' ? 'All Timeslots' : t}</option>)}
                  </select>
                </label>
              </div>

              <div className="filter-group">
                <label className="filter-label">
                  Level
                  <select value={selectedLevel} onChange={(e) => setSelectedLevel(e.target.value)} className="filter-input">
                    {levels.map(l => <option key={l} value={l}>{l === 'all' ? 'All Levels' : l}</option>)}
                  </select>
                </label>
              </div>
            </div>

            <div className="filter-buttons">
              <button
                  onClick={() => {
                    setSelectedDay('all');
                    setSelectedTimeslot('all');
                    setSelectedLevel('all');
                    setSearchTerm('');
                    fetchData();
                  }}
                  className="filter-button secondary"
              >
                Reset
              </button>
              <button onClick={() => fetchData()} className="filter-button">Apply</button>
            </div>
          </div>

          <div className="search-results-display">
            {isLoading && <p className="muted">Loading…</p>}
            {!isLoading && message && <p className="muted">{message}</p>}

            {!isLoading && Array.isArray(searchResults) && searchResults.length > 0 && (
                <div className="table-container">
                  <table>
                    <thead>
                    <tr>
                      <th>Name</th>
                      <th>Day</th>
                      <th>Timeslot</th>
                      <th>Level</th>
                      <th className="lessons-header">Lessons</th>
                      <th style={{ width: userRole === 'superuser' ? 340 : 220 }}>Actions</th>
                    </tr>
                    </thead>
                    <tbody>
                    {searchResults.map((student) => {
                      const attendanceCount = Array.isArray(student.attendance_records)
                          ? student.attendance_records.length
                          : (student.weeks_completed ?? 0);

                      return (
                          <tr key={student.student_id}>
                            <td>{student.student_name}</td>
                            <td>
                              {canEditStudentFields ? (
                                  <select
                                      className="student-field-select"
                                      aria-label="Change day"
                                      value={student.student_day}
                                      onChange={async (e) => {
                                        const newDay = e.target.value;
                                        try {
                                          const { error } = await supabase
                                              .from('students')
                                              .update({ student_day: newDay, updated_at: new Date().toISOString() })
                                              .eq('student_id', student.student_id);

                                          if (error) throw error;

                                          setSearchResults(prev => prev.map(s => s.student_id === student.student_id ? { ...s, student_day: newDay, updated_at: new Date().toISOString() } : s));
                                        } catch (err: any) {
                                          alert(`Failed to update day: ${err?.message ?? 'Unknown error'}`);
                                        }
                                      }}
                                  >
                                    <option value="Saturday">Saturday</option>
                                    <option value="Sunday">Sunday</option>
                                  </select>
                              ) : (
                                  <span title="Only superusers can change this" style={{ cursor: 'not-allowed', opacity: 0.7 }}>
                                    {student.student_day}
                                  </span>
                              )}
                            </td>
                            <td>
                              {canEditStudentFields ? (
                                  <select
                                      className="student-field-select"
                                      aria-label="Change timeslot"
                                      value={student.student_timeslot}
                                      onChange={async (e) => {
                                        const newTimeslot = e.target.value;
                                        try {
                                          const { error } = await supabase
                                              .from('students')
                                              .update({ student_timeslot: newTimeslot, updated_at: new Date().toISOString() })
                                              .eq('student_id', student.student_id);

                                          if (error) throw error;

                                          setSearchResults(prev => prev.map(s => s.student_id === student.student_id ? { ...s, student_timeslot: newTimeslot, updated_at: new Date().toISOString() } : s));
                                        } catch (err: any) {
                                          alert(`Failed to update timeslot: ${err?.message ?? 'Unknown error'}`);
                                        }
                                      }}
                                  >
                                    <option value="8-10am">8-10am</option>
                                    <option value="10-12pm">10-12pm</option>
                                    <option value="1-3pm">1-3pm</option>
                                    <option value="2-4pm">2-4pm</option>
                                    <option value="3-5pm">3-5pm</option>
                                    <option value="4-6pm">4-6pm</option>
                                  </select>
                              ) : (
                                  <span title="Only superusers can change this" style={{ cursor: 'not-allowed', opacity: 0.7 }}>
                                    {student.student_timeslot}
                                  </span>
                              )}
                            </td>
                            <td>
                              {canEditStudentFields ? (
                                  <select
                                      className="student-field-select"
                                      aria-label="Change level"
                                      value={student.student_levelofplay}
                                      onChange={async (e) => {
                                        const newLevel = e.target.value;
                                        try {
                                          const { error } = await supabase
                                              .from('students')
                                              .update({ student_levelofplay: newLevel, updated_at: new Date().toISOString() })
                                              .eq('student_id', student.student_id);

                                          if (error) throw error;

                                          setSearchResults(prev => prev.map(s => s.student_id === student.student_id ? { ...s, student_levelofplay: newLevel, updated_at: new Date().toISOString() } : s));
                                        } catch (err: any) {
                                          alert(`Failed to update level: ${err?.message ?? 'Unknown error'}`);
                                        }
                                      }}
                                  >
                                    <option value="Beginner">Beginner</option>
                                    <option value="Intermediate">Intermediate</option>
                                    <option value="Advanced">Advanced</option>
                                  </select>
                              ) : (
                                  <span title="Only superusers can change this" style={{ cursor: 'not-allowed', opacity: 0.7 }}>
                                    {student.student_levelofplay}
                                  </span>
                              )}
                            </td>
                            <td className="lessons-count" title={`${attendanceCount} lessons attended`}>
                              {attendanceCount}
                            </td>
                            <td className="actions-cell" style={{ width: userRole === 'superuser' ? 340 : 220 }}>
                              <div className="btn-group">
                                <button className="attendance-btn" onClick={() => handleAttendanceClick(student.student_id)}>
                                  Mark
                                </button>
                                <button className="makeup-btn" onClick={() => handleMakeupAttendance(student.student_id)}>
                                  Makeup
                                </button>

                                <button
                                    className="undo-btn"
                                    onClick={() => handleDeleteLastAttendance(student.student_id)}
                                    disabled={attendanceCount === 0}
                                    title={attendanceCount === 0 ? 'No attendance records to undo' : 'Undo last mark or makeup'}
                                >
                                  Undo
                                </button>

                                {userRole === 'superuser' ? (
                                    <>
                                      <button className="reset-btn" onClick={() => handleResetCourse(student.student_id)}>
                                        Reset
                                      </button>
                                      <button className="delete-btn" onClick={() => deleteStudent(student.student_id, student.student_name)}>
                                        Delete
                                      </button>
                                    </>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                      );
                    })}
                    </tbody>
                  </table>
                </div>
            )}
          </div>
        </main>
      </div>
  )
}