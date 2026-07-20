import { isIP } from 'node:net';
import { createClient, type User } from '@supabase/supabase-js';
import { getAuthenticatedUser, getStoredUserRole, serverAdmin, type UserRole } from './server-auth';

type AuditOutcome = 'success' | 'failure' | 'denied' | 'accepted' | 'warning';
type AuditKind = 'activity' | 'data_change' | 'security' | 'system';

export interface AuditActor {
    user: User;
    role?: UserRole;
}

export interface AuditEventInput {
    request?: Request;
    actor?: AuditActor | null;
    eventKind?: AuditKind;
    category: string;
    eventType: string;
    action: string;
    outcome: AuditOutcome;
    summary: string;
    actorSource?: string;
    targetTable?: string | null;
    targetRecordId?: Record<string, unknown> | null;
    targetLabel?: string | null;
    changedFields?: string[] | null;
    oldValues?: Record<string, unknown> | null;
    newValues?: Record<string, unknown> | null;
    metadata?: Record<string, unknown>;
}

const requestIds = new WeakMap<Request, string>();
const sensitiveKey = /(^|_)(password|passcode|secret|token|code|api_key|authorization|cookie|session)(_|$)/i;
const RATE_LIMIT_NOTICE_WINDOW_MS = 10 * 60_000;

interface AuditRateLimitInput {
    request: Request;
    eventType: string;
    targetLabel?: string | null;
    limit: number;
    windowMs: number;
}

function normalizeKey(key: string) {
    return key
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^a-z0-9]+/gi, '_')
        .toLowerCase();
}

function redactSensitive(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(redactSensitive);
    if (!value || typeof value !== 'object') return value;

    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, child]) => [
            key,
            sensitiveKey.test(normalizeKey(key)) ? '[REDACTED]' : redactSensitive(child),
        ]),
    );
}

function redactSensitiveText(value: string) {
    return value
        .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
        .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_JWT]')
        .replace(/([?&](?:code|token|key|secret|password)=)[^&#\s]+/gi, '$1[REDACTED]')
        .replace(
            /((?:password|passcode|secret|token|code|api[_ -]?key|authorization|cookie|session)(?:[_ -]?(?:hash|value|header))?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
            '$1[REDACTED]',
        )
        .replace(/\b\d{6}\b/g, '[REDACTED_CODE]');
}

function getRequestId(request?: Request) {
    if (!request) return crypto.randomUUID();
    const existing = requestIds.get(request);
    if (existing) return existing;

    const next = request.headers.get('x-request-id')
        || request.headers.get('x-vercel-id')
        || crypto.randomUUID();
    requestIds.set(request, next);
    return next;
}

function getClientIp(request?: Request) {
    const candidate = request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || request?.headers.get('x-real-ip')?.trim()
        || '';
    return isIP(candidate) ? candidate : null;
}

function getRequestDetails(request?: Request) {
    const requestUrl = request ? new URL(request.url) : null;
    return {
        requestId: getRequestId(request),
        requestPath: requestUrl?.pathname || null,
        requestMethod: request?.method || null,
        ipAddress: getClientIp(request),
        userAgent: request?.headers.get('user-agent')?.slice(0, 500) || null,
    };
}

export function safeAuditError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || 'Unknown error');
    return redactSensitiveText(message).slice(0, 500);
}

export async function getOptionalAuditActor(request: Request): Promise<AuditActor | null> {
    const user = await getAuthenticatedUser(request);
    return user ? { user, role: getStoredUserRole(user) } : null;
}

export async function auditRateLimitExceeded(input: AuditRateLimitInput) {
    const details = getRequestDetails(input.request);
    if (!details.ipAddress) return false;

    const { data: claimed, error } = await serverAdmin.rpc('claim_audit_rate_limit', {
        p_event_type: input.eventType,
        p_ip_address: details.ipAddress,
        p_target_label: input.targetLabel || '',
        p_limit: input.limit,
        p_window_seconds: Math.max(1, Math.ceil(input.windowMs / 1000)),
    });

    // Authentication must remain available if the additive limiter itself is
    // unavailable. The underlying provider still enforces credential validity.
    if (error) {
        console.error('[audit] Rate-limit check failed:', safeAuditError(error));
        return false;
    }
    return claimed !== true;
}

export function createAuditedAdminClient(
    request: Request,
    actor?: AuditActor | null,
    actorSource = 'api',
) {
    const details = getRequestDetails(request);
    const headers: Record<string, string> = {
        'x-audit-request-id': details.requestId,
        'x-audit-path': details.requestPath || '',
        'x-audit-method': details.requestMethod || '',
        'x-audit-source': actorSource,
    };

    if (actor?.user.id) headers['x-audit-user-id'] = actor.user.id;
    if (details.ipAddress) headers['x-audit-ip'] = details.ipAddress;
    if (details.userAgent) headers['x-audit-user-agent'] = details.userAgent;

    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        {
            auth: { persistSession: false, autoRefreshToken: false },
            global: { headers },
        },
    );
}

export async function writeAuditEvent(input: AuditEventInput) {
    try {
        const details = getRequestDetails(input.request);
        const actor = input.actor;
        const actorRole = actor
            ? actor.role || getStoredUserRole(actor.user)
            : null;

        // Once an endpoint has actually rate-limited an anonymous caller, keep
        // one visible notice per target and minute instead of storing an
        // unbounded stream of identical blocked requests. Normal actions are
        // never deduplicated.
        if (
            !actor
            && details.ipAddress
            && input.eventType.endsWith('.rate_limited')
        ) {
            const since = new Date(Date.now() - RATE_LIMIT_NOTICE_WINDOW_MS).toISOString();
            let duplicateQuery = serverAdmin
                .from('audit_logs')
                .select('id')
                .eq('event_type', input.eventType)
                .eq('outcome', input.outcome)
                .eq('ip_address', details.ipAddress)
                .gte('occurred_at', since);

            if (input.targetLabel) {
                duplicateQuery = duplicateQuery.eq('target_label', input.targetLabel);
            }

            const { data: duplicate, error: duplicateError } = await duplicateQuery.limit(1);

            if (!duplicateError && duplicate && duplicate.length > 0) return;
        }

        const { error } = await serverAdmin.from('audit_logs').insert({
            event_kind: input.eventKind || (input.category === 'authentication' ? 'security' : 'activity'),
            category: input.category,
            event_type: input.eventType,
            action: input.action,
            outcome: input.outcome,
            summary: input.summary,
            actor_user_id: actor?.user.id || null,
            actor_email: actor?.user.email || null,
            actor_name: actor?.user.user_metadata?.name
                || actor?.user.user_metadata?.username
                || null,
            actor_role: actorRole,
            actor_source: input.actorSource || (actor ? 'authenticated' : 'system'),
            target_table: input.targetTable || null,
            target_record_id: input.targetRecordId || null,
            target_label: input.targetLabel || null,
            changed_fields: input.changedFields || null,
            old_values: redactSensitive(input.oldValues || null),
            new_values: redactSensitive(input.newValues || null),
            metadata: redactSensitive(input.metadata || {}),
            request_id: details.requestId,
            request_path: details.requestPath,
            request_method: details.requestMethod,
            ip_address: details.ipAddress,
            user_agent: details.userAgent,
        });

        if (error) console.error('[audit] Unable to write audit event:', error.message);
    } catch (error) {
        // Auditing is additive and must not change the existing business outcome.
        console.error('[audit] Unexpected audit failure:', safeAuditError(error));
    }
}
