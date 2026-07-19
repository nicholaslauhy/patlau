import Link from 'next/link';

export default function AuthHeader() {
    return (
        <header className="auth-header">
            <Link href="/" className="auth-brand" aria-label="PatLau home">
                <span className="auth-brand__mark" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none">
                        <path d="m8 4 8 8M10.5 1.5l-5 5 7 12 6-6-8-11Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="m5.8 6.2 6.6 6.6M8.2 3.8l6.6 6.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                </span>
                <span className="auth-brand__copy">
                    <strong>PatLau</strong>
                    <small>Training management</small>
                </span>
            </Link>
        </header>
    );
}
