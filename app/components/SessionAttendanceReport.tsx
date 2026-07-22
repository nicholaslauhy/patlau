'use client';

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import AppHeader from './AppHeader';
import CalendarPicker from './CalendarPicker';
import TableRefreshButton from './TableRefreshButton';
import { authenticatedFetch } from '../lib/authenticated-fetch';
import {
    buildSessionAttendanceEntries,
    groupSessionAttendanceEntries,
    type AttendanceProgramme,
    type DynamicAttendanceRecord,
    type ReportAttendanceStatus,
} from '../lib/session-attendance-report';
import './session-attendance-report.css';

type UserRole = 'member' | 'admin' | 'superuser';
type ReportRange = 'selected' | 'all';
type StatusFilter = 'all' | ReportAttendanceStatus;

interface ProgrammeConfig {
    title: string;
    shortTitle: string;
    accent: string;
    icon: string;
    allowedRoles: UserRole[];
}

const PROGRAMMES: Record<AttendanceProgramme, ProgrammeConfig> = {
    weekend: {
        title: 'Weekend Attendance Report',
        shortTitle: 'Weekend',
        accent: '#1677c8',
        icon: 'W',
        allowedRoles: ['member', 'admin', 'superuser'],
    },
    weekday: {
        title: 'Weekday Attendance Report',
        shortTitle: 'Weekday',
        accent: '#1677c8',
        icon: 'WD',
        allowedRoles: ['superuser'],
    },
    matchplay: {
        title: 'MatchPlay Attendance Report',
        shortTitle: 'MatchPlay',
        accent: '#7950b3',
        icon: 'M',
        allowedRoles: ['superuser'],
    },
    one_to_one: {
        title: '1-1 Attendance Report',
        shortTitle: '1-1',
        accent: '#168765',
        icon: '1-1',
        allowedRoles: ['admin', 'superuser'],
    },
};

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

const pad = (value: number) => String(value).padStart(2, '0');
const localDateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const todayKey = () => localDateKey(new Date());

const nextDateKey = (dateValue: string, offset: number) => {
    const [year, month, day] = dateValue.split('-').map(Number);
    return localDateKey(new Date(year, month - 1, day + offset));
};

const displayDate = (dateValue: string) => {
    const [year, month, day] = dateValue.split('-').map(Number);
    if (!year || !month || !day) return dateValue;
    return new Date(year, month - 1, day).toLocaleDateString('en-SG', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
};

const recordedTime = (dateValue: string) => {
    if (!dateValue || dateValue.length <= 10) return null;
    const parsed = new Date(dateValue);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleTimeString('en-SG', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Asia/Singapore',
    });
};

const statusMeta: Record<ReportAttendanceStatus, { label: string; symbol: string }> = {
    attended: { label: 'Attended', symbol: '✓' },
    missed: { label: 'Missed', symbol: '×' },
    makeup: { label: 'Makeup', symbol: '↻' },
};

const getUserRole = (user: { app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> }) => (
    user.app_metadata?.role || user.user_metadata?.role || 'member'
) as UserRole;

const responseError = async (response: Response, fallback: string) => {
    try {
        const body = await response.json();
        return body.error || body.message || fallback;
    } catch {
        return fallback;
    }
};

const REPORT_PAGE_SIZE = 500;

const fetchAllReportRows = async (
    loadPage: (from: number, to: number) => Promise<{
        data: DynamicAttendanceRecord[];
        error: unknown;
    }>,
) => {
    const rows: DynamicAttendanceRecord[] = [];

    for (let from = 0; ; from += REPORT_PAGE_SIZE) {
        const { data, error } = await loadPage(from, from + REPORT_PAGE_SIZE - 1);
        if (error) throw error;
        rows.push(...data);
        if (data.length < REPORT_PAGE_SIZE) return rows;
    }
};

export default function SessionAttendanceReport({ programme }: { programme: AttendanceProgramme }) {
    const router = useRouter();
    const config = PROGRAMMES[programme];
    const loadVersion = useRef(0);
    const [authReady, setAuthReady] = useState(false);
    const [userRole, setUserRole] = useState<UserRole | null>(null);
    const [userName, setUserName] = useState('');
    const [range, setRange] = useState<ReportRange>('selected');
    const [selectedDate, setSelectedDate] = useState(todayKey);
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [search, setSearch] = useState('');
    const [entries, setEntries] = useState<ReturnType<typeof buildSessionAttendanceEntries>>([]);
    const [loading, setLoading] = useState(false);
    const [hasLoaded, setHasLoaded] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    useEffect(() => {
        let active = true;

        void supabase.auth.getUser().then(({ data, error }) => {
            if (!active) return;
            if (error || !data.user) {
                router.replace('/');
                return;
            }

            setUserRole(getUserRole(data.user));
            setUserName(data.user.user_metadata?.name || data.user.email || 'User');
            setAuthReady(true);
        });

        return () => {
            active = false;
        };
    }, [router]);

    const loadReport = useCallback(async () => {
        const version = ++loadVersion.current;
        setLoading(true);
        setLoadError('');

        try {
            let nextEntries: ReturnType<typeof buildSessionAttendanceEntries> = [];

            if (programme === 'weekend') {
                const response = await authenticatedFetch('/api/attendance-search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ searchTerm: '%', report: true }),
                });
                if (!response.ok) {
                    throw new Error(await responseError(response, 'Failed to load Weekend attendance.'));
                }
                const body = await response.json();
                nextEntries = buildSessionAttendanceEntries({
                    programme,
                    students: (body.results || []) as DynamicAttendanceRecord[],
                });
            } else if (programme === 'weekday' || programme === 'matchplay') {
                const studentTable = programme === 'weekday' ? 'weekday_students' : 'matchplay_students';
                const attendanceTable = programme === 'weekday' ? 'weekday_attendance' : 'matchplay_attendance';

                const [students, attendanceRecords] = await Promise.all([
                    fetchAllReportRows(async (from, to) => {
                        const result = await supabase
                            .from(studentTable)
                            .select('*')
                            .order('student_name', { ascending: true })
                            .order('id', { ascending: true })
                            .range(from, to);
                        return {
                            data: (result.data || []) as DynamicAttendanceRecord[],
                            error: result.error,
                        };
                    }),
                    fetchAllReportRows(async (from, to) => {
                        let query = supabase
                            .from(attendanceTable)
                            .select('*')
                            .order('attendance_date', { ascending: false })
                            .order('id', { ascending: true })
                        if (range === 'selected') query = query.eq('attendance_date', selectedDate);
                        const result = await query.range(from, to);
                        return {
                            data: (result.data || []) as DynamicAttendanceRecord[],
                            error: result.error,
                        };
                    }),
                ]);

                nextEntries = buildSessionAttendanceEntries({
                    programme,
                    students,
                    attendanceRecords,
                });
            } else {
                const coachPromise = authenticatedFetch('/api/users/list')
                    .then(async (response) => {
                        if (!response.ok) throw new Error('Unable to resolve coach names.');
                        const body = await response.json();
                        return (body.users || []) as DynamicAttendanceRecord[];
                    })
                    .catch(() => [] as DynamicAttendanceRecord[]);

                const [students, sessions, coaches] = await Promise.all([
                    fetchAllReportRows(async (from, to) => {
                        const result = await supabase
                            .from('one_to_one_students')
                            .select('*')
                            .order('student_name', { ascending: true })
                            .order('id', { ascending: true })
                            .range(from, to);
                        return {
                            data: (result.data || []) as DynamicAttendanceRecord[],
                            error: result.error,
                        };
                    }),
                    fetchAllReportRows(async (from, to) => {
                        let query = supabase
                            .from('one_to_one_sessions')
                            .select('*')
                            .order('session_date', { ascending: false })
                            .order('id', { ascending: true })
                        if (range === 'selected') {
                            query = query
                                .gte('session_date', selectedDate)
                                .lt('session_date', nextDateKey(selectedDate, 1));
                        }
                        const result = await query.range(from, to);
                        return {
                            data: (result.data || []) as DynamicAttendanceRecord[],
                            error: result.error,
                        };
                    }),
                    coachPromise,
                ]);

                nextEntries = buildSessionAttendanceEntries({
                    programme,
                    students,
                    sessions,
                    coaches,
                });
            }

            if (version !== loadVersion.current) return;
            setEntries(nextEntries);
            setLastUpdated(new Date());
            setHasLoaded(true);
        } catch (error) {
            if (version !== loadVersion.current) return;
            setLoadError(error instanceof Error ? error.message : `Failed to load ${config.shortTitle} attendance.`);
            setHasLoaded(true);
        } finally {
            if (version === loadVersion.current) setLoading(false);
        }
    }, [config.shortTitle, programme, range, selectedDate]);

    const permitted = Boolean(userRole && config.allowedRoles.includes(userRole));

    useEffect(() => {
        if (authReady && permitted) void loadReport();
    }, [authReady, loadReport, permitted]);

    const filteredEntries = useMemo(() => {
        const query = search.trim().toLocaleLowerCase();
        return entries.filter((entry) => {
            if (range === 'selected' && entry.dateKey !== selectedDate) return false;
            if (statusFilter !== 'all' && entry.status !== statusFilter) return false;
            if (!query) return true;
            return [entry.studentName, entry.sessionTitle, entry.detail || '', statusMeta[entry.status].label]
                .join(' ')
                .toLocaleLowerCase()
                .includes(query);
        });
    }, [entries, range, search, selectedDate, statusFilter]);

    const sectionsByDate = useMemo(() => {
        const dates = new Map<string, ReturnType<typeof groupSessionAttendanceEntries>>();
        groupSessionAttendanceEntries(filteredEntries).forEach((section) => {
            dates.set(section.dateKey, [...(dates.get(section.dateKey) || []), section]);
        });
        return [...dates.entries()].sort(([left], [right]) => right.localeCompare(left));
    }, [filteredEntries]);

    const summary = useMemo(() => ({
        recorded: filteredEntries.length,
        attended: filteredEntries.filter((entry) => entry.status === 'attended').length,
        missed: filteredEntries.filter((entry) => entry.status === 'missed').length,
        makeup: filteredEntries.filter((entry) => entry.status === 'makeup').length,
    }), [filteredEntries]);

    if (!authReady) {
        return (
            <main className="session-report-auth-state" aria-live="polite">
                <span className="session-report-spinner" aria-hidden="true" />
                <p>Checking access to attendance reports…</p>
            </main>
        );
    }

    if (!permitted) {
        return (
            <main className="session-report-auth-state">
                <div className="session-report-forbidden">
                    <span className="session-report-forbidden__code">403</span>
                    <h1>Attendance report unavailable</h1>
                    <p>Your account does not have access to the {config.shortTitle} programme report.</p>
                    <Link href="/dashboard" className="btn share-btn">Return to dashboard</Link>
                </div>
            </main>
        );
    }

    return (
        <div
            className="container session-report-shell"
            style={{ '--report-accent': config.accent } as CSSProperties}
        >
            <AppHeader title={config.title} userName={userName} userRole={userRole} mode="dashboard" />

            <main className="session-report-page">
                <section className="session-report-hero">
                    <div className="session-report-hero__icon" aria-hidden="true">{config.icon}</div>
                    <div>
                        <p className="session-report-eyebrow">Session reports</p>
                        <h1>{config.title}</h1>
                        <p>Students are grouped by attendance date and session, using the same records as the mobile app.</p>
                    </div>
                </section>

                <div className="session-report-range" aria-label="Report date range">
                    <button
                        type="button"
                        className={range === 'selected' ? 'is-active' : ''}
                        aria-pressed={range === 'selected'}
                        onClick={() => setRange('selected')}
                    >
                        Selected day
                    </button>
                    <button
                        type="button"
                        className={range === 'all' ? 'is-active' : ''}
                        aria-pressed={range === 'all'}
                        onClick={() => setRange('all')}
                    >
                        All records
                    </button>
                </div>

                {range === 'selected' && (
                    <section className="session-report-date-control" aria-label="Report date">
                        <button
                            type="button"
                            className="session-report-date-control__arrow"
                            onClick={() => setSelectedDate((value) => nextDateKey(value, -1))}
                            aria-label="Previous day"
                        >
                            ‹
                        </button>
                        <div className="session-report-date-control__picker">
                            <span>Report date</span>
                            <CalendarPicker
                                mode="date"
                                value={selectedDate}
                                onChange={setSelectedDate}
                                ariaLabel="Choose report date"
                            />
                        </div>
                        <button
                            type="button"
                            className="session-report-date-control__arrow"
                            onClick={() => setSelectedDate((value) => nextDateKey(value, 1))}
                            aria-label="Next day"
                        >
                            ›
                        </button>
                    </section>
                )}

                <section className="session-report-summary" aria-label="Attendance summary">
                    {([
                        ['recorded', 'Recorded', '●'],
                        ['attended', 'Attended', '✓'],
                        ['missed', 'Missed', '×'],
                        ['makeup', 'Makeup', '↻'],
                    ] as const).map(([key, label, symbol]) => (
                        <article key={key} className={`session-report-summary__card is-${key}`}>
                            <span className="session-report-summary__icon" aria-hidden="true">{symbol}</span>
                            <div>
                                <strong>{summary[key]}</strong>
                                <span>{label}</span>
                            </div>
                        </article>
                    ))}
                </section>

                <section className="session-report-toolbar" aria-label="Attendance report filters">
                    <label className="session-report-search">
                        <span className="sr-only">Search attendance report</span>
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
                            <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                        <input
                            type="search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Search student or session…"
                        />
                    </label>

                    <label className="session-report-status">
                        <span>Status</span>
                        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
                            <option value="all">All statuses</option>
                            <option value="attended">Attended</option>
                            <option value="missed">Missed</option>
                            <option value="makeup">Makeup</option>
                        </select>
                    </label>

                    <div className="session-report-toolbar__meta" aria-live="polite">
                        <strong>{filteredEntries.length} record{filteredEntries.length === 1 ? '' : 's'}</strong>
                        <span>
                            {lastUpdated
                                ? `Updated ${lastUpdated.toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit' })}`
                                : 'Not refreshed yet'}
                        </span>
                    </div>

                    <TableRefreshButton
                        onRefresh={loadReport}
                        refreshing={loading}
                        label={`Refresh ${config.shortTitle} attendance report`}
                        className="session-report-refresh"
                    />
                </section>

                {loadError && (
                    <div className="session-report-message is-error" role="alert">
                        <div>
                            <strong>We could not refresh this report.</strong>
                            <span>{loadError}</span>
                        </div>
                        <button type="button" onClick={() => void loadReport()}>Try again</button>
                    </div>
                )}

                {!hasLoaded && loading ? (
                    <div className="session-report-loading" aria-live="polite">
                        <span className="session-report-spinner" aria-hidden="true" />
                        <div>
                            <strong>Loading {config.shortTitle} attendance</strong>
                            <span>Fetching the latest records from Supabase…</span>
                        </div>
                    </div>
                ) : sectionsByDate.length === 0 ? (
                    <div className="session-report-empty">
                        <span aria-hidden="true">✓</span>
                        <h2>No attendance recorded</h2>
                        <p>
                            {range === 'selected'
                                ? 'No students have been marked for this date and filter.'
                                : 'No recorded attendance matches the current filters.'}
                        </p>
                    </div>
                ) : (
                    <div className={`session-report-results${loading ? ' is-refreshing' : ''}`} aria-busy={loading}>
                        {sectionsByDate.map(([date, sections]) => (
                            <section key={date} className="session-report-day">
                                <div className="session-report-day__heading">
                                    <div>
                                        <p>{date}</p>
                                        <h2>{displayDate(date)}</h2>
                                    </div>
                                    <span>
                                        {sections.reduce((total, section) => total + section.entries.length, 0)} record
                                        {sections.reduce((total, section) => total + section.entries.length, 0) === 1 ? '' : 's'}
                                    </span>
                                </div>

                                <div className="session-report-day__sessions">
                                    {sections.map((section) => (
                                        <article key={`${section.dateKey}|${section.sessionKey}`} className="session-report-session">
                                            <header>
                                                <h3>{section.sessionTitle}</h3>
                                                <span>{section.entries.length} student{section.entries.length === 1 ? '' : 's'}</span>
                                            </header>
                                            <div className="session-report-session__rows">
                                                {section.entries.map((entry) => {
                                                    const status = statusMeta[entry.status];
                                                    const time = recordedTime(entry.recordedAt);
                                                    return (
                                                        <div key={entry.id} className="session-report-row">
                                                            <span className={`session-report-row__status-icon is-${entry.status}`} aria-hidden="true">
                                                                {status.symbol}
                                                            </span>
                                                            <div className="session-report-row__person">
                                                                <strong>{entry.studentName}</strong>
                                                                {entry.detail && <span>{entry.detail}</span>}
                                                                {time && <small>Recorded {time}</small>}
                                                            </div>
                                                            <span className={`session-report-badge is-${entry.status}`}>{status.label}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </article>
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}
