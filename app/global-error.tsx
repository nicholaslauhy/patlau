'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        Sentry.captureException(error);
    }, [error]);

    return (
        <html lang="en">
        <body>
        <main style={{
            minHeight: '100vh',
            display: 'grid',
            placeItems: 'center',
            padding: '24px',
            background: '#f3f7fc',
            color: '#10233f',
            fontFamily: 'Arial, sans-serif',
        }}>
            <section style={{
                width: 'min(100%, 520px)',
                padding: '32px',
                border: '1px solid #d8e3ef',
                borderRadius: '20px',
                background: '#fff',
                textAlign: 'center',
                boxShadow: '0 18px 48px rgba(16, 35, 63, 0.08)',
            }}>
                <p style={{ margin: '0 0 8px', color: '#087dc1', fontWeight: 700 }}>
                    Something went wrong
                </p>
                <h1 style={{ margin: '0 0 12px', fontSize: '1.75rem' }}>
                    We could not load this page
                </h1>
                <p style={{ margin: '0 0 24px', color: '#5a6f89', lineHeight: 1.6 }}>
                    The problem has been recorded. You can safely try again.
                </p>
                <button
                    type="button"
                    onClick={reset}
                    style={{
                        minHeight: '48px',
                        padding: '0 24px',
                        border: 0,
                        borderRadius: '12px',
                        background: '#087dc1',
                        color: '#fff',
                        fontSize: '1rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                    }}
                >
                    Try again
                </button>
            </section>
        </main>
        </body>
        </html>
    );
}
