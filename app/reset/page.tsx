'use client'

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';
import './../styles.css';

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function ResetPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [hasSession, setHasSession] = useState(false);
    const [newPassword, setNewPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const passRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        (async () => {
            setLoading(true);
            setError(null);
            setSuccess(null);

            try {
                // parse tokens from hash (#...) or query (?...)
                const { location } = window;
                let params = new URLSearchParams();

                if (location.hash && location.hash.includes('access_token')) {
                    params = new URLSearchParams(location.hash.replace(/^#/, '?'));
                } else if (location.search) {
                    params = new URLSearchParams(location.search);
                }

                const access_token = params.get('access_token');
                const refresh_token = params.get('refresh_token');
                const errDesc = params.get('error_description') || params.get('error');

                if (errDesc) {
                    setError(decodeURIComponent(errDesc));
                    setHasSession(false);
                    window.history.replaceState({}, document.title, location.pathname);
                    return;
                }

                if (access_token && refresh_token) {
                    const { data, error: setErr } = await supabase.auth.setSession({
                        access_token,
                        refresh_token
                    });

                    if (setErr) {
                        console.error('setSession error:', setErr);
                        setError(`Failed to establish session: ${setErr.message}`);
                        setHasSession(false);
                        window.history.replaceState({}, document.title, location.pathname);
                        return;
                    }

                    setHasSession(Boolean(data?.session));
                    setSuccess('Link is valid — choose a new password.');
                    // remove tokens from URL
                    window.history.replaceState({}, document.title, location.pathname);
                    // focus password input once rendered
                    setTimeout(() => passRef.current?.focus(), 200);
                } else {
                    setError('No valid session tokens found in the link. Open the exact link from your email.');
                    setHasSession(false);
                }
            } catch (err) {
                console.error('Error processing reset link:', err);
                setError('Error processing reset link.');
                setHasSession(false);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const validatePassword = (pw: string) => pw.length >= 6;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);

        if (!validatePassword(newPassword)) {
            setError('Password must be at least 6 characters.');
            return;
        }

        setBusy(true);
        try {
            const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword });

            if (updateErr) {
                console.error('updateUser error:', updateErr);
                setError(updateErr.message || 'Failed to update password.');
                setBusy(false);
                return;
            }

            setSuccess('Password updated. Signing you in and redirecting...');
            // short pause so user sees success, then redirect to home
            setTimeout(() => router.push('/'), 800);
        } catch (err) {
            console.error('Unexpected error:', err);
            setError('Unexpected error. Please try again.');
            setBusy(false);
        }
    };

    // prompt-based request for a new reset email
    const handleRequestNewReset = async () => {
        setError(null);
        setSuccess(null);

        const email = window.prompt('Enter your email to receive a new password reset link:');
        if (!email) return;

        const emailTrim = email.trim();
        const re = /\S+@\S+\.\S+/;
        if (!re.test(emailTrim)) {
            setError('Please enter a valid email address.');
            return;
        }

        setBusy(true);
        try {
            const redirectTo = `${window.location.origin}/reset`;
            const { error: resetErr } = await supabase.auth.resetPasswordForEmail(emailTrim, { redirectTo });

            if (resetErr) {
                console.error('resetPasswordForEmail error:', resetErr);
                setError(`Failed to send reset email: ${resetErr.message}`);
            } else {
                setSuccess('Reset email sent. Check your inbox (and spam folder).');
            }
        } catch (err) {
            console.error('Unexpected error sending reset email:', err);
            setError('Unexpected error sending reset email.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="container" style={{ display: 'flex', justifyContent: 'center', padding: '3rem 1rem' }}>
            <div className="form-card" style={{ maxWidth: 720, width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <h1 className="page-title" style={{ margin: 0 }}>Reset Password</h1>
                </div>

                {loading ? (
                    <div style={{ padding: '2.5rem 1rem', textAlign: 'center' }}>
                        <p>Processing link...</p>
                    </div>
                ) : (
                    <>
                        {success && <div className="success-message" style={{ marginBottom: 12 }}>{success}</div>}
                        {error && <div className="error-message" style={{ marginBottom: 12 }}>{error}</div>}

                        {hasSession ? (
                            <form onSubmit={handleSubmit} className="student-form" style={{ gap: 12 }}>
                                <div className="form-group">
                                    <label htmlFor="new-password">New password</label>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                        <input
                                            id="new-password"
                                            ref={passRef}
                                            type="password"
                                            value={newPassword}
                                            onChange={(e) => setNewPassword(e.target.value)}
                                            placeholder="At least 6 characters"
                                            className="input"
                                            required
                                            minLength={6}
                                            style={{ flex: 1 }}
                                        />
                                    </div>
                                    <small className="hint">Use at least 6 characters. For security, choose a strong password.</small>
                                </div>

                                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                                    <button
                                        type="submit"
                                        className="submit-btn home-btn"
                                        disabled={busy}
                                        style={{
                                            flex: 1,
                                            background: '#10B981',
                                            border: 'none',
                                            color: '#fff',
                                            boxShadow: '0 2px 6px rgba(16,185,129,0.12)'
                                        }}
                                    >
                                        {busy ? 'Saving...' : 'Set new password'}
                                    </button>
                                </div>
                            </form>
                        ) : (
                            <div style={{ padding: '1rem 0' }}>
                                <p style={{ marginBottom: 12 }}>
                                    The link is invalid or expired. Request a new password reset from the app or return to the home page.
                                </p>

                                <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-start', alignItems: 'center' }}>
                                    <Link
                                        href="/"
                                        className="share-btn home-btn"
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 8,
                                            padding: '10px 14px'
                                        }}
                                    >
                                        {/* small home icon */}
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden style={{ opacity: 0.95 }}>
                                            <path d="M3 10.5L12 4l9 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                            <path d="M5 11v7a2 2 0 0 0 2 2h3v-6h4v6h3a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                        Back to Home
                                    </Link>

                                    <button
                                        type="button"
                                        className="request-reset-btn"
                                        onClick={handleRequestNewReset}
                                        disabled={busy}
                                    >
                                        {busy ? 'Sending...' : 'Request reset'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}