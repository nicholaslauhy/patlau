'use client'
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import './../styles.css';
import './signup.css';

export default function SignUp() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    router.push('/');
  }, [router]);

  const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const signUpOptions = {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
        data: {
          name: name,
          email: email
        }
      };

      if (!process.env.NEXT_PUBLIC_SITE_URL) {
        throw new Error('Production URL not configured');
      }

      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: signUpOptions
      });

      if (authError) {
        if (authError.message.toLowerCase().includes('rate limit')) {
          setError('Too many signup attempts. Please wait and try again.');
        } else if (authError.message.includes('email')) {
          setError('Invalid email format');
        } else if (authError.message.includes('password')) {
          setError('Password too weak (minimum 6 characters)');
        } else if (authError.message.includes('exists')) {
          setError('Email already registered');
        } else {
          setError(authError.message || 'Signup failed');
        }
        return;
      }

      if (!authData.user) {
        setError('Please check your email to complete signup');
        return;
      }

      if (!authData.user?.email_confirmed_at) {
        alert('Please check your email for a confirmation link to complete your signup');
        router.push('/');
        return;
      }

      const profileResponse = await fetch('/api/create-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: authData.user?.id,
          name: name
        })
      });

      if (!profileResponse.ok) {
        const errorData = await profileResponse.json();
        console.error('Profile creation error:', errorData.error);

        try {
          await supabase.auth.admin.deleteUser(authData.user?.id || '');
        } catch (deleteError) {
          console.error('Failed to delete user:', deleteError);
        }

        setError('Failed to create profile. Please contact support.');
        return;
      }

      router.push('/dashboard');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Signup failed';
      setError(errorMessage);
      console.error('Signup error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
      <div className="container">
        <header className="dashboard-header">
          <h1 className="page-title">Sign Up</h1>

          <div className="user-controls">
            <Link href="/" className="btn share-btn">Login</Link>
          </div>
        </header>

        <main>
          <div className="form-card">
            <h2>Create Your Account</h2>

            <form onSubmit={handleSignUp} className="signup-form">
              {error && <div className="error-message">{error}</div>}

              <div className="form-group">
                <label htmlFor="name">Full Name *</label>
                <input
                    type="text"
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    placeholder="Enter your full name"
                    disabled={isLoading}
                />
              </div>

              <div className="form-group">
                <label htmlFor="email">Email *</label>
                <input
                    type="email"
                    id="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="Enter your email"
                    disabled={isLoading}
                />
              </div>

              <div className="form-group">
                <label htmlFor="password">Password *</label>
                <input
                    type="password"
                    id="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="Minimum 6 characters"
                    disabled={isLoading}
                />
              </div>

              <div className="form-actions">
                <Link href="/" className="cancel-btn">Back to Login</Link>
                <button
                    type="submit"
                    className="submit-btn"
                    disabled={isLoading}
                >
                  {isLoading ? 'Creating Account...' : 'Sign Up'}
                </button>
              </div>
            </form>

            <p className="form-footer">
              Already have an account? <Link href="/" className="link">Login here</Link>
            </p>
          </div>
        </main>
      </div>
  );
}