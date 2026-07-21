import { NextRequest, NextResponse } from 'next/server';
import { writeAuditEvent } from '../../../lib/audit-server';
import { requireRole, serverAdmin } from '../../../lib/server-auth';

const PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_PAGE = 2_000;
const LOGOUT_DEDUPE_MS = 120_000;
const DEFAULT_RETENTION_DAYS = 7;

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function jsonNoStore(body: unknown, status = 200) {
    return NextResponse.json(body, {
        status,
        headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    });
}

function positiveInteger(value: string | null, fallback: number, maximum?: number) {
    const parsed = Number.parseInt(value || '', 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return maximum ? Math.min(parsed, maximum) : parsed;
}

function auditRetentionDays() {
    const parsed = Number.parseInt(process.env.AUDIT_LOCAL_RETENTION_DAYS || '', 10);
    if (!Number.isFinite(parsed)) return DEFAULT_RETENTION_DAYS;
    return Math.min(365, Math.max(1, parsed));
}

function auditPruningEnabled() {
    return process.env.AUDIT_PRUNING_ENABLED?.trim().toLowerCase() === 'true';
}

function sentryLogsUrl() {
    const configured = process.env.SENTRY_AUDIT_SEARCH_URL?.trim();
    if (!configured) return null;

    try {
        const url = new URL(configured);
        return url.protocol === 'https:' ? url.toString() : null;
    } catch {
        return null;
    }
}

function asNonNegativeNumber(value: unknown) {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function normalizeExportHealth(data: unknown) {
    const candidate = Array.isArray(data) ? data[0] : data;
    if (!candidate || typeof candidate !== 'object') return null;

    const row = candidate as Record<string, unknown>;
    return {
        pending: asNonNegativeNumber(row.pending_count),
        retry: asNonNegativeNumber(row.retry_count),
        inFlight: asNonNegativeNumber(row.in_flight_count),
        dead: asNonNegativeNumber(row.dead_count),
        exportedBuffered: asNonNegativeNumber(row.exported_buffer_count),
        oldestPendingAt: typeof row.oldest_pending_at === 'string' ? row.oldest_pending_at : null,
        lastExportedAt: typeof row.last_exported_at === 'string' ? row.last_exported_at : null,
    };
}

function singaporeBoundary(value: string, endOfDay = false) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    return `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+08:00`;
}

export async function GET(request: NextRequest) {
    const caller = await requireRole(request, ['superuser']);
    if (!caller) return jsonNoStore({ error: 'Unauthorized' }, 401);

    const parameters = request.nextUrl.searchParams;
    const page = positiveInteger(parameters.get('page'), 1, MAX_PAGE);
    const pageSize = positiveInteger(parameters.get('pageSize'), PAGE_SIZE, MAX_PAGE_SIZE);
    const offset = (page - 1) * pageSize;
    const search = (parameters.get('search') || '')
        .replace(/[%_\\]/g, ' ')
        .trim()
        .slice(0, 120);
    const category = (parameters.get('category') || '').trim().slice(0, 60);
    const outcome = (parameters.get('outcome') || '').trim().slice(0, 30);
    const action = (parameters.get('action') || '').trim().slice(0, 60);
    const targetTable = (parameters.get('table') || '').trim().slice(0, 80);
    const from = singaporeBoundary(parameters.get('from') || '');
    const to = singaporeBoundary(parameters.get('to') || '', true);
    const retentionDays = auditRetentionDays();

    let query = serverAdmin
        .from('audit_logs')
        .select('*', { count: 'exact' })
        .order('occurred_at', { ascending: false })
        .order('id', { ascending: false })
        .range(offset, offset + pageSize - 1);

    if (search) query = query.ilike('search_text', `%${search}%`);
    if (category) query = query.eq('category', category);
    if (outcome) query = query.eq('outcome', outcome);
    if (action) query = query.eq('action', action);
    if (targetTable) query = query.eq('target_table', targetTable);
    if (from) query = query.gte('occurred_at', from);
    if (to) query = query.lte('occurred_at', to);

    const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Singapore',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());

    const [logsResult, todayResult, attentionResult, exportStatusResult] = await Promise.all([
        query,
        serverAdmin
            .from('audit_logs')
            .select('id', { count: 'exact', head: true })
            .gte('occurred_at', singaporeBoundary(today)!),
        serverAdmin
            .from('audit_logs')
            .select('id', { count: 'exact', head: true })
            .in('outcome', ['failure', 'denied', 'warning'])
            .gte('occurred_at', new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString()),
        // This RPC arrives with the Sentry offload migration. Keep the viewer
        // functional while the website and database are deployed separately.
        serverAdmin.rpc('get_audit_export_status'),
    ]);

    if (logsResult.error) {
        console.error('[audit] Log viewer query failed:', logsResult.error.message);
        return jsonNoStore({ error: 'Could not load audit logs' }, 500);
    }

    return jsonNoStore({
        logs: logsResult.data || [],
        total: logsResult.count || 0,
        page,
        pageSize,
        metrics: {
            today: todayResult.count || 0,
            attention: attentionResult.count || 0,
            matching: logsResult.count || 0,
        },
        retentionDays,
        pruningEnabled: auditPruningEnabled(),
        sentryLogsUrl: sentryLogsUrl(),
        exportHealth: exportStatusResult.error ? null : normalizeExportHealth(exportStatusResult.data),
    });
}

export async function POST(request: NextRequest) {
    const caller = await requireRole(request, ['member', 'admin', 'superuser']);
    if (!caller) return jsonNoStore({ error: 'Unauthorized' }, 401);

    const body = await request.json().catch(() => ({}));
    const eventType = typeof body.eventType === 'string' ? body.eventType : '';
    if (eventType !== 'authentication.logout') {
        return jsonNoStore({ error: 'Unsupported audit event' }, 400);
    }

    const recordedAfter = new Date(Date.now() - LOGOUT_DEDUPE_MS).toISOString();
    const { data: recent } = await serverAdmin
        .from('audit_logs')
        .select('id')
        .eq('actor_user_id', caller.user.id)
        .eq('event_type', 'authentication.logout_requested')
        .gte('occurred_at', recordedAfter)
        .limit(1);

    if (!recent || recent.length === 0) {
        await writeAuditEvent({
            request,
            actor: caller,
            eventKind: 'security',
            category: 'authentication',
            eventType: 'authentication.logout_requested',
            action: 'logout',
            outcome: 'accepted',
            summary: `${caller.user.user_metadata?.name || caller.user.email || 'User'} requested sign-out`,
            actorSource: 'client_reported',
            targetTable: 'auth.users',
            targetRecordId: { id: caller.user.id },
            targetLabel: caller.user.email || null,
        });
    }

    return jsonNoStore({ message: 'Event recorded' });
}
