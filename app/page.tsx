'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import './styles.css';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const router = useRouter();

  const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        // Friendly, concise error messages for users
        let msg = 'Login failed';
        if (error.message.includes('Invalid login credentials')) msg = 'Invalid email or password.';
        else if (error.message.includes('email not confirmed')) msg = 'Please confirm your email first.';
        else if (error.message.toLowerCase().includes('rate limit')) msg = 'Too many attempts — try again later.';
        else msg = error.message || msg;

        alert(msg);
        return;
      }

      if (!data.user) {
        alert('Login failed — please try again.');
        return;
      }

      // Best-effort: create a minimal profile if needed, but ignore failures
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
        // ignore profile write errors
      }

      // Store session tokens (if available)
      if (data.session) {
        await supabase.auth.setSession({
          access_token: data.session.access_token || '',
          refresh_token: data.session.refresh_token || '',
        });
      }

      router.push('/dashboard');
    } catch (err) {
      console.error('Login error', err);
      alert('Login failed — please try again.');
    }
  };

  return (
      <div className="container">
        <header>
          <h1 style={{ margin: 0 }}>PatLau</h1>
          <div className="user-controls">
            <button
                className="share-btn"
                onClick={() => router.push('/signup')}
                aria-label="Sign up"
            >
              Sign up
            </button>
          </div>
        </header>

        <main>
          <p className="welcome">Welcome back</p>

          <div className="login-form" role="region" aria-label="Sign in">
            <form onSubmit={handleLogin} noValidate>
              <div className="form-group">
                <label htmlFor="email">Email</label>
                <input
                    required
                    type="email"
                    id="email"
                    className="form-input"
                    placeholder="you@example.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
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

              <button type="submit" className="login-btn">
                Sign in
              </button>

              <div style={{ marginTop: '0.75rem', textAlign: 'center' }}>
                <button
                    type="button"
                    onClick={() => router.push('/signup')}
                    className="icon-button"
                    style={{ padding: '0.5rem 0.75rem', borderRadius: '6px' }}
                >
                  Need an account?
                </button>
              </div>
            </form>
          </div>
        </main>
      </div>
  );
}