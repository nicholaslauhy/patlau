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
  
  // State for selected filter values
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<Student[]>([]);
  
  // State for selected filter values
  const [selectedDay, setSelectedDay] = useState('all');
  const [selectedTimeslot, setSelectedTimeslot] = useState('all');
  const [selectedLevel, setSelectedLevel] = useState('all');

  // Hardcoded options for filters
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

      const { data, error, count } = await query;

      console.log('Supabase query results:', { data, error, count });
      
      if (error) {
        console.error('Supabase query error details:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code
        });
        throw error;
      }
      
      if (data && Array.isArray(data)) {
        console.log(`Found ${data.length} student records`);
        setSearchResults(data);
        setMessage(null);
      } else {
        console.log('No student records found in response');
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

  const handleApplyFilters = () => {
    fetchData();
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

      const updatedRecords = [...studentData.attendance_records];
      updatedRecords.pop(); // Remove last attendance

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
        student.student_id === studentId ? {
          ...student,
          attendance_records: updatedStudent.attendance_records,
          weeks_completed: updatedStudent.weeks_completed,
          updated_at: updatedStudent.updated_at
        } : student
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

      // Only update if it's their day (Saturday/Sunday)
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

      setSearchResults(prev => prev.map(student => 
        student.student_id === studentId ? updatedStudent : student
      ));

    } catch (error) {
      console.error('Reset error:', error);
      alert(`Failed to reset course: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Fetch data on initial load
  useEffect(() => {
    fetchData();
  }, []);

  return (
    <div className="container">
      <header>
        <h1>Dashboard</h1>
        <div className="user-controls">
          <Link href="/attendance" className="share-btn">
            Attendance
          </Link>
          <Link href="/payment" className="share-btn">
            Payment
          </Link>
          <Link href="/add" className="share-btn">
            Add Student
          </Link>
          <button 
            className="share-btn logout" 
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
              console.log('Search term:', searchTerm);
              
              if (searchTerm) {
                try {
                  console.log('Making search request to /api/search');
                  const response = await fetch('/api/search', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ searchTerm }),
                  });

                  console.log('Search response status:', response.status);
                  
                  if (!response.ok) {
                    const errorData = await response.json();
                    console.error('Search request failed:', errorData);
                    throw new Error(errorData.message || 'Search failed');
                  }

                  const data = await response.json();
                  console.log('Search response data:', data);
                  
                  if (data.results) {
                    console.log(`Found ${data.results.length} matching records`);
                    setSearchResults(data.results);
                  } else {
                    console.log('No results found');
                    setSearchResults([]);
                  }
                } catch (error) {
                  console.error('Search error:', error);
                  setSearchResults([]);
                }
              } else {
                console.log('Empty search term - fetching all data');
                fetchData();
              }
            }}
          />
        </div>

        <div className="filter-box">
          <div className="filter-grid">
            {/* Day Filter */}
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

            {/* Timeslot Filter */}
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

            {/* Level Filter */}
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
              onClick={handleApplyFilters}
              className="filter-button"
            >
              Apply Filters
            </button>
          </div>
        </div>

        {/* Search Results Display */}
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
                      <td>
                        <button 
                          onClick={async () => {
                            if (confirm(`Are you sure you want to delete ${student.student_name}?`)) {
                              try {
                                console.log('Attempting to delete student:', student.student_id);
                                // First verify user is authenticated
                                const { data: { user } } = await supabase.auth.getUser();
                                if (!user) throw new Error('Not authenticated');
                                
                                // Perform delete with service role key (bypass RLS)
                                const serviceRoleClient = createBrowserClient(
                                  process.env.NEXT_PUBLIC_SUPABASE_URL!,
                                  process.env.SUPABASE_SERVICE_ROLE_KEY!
                                );
                                
                                const { error } = await serviceRoleClient
                                  .from('students')
                                  .delete()
                                  .eq('student_id', student.student_id);
                                
                                if (error) {
                                  console.error('Supabase delete error:', {
                                    message: error.message,
                                    details: error.details,
                                    code: error.code
                                  });
                                  throw error;
                                }
                                
                                console.log('Delete successful');
                                fetchData(); // Refresh the data
                              } catch (error) {
                                console.error('Full error deleting student:', error);
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
