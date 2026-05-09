'use client'

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import './../styles.css';
import './../dashboard/dashboard.css';
import { Student } from '../../types/supabase';

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function AttendancePage() {
  const router = useRouter();
  const [userRole, setUserRole] = useState<'superuser' | 'admin' | 'member' | null>(null);
  const [userName, setUserName] = useState('');
  const [showAccountMenu, setShowAccountMenu] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          router.push('/');
          return;
        }
        const role = (user.user_metadata?.role as 'superuser' | 'admin' | 'member') || 'member';

        // Block members and admins, allow superusers
        if (role === 'member' || role === 'admin') {
          setUserRole(role);
          return;
        }

        setUserRole(role);
      } catch (err) {
        router.push('/');
      }
    };
    checkAuth();
  }, [router]);

  useEffect(() => {
    const loadUserInfo = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setUserName(user.user_metadata?.name || user.email || 'User');
        }
      } catch (err) {
        console.error('Failed to load user info:', err);
      }
    };

    loadUserInfo();
  }, []);

  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<Student[]>([]);

  const [selectedDay, setSelectedDay] = useState('all');
  const [selectedTimeslot, setSelectedTimeslot] = useState('all');
  const [selectedLevel, setSelectedLevel] = useState('all');

  const days = ['all', 'Saturday', 'Sunday'];
  const timeslots = ['all', '8-10am', '10-12pm', '1-3pm', '2-4pm', '3-5pm', '4-6pm'];
  const levels = ['all', 'Beginner', 'Intermediate', 'Advanced'];

  const fetchData = async () => {
    setIsLoading(true);
    setSearchResults([]);

    try {
      let query = supabase
          .from('students')
          .select('*');

      if (selectedDay !== 'all') {
        query = query.eq('student_day', selectedDay);
      }
      if (selectedTimeslot !== 'all') {
        query = query.eq('student_timeslot', selectedTimeslot);
      }
      if (selectedLevel !== 'all') {
        query = query.eq('student_levelofplay', selectedLevel);
      }

      const { data, error } = await query;

      if (error) throw error;

      if (data) {
        setSearchResults(data);
        setMessage(null);
      } else {
        setSearchResults([]);
        setMessage("No student records found.");
      }
    } catch (error: any) {
      console.error("Error fetching data:", error);
      setSearchResults([]);
      setMessage("Failed to load student records. Please try again later.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteLastAttendance = async (studentId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: studentData, error: fetchError } = await supabase
          .from('students')
          .select('*')
          .eq('student_id', studentId)
          .single();

      if (fetchError || !studentData) throw fetchError || new Error('Student not found');

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

      setSearchResults(prev => prev.map(student =>
          student.student_id === studentId ? updatedStudent : student
      ));

    } catch (error) {
      console.error('Error deleting last attendance:', error);
      alert(`Failed to undo attendance: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

      setSearchResults(prev => prev.map(student =>
          student.student_id === studentId ? updatedStudent : student
      ));

    } catch (error) {
      console.error('Attendance update error:', error);
      alert(`Failed to record attendance: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

      setSearchResults(prev => prev.map(student =>
          student.student_id === studentId ? updatedStudent : student
      ));

    } catch (error) {
      console.error('Makeup attendance error:', error);
      alert(`Failed to record makeup attendance: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const syncWeeksCompleted = async (studentId: string) => {
    try {
      const { data: student, error: fetchError } = await supabase
          .from('students')
          .select('attendance_records, total_weeks')
          .eq('student_id', studentId)
          .single();

      if (fetchError || !student) throw fetchError || new Error('Student not found');

      const actualWeeksCompleted = Math.min(
          student.attendance_records?.length || 0,
          student.total_weeks || 1
      );

      const { error: updateError } = await supabase
          .from('students')
          .update({ weeks_completed: actualWeeksCompleted, updated_at: new Date().toISOString() })
          .eq('student_id', studentId);

      if (updateError) throw updateError;

      setSearchResults(prev => prev.map(s =>
          s.student_id === studentId ? { ...s, weeks_completed: actualWeeksCompleted } : s
      ));
    } catch (err) {
      console.error('Sync weeks failed:', err);
    }
  };

  const handleResetCourse = async (studentId: string) => {
    if (!studentId) {
      alert('Missing student id — cannot reset.');
      return;
    }

    if (!confirm('Reset this course? This will clear all attendance records for this student.')) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Fetch current student (to preserve price/total_weeks if needed)
      const { data: currentStudent, error: fetchError } = await supabase
          .from('students')
          .select('price, total_weeks, paid')
          .match({ student_id: studentId })
          .single();

      if (fetchError || !currentStudent) {
        console.error('Could not load student before reset:', fetchError);
        throw fetchError || new Error('Student not found');
      }

      const updates = {
        attendance_records: [],
        weeks_completed: 0,
        paid: false,
        updated_at: new Date().toISOString(),
        price: currentStudent.price,
        total_weeks: currentStudent.total_weeks
      };

      // Use .match to ensure single-row update, then select the updated row
      const { data: updatedRows, error } = await supabase
          .from('students')
          .update(updates)
          .match({ student_id: studentId })
          .select();

      if (error) {
        console.error('Reset update error:', error);
        throw error;
      }

      // Supabase returns an array for .select(), pick the first row
      const updatedStudent = Array.isArray(updatedRows) ? updatedRows[0] : updatedRows;
      if (!updatedStudent) throw new Error('Reset did not return updated student');

      // Update only the affected student in local state
      setSearchResults(prev => prev.map(s => s.student_id === studentId ? updatedStudent : s));
    } catch (err: any) {
      console.error('Reset error:', err);
      alert(`Failed to reset course: ${err?.message ?? 'Unknown error'}`);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);


  if (userRole === 'admin' || userRole === "member") {
    return (
        <div className="container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '3rem 1rem' }}>
          <div className="form-card" style={{ maxWidth: 600, width: '100%', textAlign: 'center' }}>
            <h1 style={{ fontSize: '3rem', margin: '0 0 1rem', color: '#dc2626' }}>403</h1>
            <h2 style={{ fontSize: '1.5rem', margin: '0 0 1rem', color: '#374151' }}>Forbidden</h2>
            <p style={{ margin: '0 0 1.5rem', color: '#6b7280', lineHeight: 1.6 }}>
              You do not have permission to access this page. Only superusers can view Attendance details.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <Link href="/dashboard" className="btn share-btn" style={{ display: 'inline-block' }}>Go to Dashboard</Link>
              <button
                  className="btn share-btn"
                  onClick={async () => {
                    await supabase.auth.signOut();
                    router.push('/');
                  }}
                  style={{ display: 'inline-block' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#dc2626';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '';
                  }}
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

            <h1 className="page-title">Attendance</h1>
          </div>

          <div className="user-controls">
            <Link href="/dashboard" className="btn share-btn">Dashboard</Link>

            <Link href="/payment" className="btn share-btn">Payment</Link>

            {userRole === 'superuser' && (
                <Link href="/add" className="btn share-btn">Add Student</Link>
            )}

            <button
                className="btn share-btn logout"
                onClick={async () => {
                  const { error } = await supabase.auth.signOut();
                  if (error) {
                    console.error('Logout error:', error);
                    alert('Logout failed');
                  } else {
                    router.push('/');
                  }
                }}
                style={{ display: 'inline-block' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#dc2626 !important';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '';
                }}
            >
              Logout
            </button>
          </div>
        </header>

        <main>
          <div className="search-box">
            <input
                type="text"
                placeholder="Search students..."
                onChange={async (e) => {
                  const searchTerm = e.target.value.trim();

                  if (searchTerm) {
                    try {
                      const response = await fetch('/api/attendance-search', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ searchTerm }),
                      });

                      if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(errorData.message || 'Search failed');
                      }

                      const data = await response.json();

                      if (data.results) {
                        setSearchResults(data.results);
                      } else {
                        setSearchResults([]);
                      }
                    } catch (error) {
                      console.error('Search error:', error);
                      setSearchResults([]);
                    }
                  } else {
                    fetchData();
                  }
                }}
            />
          </div>

          <div className="filter-box">
            <div className="filter-grid">
              <div className="filter-group">
                <label className="filter-label">
                  Day
                  <select
                      value={selectedDay}
                      onChange={(e) => setSelectedDay(e.target.value)}
                      className="filter-input"
                  >
                    <option value="all">All Days</option>
                    {days.filter(d => d !== 'all').map(day => (
                        <option key={day} value={day}>{day}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="filter-group">
                <label className="filter-label">
                  Timeslot
                  <select
                      value={selectedTimeslot}
                      onChange={(e) => setSelectedTimeslot(e.target.value)}
                      className="filter-input"
                  >
                    <option value="all">All Timeslots</option>
                    {timeslots.filter(t => t !== 'all').map(timeslot => (
                        <option key={timeslot} value={timeslot}>{timeslot}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="filter-group">
                <label className="filter-label">
                  Level
                  <select
                      value={selectedLevel}
                      onChange={(e) => setSelectedLevel(e.target.value)}
                      className="filter-input"
                  >
                    <option value="all">All Levels</option>
                    {levels.filter(l => l !== 'all').map(level => (
                        <option key={level} value={level}>{level}</option>
                    ))}
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
                    fetchData();
                  }}
                  className="filter-button secondary"
              >
                Clear Filters
              </button>
              <button
                  onClick={fetchData}
                  className="filter-button"
              >
                Apply Filters
              </button>
            </div>
          </div>

          <div className="search-results-display">
            {isLoading && <p>Loading student records...</p>}

            {!isLoading && message && (
                <p className="dashboard-error-message">{message}</p>
            )}

            {!isLoading && !message && searchResults.length === 0 && (
                <p>No student records found matching your criteria.</p>
            )}

            {!isLoading && Array.isArray(searchResults) && searchResults.length > 0 && (
                <div className="table-container">
                  <table>
                    <thead>
                    <tr>
                      <th>Name</th>
                      <th>Day</th>
                      <th>Timeslot</th>
                      <th>Level</th>
                      <th className="col-price">Price (S$)</th>
                      <th className="col-weeks">Weeks</th>
                      <th>Weeks Completed</th>
                      <th>Attendance Actions</th>
                      <th>Attendance History</th>
                    </tr>
                    </thead>
                    <tbody>
                    {searchResults.map((student) => (
                        <tr key={student.student_id}>
                          <td>{student.student_name}</td>
                          <td>
                            <select
                                aria-label="Change day"
                                value={student.student_day}
                                onChange={async (e) => {
                                  const newDay = e.target.value;
                                  try {
                                    const { error } = await supabase
                                        .from('students')
                                        .update({
                                          student_day: newDay,
                                          updated_at: new Date().toISOString()
                                        })
                                        .match({ student_id: student.student_id });

                                    if (error) throw error;

                                    setSearchResults(prev => prev.map(s =>
                                        s.student_id === student.student_id
                                            ? { ...s, student_day: newDay, updated_at: new Date().toISOString() }
                                            : s
                                    ));
                                  } catch (err: any) {
                                    console.error('Error updating day:', err);
                                    alert(`Failed to update day: ${err?.message ?? 'Unknown error'}`);
                                  }
                                }}
                            >
                              <option value="Saturday">Saturday</option>
                              <option value="Sunday">Sunday</option>
                            </select>
                          </td>
                          <td>
                            <select
                                aria-label="Change timeslot"
                                value={student.student_timeslot}
                                onChange={async (e) => {
                                  const newTimeslot = e.target.value;
                                  try {
                                    const { error } = await supabase
                                        .from('students')
                                        .update({
                                          student_timeslot: newTimeslot,
                                          updated_at: new Date().toISOString()
                                        })
                                        .eq('student_id', student.student_id);

                                    if (error) throw error;

                                    setSearchResults(prev => prev.map(s =>
                                        s.student_id === student.student_id ? {
                                          ...s,
                                          student_timeslot: newTimeslot,
                                          updated_at: new Date().toISOString()
                                        } : s
                                    ));
                                  } catch (error) {
                                    console.error('Error updating timeslot:', error);
                                    alert(`Failed to update timeslot: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
                          </td>
                          <td>
                            <select
                                aria-label="Change level"
                                value={student.student_levelofplay}
                                onChange={async (e) => {
                                  const newLevel = e.target.value;
                                  try {
                                    const { error } = await supabase
                                        .from('students')
                                        .update({
                                          student_levelofplay: newLevel,
                                          updated_at: new Date().toISOString()
                                        })
                                        .eq('student_id', student.student_id);

                                    if (error) throw error;

                                    setSearchResults(prev => prev.map(s =>
                                        s.student_id === student.student_id ? {
                                          ...s,
                                          student_levelofplay: newLevel,
                                          updated_at: new Date().toISOString()
                                        } : s
                                    ));
                                  } catch (error) {
                                    console.error('Error updating level:', error);
                                    alert(`Failed to update level: ${error instanceof Error ? error.message : 'Unknown error'}`);
                                  }
                                }}
                            >
                              <option value="Beginner">Beginner</option>
                              <option value="Intermediate">Intermediate</option>
                              <option value="Advanced">Advanced</option>
                            </select>
                          </td>
                          <td className="col-price">
                            <input
                                className="price-input"
                                type="number"
                                min="0"
                                step="0.01"
                                value={student.price || 0}
                                aria-label="Price in SGD"
                                title="Price in SGD"
                                onChange={async (e) => {
                                  const newPrice = parseFloat(e.target.value);
                                  try {
                                    const { error } = await supabase
                                        .from('students')
                                        .update({
                                          price: newPrice,
                                          updated_at: new Date().toISOString()
                                        })
                                        .eq('student_id', student.student_id);

                                    if (error) throw error;

                                    setSearchResults(prev => prev.map(s =>
                                        s.student_id === student.student_id ? {
                                          ...s,
                                          price: newPrice,
                                          updated_at: new Date().toISOString()
                                        } : s
                                    ));
                                  } catch (error) {
                                    console.error('Error updating price:', error);
                                    alert(`Failed to update price: ${error instanceof Error ? error.message : 'Unknown error'}`);
                                  }
                                }}
                            />
                          </td>
                          <td className="col-weeks">
                            <input
                                className="weeks-input"
                                type="number"
                                min="1"
                                value={student.total_weeks || 1}
                                aria-label="Total weeks"
                                title="Total weeks"
                                onChange={async (e) => {
                                  const newTotalWeeks = parseInt(e.target.value);
                                  try {
                                    const updates: Partial<Student> = {
                                      total_weeks: newTotalWeeks,
                                      updated_at: new Date().toISOString()
                                    };

                                    if (newTotalWeeks < (student.weeks_completed || 0)) {
                                      updates.weeks_completed = newTotalWeeks;
                                    }

                                    const { error } = await supabase
                                        .from('students')
                                        .update(updates)
                                        .eq('student_id', student.student_id);

                                    if (error) throw error;

                                    setSearchResults(prev => prev.map(s =>
                                        s.student_id === student.student_id ? {
                                          ...s,
                                          ...updates,
                                          updated_at: new Date().toISOString()
                                        } : s
                                    ));
                                  } catch (error) {
                                    console.error('Error updating total weeks:', error);
                                    alert(`Failed to update total weeks: ${error instanceof Error ? error.message : 'Unknown error'}`);
                                  }
                                }}
                            />
                          </td>
                          <td>
                            {student.weeks_completed || 0}/{student.total_weeks || 1}
                          </td>
                          <td>
                            <div style={{display: 'flex', gap: '10px', flexDirection: 'column'}}>
                              <button
                                  onClick={() => syncWeeksCompleted(student.student_id)}
                                  title="Sync weeks_completed with actual attendance records"
                                  style={{
                                    padding: '6px 12px',
                                    fontSize: '0.85rem',
                                    background: '#6366f1',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '6px',
                                    cursor: 'pointer'
                                  }}
                              >
                                Sync
                              </button>

                              <div style={{display: 'flex', gap: '10px'}}>
                                <button
                                    onClick={() => handleAttendanceClick(student.student_id)}
                                    className="attendance-btn"
                                    disabled={student.weeks_completed >= student.total_weeks}
                                >
                                  Mark Attended
                                </button>
                                <button
                                    onClick={() => handleDeleteLastAttendance(student.student_id)}
                                    className="delete-btn"
                                    disabled={!student.attendance_records?.length}
                                >
                                  Undo Last
                                </button>
                              </div>
                              <button
                                  onClick={() => handleMakeupAttendance(student.student_id)}
                                  className="makeup-btn"
                                  disabled={student.weeks_completed >= student.total_weeks}
                              >
                                Mark Makeup Class
                              </button>
                              {student.weeks_completed >= student.total_weeks && (
                                  <button
                                      onClick={() => {
                                        if (!student.paid) {
                                          alert(`${student.student_name} has not paid yet`);
                                          return;
                                        }
                                        handleResetCourse(student.student_id);
                                      }}
                                      className="reset-btn"
                                  >
                                    Reset Course
                                  </button>
                              )}
                            </div>
                          </td>
                          <td>
                            {student.attendance_records?.length > 0 ? (
                                <div className="attendance-history">
                                  <ul>
                                    {student.attendance_records.map((record, i) => {
                                      const recordDate = new Date(record);
                                      const recordDay = recordDate.getDay();
                                      const isMakeup = !(
                                          (recordDay === 6 && student.student_day === 'Saturday') ||
                                          (recordDay === 0 && student.student_day === 'Sunday')
                                      );
                                      return (
                                          <li key={i}>
                                            {recordDate.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                                            {isMakeup && ' (makeup)'}
                                          </li>
                                      );
                                    })}
                                  </ul>
                                </div>
                            ) : 'No attendance'}
                          </td>
                        </tr>
                    ))}
                    </tbody>
                  </table>
                </div>
            )}
          </div>
        </main>
      </div>
  )
}