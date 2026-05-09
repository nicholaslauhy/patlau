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
  const [userName, setUserName] = useState('');
  const [showAccountMenu, setShowAccountMenu] = useState(false);
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

        // Only superuser can access /add
        if (role !== 'superuser') {
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
        } else {
          router.push('/');
        }
      } catch (err) {
        console.error('Failed to load user info:', err);
        router.push('/');
      }
    };

    loadUserInfo();
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

  if (userRole === 'member') {
    return (
        <div className="container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '3rem 1rem' }}>
          <div className="form-card" style={{ maxWidth: 600, width: '100%', textAlign: 'center' }}>
            <h1 style={{ fontSize: '3rem', margin: '0 0 1rem', color: '#dc2626' }}>403</h1>
            <h2 style={{ fontSize: '1.5rem', margin: '0 0 1rem', color: '#374151' }}>Forbidden</h2>
            <p style={{ margin: '0 0 1.5rem', color: '#6b7280', lineHeight: 1.6 }}>
              You do not have permission to access this page. Only superusers and admins can add students.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <Link href="/dashboard" className="btn share-btn" style={{ display: 'inline-block' }}>Go to Dashboard</Link>
              <button
                  className="btn share-btn logout"  // Add 'logout' class
                  onClick={async () => {
                    await supabase.auth.signOut();
                    router.push('/');
                  }}
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

            <h1 className="page-title">Add New Student</h1>
          </div>

          <div className="user-controls">
            <Link href="/dashboard" className="btn share-btn">Dashboard</Link>
            <Link href="/attendance" className="btn share-btn">Attendance</Link>
            <Link href="/payment" className="btn share-btn">Payment</Link>
            <button
                className="btn share-btn logout"  // Add 'logout' class
                onClick={async () => {
                  await supabase.auth.signOut();
                  router.push('/');
                }}
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