'use client';

import { useEffect, useRef, useState } from 'react';
import './alternate-attendance-date-modal.css';

export interface EarlierOneToOneSessionOption {
    id: number;
    sessionDate: string;
    studentName: string;
    coachName: string;
}

const readableDate = (dateKey: string) => new Date(`${dateKey}T12:00:00`).toLocaleDateString('en-SG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
});

export default function EarlierOneToOneAttendanceModal({
    open,
    loading,
    loadError,
    sessions,
    onClose,
    onConfirm,
}: {
    open: boolean;
    loading: boolean;
    loadError?: string;
    sessions: EarlierOneToOneSessionOption[];
    onClose: () => void;
    onConfirm: (sessionId: number) => Promise<void>;
}) {
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const closeButtonRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!open) return;
        setSelectedId(sessions[0]?.id ?? null);
        setError('');
    }, [open, sessions]);

    useEffect(() => {
        if (!open) return;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const frame = requestAnimationFrame(() => closeButtonRef.current?.focus());
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !submitting) onClose();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => {
            cancelAnimationFrame(frame);
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open, onClose, submitting]);

    if (!open) return null;

    const confirm = async () => {
        if (selectedId === null) return;
        setSubmitting(true);
        setError('');
        try {
            await onConfirm(selectedId);
            onClose();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Failed to mark the earlier 1-1 session.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="alternate-attendance-modal__backdrop" role="dialog" aria-modal="true" aria-labelledby="earlier-one-to-one-title">
            <section className="alternate-attendance-modal">
                <header className="alternate-attendance-modal__header">
                    <div>
                        <span className="settings-eyebrow">1-1 attendance</span>
                        <h2 id="earlier-one-to-one-title">Mark an earlier booked session</h2>
                        <p>Select the dated booking that was attended.</p>
                    </div>
                    <button
                        ref={closeButtonRef}
                        type="button"
                        className="alternate-attendance-modal__close"
                        onClick={onClose}
                        disabled={submitting}
                        aria-label="Close earlier session selection"
                    >
                        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                            <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                    </button>
                </header>

                <div className="alternate-attendance-modal__body">
                    <p className="alternate-attendance-modal__intro">
                        Only existing unmarked sessions before today are shown. Their booking, coach and payment dates will not change.
                    </p>

                    {loading ? (
                        <div className="earlier-one-to-one-empty">Loading earlier booked sessions...</div>
                    ) : loadError ? (
                        <p className="alternate-attendance-modal__error" role="alert">{loadError}</p>
                    ) : sessions.length === 0 ? (
                        <div className="earlier-one-to-one-empty">
                            There are no earlier unmarked 1-1 sessions.
                        </div>
                    ) : (
                        <div className="earlier-one-to-one-list" role="radiogroup" aria-label="Earlier 1-1 sessions">
                            {sessions.map((session) => (
                                <label key={session.id} className={`earlier-one-to-one-option${selectedId === session.id ? ' is-selected' : ''}`}>
                                    <input
                                        type="radio"
                                        name="earlier-one-to-one-session"
                                        value={session.id}
                                        checked={selectedId === session.id}
                                        onChange={() => setSelectedId(session.id)}
                                        disabled={submitting}
                                    />
                                    <span>
                                        <strong>{session.studentName}</strong>
                                        <span>{readableDate(session.sessionDate)} - Coach: {session.coachName}</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                    )}

                    {error && <p className="alternate-attendance-modal__error" role="alert">{error}</p>}
                </div>

                <footer className="alternate-attendance-modal__actions">
                    <button type="button" onClick={onClose} disabled={submitting}>Cancel</button>
                    <button
                        type="button"
                        className="is-primary"
                        onClick={() => void confirm()}
                        disabled={loading || submitting || selectedId === null}
                    >
                        {submitting ? 'Recording...' : 'Mark attended'}
                    </button>
                </footer>
            </section>
        </div>
    );
}
