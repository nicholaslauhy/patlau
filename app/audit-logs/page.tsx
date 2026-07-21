'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import AppHeader from '../components/AppHeader';
import CalendarPicker from '../components/CalendarPicker';
import { authenticatedFetch } from '../lib/authenticated-fetch';
import type { AuditLogEntry, AuditLogResponse, AuditOutcome } from '../../types/audit';
import '../styles.css';
import '../dashboard/dashboard.css';
import './audit-logs.css';

const PAGE_SIZE = 50;

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

interface AuditFilters {
    search: string;
    category: string;
    outcome: string;
    action: string;
    from: string;
    to: string;
}

interface SentryLogsProbeResult {
    probeId: string;
    raw: {
        accepted: boolean;
        httpStatus: number | null;
        rateLimitHeaderPresent: boolean;
        error: string | null;
        destination: {
            host: string;
            projectId: string;
            environment: string;
        } | null;
    };
    sdk: {
        initialized: boolean;
        logsEnabled: boolean;
        queueDrained: boolean;
        error: string | null;
    };
}

const EMPTY_FILTERS: AuditFilters = {
    search: '',
    category: '',
    outcome: '',
    action: '',
    from: '',
    to: '',
};

const EMPTY_RESPONSE: AuditLogResponse = {
    logs: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    metrics: { today: 0, attention: 0, matching: 0 },
    retentionDays: 7,
    pruningEnabled: false,
    sentryLogsUrl: null,
    exportHealth: null,
};

const CATEGORY_LABELS: Record<string, string> = {
    authentication: 'Authentication',
    attendance: 'Attendance',
    payments: 'Payments',
    makeup: 'Makeup',
    students: 'Students',
    users: 'User management',
    profiles: 'User profiles',
    support: 'Chats & support',
    notifications: 'Notifications',
    coach_attendance: 'Coach attendance',
    system: 'System',
};

const OUTCOME_LABELS: Record<AuditOutcome, string> = {
    success: 'Successful',
    failure: 'Failed',
    denied: 'Denied',
    accepted: 'Accepted',
    warning: 'Warning',
};

const ACTION_SUGGESTIONS = [
    'insert',
    'update',
    'delete',
    'mark',
    'missed',
    'makeup',
    'undo',
    'reset',
    'login',
    'logout',
    'request_password_reset',
    'resend_password_reset_code',
    'verify_reset_code',
    'change_password',
    'create_user',
    'change_user_role',
    'delete_user',
    'delete_student',
    'upload_profile_photo',
    'remove_profile_photo',
    'record_payment',
    'reverse_payment',
    'send_message',
    'receive_parent_message',
    'send_ai_reply',
    'send_support_reply',
    'change_status',
    'send_telegram',
    'send_monthly_summary',
    'send_monthly_summaries',
];

function humanise(value: string | null | undefined) {
    if (!value) return 'Not recorded';
    return value
        .replace(/[._-]+/g, ' ')
        .replace(/\b\w/g, (character) => character.toUpperCase());
}

function categoryLabel(value: string) {
    return CATEGORY_LABELS[value] || humanise(value);
}

function formatDateTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('en-SG', {
        timeZone: 'Asia/Singapore',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
    });
}

function actorName(entry: AuditLogEntry) {
    return entry.actor_name || entry.actor_email || humanise(entry.actor_source) || 'System';
}

function displayValue(value: unknown) {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function OutcomeBadge({ outcome }: { outcome: AuditOutcome }) {
    return (
        <span className={`audit-badge audit-badge--${outcome}`}>
            {OUTCOME_LABELS[outcome] || humanise(outcome)}
        </span>
    );
}

function DetailItem({ label, value, mono = false }: { label: string; value: unknown; mono?: boolean }) {
    return (
        <div className="audit-detail-item">
            <dt>{label}</dt>
            <dd className={mono ? 'is-mono' : ''}>{displayValue(value)}</dd>
        </div>
    );
}

function ExportNotice({
    notice,
    onDismiss,
}: {
    notice: { type: 'success' | 'error'; message: string };
    onDismiss: () => void;
}) {
    const [exiting, setExiting] = useState(false);

    useEffect(() => {
        const timer = window.setTimeout(() => setExiting(true), 10_000);
        return () => window.clearTimeout(timer);
    }, []);

    return (
        <div
            className={`audit-export-notice audit-export-notice--${notice.type}${exiting ? ' is-exiting' : ''}`}
            role={notice.type === 'error' ? 'alert' : 'status'}
            aria-live="polite"
            onAnimationEnd={() => {
                if (exiting) onDismiss();
            }}
        >
            <span>{notice.message}</span>
            <button type="button" onClick={() => setExiting(true)} aria-label="Dismiss export message">×</button>
        </div>
    );
}

export default function AuditLogsPage() {
    const router = useRouter();
    const [authorized, setAuthorized] = useState(false);
    const [userName, setUserName] = useState('');
    const [draftFilters, setDraftFilters] = useState<AuditFilters>(EMPTY_FILTERS);
    const [appliedFilters, setAppliedFilters] = useState<AuditFilters>(EMPTY_FILTERS);
    const [response, setResponse] = useState<AuditLogResponse>(EMPTY_RESPONSE);
    const [page, setPage] = useState(1);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);
    const [mobileDetailMode, setMobileDetailMode] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [filterError, setFilterError] = useState('');
    const [copied, setCopied] = useState(false);
    const [copyError, setCopyError] = useState('');
    const [exporting, setExporting] = useState(false);
    const [probingSentry, setProbingSentry] = useState(false);
    const [lastExportRunId, setLastExportRunId] = useState('');
    const [sentryProbe, setSentryProbe] = useState<SentryLogsProbeResult | null>(null);
    const [exportNotice, setExportNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const detailRef = useRef<HTMLElement>(null);
    const detailCloseRef = useRef<HTMLButtonElement>(null);
    const detailTriggerRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        const initialise = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.replace('/');
                return;
            }

            const role = user.app_metadata?.role || user.user_metadata?.role || 'member';
            if (role !== 'superuser') {
                router.replace('/dashboard');
                return;
            }

            setUserName(user.user_metadata?.name || user.email || 'User');
            setAuthorized(true);
        };

        void initialise();
    }, [router]);

    const loadLogs = useCallback(async () => {
        if (!authorized) return;

        setLoading(true);
        setError('');
        try {
            const parameters = new URLSearchParams({
                page: String(page),
                pageSize: String(PAGE_SIZE),
            });

            Object.entries(appliedFilters).forEach(([key, value]) => {
                if (value.trim()) parameters.set(key, value.trim());
            });

            const result = await authenticatedFetch(`/api/audit/events?${parameters.toString()}`);
            const payload = await result.json().catch(() => ({}));
            if (!result.ok) throw new Error(payload.error || 'Could not load audit logs.');

            const nextResponse = payload as AuditLogResponse;
            const nextLogs = Array.isArray(nextResponse.logs) ? nextResponse.logs : [];
            setResponse({ ...EMPTY_RESPONSE, ...nextResponse, logs: nextLogs });
            setSelectedId((current) => (
                current !== null && nextLogs.some((entry) => entry.id === current)
                    ? current
                    : nextLogs[0]?.id ?? null
            ));
        } catch (requestError) {
            setResponse(EMPTY_RESPONSE);
            setSelectedId(null);
            setError(requestError instanceof Error ? requestError.message : 'Could not load audit logs.');
        } finally {
            setLoading(false);
        }
    }, [appliedFilters, authorized, page]);

    useEffect(() => {
        void loadLogs();
    }, [loadLogs]);

    useEffect(() => {
        const query = window.matchMedia('(max-width: 760px)');
        const syncMode = () => setMobileDetailMode(query.matches);
        syncMode();
        query.addEventListener('change', syncMode);
        return () => query.removeEventListener('change', syncMode);
    }, []);

    useEffect(() => {
        if (!detailOpen || !mobileDetailMode) return;

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const focusFrame = window.requestAnimationFrame(() => detailCloseRef.current?.focus());

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                setDetailOpen(false);
                return;
            }

            if (event.key !== 'Tab' || !detailRef.current) return;
            const focusable = Array.from(detailRef.current.querySelectorAll<HTMLElement>(
                'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
            ));
            if (focusable.length === 0) return;

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement;
            if (event.shiftKey && (active === first || !detailRef.current.contains(active))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (active === last || !detailRef.current.contains(active))) {
                event.preventDefault();
                first.focus();
            }
        };
        window.addEventListener('keydown', handleKeyDown);

        return () => {
            window.cancelAnimationFrame(focusFrame);
            window.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = previousOverflow;
            window.requestAnimationFrame(() => detailTriggerRef.current?.focus());
        };
    }, [detailOpen, mobileDetailMode]);

    const selectedEntry = useMemo(
        () => response.logs.find((entry) => entry.id === selectedId) || null,
        [response.logs, selectedId],
    );

    const categoryOptions = useMemo(() => {
        const values = new Set(Object.keys(CATEGORY_LABELS));
        response.logs.forEach((entry) => values.add(entry.category));
        return Array.from(values).sort((left, right) => categoryLabel(left).localeCompare(categoryLabel(right)));
    }, [response.logs]);

    const actionOptions = useMemo(() => {
        const values = new Set(ACTION_SUGGESTIONS);
        response.logs.forEach((entry) => values.add(entry.action));
        return Array.from(values).sort();
    }, [response.logs]);

    const changedFields = useMemo(() => {
        if (!selectedEntry) return [];
        if (selectedEntry.changed_fields?.length) return selectedEntry.changed_fields;
        return Array.from(new Set([
            ...Object.keys(selectedEntry.old_values || {}),
            ...Object.keys(selectedEntry.new_values || {}),
        ])).sort();
    }, [selectedEntry]);

    const totalPages = Math.max(1, Math.ceil(response.total / (response.pageSize || PAGE_SIZE)));

    const applyFilters = (event: React.FormEvent) => {
        event.preventDefault();
        if (draftFilters.from && draftFilters.to && draftFilters.from > draftFilters.to) {
            setFilterError('The start date must be before the end date.');
            return;
        }
        setFilterError('');
        setPage(1);
        setDetailOpen(false);
        setAppliedFilters({
            ...draftFilters,
            search: draftFilters.search.trim(),
            action: draftFilters.action.trim(),
        });
    };

    const resetFilters = () => {
        setFilterError('');
        setDraftFilters(EMPTY_FILTERS);
        setAppliedFilters(EMPTY_FILTERS);
        setPage(1);
        setDetailOpen(false);
    };

    const selectEntry = (entry: AuditLogEntry, trigger: HTMLButtonElement) => {
        detailTriggerRef.current = trigger;
        setSelectedId(entry.id);
        setDetailOpen(true);
        setCopied(false);
        setCopyError('');
    };

    const copyRequestId = async () => {
        if (!selectedEntry?.request_id) return;
        setCopyError('');
        try {
            if (!navigator.clipboard?.writeText) throw new Error('Clipboard access unavailable');
            await navigator.clipboard.writeText(selectedEntry.request_id);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
        } catch {
            setCopied(false);
            setCopyError('Could not copy the request ID. You can select and copy it manually.');
        }
    };

    const exportNow = async () => {
        if (exporting || probingSentry) return;

        setExporting(true);
        setExportNotice(null);
        try {
            const result = await authenticatedFetch('/api/audit/export', { method: 'POST' });
            const payload = await result.json().catch(() => ({}));
            if (!result.ok || payload.success === false) {
                throw new Error(payload.error || 'Could not export audit logs to Sentry.');
            }

            const exported = Number(payload.result?.exported) || 0;
            const pruned = Number(payload.result?.pruned) || 0;
            const requeued = Number(payload.result?.requeued) || 0;
            const exportRunId = typeof payload.result?.exportRunId === 'string'
                ? payload.result.exportRunId
                : '';
            const sdkSummaryQueueDrained = payload.result?.sdkSummaryQueueDrained === true;
            setLastExportRunId(exportRunId);
            const summary = exported > 0
                ? `${exported.toLocaleString()} ${exported === 1 ? 'log record was' : 'log records were'} accepted by Sentry ingestion.`
                : 'All queued audit records are already up to date.';
            const retrySummary = requeued > 0
                ? ` ${requeued.toLocaleString()} previously failed ${requeued === 1 ? 'event was' : 'events were'} retried.`
                : '';
            const pruningSummary = pruned > 0
                ? ` ${pruned.toLocaleString()} safely exported ${pruned === 1 ? 'record was' : 'records were'} removed from the local buffer.`
                : '';
            const sdkSummary = sdkSummaryQueueDrained
                ? ' The official Sentry SDK also drained its verification record from the local queue.'
                : ' The official Sentry SDK did not confirm that its local queue drained; use Test Sentry for details.';
            setExportNotice({ type: 'success', message: `${summary}${retrySummary}${pruningSummary}${sdkSummary}` });
            await loadLogs();
        } catch (requestError) {
            setExportNotice({
                type: 'error',
                message: requestError instanceof Error ? requestError.message : 'Could not export audit logs to Sentry.',
            });
        } finally {
            setExporting(false);
        }
    };

    const testSentryLogs = async () => {
        if (probingSentry || exporting) return;

        setProbingSentry(true);
        setSentryProbe(null);
        setExportNotice(null);
        try {
            const result = await authenticatedFetch('/api/audit/sentry-probe', { method: 'POST' });
            const payload = await result.json().catch(() => ({}));
            if (!result.ok || !payload.result) {
                throw new Error(payload.error || 'Could not run the Sentry Logs test.');
            }

            const probe = payload.result as SentryLogsProbeResult;
            setSentryProbe(probe);
            setExportNotice({
                type: probe.raw.accepted && probe.sdk.queueDrained ? 'success' : 'error',
                message: probe.raw.accepted && probe.sdk.queueDrained
                    ? 'The raw probe was accepted and the official SDK queue drained. Search the exact probe ID shown below in Sentry Logs.'
                    : 'The Sentry test found a delivery or SDK configuration problem. Review the checks below.',
            });
        } catch (requestError) {
            setExportNotice({
                type: 'error',
                message: requestError instanceof Error ? requestError.message : 'Could not run the Sentry Logs test.',
            });
        } finally {
            setProbingSentry(false);
        }
    };

    if (!authorized) {
        return <div className="container"><p className="audit-access-check">Checking access…</p></div>;
    }

    const retentionDays = response.retentionDays || 7;
    const pruningEnabled = response.pruningEnabled === true;
    const exportHealth = response.exportHealth;

    return (
        <div className="container audit-page">
            <AppHeader title="Audit Logs" userName={userName} userRole="superuser" mode="dashboard" />

            <main className="audit-main">
                <section className="audit-hero">
                    <div>
                        <span className="audit-eyebrow">Recent Supabase activity</span>
                        <h1>Understand every important action</h1>
                        <p>Supabase targets a {retentionDays}-day local buffer after successful delivery, with an additional safety grace. Unsent or failed events remain here until resolved.</p>
                    </div>
                    <div className="audit-metrics" aria-label="Audit activity summary">
                        <div><strong>{response.metrics.today.toLocaleString()}</strong><span>Today</span></div>
                        <div className={response.metrics.attention > 0 ? 'needs-attention' : ''}><strong>{response.metrics.attention.toLocaleString()}</strong><span>Needs attention ({retentionDays}d)</span></div>
                        <div><strong>{response.metrics.matching.toLocaleString()}</strong><span>Matching</span></div>
                    </div>
                </section>

                <section className="audit-export-card" aria-labelledby="audit-export-title">
                    <div className="audit-export-heading">
                        <div>
                            <span className="audit-eyebrow">Sentry offload</span>
                            <h2 id="audit-export-title">Audit export health</h2>
                            <p>{pruningEnabled
                                ? 'Successfully handed-off events become eligible for cleanup only after both safety windows.'
                                : 'Cleanup is paused. Verify an exported event in Sentry, then enable pruning in Vercel.'}</p>
                        </div>
                        <div className="audit-export-actions">
                            <button
                                type="button"
                                className="audit-probe-button"
                                onClick={() => void testSentryLogs()}
                                disabled={probingSentry || exporting}
                            >
                                {probingSentry ? 'Testing Sentry...' : 'Test Sentry'}
                            </button>
                            {response.sentryLogsUrl && (
                                <a href={response.sentryLogsUrl} target="_blank" rel="noreferrer" className="audit-sentry-link">
                                    Open Sentry Logs <span aria-hidden="true">↗</span>
                                </a>
                            )}
                            <button
                                type="button"
                                className="audit-export-button"
                                onClick={() => void exportNow()}
                                disabled={exporting || probingSentry}
                            >
                                {exporting ? 'Exporting…' : 'Export now'}
                            </button>
                        </div>
                    </div>

                    {exportHealth ? (
                        <>
                            <dl className="audit-export-stats">
                                <div><dt>Pending</dt><dd>{exportHealth.pending.toLocaleString()}</dd><dd className="audit-export-stat-note">Waiting to send</dd></div>
                                <div className={exportHealth.retry > 0 ? 'has-warning' : ''}><dt>Retry</dt><dd>{exportHealth.retry.toLocaleString()}</dd><dd className="audit-export-stat-note">Scheduled again</dd></div>
                                <div><dt>In flight</dt><dd>{exportHealth.inFlight.toLocaleString()}</dd><dd className="audit-export-stat-note">Being delivered</dd></div>
                                <div className={exportHealth.dead > 0 ? 'has-error' : ''}><dt>Failed</dt><dd>{exportHealth.dead.toLocaleString()}</dd><dd className="audit-export-stat-note">Needs attention</dd></div>
                            </dl>
                            <div className="audit-export-timeline">
                                <p><span>Last successful export</span><strong>{exportHealth.lastExportedAt ? formatDateTime(exportHealth.lastExportedAt) : 'Not yet exported'}</strong></p>
                                <p><span>Oldest waiting event</span><strong>{exportHealth.oldestPendingAt ? formatDateTime(exportHealth.oldestPendingAt) : 'Nothing waiting'}</strong></p>
                                <p><span>Delivered in local buffer</span><strong>{exportHealth.exportedBuffered.toLocaleString()}</strong></p>
                                <p><span>Automatic cleanup</span><strong>{pruningEnabled ? 'Enabled after safety windows' : 'Paused until verified'}</strong></p>
                            </div>
                        </>
                    ) : (
                        <p className="audit-export-unavailable">Export monitoring will appear after the audit offload database migration is installed.</p>
                    )}

                    {lastExportRunId && (
                        <div className="audit-export-search-token" role="status">
                            <span>Search this export in Sentry Logs</span>
                            <code>audit_export_run_id:{lastExportRunId}</code>
                        </div>
                    )}

                    {sentryProbe && (
                        <section className="audit-probe-result" aria-labelledby="audit-probe-title">
                            <div className="audit-probe-result-heading">
                                <div>
                                    <h3 id="audit-probe-title">Sentry Logs delivery test</h3>
                                    <p>These checks compare the audit exporter with Sentry's official SDK using the same fresh probe ID.</p>
                                </div>
                                <button type="button" onClick={() => setSentryProbe(null)} aria-label="Dismiss Sentry test details">Dismiss</button>
                            </div>

                            <div className="audit-probe-checks">
                                <div className={sentryProbe.raw.accepted ? 'is-good' : 'is-bad'}>
                                    <span>Raw ingestion</span>
                                    <strong>{sentryProbe.raw.accepted ? `Accepted (HTTP ${sentryProbe.raw.httpStatus})` : 'Not accepted'}</strong>
                                </div>
                                <div className={sentryProbe.sdk.initialized ? 'is-good' : 'is-bad'}>
                                    <span>SDK initialized</span>
                                    <strong>{sentryProbe.sdk.initialized ? 'Yes' : 'No'}</strong>
                                </div>
                                <div className={sentryProbe.sdk.logsEnabled ? 'is-good' : 'is-bad'}>
                                    <span>SDK Logs enabled</span>
                                    <strong>{sentryProbe.sdk.logsEnabled ? 'Yes' : 'No'}</strong>
                                </div>
                                <div className={sentryProbe.sdk.queueDrained ? 'is-good' : 'is-bad'}>
                                    <span>SDK local queue</span>
                                    <strong>{sentryProbe.sdk.queueDrained ? 'Drained' : 'Not confirmed'}</strong>
                                </div>
                            </div>

                            <div className="audit-probe-query">
                                <span>Copy this exact query into Sentry Logs</span>
                                <code>source:patlau_sentry_probe probe_id:{sentryProbe.probeId}</code>
                            </div>

                            {sentryProbe.raw.destination && (
                                <p className="audit-probe-destination">
                                    Destination: <strong>{sentryProbe.raw.destination.host}</strong>, project ID <strong>{sentryProbe.raw.destination.projectId}</strong>, environment <strong>{sentryProbe.raw.destination.environment}</strong>.
                                </p>
                            )}
                            {sentryProbe.raw.rateLimitHeaderPresent && (
                                <p className="audit-probe-warning">Sentry announced a rate-limit window while accepting the raw probe.</p>
                            )}
                            {sentryProbe.raw.error && <p className="audit-probe-error">Raw ingestion: {sentryProbe.raw.error}</p>}
                            {sentryProbe.sdk.error && <p className="audit-probe-error">Official SDK: {sentryProbe.sdk.error}</p>}
                            <p className="audit-probe-note">
                                Accepted and queue drained confirm transport only. The final proof is that the probe appears in Sentry Logs; keep automatic cleanup paused until it does.
                            </p>
                        </section>
                    )}

                    {exportNotice && (
                        <ExportNotice
                            key={`${exportNotice.type}-${exportNotice.message}`}
                            notice={exportNotice}
                            onDismiss={() => setExportNotice(null)}
                        />
                    )}
                </section>

                <form className="audit-filter-card" onSubmit={applyFilters}>
                    <div className="audit-filter-heading">
                        <div><h2>Find recent activity</h2><p>Search names, students, summaries and recorded identifiers from the {retentionDays}-day buffer.</p></div>
                        {Object.values(appliedFilters).some(Boolean) && <span>Filters applied</span>}
                    </div>

                    <div className="audit-filter-grid">
                        <label className="audit-search-field">
                            <span>Search</span>
                            <input
                                className="filter-input"
                                value={draftFilters.search}
                                onChange={(event) => setDraftFilters((current) => ({ ...current, search: event.target.value }))}
                                placeholder="Person, student, payment or summary…"
                                maxLength={120}
                            />
                        </label>

                        <label>
                            <span>Category</span>
                            <select
                                className="filter-input"
                                value={draftFilters.category}
                                onChange={(event) => setDraftFilters((current) => ({ ...current, category: event.target.value }))}
                            >
                                <option value="">All categories</option>
                                {categoryOptions.map((category) => <option key={category} value={category}>{categoryLabel(category)}</option>)}
                            </select>
                        </label>

                        <label>
                            <span>Outcome</span>
                            <select
                                className="filter-input"
                                value={draftFilters.outcome}
                                onChange={(event) => setDraftFilters((current) => ({ ...current, outcome: event.target.value }))}
                            >
                                <option value="">All outcomes</option>
                                {Object.entries(OUTCOME_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </select>
                        </label>

                        <label>
                            <span>Action</span>
                            <input
                                className="filter-input"
                                list="audit-action-options"
                                value={draftFilters.action}
                                onChange={(event) => setDraftFilters((current) => ({ ...current, action: event.target.value }))}
                                placeholder="e.g. update or reset"
                                maxLength={60}
                            />
                            <datalist id="audit-action-options">
                                {actionOptions.map((action) => <option key={action} value={action}>{humanise(action)}</option>)}
                            </datalist>
                        </label>

                        <label className="audit-date-field">
                            <span>From</span>
                            <CalendarPicker
                                mode="date"
                                value={draftFilters.from}
                                onChange={(value) => setDraftFilters((current) => ({ ...current, from: value }))}
                                ariaLabel="Audit log start date"
                            />
                        </label>

                        <label className="audit-date-field">
                            <span>To</span>
                            <CalendarPicker
                                mode="date"
                                value={draftFilters.to}
                                onChange={(value) => setDraftFilters((current) => ({ ...current, to: value }))}
                                ariaLabel="Audit log end date"
                            />
                        </label>
                    </div>

                    {filterError && <p className="audit-filter-error" role="alert">{filterError}</p>}
                    <div className="audit-filter-actions">
                        <button type="button" className="filter-button secondary" onClick={resetFilters}>Reset</button>
                        <button type="submit" className="filter-button">Apply filters</button>
                    </div>
                </form>

                {error && (
                    <div className="error-message audit-error" role="alert">
                        <span>{error}</span>
                        <button type="button" onClick={() => void loadLogs()}>Try again</button>
                    </div>
                )}

                <section className="audit-workspace" aria-busy={loading}>
                    <div className="audit-feed-card">
                        <div className="audit-results-heading">
                            <div><h2>Recent activity</h2><p>{response.total.toLocaleString()} matching {response.total === 1 ? 'event' : 'events'}</p></div>
                            {loading && <span className="audit-loading-dot">Refreshing</span>}
                        </div>
                        <p className="audit-results-status" role="status" aria-live="polite" aria-atomic="true">
                            {loading
                                ? 'Loading audit activity.'
                                : `${response.total} matching ${response.total === 1 ? 'event' : 'events'}. Page ${page} of ${totalPages}.`}
                        </p>

                        <div className="audit-feed">
                            {loading && response.logs.length === 0 ? (
                                <div className="audit-empty"><strong>Loading activity…</strong><span>Retrieving the latest secure audit records.</span></div>
                            ) : response.logs.length === 0 ? (
                                <div className="audit-empty"><strong>No matching activity</strong><span>Adjust the filters or reset them to see more records.</span></div>
                            ) : response.logs.map((entry) => (
                                <button
                                    type="button"
                                    key={entry.id}
                                    className={`audit-event${selectedId === entry.id ? ' is-selected' : ''}`}
                                    onClick={(event) => selectEntry(entry, event.currentTarget)}
                                    aria-pressed={selectedId === entry.id}
                                >
                                    <span className={`audit-event-icon audit-event-icon--${entry.category}`} aria-hidden="true">
                                        {categoryLabel(entry.category).charAt(0)}
                                    </span>
                                    <span className="audit-event-copy">
                                        <span className="audit-event-topline">
                                            <span className="audit-category">{categoryLabel(entry.category)}</span>
                                            <time>{formatDateTime(entry.occurred_at)}</time>
                                        </span>
                                        <strong>{entry.summary}</strong>
                                        <span className="audit-event-meta">
                                            <span>{actorName(entry)}</span>
                                            {entry.target_label && <span>{entry.target_label}</span>}
                                        </span>
                                        <OutcomeBadge outcome={entry.outcome} />
                                    </span>
                                    <span className="audit-event-chevron" aria-hidden="true">›</span>
                                </button>
                            ))}
                        </div>

                        <div className="audit-pagination">
                            <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || loading}>Previous</button>
                            <span>Page {page} of {totalPages}</span>
                            <button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages || loading}>Next</button>
                        </div>
                    </div>

                    <aside
                        ref={detailRef}
                        className={`audit-detail${detailOpen ? ' is-open' : ''}`}
                        aria-label="Selected audit event details"
                        role={mobileDetailMode && detailOpen ? 'dialog' : undefined}
                        aria-modal={mobileDetailMode && detailOpen ? true : undefined}
                        aria-labelledby={mobileDetailMode && detailOpen && selectedEntry ? 'audit-detail-title' : undefined}
                    >
                        {!selectedEntry ? (
                            <div className="audit-detail-empty"><strong>Select an activity</strong><span>Its actor, target and recorded changes will appear here.</span></div>
                        ) : (
                            <>
                                <div className="audit-detail-mobile-bar">
                                    <button ref={detailCloseRef} type="button" onClick={() => setDetailOpen(false)} aria-label="Close activity details">← Back to activity</button>
                                </div>
                                <header className="audit-detail-header">
                                    <div className="audit-detail-header-topline">
                                        <span className="audit-eyebrow">Event #{selectedEntry.id}</span>
                                        <OutcomeBadge outcome={selectedEntry.outcome} />
                                    </div>
                                    <h2 id="audit-detail-title">{selectedEntry.summary}</h2>
                                    <div className="audit-detail-timestamp">
                                        <span>Recorded</span>
                                        <time dateTime={selectedEntry.occurred_at}>{formatDateTime(selectedEntry.occurred_at)}</time>
                                    </div>
                                </header>

                                <section className="audit-detail-section">
                                    <h3>Who and what</h3>
                                    <dl className="audit-detail-grid">
                                        <DetailItem label="Actor" value={actorName(selectedEntry)} />
                                        <DetailItem label="Role" value={humanise(selectedEntry.actor_role)} />
                                        <DetailItem label="Source" value={humanise(selectedEntry.actor_source)} />
                                        <DetailItem label="Category" value={categoryLabel(selectedEntry.category)} />
                                        <DetailItem label="Action" value={humanise(selectedEntry.action)} />
                                        <DetailItem label="Target" value={selectedEntry.target_label || humanise(selectedEntry.target_table)} />
                                    </dl>
                                </section>

                                {changedFields.length > 0 && (
                                    <section className="audit-detail-section">
                                        <h3>Recorded changes</h3>
                                        <div className="audit-change-list">
                                            {changedFields.map((field) => (
                                                <article key={field} className="audit-change">
                                                    <h4>{humanise(field)}</h4>
                                                    <div>
                                                        <span><small>Before</small><code>{displayValue(selectedEntry.old_values?.[field])}</code></span>
                                                        <span className="audit-change-arrow" aria-hidden="true">→</span>
                                                        <span><small>After</small><code>{displayValue(selectedEntry.new_values?.[field])}</code></span>
                                                    </div>
                                                </article>
                                            ))}
                                        </div>
                                    </section>
                                )}

                                <section className="audit-detail-section">
                                    <h3>Request information</h3>
                                    <dl className="audit-detail-grid">
                                        <DetailItem label="Page or endpoint" value={selectedEntry.request_path} mono />
                                        <DetailItem label="Method" value={selectedEntry.request_method} mono />
                                        <DetailItem label="IP address" value={selectedEntry.ip_address} mono />
                                        <DetailItem label="Event type" value={selectedEntry.event_type} mono />
                                    </dl>
                                    {selectedEntry.request_id && (
                                        <div className="audit-request-id">
                                            <div><span>Request ID</span><code>{selectedEntry.request_id}</code></div>
                                            <button type="button" onClick={() => void copyRequestId()}>{copied ? 'Copied' : 'Copy ID'}</button>
                                        </div>
                                    )}
                                    {copyError && <p className="audit-copy-error" role="alert">{copyError}</p>}
                                </section>

                                <details className="audit-technical-details">
                                    <summary>Technical details</summary>
                                    <dl>
                                        <DetailItem label="Target table" value={selectedEntry.target_table} mono />
                                        <DetailItem label="Target record" value={selectedEntry.target_record_id} mono />
                                        <DetailItem label="Metadata" value={selectedEntry.metadata} mono />
                                        <DetailItem label="User agent" value={selectedEntry.user_agent} mono />
                                    </dl>
                                </details>
                            </>
                        )}
                    </aside>
                </section>
            </main>
        </div>
    );
}
