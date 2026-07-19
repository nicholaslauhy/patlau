'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { useState } from 'react';

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

function VisibilityIcon({ visible }: { visible: boolean }) {
    if (visible) {
        return (
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 5.2A9.8 9.8 0 0 1 12 5c5.5 0 9 7 9 7a15.7 15.7 0 0 1-2.2 3.1M6.6 6.6C4.2 8.2 3 12 3 12s3.5 7 9 7c1.3 0 2.5-.4 3.6-1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        );
    }

    return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
            <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.7" />
        </svg>
    );
}

const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(function PasswordField(
    { className = '', id, ...props },
    ref,
) {
    const [visible, setVisible] = useState(false);

    return (
        <div className="password-field">
            <input
                {...props}
                ref={ref}
                id={id}
                type={visible ? 'text' : 'password'}
                className={className}
            />
            <button
                type="button"
                className="password-field__toggle"
                onClick={() => setVisible((current) => !current)}
                aria-label={visible ? 'Hide password' : 'Show password'}
                aria-pressed={visible}
                aria-controls={id}
                title={visible ? 'Hide password' : 'Show password'}
            >
                <VisibilityIcon visible={visible} />
            </button>
        </div>
    );
});

export default PasswordField;
