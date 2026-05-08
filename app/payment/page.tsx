'use client'

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
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

  const [selectedDay, setSelectedDay] = useState('all');
  const [selectedTimeslot, setSelectedTimeslot] = useState('all');
  const [selectedLevel, setSelectedLevel] = useState('all');

  const days = ['all', 'Saturday', 'Sunday'];
  const timeslots = ['all', '8-10am', '10-12pm', '1-3pm', '2-4pm', '3-5pm', '4-6pm'];
  const levels = ['all', 'Beginner', 'Intermediate', 'Advanced'];

  const [paymentHistory, setPaymentHistory] = useState<Record<string, number>>({});

  const sendPeriodSummary = async (totalAmount: number, startDate: Date, endDate: Date) => {
    try {
      const { data: payments } = await supabase
          .from('payment_history')
          .select('student_id, amount, recorded_at')
          .gte('recorded_at', startDate.toISOString())
          .lte('recorded_at', endDate.toISOString())
          .order('recorded_at', { ascending: true });

      const paymentDetails = await Promise.all(
          (payments || []).map(async (payment) => {
            const { data: student } = await supabase
                .from('students')
                .select('student_name')
                .eq('student_id', payment.student_id)
                .single();
            return {
              ...payment,
              student_name: student?.student_name || 'Unknown'
            };
          })
      );

      const paymentLines = paymentDetails.map(p =>
          `- ${p.student_name}: S$${Math.abs(p.amount).toFixed(2)} (${new Date(p.recorded_at).toLocaleDateString()})`
      ).join('\n');

      const message = `📊 Payment Period Summary 📊\n\n` +
          `Period: ${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}\n` +
          `Total Collected: S$${totalAmount.toFixed(2)}\n\n` +
          `Payment Details:\n${paymentLines}\n\n` +
          `Starting new tracking period from today.`;

      const response = await fetch('/api/telegram-reminder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });

      if (!response.ok) throw new Error('Failed to send Telegram notification');

      const { error: updateError } = await supabase
          .from('students')
          .update({ paid: false })
          .neq('paid', false);

      if (updateError) throw updateError;

    } catch (error) {
      console.error('Error sending period summary:', error);
    }
  };

  const fetchPaidCount = async () => {
    try {
      const { data, error } = await supabase
          .from('payment_history')
          .select('amount, recorded_at')
          .gte('recorded_at', trackingPeriod.start.toISOString())
          .lte('recorded_at', trackingPeriod.end.toISOString());

      if (error) throw error;

      const totalAmount = data?.reduce((sum, record) => sum + record.amount, 0) || 0;
      setPaidCount(totalAmount);
      setLastUpdated(`Total collected: S$${totalAmount.toFixed(2)} (as of ${new Date().toLocaleDateString()})`);

      if (new Date() > trackingPeriod.end) {
        await sendPeriodSummary(totalAmount, trackingPeriod.start, trackingPeriod.end);

        const today = new Date();
        const newStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const newEnd = new Date(newStart);
        newEnd.setMonth(newEnd.getMonth() + 3);

        setTrackingPeriod({ start: newStart, end: newEnd });
        await fetchPaidCount();
      }
    } catch (error) {
      console.error('Error fetching paid count:', error);
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

  const handlePaymentStatusChange = async (studentId: string, newPaidStatus: boolean) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const student = searchResults.find(s => s.student_id === studentId);
      if (!student) throw new Error('Student not found');

      const now = new Date();
      const studentAmount = (student.price || 0) * (student.total_weeks || 1);
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
            amount: newPaidStatus ? studentAmount : -studentAmount,
            recorded_at: now.toISOString()
          });

      if (historyError) throw new Error('Failed to record payment history');

      setPaidCount(newAmount);
      setSearchResults(prev => prev.map(s => s.student_id === studentId ? { ...s, paid: newPaidStatus, updated_at: now.toISOString() } : s));
      setLastUpdated(`Payment recorded at ${now.toLocaleString()}`);
      setTimeout(fetchPaidCount, 500);
    } catch (error) {
      console.error('Payment status update failed:', error);
      alert(`Failed to update payment status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
      <div className="container">
        <header>
          <h1>Payment</h1>
          <div className="user-controls">
            <Link href="/dashboard" className="btn share-btn">Dashboard</Link>
            <Link href="/attendance" className="btn share-btn">Attendance</Link>
            <Link href="/add" className="btn share-btn">Add Student</Link>
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
                  try {
                    if (searchTerm) {
                      const response = await fetch('/api/payment-search', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ searchTerm }),
                      });
                      if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(errorData.message || 'Search failed');
                      }
                      const data = await response.json();
                      setSearchResults(data.results || []);
                    } else {
                      await fetchData();
                    }
                  } catch (error) {
                    console.error('Search error:', error);
                    setSearchResults([]);
                  }
                }}
            />
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
              <p className="timestamp">Updated: {new Date().toLocaleString()}</p>

              <div className="payment-actions">
                <button className="payment-action-btn danger" onClick={async () => {
                  if (!confirm('Are you sure you want to reset the total? This will send a summary and start a new tracking period.')) return;
                  try {
                    const { data } = await supabase
                        .from('payment_history')
                        .select('amount')
                        .gte('recorded_at', trackingPeriod.start.toISOString())
                        .lte('recorded_at', trackingPeriod.end.toISOString());
                    const totalAmount = data?.reduce((sum, record) => sum + record.amount, 0) || 0;
                    await sendPeriodSummary(totalAmount, trackingPeriod.start, trackingPeriod.end);
                    const { error: updateError } = await supabase.from('students').update({ paid: false }).neq('paid', false);
                    if (updateError) throw updateError;
                    const { error: deleteError } = await supabase.from('payment_history').delete().neq('id', 0);
                    if (deleteError) throw deleteError;
                    const today = new Date();
                    const newStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
                    const newEnd = new Date(newStart);
                    newEnd.setMonth(newEnd.getMonth() + 3);
                    setTrackingPeriod({ start: newStart, end: newEnd });
                    await fetchData();
                    setLastUpdated('Summary sent. All payments reset. New tracking period started');
                  } catch (error) {
                    console.error('Reset failed:', error);
                    alert('Reset failed. See console for details.');
                    fetchData();
                  }
                }}>Reset Total</button>

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
                    await fetch('/api/telegram-reminder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });

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
                  <table>
                    <thead>
                    <tr>
                      {/* Student ID column removed visually */}
                      <th>Name</th>
                      <th>Day</th>
                      <th>Timeslot</th>
                      <th>Level</th>
                      <th className="col-price">Price (S$)</th>
                      <th className="col-weeks">Total Weeks</th>
                      <th className="col-total">Total Price (S$)</th>
                      <th>Weeks Completed</th>
                      <th>Payment Status</th>
                      <th>Actions</th>
                    </tr>
                    </thead>
                    <tbody>
                    {searchResults.map((student) => (
                        <tr key={student.student_id}>
                          {/* ID removed here */}
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
                                        .update({ student_day: newDay, updated_at: new Date().toISOString() })
                                        .eq('student_id', student.student_id);
                                    if (error) throw error;
                                    setSearchResults(prev => prev.map(s => s.student_id === student.student_id ? { ...s, student_day: newDay, updated_at: new Date().toISOString() } : s));
                                  } catch (error) {
                                    console.error('Error updating day:', error);
                                    alert('Failed to update day');
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
                                        .update({ student_timeslot: newTimeslot, updated_at: new Date().toISOString() })
                                        .eq('student_id', student.student_id);
                                    if (error) throw error;
                                    setSearchResults(prev => prev.map(s => s.student_id === student.student_id ? { ...s, student_timeslot: newTimeslot, updated_at: new Date().toISOString() } : s));
                                  } catch (error) {
                                    console.error('Error updating timeslot:', error);
                                    alert('Failed to update timeslot');
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
                                        .update({ student_levelofplay: newLevel, updated_at: new Date().toISOString() })
                                        .eq('student_id', student.student_id);
                                    if (error) throw error;
                                    setSearchResults(prev => prev.map(s => s.student_id === student.student_id ? { ...s, student_levelofplay: newLevel, updated_at: new Date().toISOString() } : s));
                                  } catch (error) {
                                    console.error('Error updating level:', error);
                                    alert('Failed to update level');
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
                                onChange={async (e) => {
                                  const newPrice = parseFloat(e.target.value || '0');
                                  try {
                                    const { error } = await supabase.from('students').update({ price: newPrice, updated_at: new Date().toISOString() }).eq('student_id', student.student_id);
                                    if (error) throw error;
                                    setSearchResults(prev => prev.map(s => s.student_id === student.student_id ? { ...s, price: newPrice, updated_at: new Date().toISOString() } : s));
                                  } catch (error) {
                                    console.error('Error updating price:', error);
                                    alert('Failed to update price');
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
                                onChange={async (e) => {
                                  const newTotalWeeks = parseInt(e.target.value || '1');
                                  try {
                                    const updates: Partial<Student> = { total_weeks: newTotalWeeks, updated_at: new Date().toISOString() };
                                    if (newTotalWeeks < (student.weeks_completed || 0)) updates.weeks_completed = newTotalWeeks;
                                    const { error } = await supabase.from('students').update(updates).eq('student_id', student.student_id);
                                    if (error) throw error;
                                    setSearchResults(prev => prev.map(s => s.student_id === student.student_id ? { ...s, ...updates, updated_at: new Date().toISOString() } : s));
                                  } catch (error) {
                                    console.error('Error updating total weeks:', error);
                                    alert('Failed to update total weeks');
                                  }
                                }}
                            />
                          </td>

                          <td className="col-total">{((student.price || 0) * (student.total_weeks || 1)).toFixed(2)}</td>

                          <td>{student.weeks_completed || 0}/{student.total_weeks || 1}</td>

                          <td>
                            <label style={{display: 'flex', alignItems: 'center', gap: '5px'}}>
                              <input type="checkbox" checked={student.paid ?? false} onChange={(e) => handlePaymentStatusChange(student.student_id, e.target.checked)} />
                              {student.paid ? 'Paid' : 'Unpaid'}
                            </label>
                          </td>

                          <td>
                            <button onClick={async () => {
                              if (!confirm(`Are you sure you want to delete ${student.student_name}?`)) return;
                              try {
                                const { data: { user } } = await supabase.auth.getUser();
                                if (!user) throw new Error('Not authenticated');
                                const serviceRoleClient = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
                                const { error } = await serviceRoleClient.from('students').delete().eq('student_id', student.student_id);
                                if (error) throw error;
                                fetchData();
                              } catch (error) {
                                console.error('Error deleting student:', error);
                                alert('Delete failed');
                              }
                            }} className="delete-btn">Delete</button>
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