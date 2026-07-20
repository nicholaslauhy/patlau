'use client'

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';
import AuthHeader from './../components/AuthHeader';
import PasswordField from './../components/PasswordField';
import './../styles.css';

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function ResetPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);

    const [resetMode, setResetMode] = useState<'link' | 'code' | 'password'>('code');
    const [recoveryStep, setRecoveryStep] = useState<'request' | 'verify'>('request');
    const [hasSession, setHasSession] = useState(false);

    const [email, setEmail] = useState('');
    const [code, setCode] = useState('');
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
                const { location } = window;
                let params = new URLSearchParams();

                // Try query string first
                if (location.search) {
                    params = new URLSearchParams(location.search);
                }
                // Fallback to hash
                else if (location.hash && location.hash.includes('access_token')) {
                    params = new URLSearchParams(location.hash.replace(/^#/, '?'));
                }

                const access_token = params.get('access_token');
                const refresh_token = params.get('refresh_token');
                const errDesc = params.get('error_description') || params.get('error');

                if (errDesc) {
                    setError(decodeURIComponent(errDesc));
                    setResetMode('code');
                    window.history.replaceState({}, document.title, location.pathname);
                    setLoading(false);
                    return;
                }

                if (access_token && refresh_token) {
                    const { data, error: setErr } = await supabase.auth.setSession({
                        access_token,
                        refresh_token,
                    });

                    if (setErr) {
                        console.error('setSession error:', setErr);
                        setError(`Failed to establish session: ${setErr.message}`);
                        setResetMode('code');
                        window.history.replaceState({}, document.title, location.pathname);
                        setLoading(false);
                        return;
                    }

                    setHasSession(Boolean(data?.session));
                    setResetMode('password');
                    setSuccess('Link is valid — choose a new password.');
                    window.history.replaceState({}, document.title, location.pathname);
                    setTimeout(() => passRef.current?.focus(), 200);
                } else {
                    // No URL tokens found — show code form
                    setResetMode('code');
                    setError(null);
                }
            } catch (err) {
                console.error('Error processing reset link:', err);
                setError('Error processing reset link.');
                setResetMode('code');
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const validatePassword = (pw: string) => pw.length >= 6;
    const validateCode = (c: string) => /^\d{6}$/.test(c);

    const handleSendCode = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);

        if (!email.trim()) {
            setError('Please enter your email.');
            return;
        }

        setBusy(true);
        try {
            const res = await fetch('/api/auth/send-reset-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email.trim() }),
            });

            const data = await res.json();
            if (!res.ok) {
                setError(data.error || 'Failed to send code');
                return;
            }

            setSuccess('Code sent to your email. Check your inbox (and spam folder).');
            setRecoveryStep('verify');
        } catch (err) {
            console.error('Error requesting code:', err);
            setError('Error requesting code. Try again.');
        } finally {
            setBusy(false);
        }
    };

    const returnToEmailStep = () => {
        setRecoveryStep('request');
        setCode('');
        setError(null);
        setSuccess(null);
    };

    const handleVerifyCode = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);

        if (!email.trim() || !validateCode(code.trim())) {
            setError('Please enter your email and the 6-digit code.');
            return;
        }

        setBusy(true);
        try {
            const res = await fetch('/api/auth/verify-reset-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email.trim(), code: code.trim() }),
            });

            const data = await res.json();
            if (!res.ok) {
                setError(data.error || 'Code verification failed');
                return;
            }

            const { error: setErr } = await supabase.auth.setSession({
                access_token: data.session.access_token,
                refresh_token: data.session.refresh_token,
            });

            if (setErr) {
                setError(`Failed to establish session: ${setErr.message}`);
                return;
            }

            setHasSession(true);
            setResetMode('password');
            setSuccess('Code verified — choose a new password.');
            setTimeout(() => passRef.current?.focus(), 200);
        } catch (err) {
            console.error('Error verifying code:', err);
            setError('Error verifying code. Try again.');
        } finally {
            setBusy(false);
        }
    };

    const handleSubmitPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);

        if (!validatePassword(newPassword)) {
            setError('Password must be at least 6 characters.');
            return;
        }

        setBusy(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) {
                setError('Your reset session has expired. Please request a new code.');
                setBusy(false);
                return;
            }

            const response = await fetch('/api/auth/change-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({ password: newPassword }),
            });
            const payload = await response.json().catch(() => ({}));

            if (!response.ok) {
                setError(payload.error || 'Failed to update password.');
                setBusy(false);
                return;
            }

            setSuccess('Password updated. Signing you in and redirecting...');
            setTimeout(() => router.push('/'), 800);
        } catch (err) {
            console.error('Unexpected error:', err);
            setError('Unexpected error. Please try again.');
            setBusy(false);
        }
    };

    return (
        <div className="container auth-shell">
            <AuthHeader />
            <main className="auth-main auth-reset-main">
            <section className="form-card auth-reset-card auth-reset-card--single">
                <div className="auth-card__intro">
                    <span className="auth-eyebrow">Account recovery</span>
                    <h1 className="page-title">Reset your password</h1>
                    <p>
                        {resetMode === 'password' && hasSession
                            ? 'Choose a secure new password for your account.'
                            : recoveryStep === 'request'
                                ? 'Enter your account email to receive a six-digit recovery code.'
                                : 'Enter the code we sent to your email address.'}
                    </p>
                </div>

                {loading ? (
                    <div style={{ padding: '2.5rem 1rem', textAlign: 'center' }}>
                        <p>Processing link...</p>
                    </div>
                ) : (
                    <>
                        {success && <div className="success-message" style={{ marginBottom: 12 }}>{success}</div>}
                        {error && <div className="error-message" style={{ marginBottom: 12 }}>{error}</div>}

                        {resetMode === 'password' && hasSession ? (
                            <form onSubmit={handleSubmitPassword} className="auth-reset-form">
                                <div className="form-group">
                                    <label htmlFor="new-password">New password</label>
                                    <PasswordField
                                        id="new-password"
                                        ref={passRef}
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        placeholder="At least 6 characters"
                                        className="input"
                                        required
                                        minLength={6}
                                        disabled={busy}
                                    />
                                    <small className="hint">Use at least 6 characters and avoid reusing an old password.</small>
                                </div>

                                <button
                                    type="submit"
                                    className="submit-btn auth-reset-primary"
                                    disabled={busy}
                                >
                                    {busy ? 'Saving...' : 'Set new password'}
                                </button>
                            </form>
                        ) : recoveryStep === 'request' ? (
                                <form onSubmit={handleSendCode} className="auth-reset-form auth-reset-step-panel">
                                    <div className="auth-reset-progress">
                                        <span>Step 1 of 2</span>
                                        <div aria-hidden="true"><i className="is-active" /><i /></div>
                                    </div>
                                    <div className="form-group">
                                        <label htmlFor="reset-email">Email</label>
                                        <input
                                            id="reset-email"
                                            type="email"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            placeholder="your@email.com"
                                            className="input"
                                            required
                                            disabled={busy}
                                        />
                                    </div>

                                    <button
                                        type="submit"
                                        className="submit-btn auth-reset-primary"
                                        disabled={busy}
                                    >
                                        {busy ? 'Sending...' : 'Send Code'}
                                    </button>
                                </form>
                        ) : (
                                <form onSubmit={handleVerifyCode} className="auth-reset-form auth-reset-step-panel">
                                    <div className="auth-reset-progress">
                                        <span>Step 2 of 2</span>
                                        <div aria-hidden="true"><i className="is-complete" /><i className="is-active" /></div>
                                    </div>
                                    <div className="auth-reset-email-summary">
                                        <div><span>Code sent to</span><strong>{email}</strong></div>
                                        <button type="button" onClick={returnToEmailStep} disabled={busy}>Change email</button>
                                    </div>
                                    <div className="form-group">
                                        <label htmlFor="reset-code">Reset Code</label>
                                        <input
                                            id="reset-code"
                                            type="text"
                                            value={code}
                                            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                            placeholder="000000"
                                            maxLength={6}
                                            required
                                            disabled={busy}
                                            className="input auth-code-input"
                                        />
                                        <small className="hint">Enter the 6-digit code from your email.</small>
                                    </div>

                                    <div className="auth-reset-form-actions">
                                        <button type="button" className="auth-reset-back" onClick={returnToEmailStep} disabled={busy}>
                                            Back
                                        </button>
                                        <button
                                            type="submit"
                                            className="submit-btn auth-reset-primary"
                                            disabled={busy}
                                        >
                                            {busy ? 'Verifying...' : 'Verify Code'}
                                        </button>
                                    </div>
                                </form>
                        )}

                        <div className="auth-reset-footer">
                            <Link href="/" className="auth-link-button">
                                Back to sign in
                            </Link>
                        </div>
                    </>
                )}
            </section>
            </main>
        </div>
    );
}
