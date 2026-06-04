'use client'

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import AppHeader from './../components/AppHeader';
import './../styles.css';
import './../dashboard/dashboard.css';
import { Student } from '../../types/supabase';

const useDebounce = (callback: (value: any) => Promise<void>, delay: number) => {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  return (value: any) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      callback(value);
    }, delay);
  };
};

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function AttendancePage() {
  const router = useRouter();
  const [userRole, setUserRole] = useState<'superuser' | 'admin' | 'member' | null>(null);
  const [userName, setUserName] = useState('');

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


  type AttendanceStatus = 'mark' | 'missed' | 'makeup';

  const makeAttendanceRecord = (
      dateIso: string,
      status: AttendanceStatus = 'mark',
      originalMissedDate?: string
  ) => {
    if (status === 'mark') {
      return dateIso;
    }

    if (status === 'makeup' && originalMissedDate) {
      return `${dateIso}|makeup|${originalMissedDate}`;
    }

    return `${dateIso}|${status}`;
  };

  const parseAttendanceRecord = (record: unknown) => {
    const raw = String(record || '');

    if (raw.includes('|')) {
      const [dateIso, statusRaw, originalMissedDate] = raw.split('|');
      const status = ['missed', 'makeup'].includes(statusRaw)
          ? (statusRaw as AttendanceStatus)
          : 'mark';

      return {
        dateIso,
        status,
        originalMissedDate
      };
    }

    const legacyMissedMatch = raw.match(/^(.*)\s+\(missed\)$/i);
    if (legacyMissedMatch) {
      return {
        dateIso: legacyMissedMatch[1],
        status: 'missed' as AttendanceStatus,
        originalMissedDate: undefined
      };
    }

    const legacyMakeupMatch = raw.match(/^(.*)\s+\(makeup\)$/i);
    if (legacyMakeupMatch) {
      return {
        dateIso: legacyMakeupMatch[1],
        status: 'makeup' as AttendanceStatus,
        originalMissedDate: undefined
      };
    }

    return {
      dateIso: raw,
      status: 'mark' as AttendanceStatus,
      originalMissedDate: undefined
    };
  };

  const findLastRecordIndexByStatus = (
      records: unknown[],
      statuses: AttendanceStatus[]
  ) => {
    for (let i = records.length - 1; i >= 0; i--) {
      const parsed = parseAttendanceRecord(records[i]);
      if (statuses.includes(parsed.status)) {
        return i;
      }
    }

    return -1;
  };

  const removeLastRecordByStatus = (
      records: unknown[],
      statuses: AttendanceStatus[]
  ) => {
    const nextRecords = [...records];
    const index = findLastRecordIndexByStatus(nextRecords, statuses);

    if (index !== -1) {
      nextRecords.splice(index, 1);
      return nextRecords;
    }

    if (nextRecords.length > 0) {
      nextRecords.pop();
    }

    return nextRecords;
  };

  const formatAttendanceRecord = (record: unknown) => {
    const { dateIso, status } = parseAttendanceRecord(record);
    const parsedDate = new Date(dateIso);
    const readableDate = Number.isNaN(parsedDate.getTime())
        ? String(dateIso)
        : parsedDate.toLocaleDateString();

    if (status === 'missed') {
      return `${readableDate} (missed)`;
    }

    if (status === 'makeup') {
      return `${readableDate} (makeup)`;
    }

    return readableDate;
  };

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
      fetchData();
    } catch (err: any) {
      alert(`Delete failed: ${err?.message ?? 'Unknown error'}`);
    }
  };

  const handleDeleteLastAttendance = async (studentId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Current student state
      const { data: studentData, error: fetchError } = await supabase
          .from('students')
          .select('*')
          .eq('student_id', studentId)
          .single();

      if (fetchError || !studentData) {
        throw fetchError || new Error('Student not found');
      }

      // Pull latest audit trail for this student (include undo entries)
      const { data: auditLogs, error: auditError } = await supabase
          .from('student_audit')
          .select('action, created_at')
          .eq('student_id', studentId)
          .in('action', ['mark', 'missed', 'makeup', 'undo'])
          .order('created_at', { ascending: false })
          .limit(100);

      if (auditError) throw auditError;

      const logs = auditLogs || [];

      // Build "unconsumed" action stack:
      // - mark/missed/makeup push
      // - undo pops one
      const stack: Array<'mark' | 'missed' | 'makeup'> = [];
      for (let i = logs.length - 1; i >= 0; i--) {
        const a = logs[i].action;
        if (a === 'mark' || a === 'missed' || a === 'makeup') {
          stack.push(a);
        } else if (a === 'undo') {
          if (stack.length > 0) stack.pop();
        }
      }

      // last unconsumed action to reverse now
      const lastAction = stack.length > 0 ? stack[stack.length - 1] : null;

      // Fallback if no audit action found: best effort from counters
      if (!lastAction) {
        let newAttended = studentData.attended ?? 0;
        let newMissed = studentData.missed ?? 0;
        let newRecords = Array.isArray(studentData.attendance_records)
            ? [...studentData.attendance_records]
            : [];

        if (newAttended > 0) {
          newAttended = Math.max(0, newAttended - 1);
          newRecords = removeLastRecordByStatus(newRecords, ['mark', 'makeup']);
        } else if (newMissed > 0) {
          newMissed = Math.max(0, newMissed - 1);
          newRecords = removeLastRecordByStatus(newRecords, ['missed']);
        } else {
          alert('Nothing to undo.');
          return;
        }

        const { data: updatedStudent, error } = await supabase
            .from('students')
            .update({
              attended: newAttended,
              missed: newMissed,
              attendance_records: newRecords,
              updated_at: new Date().toISOString()
            })
            .eq('student_id', studentId)
            .select()
            .single();

        if (error || !updatedStudent) throw error || new Error('Update failed');

        setSearchResults(prev => prev.map(s => s.student_id === studentId ? updatedStudent : s));
        await logAudit(studentId, 'undo');
        return;
      }

      // Reverse lastAction
      let newAttended = studentData.attended ?? 0;
      let newMissed = studentData.missed ?? 0;
      let newRecords = Array.isArray(studentData.attendance_records)
          ? [...studentData.attendance_records]
          : [];

      if (lastAction === 'mark') {
        newAttended = Math.max(0, newAttended - 1);
        newRecords = removeLastRecordByStatus(newRecords, ['mark']);
      } else if (lastAction === 'missed') {
        newMissed = Math.max(0, newMissed - 1);
        newRecords = removeLastRecordByStatus(newRecords, ['missed']);
      } else if (lastAction === 'makeup') {
        // makeup = attended +1, missed -1
        // undo makeup => attended -1, missed +1 and restore the missed history row
        newAttended = Math.max(0, newAttended - 1);
        newMissed = newMissed + 1;

        const makeupRecordIndex = findLastRecordIndexByStatus(newRecords, ['makeup']);
        if (makeupRecordIndex !== -1) {
          const makeupRecord = parseAttendanceRecord(newRecords[makeupRecordIndex]);
          const missedDateToRestore = makeupRecord.originalMissedDate || makeupRecord.dateIso;
          newRecords[makeupRecordIndex] = makeAttendanceRecord(missedDateToRestore, 'missed');
        } else {
          newRecords = removeLastRecordByStatus(newRecords, ['makeup']);
        }
      }

      const { data: updatedStudent, error } = await supabase
          .from('students')
          .update({
            attended: newAttended,
            missed: newMissed,
            attendance_records: newRecords,
            updated_at: new Date().toISOString()
          })
          .eq('student_id', studentId)
          .select()
          .single();

      if (error || !updatedStudent) throw error || new Error('Update failed');

      setSearchResults(prev => prev.map(s => s.student_id === studentId ? updatedStudent : s));

      // IMPORTANT: write undo so next undo consumes previous action correctly
      await logAudit(studentId, 'undo');
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

      const nowIso = new Date().toISOString();
      const newAttended = attended + 1;
      const currentRecords = Array.isArray(studentData.attendance_records)
          ? [...studentData.attendance_records]
          : [];
      const newRecords = [...currentRecords, makeAttendanceRecord(nowIso, 'mark')];

      const { data: updatedStudent, error } = await supabase.from('students').update({
        attended: newAttended,
        attendance_records: newRecords,
        updated_at: nowIso
      }).eq('student_id', studentId).select().single();

      if (error || !updatedStudent) throw error || new Error('Update failed');
      setSearchResults(prev => prev.map(s => s.student_id === studentId ? updatedStudent : s));
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

      const { data: studentData, error: fetchError } = await supabase
          .from('students')
          .select('*')
          .eq('student_id', studentId)
          .single();

      if (fetchError || !studentData) {
        throw fetchError || new Error('Student not found');
      }

      const attended = studentData.attended ?? 0;
      const missed = studentData.missed ?? 0;
      const totalWeeks = studentData.total_weeks ?? 0;

      if (missed <= 0) {
        alert('No missed lessons to makeup.');
        return;
      }

      if ((attended + missed) > totalWeeks) {
        alert('Cannot makeup, subscription total would be exceeded.');
        return;
      }

      const nowIso = new Date().toISOString();
      const newAttended = attended + 1;
      const newMissed = Math.max(0, missed - 1);

      const newRecords = Array.isArray(studentData.attendance_records)
          ? [...studentData.attendance_records]
          : [];
      const missedRecordIndex = findLastRecordIndexByStatus(newRecords, ['missed']);

      if (missedRecordIndex !== -1) {
        const missedRecord = parseAttendanceRecord(newRecords[missedRecordIndex]);
        newRecords[missedRecordIndex] = makeAttendanceRecord(
            nowIso,
            'makeup',
            missedRecord.dateIso
        );
      } else {
        newRecords.push(makeAttendanceRecord(nowIso, 'makeup'));
      }

      const { data: updatedStudent, error } = await supabase
          .from('students')
          .update({
            attended: newAttended,
            missed: newMissed,
            attendance_records: newRecords,
            updated_at: nowIso
          })
          .eq('student_id', studentId)
          .select()
          .single();

      if (error || !updatedStudent) {
        throw error || new Error('Update failed');
      }

      setSearchResults(prev =>
          prev.map(s => s.student_id === studentId ? updatedStudent : s)
      );

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

      const nowIso = new Date().toISOString();
      const newMissed = missed + 1;
      const currentRecords = Array.isArray(studentData.attendance_records)
          ? [...studentData.attendance_records]
          : [];
      const newRecords = [...currentRecords, makeAttendanceRecord(nowIso, 'missed')];

      const { data: updatedStudent, error } = await supabase.from('students').update({
        missed: newMissed,
        attendance_records: newRecords,
        updated_at: nowIso
      }).eq('student_id', studentId).select().single();

      if (error || !updatedStudent) throw error || new Error('Update failed');
      setSearchResults(prev => prev.map(s => s.student_id === studentId ? updatedStudent : s));
      await logAudit(studentId, 'missed');
    } catch (err: any) {
      console.error('Missed error:', err);
      alert(`Failed to mark missed: ${err?.message ?? 'Unknown error'}`);
    }
  };

  const handleResetCourse = async (studentId: string) => {
    if (!confirm('Reset this course? This will clear attended and missed counts.')) {
      return;
    }

    try {
      const student = searchResults.find(s => s.student_id === studentId);

      if (!student) {
        throw new Error('Student not found');
      }

      const paid = Boolean(student.paid ?? false);

      if (!paid) {
        const override = confirm(
            'Student must have paid for a new subscription before reset.\n\n' +
            'Click OK to force reset anyway, or Cancel to abort.'
        );

        if (!override) {
          alert('Reset cancelled.');
          return;
        }
      }

      const { data: updatedStudent, error } = await supabase
          .from('students')
          .update({
            attended: 0,
            missed: 0,
            attendance_records: [],
            paid: false,
            updated_at: new Date().toISOString()
          })
          .eq('student_id', studentId)
          .select()
          .single();

      if (error || !updatedStudent) {
        throw error || new Error('Reset failed');
      }

      setSearchResults(prev =>
          prev.map(s => s.student_id === studentId ? updatedStudent : s)
      );

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
              <button type="button" className="btn share-btn" onClick={async () => { await supabase.auth.signOut(); router.push('/'); }}>Logout</button>
            </div>
          </div>
        </div>
    );
  }

  return (
      <div className="container">
        <AppHeader
            title="Attendance"
            userName={userName}
            userRole={userRole}
            mode="dashboard"
        />

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
              <div className="filter-group">
                <label className="filter-label">
                  Day
                  <select
                      value={selectedDay}
                      onChange={(e) => setSelectedDay(e.target.value)}
                      className="filter-input"
                  >
                    {days.map(d => <option key={d} value={d}>{d === 'all' ? 'All Days' : d}</option>)}
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
                    {timeslots.map(t => <option key={t} value={t}>{t === 'all' ? 'All Timeslots' : t}</option>)}
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
                    {levels.map(l => <option key={l} value={l}>{l === 'all' ? 'All Levels' : l}</option>)}
                  </select>
                </label>
              </div>
            </div>

            <div className="filter-buttons">
              <button type="button" onClick={() => { setSelectedDay('all'); setSelectedTimeslot('all'); setSelectedLevel('all'); fetchData(); }} className="filter-button secondary">Clear Filters</button>
              <button type="button" onClick={fetchData} className="filter-button">Apply Filters</button>
            </div>
          </div>

          <div className="search-results-display">
            {isLoading && <p>Loading student records...</p>}
            {!isLoading && message && <p className="dashboard-error-message">{message}</p>}
            {!isLoading && Array.isArray(searchResults) && searchResults.length > 0 && (
                <div className="table-container">
                  <div className="table-scroll">
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
                              <td>
                                <select
                                    aria-label="Change day"
                                    value={student.student_day}
                                    className="student-field-select"
                                    onChange={async (e) => {
                                      const newDay = e.target.value;
                                      try {
                                        const { error } = await supabase.from('students').update({ student_day: newDay, updated_at: new Date().toISOString() }).eq('student_id', student.student_id);
                                        if (error) throw error;
                                        setSearchResults(prev => prev.map(s => s.student_id === student.student_id ? { ...s, student_day: newDay, updated_at: new Date().toISOString() } : s));
                                      } catch (err) { console.error(err); alert('Failed to update day'); }
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
                                    className="student-field-select"
                                    onChange={async (e) => {
                                      const newTimeslot = e.target.value;
                                      try {
                                        const { error } = await supabase.from('students').update({ student_timeslot: newTimeslot, updated_at: new Date().toISOString() }).eq('student_id', student.student_id);
                                        if (error) throw error;
                                        setSearchResults(prev => prev.map(s => s.student_id === student.student_id ? { ...s, student_timeslot: newTimeslot, updated_at: new Date().toISOString() } : s));
                                      } catch (err) { console.error(err); alert('Failed to update timeslot'); }
                                    }}
                                >
                                  {['8-10am','10-12pm','1-3pm','2-4pm','3-5pm','4-6pm'].map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                              </td>

                              <td>
                                <select
                                    aria-label="Change level"
                                    value={student.student_levelofplay}
                                    className="student-field-select"
                                    onChange={async (e) => {
                                      const newLevel = e.target.value;
                                      try {
                                        const { error } = await supabase.from('students').update({ student_levelofplay: newLevel, updated_at: new Date().toISOString() }).eq('student_id', student.student_id);
                                        if (error) throw error;
                                        setSearchResults(prev => prev.map(s => s.student_id === student.student_id ? { ...s, student_levelofplay: newLevel, updated_at: new Date().toISOString() } : s));
                                      } catch (err) { console.error(err); alert('Failed to update level'); }
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
                                    value={student.price ?? ''}
                                    onChange={(e) => {
                                      const inputValue = e.target.value;
                                      // Update UI immediately
                                      setSearchResults(prev => prev.map(s =>
                                          s.student_id === student.student_id
                                              ? { ...s, price: inputValue === '' ? null : parseFloat(inputValue) }
                                              : s
                                      ));

                                      // Debounce the database update (500ms delay)
                                      const updatePrice = async () => {
                                        const newPrice = inputValue === '' ? null : parseFloat(inputValue || '0');
                                        try {
                                          const { error } = await supabase.from('students').update({ price: newPrice, updated_at: new Date().toISOString() }).eq('student_id', student.student_id);
                                          if (error) throw error;
                                        } catch (err) {
                                          console.error(err);
                                          alert('Failed to update price');
                                        }
                                      };

                                      // Clear existing timeout
                                      if ((e.currentTarget as any).__priceTimeout) {
                                        clearTimeout((e.currentTarget as any).__priceTimeout);
                                      }
                                      (e.currentTarget as any).__priceTimeout = setTimeout(updatePrice, 500);
                                    }}
                                    style={{ borderColor: (student.price ?? 0) === 0 || student.price === null || student.price === undefined ? '#ef4444' : 'var(--border)' }}
                                    title={(student.price ?? 0) === 0 || student.price === null || student.price === undefined ? 'Required field' : `Price: S$${student.price}`}
                                />
                              </td>

                              <td className="col-weeks">
                                <input
                                    className="weeks-input"
                                    type="number"
                                    min="1"
                                    value={student.total_weeks ?? ''}
                                    onChange={(e) => {
                                      const inputValue = e.target.value;
                                      // Update UI immediately
                                      setSearchResults(prev => prev.map(s =>
                                          s.student_id === student.student_id
                                              ? { ...s, total_weeks: inputValue === '' ? null : parseInt(inputValue) }
                                              : s
                                      ));

                                      // Debounce the database update (500ms delay)
                                      const updateWeeks = async () => {
                                        const newTotal = inputValue === '' ? null : parseInt(inputValue || '1');
                                        try {
                                          const updates: Partial<Student> = { total_weeks: newTotal, updated_at: new Date().toISOString() };
                                          const { error } = await supabase.from('students').update(updates).eq('student_id', student.student_id);
                                          if (error) throw error;
                                        } catch (err) {
                                          console.error(err);
                                          alert('Failed to update total weeks');
                                        }
                                      };

                                      // Clear existing timeout
                                      if ((e.currentTarget as any).__weeksTimeout) {
                                        clearTimeout((e.currentTarget as any).__weeksTimeout);
                                      }
                                      (e.currentTarget as any).__weeksTimeout = setTimeout(updateWeeks, 500);
                                    }}
                                    style={{ borderColor: (student.total_weeks ?? 0) === 0 || student.total_weeks === null || student.total_weeks === undefined ? '#ef4444' : 'var(--border)' }}
                                    title={(student.total_weeks ?? 0) === 0 || student.total_weeks === null || student.total_weeks === undefined ? 'Required field' : `Weeks: ${student.total_weeks}`}
                                />
                              </td>

                              <td className="lessons-count" title={`${attended} attended`}>{attended}</td>
                              <td className="missed-count" title={`${missed} missed`}>{missed}</td>

                              <td className="actions-cell">
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                  {/* Row 1: Mark / Missed / Makeup */}
                                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                    <button
                                        type="button"
                                        className="attendance-btn"
                                        onClick={() => handleAttendanceClick(student.student_id)}
                                        disabled={finished}
                                        title={finished ? 'Subscription lessons completed' : 'Mark attended'}
                                    >
                                      Mark
                                    </button>

                                    <button
                                        type="button"
                                        className="missed-btn"
                                        onClick={() => handleMissed(student.student_id)}
                                        disabled={finished}
                                        title={finished ? 'Subscription lessons completed' : 'Mark missed'}
                                    >
                                      Missed
                                    </button>

                                    <button
                                        type="button"
                                        className="makeup-btn"
                                        onClick={() => handleMakeupAttendance(student.student_id)}
                                        disabled={finished || (student.missed ?? 0) <= 0}
                                        title={(student.missed ?? 0) <= 0 ? 'No missed lessons to makeup' : 'Makeup (convert one missed to attended)'}
                                    >
                                      Makeup
                                    </button>
                                  </div>

                                  {/* Row 2: Undo / Reset / Delete */}
                                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                    <button
                                        type="button"
                                        className="undo-btn"
                                        onClick={() => handleDeleteLastAttendance(student.student_id)}
                                        disabled={(student.attended ?? 0) + (student.missed ?? 0) === 0}
                                        title={(student.attended ?? 0) + (student.missed ?? 0) === 0 ? 'No actions to undo' : 'Undo last action'}
                                    >
                                      Undo
                                    </button>

                                    <button
                                        type="button"
                                        className="reset-btn"
                                        onClick={() => handleResetCourse(student.student_id)}
                                        title="Reset course (requires payment)"
                                    >
                                      Reset
                                    </button>

                                    <button
                                        type="button"
                                        className="delete-btn"
                                        onClick={() => {
                                          if (confirm(`Delete ${student.student_name}? This cannot be undone.`)) {
                                            deleteStudent(student.student_id, student.student_name);
                                          }
                                        }}
                                        title="Delete this student"
                                    >
                                      Delete
                                    </button>
                                  </div>

                                  {/* Info message if subscription is used - only show if weeks is set AND used */}
                                  {student.total_weeks !== null &&
                                      student.total_weeks !== undefined &&
                                      student.total_weeks !== 0 &&
                                      (student.attended + student.missed) >= student.total_weeks && (
                                          <p style={{ fontSize: '0.85rem', color: '#ef4444', margin: '4px 0 0 0' }}>
                                            <em>✓ Subscription used — requires payment to reset</em>
                                          </p>
                                      )}
                                </div>
                              </td>

                              <td>
                                {student.attendance_records?.length > 0 ? (
                                    <div className="attendance-history"><ul>{student.attendance_records.map((r,i) => <li key={i}>{formatAttendanceRecord(r)}</li>)}</ul></div>
                                ) : 'No attendance'}
                              </td>
                            </tr>
                        );
                      })}
                      </tbody>
                    </table>
                  </div>
                </div>
            )}
          </div>
        </main>
      </div>
  );
}