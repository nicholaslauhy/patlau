'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import AuthHeader from './components/AuthHeader';
import PasswordField from './components/PasswordField';
import { safeChatReturnPath } from './lib/auth-return';
import './styles.css';

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function Login() {
    const [emailOrUsername, setEmailOrUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [showAccountMessage, setShowAccountMessage] = useState(false);
    const router = useRouter();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ emailOrUsername, password }),
            });

            const data = await response.json();

            if (!response.ok) {
                let msg = data?.error || 'Login failed';

                if (msg.includes('Invalid login credentials')) {
                    msg = 'Invalid email/username or password.';
                } else if (msg.includes('email not confirmed')) {
                    msg = 'Please confirm your email first.';
                } else if (msg.toLowerCase().includes('rate limit')) {
                    msg = 'Too many attempts — try again later.';
                } else if (msg.includes('User not found')) {
                    msg = 'User not found.';
                }

                console.error('Login failed response:', data);
                setError(msg);
                return;
            }

            const session = data?.session;
            if (!session || !session.access_token || !session.refresh_token) {
                console.error('Login route returned invalid session:', data);
                setError('Login failed: missing session tokens. Please try again.');
                return;
            }

            const { error: sessionError } = await supabase.auth.setSession({
                access_token: session.access_token,
                refresh_token: session.refresh_token,
            });

            if (sessionError) {
                console.error('setSession error:', sessionError);
                setError('Login failed. Please try again.');
                return;
            }

            try {
                if (data?.user?.id) {
                    await supabase.from('profiles').upsert(
                        {
                            id: data.user.id,
                            name: data.user.email?.split('@')[0] || 'User',
                            created_at: new Date().toISOString(),
                        },
                        { onConflict: 'id' }
                    );
                }
            } catch (profileError) {
                console.error('Profile upsert failed:', profileError);
            }

            const requestedPath = safeChatReturnPath(
                new URLSearchParams(window.location.search).get('next')
            );
            router.replace(requestedPath || '/operations');
        } catch (err) {
            console.error('Login error:', err);
            setError('Login failed — please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="container auth-shell">
            <AuthHeader />

            <main className="auth-main">
                <section className="login-form auth-card" aria-labelledby="sign-in-title">
                    <div className="auth-card__intro">
                        <span className="auth-eyebrow">Secure access</span>
                        <h1 id="sign-in-title">Welcome back</h1>
                        <p>Sign in to manage training, attendance, and payments.</p>
                    </div>
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
                                onChange={(e) => setEmailOrUsername(e.target.value)}
                                autoComplete="username"
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="password">Password</label>
                            <PasswordField
                                required
                                id="password"
                                className="form-input"
                                placeholder="Enter your password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                autoComplete="current-password"
                            />
                        </div>

                        <button type="submit" className="login-btn" disabled={isLoading}>
                            {isLoading ? 'Signing in...' : 'Sign in'}
                        </button>

                        <div className="auth-card__actions">
                            <button
                                type="button"
                                onClick={() => router.push('/reset')}
                                className="auth-link-button"
                            >
                                Forgot password?
                            </button>

                            <button
                                type="button"
                                onClick={() => setShowAccountMessage(!showAccountMessage)}
                                className="auth-secondary-button"
                            >
                                Need an account?
                            </button>

                            {showAccountMessage && (
                                <div className="auth-account-message">
                                    If you need to create an account, please contact the admin at nicholaslauhongyi@gmail.com
                                </div>
                            )}
                        </div>
                    </form>
                </section>
            </main>
        </div>
    );
}
