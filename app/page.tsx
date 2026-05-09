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

      if (!response.ok) {
        let msg = data.error || 'Login failed';
        if (msg.includes('Invalid login credentials')) msg = 'Invalid email/username or password.';
        else if (msg.includes('email not confirmed')) msg = 'Please confirm your email first.';
        else if (msg.toLowerCase().includes('rate limit')) msg = 'Too many attempts — try again later.';
        else if (msg.includes('User not found')) msg = 'User not found.';

        setError(msg);
        return;
      }

      // Set session from response
      if (data.session) {
        await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
      }

      // Ensure user profile exists
      try {
        const { data: existing } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', data.user.id)
            .maybeSingle();

        if (!existing) {
          await supabase.from('profiles').insert({
            id: data.user.id,
            name: data.user.email?.split('@')[0] || 'User',
            created_at: new Date().toISOString(),
          });
        }
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

              <div style={{ marginTop: '0.75rem', textAlign: 'center' }}>
                <span
                    className="icon-button"
                    title="If you need to create an account, please contact the admin at nicholaslauhongyi@gmail.com"
                    style={{
                      padding: '0.5rem 0.75rem',
                      borderRadius: '6px',
                      cursor: 'default',
                      display: 'inline-block'
                    }}
                >
                  Need an account?
                </span>
              </div>
            </form>
          </div>
        </main>
      </div>
  );
}