'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import './styles.css';

export default function Login() {
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showAccountMessage, setShowAccountMessage] = useState(false);
  const router = useRouter();

  const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      // Call our custom login endpoint
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailOrUsername,
          password,
        }),
      });

      const data = await response.json();

      // friendly error mapping (preserve your current messages)
      if (!response.ok) {
        let msg = data?.error || 'Login failed';
        if (msg.includes('Invalid login credentials')) msg = 'Invalid email/username or password.';
        else if (msg.includes('email not confirmed')) msg = 'Please confirm your email first.';
        else if (msg.toLowerCase().includes('rate limit')) msg = 'Too many attempts — try again later.';
        else if (msg.includes('User not found')) msg = 'User not found.';

        console.error('Login failed response:', data);
        setError(msg);
        return;
      }

      // Defensive: ensure a valid session object with tokens before calling setSession
      const session = data?.session;
      if (!session || !session.access_token || !session.refresh_token) {
        console.error('Login route returned invalid session:', data);
        setError('Login failed: missing session tokens. Please try again.');
        return;
      }

      try {
        await supabase.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        });
      } catch (err) {
        console.error('setSession error', err, data);
        setError('Login failed (session error). Try again.');
        return;
      }

      // Ensure user profile exists
      try {
        const { data: existing } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', data.user.id)
            .maybeSingle();

        await supabase.from('profiles').upsert({
          id: data.user.id,
          name: data.user.email?.split('@')[0] || 'User',
          created_at: new Date().toISOString(),
        }, { onConflict: 'id' });
      } catch {
        // ignore profile errors
      }

      router.push('/dashboard');
    } catch (err) {
      console.error('Login error', err);
      setError('Login failed — please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
      <div className="container">
        <header>
          <h1 style={{ margin: 0 }}>PatLau</h1>
          <div className="user-controls">
            {/* Removed sign up button here */}
          </div>
        </header>

        <main>
          <p className="welcome">Welcome back</p>

          <div className="login-form" role="region" aria-label="Sign in">
            <form onSubmit={handleLogin} noValidate>
              {error && <div className="error-message">{error}</div>}

              <div className="form-group">
                <label htmlFor="emailOrUsername">Email or Username</label>
                <input
                    required
                    type="text"
                    id="emailOrUsername"
                    className="form-input"
                    placeholder="you@example.com or username"
                    value={emailOrUsername}
                    onChange={e => setEmailOrUsername(e.target.value)}
                    autoComplete="username"
                />
              </div>

              <div className="form-group">
                <label htmlFor="password">Password</label>
                <input
                    required
                    type="password"
                    id="password"
                    className="form-input"
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete="current-password"
                />
              </div>

              <button type="submit" className="login-btn" disabled={isLoading}>
                {isLoading ? 'Signing in...' : 'Sign in'}
              </button>

              <div style={{ marginTop: '1rem', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {/* Forgot Password Link */}
                <button
                    type="button"
                    onClick={() => router.push('/reset')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#2563eb',
                      cursor: 'pointer',
                      fontSize: '0.95rem',
                      textDecoration: 'underline',
                      padding: 0,
                    }}
                >
                  Forgot password?
                </button>

                {/* Need an account button */}
                <button
                    type="button"
                    onClick={() => setShowAccountMessage(!showAccountMessage)}
                    className="submit-btn"
                    style={{
                      background: '#f3f4f6',
                      color: '#374151',
                      border: '1px solid #e5e7eb',
                    }}
                >
                  Need an account?
                </button>

                {/* Account message */}
                {showAccountMessage && (
                    <div style={{
                      background: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      borderRadius: '6px',
                      padding: '10px 12px',
                      color: '#1e40af',
                      fontSize: '0.9rem',
                      marginTop: '0.5rem'
                    }}>
                      If you need to create an account, please contact the admin at nicholaslauhongyi@gmail.com
                    </div>
                )}
              </div>
            </form>
          </div>
        </main>
      </div>
  );
}