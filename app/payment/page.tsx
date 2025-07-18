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

export default function PaymentPage() {
  const router = useRouter();
  
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

  const handlePaymentStatusChange = async (studentId: string, newPaidStatus: boolean) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('students')
        .update({
          paid: newPaidStatus,
          updated_at: new Date().toISOString()
        })
        .eq('student_id', studentId);

      if (error) throw error;

      setSearchResults(prev => prev.map(student => 
        student.student_id === studentId ? {
          ...student,
          paid: newPaidStatus,
          updated_at: new Date().toISOString()
        } : student
      ));
    } catch (error) {
      console.error('Payment status update failed:', error);
      alert(`Failed to update payment status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <div className="container">
      <header>
        <h1>Payment</h1>
        <div className="user-controls">
          <Link href="/dashboard" className="share-btn">
            Dashboard
          </Link>
          <Link href="/attendance" className="share-btn">
            Attendance
          </Link>
          <Link href="/add" className="share-btn">
            Add Student
          </Link>
          <button 
            className="share-btn" 
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
                
                if (searchTerm) {
                  try {
                    const response = await fetch('/api/payment-search', {
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
                    <th>Student ID</th>
                    <th>Name</th>
                    <th>Day</th>
                    <th>Timeslot</th>
                    <th>Level</th>
                    <th>Price (S$)</th>
                    <th>Total Weeks</th>
                    <th>Total Price (S$)</th>
                    <th>Weeks Completed</th>
                    <th>Payment Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((student) => (
                    <tr key={student.student_id}>
                      <td>{student.student_id}</td>
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
                                .eq('student_id', student.student_id);
                              
                              if (error) throw error;
                              
                              setSearchResults(prev => prev.map(s => 
                                s.student_id === student.student_id ? {
                                  ...s,
                                  student_day: newDay,
                                  updated_at: new Date().toISOString()
                                } : s
                              ));
                            } catch (error) {
                              console.error('Error updating day:', error);
                              alert(`Failed to update day: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
                      <td>{student.price}</td>
                      <td>{student.total_weeks}</td>
                      <td>{(student.price * student.total_weeks).toFixed(2)}</td>
                      <td>
                        {student.weeks_completed || 0}/{student.total_weeks}
                      </td>
                      <td>
                        <label style={{display: 'flex', alignItems: 'center', gap: '5px'}}>
                          <input
                            type="checkbox"
                            checked={student.paid ?? false}
                            onChange={(e) => handlePaymentStatusChange(student.student_id, e.target.checked)}
                          />
                          {student.paid ? 'Paid' : 'Unpaid'}
                        </label>
                      </td>
                      <td>
                        <button 
                          onClick={async () => {
                            if (confirm(`Are you sure you want to delete ${student.student_name}?`)) {
                              try {
                                const { data: { user } } = await supabase.auth.getUser();
                                if (!user) throw new Error('Not authenticated');
                                
                                const serviceRoleClient = createBrowserClient(
                                  process.env.NEXT_PUBLIC_SUPABASE_URL!,
                                  process.env.SUPABASE_SERVICE_ROLE_KEY!
                                );
                                
                                const { error } = await serviceRoleClient
                                  .from('students')
                                  .delete()
                                  .eq('student_id', student.student_id);
                                
                                if (error) throw error;
                                
                                fetchData();
                              } catch (error) {
                                console.error('Error deleting student:', error);
                                alert(`Delete failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
                              }
                            }
                          }}
                          className="delete-btn"
                        >
                          Delete
                        </button>
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
