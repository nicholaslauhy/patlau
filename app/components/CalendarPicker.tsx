'use client';

import {
    type CSSProperties,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { createPortal } from 'react-dom';

type CalendarMode = 'date' | 'month';

interface CalendarPickerProps {
    mode: CalendarMode;
    value: string;
    onChange: (value: string) => void;
    className?: string;
    style?: CSSProperties;
    disabled?: boolean;
    ariaLabel?: string;
}

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const pad = (value: number) => String(value).padStart(2, '0');
const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const monthKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;

const parseValue = (value: string, mode: CalendarMode) => {
    const match = mode === 'date'
        ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
        : /^(\d{4})-(\d{2})$/.exec(value);

    if (!match) return new Date();
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = mode === 'date' ? Number(match[3]) : 1;
    const parsed = new Date(year, month, day);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const formatValue = (value: string, mode: CalendarMode) => {
    if (!value) return mode === 'date' ? 'Select date' : 'Select month';
    const date = parseValue(value, mode);
    return date.toLocaleDateString('en-SG', mode === 'date'
        ? { day: 'numeric', month: 'short', year: 'numeric' }
        : { month: 'long', year: 'numeric' });
};

function CalendarIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M7 3v3M17 3v3M4 9h16M5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-12A1.5 1.5 0 0 1 5.5 5Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
    );
}

function ChevronIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="m5.5 7.5 4.5 4.5 4.5-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function ArrowIcon({ direction }: { direction: 'previous' | 'next' }) {
    return (
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d={direction === 'previous' ? 'm12.5 5-5 5 5 5' : 'm7.5 5 5 5-5 5'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

export default function CalendarPicker({
    mode,
    value,
    onChange,
    className = '',
    style,
    disabled = false,
    ariaLabel,
}: CalendarPickerProps) {
    const selectedDate = useMemo(() => parseValue(value, mode), [value, mode]);
    const [open, setOpen] = useState(false);
    const [showYearPicker, setShowYearPicker] = useState(false);
    const [viewYear, setViewYear] = useState(selectedDate.getFullYear());
    const [viewMonth, setViewMonth] = useState(selectedDate.getMonth());
    const [position, setPosition] = useState({ top: 0, left: 0 });
    const triggerRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        setViewYear(selectedDate.getFullYear());
        setViewMonth(selectedDate.getMonth());
        setShowYearPicker(false);
    }, [open, selectedDate]);

    useLayoutEffect(() => {
        if (!open) return;

        const updatePosition = () => {
            const trigger = triggerRef.current;
            const popover = popoverRef.current;
            if (!trigger) return;

            const rect = trigger.getBoundingClientRect();
            const width = popover?.offsetWidth || (mode === 'date' ? 334 : 360);
            const height = popover?.offsetHeight || (mode === 'date' ? 410 : 330);
            const gap = 8;
            const left = Math.min(
                Math.max(10, rect.left),
                Math.max(10, window.innerWidth - width - 10),
            );
            const roomBelow = window.innerHeight - rect.bottom;
            const top = roomBelow >= height + gap
                ? rect.bottom + gap
                : Math.max(10, rect.top - height - gap);
            setPosition({ top, left });
        };

        updatePosition();
        const frame = requestAnimationFrame(updatePosition);
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [open, mode, showYearPicker, viewMonth, viewYear]);

    useEffect(() => {
        if (!open) return;

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Node;
            if (!triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
                setOpen(false);
            }
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpen(false);
                triggerRef.current?.focus();
            }
        };

        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [open]);

    const changePeriod = (amount: number) => {
        if (showYearPicker) {
            setViewYear((year) => year + amount * 10);
            return;
        }
        if (mode === 'month') {
            setViewYear((year) => year + amount);
            return;
        }
        const next = new Date(viewYear, viewMonth + amount, 1);
        setViewYear(next.getFullYear());
        setViewMonth(next.getMonth());
    };

    const yearRangeStart = Math.floor(viewYear / 10) * 10;
    const years = Array.from({ length: 12 }, (_, index) => yearRangeStart + index);

    const chooseYear = (year: number) => {
        setViewYear(year);
        setShowYearPicker(false);
    };

    const chooseDate = (date: Date) => {
        onChange(dateKey(date));
        setOpen(false);
        triggerRef.current?.focus();
    };

    const chooseMonth = (month: number) => {
        onChange(`${viewYear}-${pad(month + 1)}`);
        setOpen(false);
        triggerRef.current?.focus();
    };

    const chooseToday = () => {
        const today = new Date();
        onChange(mode === 'date' ? dateKey(today) : monthKey(today));
        setOpen(false);
        triggerRef.current?.focus();
    };

    const days = useMemo(() => {
        const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
        return Array.from({ length: 42 }, (_, index) => {
            const date = new Date(viewYear, viewMonth, index - firstWeekday + 1);
            return { date, inCurrentMonth: date.getMonth() === viewMonth };
        });
    }, [viewMonth, viewYear]);

    const popover = open && typeof document !== 'undefined' ? createPortal(
        <div
            ref={popoverRef}
            className={`calendar-popover calendar-popover--${mode}`}
            style={{ top: position.top, left: position.left }}
            role="dialog"
            aria-label={mode === 'date' ? 'Choose date' : 'Choose month'}
        >
            <div className="calendar-popover__header">
                <div>
                    <span>{showYearPicker ? 'Select year' : mode === 'date' ? 'Select date' : 'Select month'}</span>
                    <button
                        type="button"
                        className="calendar-popover__period"
                        onClick={() => setShowYearPicker((current) => !current)}
                        aria-label={showYearPicker ? 'Return to calendar' : 'Choose year'}
                    >
                        <strong>
                            {showYearPicker
                                ? `${yearRangeStart} - ${yearRangeStart + 11}`
                                : mode === 'date'
                                    ? `${MONTHS[viewMonth]} ${viewYear}`
                                    : viewYear}
                        </strong>
                        <ChevronIcon />
                    </button>
                </div>
                <div className="calendar-popover__navigation">
                    <button type="button" onClick={() => changePeriod(-1)} aria-label={showYearPicker ? 'Previous year range' : mode === 'date' ? 'Previous month' : 'Previous year'}>
                        <ArrowIcon direction="previous" />
                    </button>
                    <button type="button" onClick={() => changePeriod(1)} aria-label={showYearPicker ? 'Next year range' : mode === 'date' ? 'Next month' : 'Next year'}>
                        <ArrowIcon direction="next" />
                    </button>
                </div>
            </div>

            {showYearPicker ? (
                <div className="year-grid" role="grid">
                    {years.map((year) => {
                        const selected = selectedDate.getFullYear() === year;
                        const current = new Date().getFullYear() === year;
                        return (
                            <button
                                type="button"
                                role="gridcell"
                                key={year}
                                className={`${selected ? 'is-selected' : ''}${current ? ' is-current' : ''}`}
                                aria-selected={selected}
                                onClick={() => chooseYear(year)}
                            >
                                {year}
                            </button>
                        );
                    })}
                </div>
            ) : mode === 'date' ? (
                <div className="calendar-grid" role="grid">
                    {WEEKDAYS.map((weekday) => <span className="calendar-grid__weekday" key={weekday}>{weekday}</span>)}
                    {days.map(({ date, inCurrentMonth }) => {
                        const key = dateKey(date);
                        const selected = key === value;
                        const today = key === dateKey(new Date());
                        return (
                            <button
                                type="button"
                                role="gridcell"
                                key={key}
                                className={`${inCurrentMonth ? '' : 'is-outside'}${selected ? ' is-selected' : ''}${today ? ' is-today' : ''}`}
                                aria-label={date.toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' })}
                                aria-selected={selected}
                                onClick={() => chooseDate(date)}
                            >
                                {date.getDate()}
                            </button>
                        );
                    })}
                </div>
            ) : (
                <div className="month-grid" role="grid">
                    {MONTHS.map((month, index) => {
                        const selected = `${viewYear}-${pad(index + 1)}` === value;
                        const now = new Date();
                        const current = now.getFullYear() === viewYear && now.getMonth() === index;
                        return (
                            <button
                                type="button"
                                role="gridcell"
                                key={month}
                                className={`${selected ? 'is-selected' : ''}${current ? ' is-current' : ''}`}
                                aria-selected={selected}
                                onClick={() => chooseMonth(index)}
                            >
                                <span>{month.slice(0, 3)}</span>
                                <small>{month}</small>
                            </button>
                        );
                    })}
                </div>
            )}

            <div className="calendar-popover__footer">
                <button type="button" onClick={chooseToday}>{mode === 'date' ? 'Today' : 'This month'}</button>
                <button type="button" onClick={() => setOpen(false)}>Close</button>
            </div>
        </div>,
        document.body,
    ) : null;

    return (
        <div className="calendar-picker">
            <button
                ref={triggerRef}
                type="button"
                className={`calendar-picker__trigger ${className}`.trim()}
                style={style}
                disabled={disabled}
                aria-label={ariaLabel || (mode === 'date' ? 'Selected date' : 'Selected month')}
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={() => setOpen((current) => !current)}
            >
                <span className="calendar-picker__icon"><CalendarIcon /></span>
                <span className="calendar-picker__value">{formatValue(value, mode)}</span>
                <span className="calendar-picker__chevron"><ChevronIcon /></span>
            </button>
            {popover}
        </div>
    );
}
