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
        if (!user) { router.push('/'); return; }
        const role = (user.user_metadata?.role as 'superuser' | 'admin' | 'member') || 'member';
        if (role === 'member' || role === 'admin') { setUserRole(role); return; }
        setUserRole(role);
      } catch (err) { router.push('/'); }
    };
    checkAuth();
  }, [router]);

  useEffect(() => {
    const loadUserInfo = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) { setUserName(user.user_metadata?.name || user.email || 'User'); }
      } catch (err) { console.error('Failed to load user info:', err); }
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
      let query = supabase.from('students').select('*');
      if (selectedDay !== 'all') query = query.eq('student_day', selectedDay);
      if (selectedTimeslot !== 'all') query = query.eq('student_timeslot', selectedTimeslot);
      if (selectedLevel !== 'all') query = query.eq('student_levelofplay', selectedLevel);

      const { data, error } = await query;
      if (error) throw error;
      if (data) { setSearchResults(data); setMessage(null); } else { setSearchResults([]); setMessage("No student records found."); }
    } catch (error: any) {
      console.error("Error fetching data:", error);
      setSearchResults([]);
      setMessage("Failed to load student records. Please try again later.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    const subscription = supabase
        .channel('public:students')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, (payload) => {
          if (payload.eventType === 'UPDATE') {
            setSearchResults(prev => prev.map(s =>
                s.student_id === payload.new.student_id ? payload.new as Student : s
            ));
          }
        })
        .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

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

      const { data: auditLogs, error: auditError } = await supabase
          .from('student_audit')
          .select('*')
          .eq('student_id', studentId)
          .in('action', ['mark', 'makeup', 'missed'])
          .order('created_at', { ascending: false })
          .limit(1);

      if (auditError) throw auditError;
      if (!auditLogs || auditLogs.length === 0) {
        // If no audit log found, just reverse the last action based on current state
        alert('No audit log found. Undoing last recorded action...');

        let newAttended = (studentData.attended ?? 0);
        let newMissed = (studentData.missed ?? 0);
        let newRecords = Array.isArray(studentData.attendance_records) ? [...studentData.attendance_records] : [];

        // Assume last action was a Mark (most common case)
        if (newAttended > 0) {
          newAttended = Math.max(0, newAttended - 1);
          if (newRecords.length > 0) newRecords.pop();
        } else if (newMissed > 0) {
          newMissed = Math.max(0, newMissed - 1);
        } else {
          alert('Nothing to undo.');
          return;
        }

        const { data: updatedStudent, error } = await supabase.from('students').update({
          attended: newAttended,
          missed: newMissed,
          attendance_records: newRecords,
          updated_at: new Date().toISOString()
        }).eq('student_id', studentId).select().single();

        if (error || !updatedStudent) throw error || new Error('Update failed');
        setSearchResults(prev => prev.map(s => s.student_id === studentId ? updatedStudent : s));
        await fetchData();
        return;
      }

      const lastAction = auditLogs[0];
      // Remove the user check — allow undo regardless of who performed the action
      // if (lastAction.created_by !== user.id) { alert('You can only undo actions you have committed.'); return; }

      let newAttended = (studentData.attended ?? 0);
      let newMissed = (studentData.missed ?? 0);
      let newRecords = Array.isArray(studentData.attendance_records) ? [...studentData.attendance_records] : [];

      if (lastAction.action === 'mark') {
        newAttended = Math.max(0, newAttended - 1);
        if (newRecords.length > 0) newRecords.pop();
      } else if (lastAction.action === 'missed') {
        newMissed = Math.max(0, newMissed - 1);
      } else if (lastAction.action === 'makeup') {
        newAttended = Math.max(0, newAttended - 1);
        newMissed = newMissed + 1;
        if (newRecords.length > 0) newRecords.pop();
      }

      const { data: updatedStudent, error } = await supabase.from('students').update({
        attended: newAttended,
        missed: newMissed,
        attendance_records: newRecords,
        updated_at: new Date().toISOString()
      }).eq('student_id', studentId).select().single();

      if (error || !updatedStudent) throw error || new Error('Update failed');
      setSearchResults(prev => prev.map(s => s.student_id === studentId ? updatedStudent : s));
      await fetchData();

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (token) {
        await fetch('/api/audit/log-attendance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ student_id: studentId, action: 'undo' })
        });
      }
    } catch (err: any) {
      console.error('Undo error:', err);
      alert(`Failed to undo: ${err?.message ?? 'Unknown error'}`);
    }
  };

  const handleAttendanceClick = async (studentId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: studentData, error: fetchError } = await supabase.from('students').select('*').eq('student_id', studentId).single();
      if (fetchError || !studentData) throw fetchError || new Error('Student not found');

      const today = new Date().getDay();
      const isStudentDay = (today === 6 && studentData.student_day === 'Saturday') || (today === 0 && studentData.student_day === 'Sunday');
      if (!isStudentDay) { alert(`Can only mark attendance on ${studentData.student_day}`); return; }

      const attended = (studentData.attended ?? 0);
      const missed = (studentData.missed ?? 0);
      const totalWeeks = studentData.total_weeks ?? 0;
      if ((attended + missed) >= totalWeeks) { alert('Subscription lessons already used.'); return; }

      const newAttended = attended + 1;
      const newRecords = Array.isArray(studentData.attendance_records) ? [...studentData.attendance_records, new Date().toISOString()] : [new Date().toISOString()];

      const { data: updatedStudent, error } = await supabase.from('students').update({
        attended: newAttended,
        attendance_records: newRecords,
        updated_at: new Date().toISOString()
      }).eq('student_id', studentId).select().single();

      if (error || !updatedStudent) throw error || new Error('Update failed');
      setSearchResults(prev => prev.map(s => s.student_id === studentId ? updatedStudent : s));
      await fetchData();
      await logAudit(studentId, 'mark');
    } catch (err: any) {
      console.error('Attendance error:', err);
      alert(`Failed to record attendance: ${err?.message ?? 'Unknown error'}`);
    }
  };

  const handleMakeupAttendance = async (studentId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: studentData, error: fetchError } = await supabase.from('students').select('*').eq('student_id', studentId).single();
      if (fetchError || !studentData) throw fetchError || new Error('Student not found');

      const attended = (studentData.attended ?? 0);
      const missed = (studentData.missed ?? 0);
      const totalWeeks = studentData.total_weeks ?? 0;

      if (missed <= 0) { alert('No missed lessons to makeup.'); return; }
      if ((attended + missed) > totalWeeks) { alert('Cannot makeup, subscription total would be exceeded.'); return; }

      const newAttended = attended + 1;
      const newMissed = Math.max(0, missed - 1);
      const newRecords = Array.isArray(studentData.attendance_records) ? [...studentData.attendance_records, new Date().toISOString()] : [new Date().toISOString()];

      const { data: updatedStudent, error } = await supabase.from('students').update({
        attended: newAttended,
        missed: newMissed,
        attendance_records: newRecords,
        updated_at: new Date().toISOString()
      }).eq('student_id', studentId).select().single();

      if (error || !updatedStudent) throw error || new Error('Update failed');
      setSearchResults(prev => prev.map(s => s.student_id === studentId ? updatedStudent : s));
      await fetchData();
      await logAudit(studentId, 'makeup');
    } catch (err: any) {
      console.error('Makeup error:', err);
      alert(`Failed to record makeup: ${err?.message ?? 'Unknown error'}`);
    }
  };

  const handleMissed = async (studentId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: studentData, error: fetchError } = await supabase.from('students').select('*').eq('student_id', studentId).single();
      if (fetchError || !studentData) throw fetchError || new Error('Student not found');

      const attended = (studentData.attended ?? 0);
      const missed = (studentData.missed ?? 0);
      const totalWeeks = studentData.total_weeks ?? 0;

      if ((attended + missed) >= totalWeeks) { alert('Subscription lessons already used.'); return; }

      const newMissed = missed + 1;

      const { data: updatedStudent, error } = await supabase.from('students').update({
        missed: newMissed,
        updated_at: new Date().toISOString()
      }).eq('student_id', studentId).select().single();

      if (error || !updatedStudent) throw error || new Error('Update failed');
      setSearchResults(prev => prev.map(s => s.student_id === studentId ? updatedStudent : s));
      await fetchData();
      await logAudit(studentId, 'missed');
    } catch (err: any) {
      console.error('Missed error:', err);
      alert(`Failed to mark missed: ${err?.message ?? 'Unknown error'}`);
    }
  };

  const handleSync = async (studentId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: auditLogs, error: auditError } = await supabase
          .from('student_audit')
          .select('action')
          .eq('student_id', studentId)
          .in('action', ['mark', 'makeup', 'missed']);

      if (auditError) throw auditError;

      let newAttended = 0;
      let newMissed = 0;

      (auditLogs || []).forEach(log => {
        if (log.action === 'mark') newAttended++;
        if (log.action === 'makeup') newAttended++;
        if (log.action === 'missed') newMissed++;
      });

      const { data: updatedStudent, error } = await supabase
          .from('students')
          .update({ attended: newAttended, missed: newMissed, updated_at: new Date().toISOString() })
          .eq('student_id', studentId)
          .select()
          .single();

      if (error || !updatedStudent) throw error || new Error('Sync failed');
      setSearchResults(prev => prev.map(s => s.student_id === studentId ? updatedStudent : s));
      alert('Attendance synced from audit logs');
    } catch (err: any) {
      console.error('Sync error:', err);
      alert(`Sync failed: ${err?.message ?? 'Unknown error'}`);
    }
  };

  const handleResetCourse = async (studentId: string) => {
    if (!confirm('Reset this course? This will clear attended and missed counts.')) return;
    try {
      const student = searchResults.find(s => s.student_id === studentId);
      if (!student) throw new Error('Student not found');

      const paid = Boolean(student.paid ?? false);
      if (!paid) {
        const override = confirm('Student must have paid for a new subscription before reset.\n\nClick OK to force reset anyway, or Cancel to abort.');
        if (!override) {
          alert('Reset cancelled.');
          return;
        }
      }

      const { data: updatedStudent, error } = await supabase.from('students').update({
        attended: 0,
        missed: 0,
        attendance_records: [],
        paid: false,
        updated_at: new Date().toISOString()
      }).eq('student_id', studentId).select().single();

      if (error || !updatedStudent) throw error || new Error('Reset failed');
      setSearchResults(prev => prev.map(s => s.student_id === studentId ? updatedStudent : s));
      await logAudit(studentId, 'reset');
      alert('Course reset successfully!');
    } catch (err: any) {
      console.error('Reset error:', err);
      alert(`Failed to reset course: ${err?.message ?? 'Unknown error'}`);
    }
  };

  const logAudit = async (studentId: string, action: 'mark' | 'makeup' | 'missed' | 'reset' | 'undo' | 'delete') => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      await fetch('/api/audit/log-attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ student_id: studentId, action })
      });
    } catch (e) {
      console.error('Failed to log audit:', e);
    }
  };

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
              <button className="btn share-btn" onClick={async () => { await supabase.auth.signOut(); router.push('/'); }}>Logout</button>
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
              <button className="account-avatar-btn" onClick={() => setShowAccountMenu(!showAccountMenu)} title="View account">👤</button>
              {showAccountMenu && (
                  <div className="account-menu">
                    <p className="account-name">{userName || 'User'}</p>
                    <p className="account-role">{userRole?.toUpperCase() || 'MEMBER'}</p>
                    <Link href="/settings" className="account-menu-link" onClick={() => setShowAccountMenu(false)}>⚙️ Settings</Link>
                  </div>
              )}
            </div>
            <h1 className="page-title">Attendance</h1>
          </div>

          <div className="user-controls">
            <Link href="/dashboard" className="btn share-btn">Dashboard</Link>
            <Link href="/payment" className="btn share-btn">Payment</Link>
            {userRole === 'superuser' && <Link href="/add" className="btn share-btn">Add Student</Link>}
            <button className="btn share-btn logout" onClick={async () => { await supabase.auth.signOut(); router.push('/'); }}>Logout</button>
          </div>
        </header>

        <main>
          <div className="search-box">
            <input type="text" placeholder="Search students..." onChange={async (e) => {
              const searchTerm = e.target.value.trim();
              if (searchTerm) {
                try {
                  const response = await fetch('/api/attendance-search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ searchTerm }) });
                  if (!response.ok) throw new Error('Search failed');
                  const data = await response.json();
                  setSearchResults(data.results || []);
                } catch (err) {
                  console.error('Search error:', err);
                  setSearchResults([]);
                }
              } else fetchData();
            }} />
          </div>

          <div className="filter-box">
            <div className="filter-grid">
              <div className="filter-group"><label>Day<select value={selectedDay} onChange={(e) => setSelectedDay(e.target.value)} className="filter-input"><option value="all">All Days</option>{days.filter(d => d !== 'all').map(day => <option key={day} value={day}>{day}</option>)}</select></label></div>
              <div className="filter-group"><label>Timeslot<select value={selectedTimeslot} onChange={(e) => setSelectedTimeslot(e.target.value)} className="filter-input"><option value="all">All Timeslots</option>{timeslots.filter(t => t !== 'all').map(timeslot => <option key={timeslot} value={timeslot}>{timeslot}</option>)}</select></label></div>
              <div className="filter-group"><label>Level<select value={selectedLevel} onChange={(e) => setSelectedLevel(e.target.value)} className="filter-input"><option value="all">All Levels</option>{levels.filter(l => l !== 'all').map(level => <option key={level} value={level}>{level}</option>)}</select></label></div>
            </div>

            <div className="filter-buttons">
              <button onClick={() => { setSelectedDay('all'); setSelectedTimeslot('all'); setSelectedLevel('all'); fetchData(); }} className="filter-button secondary">Clear Filters</button>
              <button onClick={fetchData} className="filter-button">Apply Filters</button>
            </div>
          </div>

          <div className="search-results-display">
            {isLoading && <p>Loading student records...</p>}
            {!isLoading && message && <p className="dashboard-error-message">{message}</p>}
            {!isLoading && Array.isArray(searchResults) && searchResults.length > 0 && (
                <div className="table-container">
                  <table>
                    <thead>
                    <tr>
                      <th>Name</th><th>Day</th><th>Timeslot</th><th>Level</th>
                      <th>Price (S$)</th><th>Weeks</th><th>Attended</th><th>Missed</th><th>Actions</th><th>Attendance History</th>
                    </tr>
                    </thead>
                    <tbody>
                    {searchResults.map(student => {
                      const attended = student.attended ?? 0;
                      const missed = student.missed ?? 0;
                      const used = attended + missed;
                      const finished = used >= (student.total_weeks ?? 0);
                      return (
                          <tr key={student.student_id}>
                            <td>{student.student_name}</td>
                            <td><select aria-label="Change day" value={student.student_day} onChange={async (e) => {
                              const newDay = e.target.value;
                              try {
                                const { error } = await supabase.from('students').update({ student_day: newDay, updated_at: new Date().toISOString() }).match({ student_id: student.student_id });
                                if (error) throw error;
                                setSearchResults(prev => prev.map(s => s.student_id === student.student_id ? { ...s, student_day: newDay, updated_at: new Date().toISOString() } : s));
                              } catch (err) { console.error(err); alert('Failed to update day'); }
                            }}><option value="Saturday">Saturday</option><option value="Sunday">Sunday</option></select></td>

                            <td><select aria-label="Change timeslot" value={student.student_timeslot} onChange={async (e) => {
                              const newTimeslot = e.target.value;
                              try {
                                const { error } = await supabase.from('students').update({ student_timeslot: newTimeslot, updated_at: new Date().toISOString() }).eq('student_id', student.student_id);
                                if (error) throw error;
                                setSearchResults(prev => prev.map(s => s.student_id === student.student_id ? { ...s, student_timeslot: newTimeslot, updated_at: new Date().toISOString() } : s));
                              } catch (err) { console.error(err); alert('Failed to update timeslot'); }
                            }}>{['8-10am','10-12pm','1-3pm','2-4pm','3-5pm','4-6pm'].map(t => <option key={t} value={t}>{t}</option>)}</select></td>

                            <td><select aria-label="Change level" value={student.student_levelofplay} onChange={async (e) => {
                              const newLevel = e.target.value;
                              try {
                                const { error } = await supabase.from('students').update({ student_levelofplay: newLevel, updated_at: new Date().toISOString() }).eq('student_id', student.student_id);
                                if (error) throw error;
                                setSearchResults(prev => prev.map(s => s.student_id === student.student_id ? { ...s, student_levelofplay: newLevel, updated_at: new Date().toISOString() } : s));
                              } catch (err) { console.error(err); alert('Failed to update level'); }
                            }}><option value="Beginner">Beginner</option><option value="Intermediate">Intermediate</option><option value="Advanced">Advanced</option></select></td>

                            <td className="col-price"><input className="price-input" type="number" min="0" step="0.01" value={student.price || 0} onChange={async (e) => {
                              const newPrice = parseFloat(e.target.value || '0');
                              try {
                                const { error } = await supabase.from('students').update({ price: newPrice, updated_at: new Date().toISOString() }).eq('student_id', student.student_id);
                                if (error) throw error; setSearchResults(prev => prev.map(s => s.student_id === student.student_id ? { ...s, price: newPrice, updated_at: new Date().toISOString() } : s));
                              } catch (err) { console.error(err); alert('Failed to update price'); }
                            }} /></td>

                            <td className="col-weeks"><input className="weeks-input" type="number" min="1" value={student.total_weeks || 1} onChange={async (e) => {
                              const newTotal = parseInt(e.target.value || '1');
                              try {
                                const updates: Partial<Student> = { total_weeks: newTotal, updated_at: new Date().toISOString() };
                                if (newTotal < (student.attended + student.missed)) updates.attended = Math.min(student.attended, newTotal);
                                const { error } = await supabase.from('students').update(updates).eq('student_id', student.student_id);
                                if (error) throw error; setSearchResults(prev => prev.map(s => s.student_id === student.student_id ? { ...s, ...updates } : s));
                              } catch (err) { console.error(err); alert('Failed to update total weeks'); }
                            }} /></td>

                            <td className="lessons-count" title={`${attended} attended`}>{attended}</td>
                            <td className="missed-count" title={`${missed} missed`}>{missed}</td>

                            <td>
                              <div style={{display:'flex',gap:10,flexDirection:'column'}}>
                                <button onClick={() => handleSync(student.student_id)} className="sync-btn" style={{backgroundColor: '#9333ea',color:'white',padding:'6px 12px',fontSize:'0.85rem',border:'none',borderRadius:'6px',cursor:'pointer'}}>Sync</button>
                                <div style={{display:'flex',gap:10}}>
                                  <button onClick={() => handleAttendanceClick(student.student_id)} className="attendance-btn" disabled={finished}>Mark Attended</button>
                                  <button onClick={() => handleMissed(student.student_id)} className="missed-btn" disabled={finished}>Missed</button>
                                  <button onClick={() => handleDeleteLastAttendance(student.student_id)} className="delete-btn" disabled={(student.attended ?? 0) + (student.missed ?? 0) === 0}>Undo Last</button>
                                </div>
                                <div>
                                  <button onClick={() => handleMakeupAttendance(student.student_id)} className="makeup-btn" disabled={finished || (student.missed ?? 0) <= 0}>Mark Makeup Class</button>
                                </div>
                                { (student.attended + student.missed) >= (student.total_weeks || 0) && (
                                    <div>
                                      <em>Subscription used — requires payment to reset</em>
                                    </div>
                                )}
                                <div>
                                  <button onClick={() => handleResetCourse(student.student_id)} className="reset-btn">Reset Course</button>
                                </div>
                              </div>
                            </td>

                            <td>
                              {student.attendance_records?.length > 0 ? (
                                  <div className="attendance-history"><ul>{student.attendance_records.map((r,i) => <li key={i}>{new Date(r).toLocaleDateString()}</li>)}</ul></div>
                              ) : 'No attendance'}
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
  );
}