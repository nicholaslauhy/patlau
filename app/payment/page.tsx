'use client'

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import AppHeader from './../components/AppHeader';
import './../styles.css';
import './../dashboard/dashboard.css';
import './payment.css';
import { Student } from '../../types/supabase';

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function PaymentPage() {
  const router = useRouter();
  const [userName, setUserName] = useState('');
  const [userRole, setUserRole] = useState<'superuser' | 'admin' | 'member' | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { router.push('/'); return; }
        const role = (user.user_metadata?.role as 'superuser' | 'admin' | 'member') || 'member';
        if (role === 'member' || role === 'admin') { setUserRole(role); return; }
        setUserRole(role);
      } catch (err) { console.error(err); router.push('/'); }
    };
    checkAuth();
  }, [router]);

  useEffect(() => {
    const loadUserInfo = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) setUserName(user.user_metadata?.name || user.email || 'User');
      } catch (err) { console.error(err); }
    };
    loadUserInfo();
  }, []);

  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<Student[]>([]);
  const [paidCount, setPaidCount] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [trackingPeriod, setTrackingPeriod] = useState(() => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const end = new Date(start);
    end.setMonth(end.getMonth() + 3);
    return { start, end };
  });
  const [periodLoaded, setPeriodLoaded] = useState(false);

  const [selectedDay, setSelectedDay] = useState('all');
  const [selectedTimeslot, setSelectedTimeslot] = useState('all');
  const [selectedLevel, setSelectedLevel] = useState('all');

  const days = ['all', 'Saturday', 'Sunday'];
  const timeslots = ['all', '8-10am', '10-12pm', '1-3pm', '2-4pm', '3-5pm', '4-6pm'];
  const levels = ['all', 'Beginner', 'Intermediate', 'Advanced'];

  const sendWeekendTelegram = async (message: string) => {
    const response = await fetch('/api/telegram-weekend-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ message }),
    });

    let payload: any = null;

    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok || !payload?.success) {
      const details = payload?.details?.description
          || payload?.details?.message
          || payload?.error
          || `Weekend Telegram route returned HTTP ${response.status}`;

      throw new Error(details);
    }

    return payload;
  };

  const sendPaymentStatusTelegram = async (
      studentName: string,
      amount: number,
      recordedAt: string,
      isPaid: boolean
  ) => {
    const message =
        `${isPaid ? '✅ Weekend Payment Received' : '↩️ Weekend Payment Reversed'}\n\n` +
        `Student: ${studentName}\n` +
        `Amount: ${isPaid ? '+' : '-'}S$${Math.abs(amount).toFixed(2)}\n` +
        `Recorded At: ${new Date(recordedAt).toLocaleString()}\n` +
        `Status: ${isPaid ? 'Paid' : 'Unpaid'}`;

    await sendWeekendTelegram(message);
  };

  const sendPeriodSummary = async (
      totalAmount: number,
      startDate: Date,
      endDate: Date
  ) => {
    const { data: payments, error: paymentError } = await supabase
        .from('payment_history')
        .select('student_id, amount, recorded_at')
        .gte('recorded_at', startDate.toISOString())
        .lt('recorded_at', endDate.toISOString())
        .order('recorded_at', { ascending: true });

    if (paymentError) throw paymentError;

    const paymentDetails = await Promise.all(
        (payments || []).map(async (payment) => {
          const { data: student } = await supabase
              .from('students')
              .select('student_name')
              .eq('student_id', payment.student_id)
              .maybeSingle();

          return {
            ...payment,
            student_name: student?.student_name || 'Unknown',
          };
        })
    );

    const paymentLines = paymentDetails.length
        ? paymentDetails
            .map((payment) => {
              const sign = Number(payment.amount || 0) >= 0 ? '+' : '-';

              return (
                  `- ${payment.student_name}: ` +
                  `${sign}S$${Math.abs(Number(payment.amount || 0)).toFixed(2)} ` +
                  `(${new Date(payment.recorded_at).toLocaleDateString()})`
              );
            })
            .join('\n')
        : '- No Weekend payment transactions recorded in this period.';

    const message =
        `📊 Weekend Payment Period Summary\n\n` +
        `Period: ${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}\n` +
        `Total Collected: S$${totalAmount.toFixed(2)}\n\n` +
        `Payment Details:\n${paymentLines}\n\n` +
        `Payment records were preserved.`;

    await sendWeekendTelegram(message);
  };

  const loadWeekendTrackingPeriod = async () => {
    const { data, error } = await supabase
        .from('weekend_payment_period_state')
        .select('*')
        .eq('id', 1)
        .maybeSingle();

    if (error) throw error;

    if (data) {
      setTrackingPeriod({
        start: new Date(data.start_at),
        end: new Date(data.end_at),
      });
      setPeriodLoaded(true);
      return;
    }

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 3);

    const { error: insertError } = await supabase
        .from('weekend_payment_period_state')
        .insert({
          id: 1,
          start_at: start.toISOString(),
          end_at: end.toISOString(),
          updated_at: new Date().toISOString(),
        });

    if (insertError) throw insertError;

    setTrackingPeriod({ start, end });
    setPeriodLoaded(true);
  };

  const fetchPaidCount = async () => {
    if (!periodLoaded) return;

    try {
      const now = new Date();

      if (now >= trackingPeriod.end) {
        const { data: completedRows, error: completedError } = await supabase
            .from('payment_history')
            .select('amount')
            .gte('recorded_at', trackingPeriod.start.toISOString())
            .lt('recorded_at', trackingPeriod.end.toISOString());

        if (completedError) throw completedError;

        const completedTotal =
            completedRows?.reduce((sum, row) => sum + Number(row.amount || 0), 0) || 0;

        await sendPeriodSummary(
            completedTotal,
            trackingPeriod.start,
            trackingPeriod.end
        );

        let nextStart = new Date(trackingPeriod.end);
        let nextEnd = new Date(nextStart);
        nextEnd.setMonth(nextEnd.getMonth() + 3);

        while (now >= nextEnd) {
          nextStart = new Date(nextEnd);
          nextEnd = new Date(nextStart);
          nextEnd.setMonth(nextEnd.getMonth() + 3);
        }

        const { error: periodError } = await supabase
            .from('weekend_payment_period_state')
            .update({
              start_at: nextStart.toISOString(),
              end_at: nextEnd.toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', 1);

        if (periodError) throw periodError;

        setTrackingPeriod({ start: nextStart, end: nextEnd });
        return;
      }

      const { data, error } = await supabase
          .from('payment_history')
          .select('amount, recorded_at')
          .gte('recorded_at', trackingPeriod.start.toISOString())
          .lt('recorded_at', trackingPeriod.end.toISOString());

      if (error) throw error;

      const totalAmount =
          data?.reduce((sum, record) => sum + Number(record.amount || 0), 0) || 0;

      setPaidCount(totalAmount);
      setLastUpdated(
          `Total collected: S$${totalAmount.toFixed(2)} (as of ${new Date().toLocaleDateString()})`
      );
    } catch (error) {
      console.error('Error fetching Weekend payment counter:', error);
    }
  };

  const fetchData = async () => {
    setIsLoading(true);
    setSearchResults([]);
    await fetchPaidCount();

    try {
      let query = supabase.from('students').select('*');

      if (selectedDay !== 'all') query = query.eq('student_day', selectedDay);
      if (selectedTimeslot !== 'all') query = query.eq('student_timeslot', selectedTimeslot);
      if (selectedLevel !== 'all') query = query.eq('student_levelofplay', selectedLevel);

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

  useEffect(() => {
    loadWeekendTrackingPeriod().catch((error) => {
      console.error('Failed to load Weekend tracking period:', error);
    });
  }, []);

  useEffect(() => {
    if (periodLoaded) fetchData();
  }, [periodLoaded, trackingPeriod.start.getTime(), trackingPeriod.end.getTime()]);

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

  const handlePaymentStatusChange = async (studentId: string, newPaidStatus: boolean) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const student = searchResults.find(s => s.student_id === studentId);
      if (!student) throw new Error('Student not found');

      const now = new Date();
      const studentAmount = (student.price || 0) * (student.total_weeks || 1);
      const historyAmount = newPaidStatus ? studentAmount : -studentAmount;
      const newAmount = newPaidStatus ? paidCount + studentAmount : paidCount - studentAmount;

      const { error: updateError } = await supabase
          .from('students')
          .update({ paid: newPaidStatus, updated_at: now.toISOString() })
          .eq('student_id', studentId);

      if (updateError) throw updateError;

      const { data: { session } } = await supabase.auth.getSession();
      const createTableResponse = await fetch('/api/create-payment-table', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}` }
      });

      if (!createTableResponse.ok) {
        const errorData = await createTableResponse.json();
        throw new Error(errorData.error || 'Failed to create payment table');
      }

      const { error: historyError } = await supabase
          .from('payment_history')
          .insert({
            student_id: studentId,
            amount: historyAmount,
            recorded_at: now.toISOString()
          });

      if (historyError) throw new Error('Failed to record payment history');

      await sendPaymentStatusTelegram(
          student.student_name,
          studentAmount,
          now.toISOString(),
          newPaidStatus
      );

      setPaidCount(newAmount);
      setSearchResults(prev =>
          prev.map(s =>
              s.student_id === studentId
                  ? { ...s, paid: newPaidStatus, updated_at: now.toISOString() }
                  : s
          )
      );
      setLastUpdated(`Payment recorded at ${now.toLocaleString()}`);
      setTimeout(fetchPaidCount, 500);
    } catch (error) {
      console.error('Payment status update failed:', error);
      alert(
          `Payment status was updated, but the Weekend Telegram notification failed:

${
              error instanceof Error ? error.message : 'Unknown error'
          }

Check the Weekend bot token, group membership, chat ID and topic ID.`
      );
    }
  };

  const handleDelete = async (studentId: string) => {
    if (!confirm('Delete this student?')) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const response = await fetch('/api/students/delete', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ student_id: studentId }) });
      if (!response.ok) { const d = await response.json(); throw new Error(d.error || 'Delete failed'); }
      fetchData();
    } catch (err: any) {
      console.error('Delete failed:', err); alert('Delete failed');
    }
  };

  if (userRole === 'admin' || userRole === 'member') {
    return (
        <div className="container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '3rem 1rem' }}>
          <div className="form-card" style={{ maxWidth: 600, width: '100%', textAlign: 'center' }}>
            <h1 style={{ fontSize: '3rem', margin: '0 0 1rem', color: '#dc2626' }}>403</h1>
            <h2 style={{ fontSize: '1.5rem', margin: '0 0 1rem', color: '#374151' }}>Forbidden</h2>
            <p style={{ margin: '0 0 1.5rem', color: '#6b7280' }}>You do not have permission to access this page.</p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <Link href="/dashboard" className="btn share-btn">Go to Dashboard</Link>
              <button className="btn share-btn" onClick={async () => { await supabase.auth.signOut(); router.push('/'); }}>Logout</button>
            </div>
          </div>
        </div>
    );
  }

  return (
      <div className="container">
        <AppHeader
            title="Payment"
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
                  const response = await fetch('/api/payment-search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ searchTerm }) });
                  if (!response.ok) throw new Error('Search failed');
                  const data = await response.json();
                  setSearchResults(data.results || []);
                } catch (err) {
                  console.error('Search error:', err); setSearchResults([]);
                }
              } else fetchData();
            }} />
          </div>

          <div className="filter-box">
            <div className="filter-grid">
              <div className="filter-group">
                <label className="filter-label">
                  Day
                  <select value={selectedDay} onChange={(e) => setSelectedDay(e.target.value)} className="filter-input">
                    <option value="all">All Days</option>
                    {days.filter(d => d !== 'all').map(day => <option key={day} value={day}>{day}</option>)}
                  </select>
                </label>
              </div>

              <div className="filter-group">
                <label className="filter-label">
                  Timeslot
                  <select value={selectedTimeslot} onChange={(e) => setSelectedTimeslot(e.target.value)} className="filter-input">
                    <option value="all">All Timeslots</option>
                    {timeslots.filter(t => t !== 'all').map(timeslot => <option key={timeslot} value={timeslot}>{timeslot}</option>)}
                  </select>
                </label>
              </div>

              <div className="filter-group">
                <label className="filter-label">
                  Level
                  <select value={selectedLevel} onChange={(e) => setSelectedLevel(e.target.value)} className="filter-input">
                    <option value="all">All Levels</option>
                    {levels.filter(l => l !== 'all').map(level => <option key={level} value={level}>{level}</option>)}
                  </select>
                </label>
              </div>
            </div>

            <div className="filter-buttons">
              <button onClick={() => { setSelectedDay('all'); setSelectedTimeslot('all'); setSelectedLevel('all'); fetchData(); }} className="filter-button secondary">Clear Filters</button>
              <button onClick={fetchData} className="filter-button">Apply Filters</button>
            </div>
          </div>

          <div className="payment-summary">
            <div className="summary-card">
              <h3>Total Payments Collected</h3>
              <p className="amount">S${paidCount.toFixed(2)}</p>
              <p className="timestamp">Tracking Period: {trackingPeriod.start.toLocaleDateString()} - {trackingPeriod.end.toLocaleDateString()}</p>

              <div className="payment-actions">
                <button
                    className="payment-action-btn danger"
                    onClick={async () => {
                      if (!confirm(
                          'Send the current rolling 3-month summary and start a new 3-month counter from today? Existing payment statuses and history will be preserved.'
                      )) return;

                      try {
                        const { data, error } = await supabase
                            .from('payment_history')
                            .select('amount')
                            .gte('recorded_at', trackingPeriod.start.toISOString())
                            .lt('recorded_at', trackingPeriod.end.toISOString());

                        if (error) throw error;

                        const totalAmount =
                            data?.reduce((sum, row) => sum + Number(row.amount || 0), 0) || 0;

                        await sendPeriodSummary(
                            totalAmount,
                            trackingPeriod.start,
                            trackingPeriod.end
                        );

                        const newStart = new Date();
                        newStart.setHours(0, 0, 0, 0);
                        const newEnd = new Date(newStart);
                        newEnd.setMonth(newEnd.getMonth() + 3);

                        const { error: periodError } = await supabase
                            .from('weekend_payment_period_state')
                            .upsert({
                              id: 1,
                              start_at: newStart.toISOString(),
                              end_at: newEnd.toISOString(),
                              updated_at: new Date().toISOString(),
                            });

                        if (periodError) throw periodError;

                        setTrackingPeriod({ start: newStart, end: newEnd });
                        setPaidCount(0);
                        setLastUpdated(
                            'Summary sent. New rolling 3-month counter started. Payment statuses and history were preserved.'
                        );
                      } catch (error) {
                        console.error('Reset failed:', error);
                        alert(
                            `Weekend reset summary failed:

${
                                error instanceof Error ? error.message : 'Unknown error'
                            }`
                        );
                      }
                    }}
                >
                  Reset Total
                </button>

                <button className="payment-action-btn warning" onClick={async () => {
                  try {
                    const { data: lastPayment } = await supabase
                        .from('payment_history')
                        .select('student_id, amount, recorded_at')
                        .order('recorded_at', { ascending: false })
                        .limit(1)
                        .single();
                    if (!lastPayment) throw new Error('No payment found to undo');

                    const { data: student } = await supabase
                        .from('students')
                        .select('student_name')
                        .eq('student_id', lastPayment.student_id)
                        .single();

                    const { error: updateError } = await supabase.from('students').update({ paid: false }).eq('student_id', lastPayment.student_id);
                    if (updateError) throw updateError;

                    const { error: deleteError } = await supabase.from('payment_history').delete().eq('recorded_at', lastPayment.recorded_at);
                    if (deleteError) throw deleteError;

                    const message = `↩️ Payment Undone ↩️\n\nStudent: ${student?.student_name || 'Unknown'}\nAmount: S$${Math.abs(lastPayment.amount).toFixed(2)}\nRecorded at: ${new Date(lastPayment.recorded_at).toLocaleString()}\nStatus: Marked as unpaid`;
                    await sendWeekendTelegram(message);

                    await fetchData();
                    setLastUpdated('Undid last payment. Notification sent.');
                  } catch (error) {
                    console.error('Undo failed:', error);
                    alert('Undo failed. See console for details.');
                    fetchData();
                  }
                }}>Undo Add</button>
              </div>
            </div>
          </div>

          <div className="search-results-display">
            {isLoading && <p>Loading student records...</p>}
            {!isLoading && message && <p className="dashboard-error-message">{message}</p>}
            {!isLoading && !message && searchResults.length === 0 && <p>No student records found matching your criteria.</p>}

            {!isLoading && Array.isArray(searchResults) && searchResults.length > 0 && (
                <div className="table-container">
                  <div className="user-scroll">
                    <table>
                      <thead>
                      <tr>
                        <th>Name</th><th>Day</th><th>Timeslot</th><th>Level</th>
                        <th className="col-price">Price (S$)</th><th className="col-weeks">Total Weeks</th>
                        <th>Attended</th><th>Missed</th><th>Total Price</th><th>Payment Status</th><th>Actions</th>
                      </tr>
                      </thead>
                      <tbody>
                      {searchResults.map(student => {
                        const used = (student.attended ?? 0) + (student.missed ?? 0);
                        const finished = used >= (student.total_weeks ?? 0);
                        return (
                            <tr key={student.student_id}>
                              <td>{student.student_name}</td>
                              <td>{student.student_day}</td>
                              <td>{student.student_timeslot}</td>
                              <td>{student.student_levelofplay}</td>
                              <td className="col-price">{(student.price || 0).toFixed(2)}</td>
                              <td className="col-weeks">{student.total_weeks || 1}</td>
                              <td className="lessons-count">{student.attended ?? 0}</td>
                              <td className="missed-count">{student.missed ?? 0}</td>
                              <td className="col-total">{(((student.price || 0) * (student.total_weeks || 1))).toFixed(2)}</td>
                              <td>
                                <label style={{display:'flex',alignItems:'center',gap:5}}>
                                  <input type="checkbox" checked={student.paid ?? false} onChange={(e) => handlePaymentStatusChange(student.student_id, e.target.checked)} />
                                  {student.paid ? 'Paid' : 'Unpaid'}
                                </label>
                              </td>
                              <td>
                                <div style={{display:'flex',gap:10}}>
                                  <button onClick={() => handleDelete(student.student_id)} className="delete-btn">Delete</button>
                                  { finished && !student.paid && <em style={{color:'#b91c1c'}}>Finish used — requires payment</em> }
                                </div>
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