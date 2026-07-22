'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import CalendarPicker from './CalendarPicker';
import {
    attendanceRecordDateKey,
    findLatestAvailableLessonDate,
    isLessonDateForDay,
    localDateKey,
    singaporeDateKey,
    validateAlternateAttendanceDate,
} from '../lib/weekend-attendance-date';
import './alternate-attendance-date-modal.css';

interface AlternateAttendanceStudent {
    student_id: string;
    student_name: string;
    student_day: string;
    student_timeslot?: string | null;
    attendance_records?: unknown[] | null;
}

export default function AlternateAttendanceDateModal({
    student,
    onClose,
    onConfirm,
}: {
    student: AlternateAttendanceStudent | null;
    onClose: () => void;
    onConfirm: (dateKey: string) => Promise<void>;
}) {
    const records = useMemo(
        () => student && Array.isArray(student.attendance_records) ? student.attendance_records : [],
        [student],
    );
    const [selectedDate, setSelectedDate] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [attempted, setAttempted] = useState(false);
    const [submitError, setSubmitError] = useState('');
    const dialogRef = useRef<HTMLElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);
    const submittingRef = useRef(false);
    const onCloseRef = useRef(onClose);

    useEffect(() => {
        submittingRef.current = submitting;
    }, [submitting]);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        if (!student) return;
        setSelectedDate(findLatestAvailableLessonDate({
            studentDay: student.student_day,
            attendanceRecords: records,
        }));
        setAttempted(false);
        setSubmitError('');
    }, [records, student]);

    useEffect(() => {
        if (!student) return;
        previousFocusRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const focusFrame = requestAnimationFrame(() => closeButtonRef.current?.focus());

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !submittingRef.current) {
                event.preventDefault();
                onCloseRef.current();
                return;
            }

            if (event.key !== 'Tab') return;
            const containers = [
                dialogRef.current,
                document.querySelector<HTMLElement>('.calendar-popover'),
            ].filter(Boolean) as HTMLElement[];
            const focusable = containers.flatMap((container) => Array.from(
                container.querySelectorAll<HTMLElement>(
                    'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
                ),
            )).filter((element) => element.offsetParent !== null);
            if (focusable.length === 0) return;

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            cancelAnimationFrame(focusFrame);
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', handleKeyDown);
            previousFocusRef.current?.focus();
        };
    }, [student?.student_id]);

    if (!student) return null;

    const validationError = validateAlternateAttendanceDate({
        dateKey: selectedDate,
        studentDay: student.student_day,
        attendanceRecords: records,
    });
    const usedDates = new Set(records.map(attendanceRecordDateKey).filter(Boolean));
    const today = singaporeDateKey();
    const dateLabel = selectedDate
        ? new Date(`${selectedDate}T12:00:00`).toLocaleDateString('en-SG', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
        })
        : '';

    const confirm = async () => {
        setAttempted(true);
        setSubmitError('');
        if (validationError) return;

        setSubmitting(true);
        try {
            await onConfirm(selectedDate);
            onClose();
        } catch (error) {
            setSubmitError(error instanceof Error ? error.message : 'Failed to record attendance.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div
            className="alternate-attendance-modal__backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="alternate-attendance-title"
            aria-describedby="alternate-attendance-description"
            onMouseDown={(event) => {
                if (event.currentTarget === event.target && !submitting) onClose();
            }}
        >
            <section ref={dialogRef} className="alternate-attendance-modal">
                <header className="alternate-attendance-modal__header">
                    <div>
                        <span className="settings-eyebrow">Weekend attendance</span>
                        <h2 id="alternate-attendance-title">Mark attendance for another date</h2>
                        <p>
                            <strong>{student.student_name}</strong>
                            {' · '}{student.student_day}
                            {student.student_timeslot ? `, ${student.student_timeslot}` : ''}
                        </p>
                    </div>
                    <button
                        ref={closeButtonRef}
                        type="button"
                        className="alternate-attendance-modal__close"
                        onClick={onClose}
                        disabled={submitting}
                        aria-label="Close date selection"
                    >
                        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                            <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                    </button>
                </header>

                <div className="alternate-attendance-modal__body">
                    <p id="alternate-attendance-description" className="alternate-attendance-modal__intro">
                        Choose the {student.student_day} when this student actually attended. Future dates,
                        other weekdays and dates already in the attendance history are unavailable.
                    </p>

                    <label className="alternate-attendance-modal__field">
                        <span>Actual lesson date</span>
                        <CalendarPicker
                            mode="date"
                            value={selectedDate}
                            onChange={(value) => {
                                setSelectedDate(value);
                                setAttempted(false);
                                setSubmitError('');
                            }}
                            disabled={submitting}
                            ariaLabel={`Actual ${student.student_day} lesson date`}
                            isDateDisabled={(date) => {
                                const key = localDateKey(date);
                                return key > today
                                    || !isLessonDateForDay(key, student.student_day)
                                    || usedDates.has(key);
                            }}
                        />
                    </label>

                    {dateLabel && !validationError && (
                        <div className="alternate-attendance-modal__selection" aria-live="polite">
                            <span>Attendance will be recorded for</span>
                            <strong>{dateLabel}</strong>
                        </div>
                    )}

                    {(submitError || (attempted && validationError)) && (
                        <p className="alternate-attendance-modal__error" role="alert">
                            {submitError || validationError}
                        </p>
                    )}

                    <p className="alternate-attendance-modal__note">
                        This adds one attended lesson and keeps the original recording time in the audit log.
                    </p>
                </div>

                <footer className="alternate-attendance-modal__actions">
                    <button type="button" onClick={onClose} disabled={submitting}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="is-primary"
                        onClick={() => void confirm()}
                        disabled={submitting || Boolean(validationError)}
                    >
                        {submitting ? 'Recording…' : 'Mark attended'}
                    </button>
                </footer>
            </section>
        </div>
    );
}
