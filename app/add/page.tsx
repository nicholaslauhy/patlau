'use client'

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import { v4 as uuidv4 } from 'uuid';
import './../styles.css';
import './../dashboard/dashboard.css';
import './add.css';

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function AddStudent() {
  const router = useRouter();
  const [userRole, setUserRole] = useState<'superuser' | 'admin' | 'member' | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          router.push('/');
          return;
        }
        const role = (user.user_metadata?.role as 'superuser' | 'admin' | 'member') || 'member';
        if (role === 'member' || role === null) {
          router.push('/dashboard');
          return;
        }
        setUserRole(role);
      } catch (err) {
        router.push('/');
      }
    };
    checkAuth();
  }, [router]);

  const [formData, setFormData] = useState({
    student_name: '',
    student_day: 'Saturday',
    student_timeslot: '8-10am',
    student_levelofplay: 'Beginner',
    price: 0,
    total_weeks: 1,
    weeks_completed: 0
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
          .from('students')
          .insert([{
            ...formData,
            student_id: uuidv4(),
            created_by: user?.id,
            created_at: new Date().toISOString()
          }])
          .select();

      if (error) {
        console.error('Supabase error details:', error);
        throw new Error(error.message);
      }

      router.push('/dashboard');
    } catch (err) {
      console.error('Error adding student:', err);
      setError(`Failed to add student: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: isNaN(Number(value)) ? value : Number(value) }));
  };

  return (
      <div className="container">
        <header>
          <h1>Add New Student</h1>
          <div className="user-controls">
            <Link href="/dashboard" className="btn share-btn">Dashboard</Link>
            <Link href="/attendance" className="btn share-btn">Attendance</Link>
            <Link href="/payment" className="btn share-btn">Payment</Link>
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
          <div className="form-card">
            <h2>Student Details</h2>

            <form onSubmit={handleSubmit} className="student-form">
              {error && <p className="error-message">{error}</p>}

              <div className="form-grid">
                <div className="form-group">
                  <label htmlFor="student_name">Student Name *</label>
                  <input
                      type="text"
                      id="student_name"
                      name="student_name"
                      value={formData.student_name}
                      onChange={handleChange}
                      required
                      placeholder="Enter student name"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="student_day">Day *</label>
                  <select
                      id="student_day"
                      name="student_day"
                      value={formData.student_day}
                      onChange={handleChange}
                      required
                  >
                    <option value="Saturday">Saturday</option>
                    <option value="Sunday">Sunday</option>
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="student_timeslot">Timeslot *</label>
                  <select
                      id="student_timeslot"
                      name="student_timeslot"
                      value={formData.student_timeslot}
                      onChange={handleChange}
                      required
                  >
                    <option value="8-10am">8-10am</option>
                    <option value="10-12pm">10-12pm</option>
                    <option value="1-3pm">1-3pm</option>
                    <option value="2-4pm">2-4pm</option>
                    <option value="3-5pm">3-5pm</option>
                    <option value="4-6pm">4-6pm</option>
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="student_levelofplay">Level *</label>
                  <select
                      id="student_levelofplay"
                      name="student_levelofplay"
                      value={formData.student_levelofplay}
                      onChange={handleChange}
                      required
                  >
                    <option value="Beginner">Beginner</option>
                    <option value="Intermediate">Intermediate</option>
                    <option value="Advanced">Advanced</option>
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="price">Price (S$) *</label>
                  <input
                      type="number"
                      id="price"
                      name="price"
                      value={formData.price}
                      onChange={handleChange}
                      min="0"
                      step="0.01"
                      required
                      placeholder="0.00"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="total_weeks">Total Weeks *</label>
                  <input
                      type="number"
                      id="total_weeks"
                      name="total_weeks"
                      value={formData.total_weeks}
                      onChange={handleChange}
                      min="1"
                      required
                      placeholder="1"
                  />
                </div>
              </div>

              <div className="form-actions">
                <Link href="/dashboard" className="cancel-btn">Cancel</Link>
                <button type="submit" className="submit-btn" disabled={isSubmitting}>
                  {isSubmitting ? 'Adding...' : 'Add Student'}
                </button>
              </div>
            </form>
          </div>
        </main>
      </div>
  );
}