import { randomUUID } from 'node:crypto';
import { serverAdmin } from './server-auth';
import { scrubSentryLog, scrubSentryText, scrubSentryValue } from './sentry-scrub';

const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_MAX_BATCHES = 20;
const DEFAULT_RETENTION_DAYS = 7;
const EXPORT_LEASE_SECONDS = 300;
const SENTRY_REQUEST_TIMEOUT_MS = 10_000;
const MAX_SENTRY_ERROR_DETAIL_LENGTH = 500;
const MAX_SENTRY_ENVELOPE_BYTES = 750_000;
const MAX_JSON_ATTRIBUTE_LENGTH = 16_000;
const SENTRY_EXPORTER_NAME = 'patlau.audit-exporter';
const SENTRY_EXPORTER_VERSION = '1.0.0';

type AuditLogLevel = 'info' | 'warn' | 'error';

type SentryTypedAttribute =
    | { value: string; type: 'string' }
    | { value: number; type: 'integer' | 'double' }
    | { value: boolean; type: 'boolean' };

interface SerializedSentryLog {
    timestamp: number;
    level: AuditLogLevel;
    body: string;
    severity_number: 9 | 13 | 17;
    attributes: Record<string, SentryTypedAttribute>;
}

export interface AuditExportStatus {
    pending_count: number;
    retry_count: number;
    in_flight_count: number;
    dead_count: number;
    exported_buffer_count: number;
    oldest_pending_at: string | null;
    last_exported_at: string | null;
}

interface ClaimedAuditLog {
    audit_log_id: number;
    stable_event_id: string;
    export_lease_token: string;
    occurred_at: string;
    event_kind: string;
    category: string;
    event_type: string;
    action: string;
    outcome: string;
    summary: string;
    actor_user_id: string | null;
    actor_email: string | null;
    actor_name: string | null;
    actor_role: string | null;
    actor_source: string;
    target_table: string | null;
    target_record_id: Record<string, unknown> | null;
    target_label: string | null;
    changed_fields: string[] | null;
    old_values: Record<string, unknown> | null;
    new_values: Record<string, unknown> | null;
    metadata: Record<string, unknown> | null;
    request_id: string | null;
    request_path: string | null;
    request_method: string | null;
    ip_address: string | null;
    user_agent: string | null;
}

export interface AuditExportResult {
    claimed: number;
    exported: number;
    pruned: number;
    requeued: number;
    batches: number;
    exportRunId: string;
    status: AuditExportStatus | null;
}

export interface RawSentryProbeResult {
    accepted: true;
    httpStatus: number;
    rateLimitHeaderPresent: boolean;
    destination: {
        host: string;
        projectId: string;
        environment: string;
    };
}

interface SentryEnvelopeReceipt {
    httpStatus: number;
    rateLimitHeaderPresent: boolean;
}

export class AuditExportConfigurationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AuditExportConfigurationError';
    }
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
    const parsed = Number.parseInt(value || '', 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, parsed));
}

export function getAuditRetentionDays() {
    return boundedInteger(
        process.env.AUDIT_LOCAL_RETENTION_DAYS,
        DEFAULT_RETENTION_DAYS,
        1,
        365,
    );
}

export function isSentryAuditConfigured() {
    return Boolean(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN);
}

export function isAuditPruningEnabled() {
    return process.env.AUDIT_PRUNING_ENABLED?.trim().toLowerCase() === 'true';
}

function getSentryDsn() {
    return (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || '').trim();
}

function getSentryEnvironment() {
    return process.env.SENTRY_ENVIRONMENT
        || process.env.VERCEL_ENV
        || process.env.NODE_ENV
        || 'production';
}

/**
 * Converts a public Sentry DSN into the envelope ingestion endpoint without
 * exposing the DSN secret (legacy self-hosted DSNs may still contain one).
 */
function getSentryEnvelopeEndpoint(dsn: string) {
    let parsed: URL;
    try {
        parsed = new URL(dsn);
    } catch {
        throw new AuditExportConfigurationError('SENTRY_DSN is not a valid URL.');
    }

    if (!['https:', 'http:'].includes(parsed.protocol) || !parsed.username || !parsed.hostname) {
        throw new AuditExportConfigurationError('SENTRY_DSN is missing a valid protocol, public key, or host.');
    }

    const pathParts = parsed.pathname.split('/').filter(Boolean);
    const projectId = pathParts.pop();
    if (!projectId) {
        throw new AuditExportConfigurationError('SENTRY_DSN is missing its project ID.');
    }

    const pathPrefix = pathParts.length ? `/${pathParts.join('/')}` : '';
    const endpoint = new URL(`${parsed.protocol}//${parsed.host}${pathPrefix}/api/${projectId}/envelope/`);
    endpoint.searchParams.set('sentry_version', '7');
    endpoint.searchParams.set('sentry_key', decodeURIComponent(parsed.username));
    endpoint.searchParams.set('sentry_client', `${SENTRY_EXPORTER_NAME}/${SENTRY_EXPORTER_VERSION}`);
    return endpoint.toString();
}

function getSentryDestination(dsn: string) {
    const endpoint = new URL(getSentryEnvelopeEndpoint(dsn));
    const pathParts = endpoint.pathname.split('/').filter(Boolean);
    const apiIndex = pathParts.lastIndexOf('api');
    const projectId = apiIndex >= 0 ? pathParts[apiIndex + 1] : '';

    return {
        host: endpoint.host,
        projectId,
        environment: getSentryEnvironment(),
    };
}

function jsonAttribute(value: unknown) {
    if (value === null || value === undefined) return '';
    try {
        return JSON.stringify(scrubSentryValue(value)).slice(0, MAX_JSON_ATTRIBUTE_LENGTH);
    } catch {
        return '[UNSERIALIZABLE]';
    }
}

function compactAttributes(row: ClaimedAuditLog, exportRunId: string) {
    const attributes: Record<string, string | number | boolean> = {
        source: 'supabase_audit',
        audit_export_run_id: exportRunId,
        audit_log_id: row.audit_log_id,
        audit_stable_id: row.stable_event_id,
        audit_occurred_at: row.occurred_at,
        audit_event_kind: row.event_kind,
        audit_category: row.category,
        audit_event_type: row.event_type,
        audit_action: row.action,
        audit_outcome: row.outcome,
        actor_source: row.actor_source,
    };

    const optional: Record<string, string | null | undefined> = {
        actor_user_id: row.actor_user_id,
        actor_email: row.actor_email,
        actor_name: row.actor_name,
        actor_role: row.actor_role,
        target_table: row.target_table,
        target_label: row.target_label,
        request_id: row.request_id,
        request_path: row.request_path,
        request_method: row.request_method,
        request_ip_address: row.ip_address,
        request_user_agent: row.user_agent,
    };

    for (const [key, value] of Object.entries(optional)) {
        if (value) attributes[key] = value.slice(0, 2_000);
    }

    if (row.changed_fields?.length) {
        attributes.changed_fields = row.changed_fields.slice(0, 100).join(',');
    }
    if (row.target_record_id) attributes.target_record_id_json = jsonAttribute(row.target_record_id);
    if (row.old_values) attributes.old_values_json = jsonAttribute(row.old_values);
    if (row.new_values) attributes.new_values_json = jsonAttribute(row.new_values);
    if (row.metadata && Object.keys(row.metadata).length) {
        attributes.metadata_json = jsonAttribute(row.metadata);
    }

    return attributes;
}

function typedAttribute(value: string | number | boolean): SentryTypedAttribute {
    if (typeof value === 'string') return { value, type: 'string' };
    if (typeof value === 'boolean') return { value, type: 'boolean' };
    return { value, type: Number.isInteger(value) ? 'integer' : 'double' };
}

function serializedAuditLog(
    row: ClaimedAuditLog,
    sequence: number,
    exportRunId: string,
): SerializedSentryLog {
    const level: AuditLogLevel = row.outcome === 'failure'
        ? 'error'
        : row.outcome === 'denied' || row.outcome === 'warning'
            ? 'warn'
            : 'info';
    const severity = level === 'error' ? 17 : level === 'warn' ? 13 : 9;
    const environment = getSentryEnvironment();
    const parsedOccurredAt = Date.parse(row.occurred_at);
    const now = Date.now();
    const canUseOccurredAt = Number.isFinite(parsedOccurredAt)
        && parsedOccurredAt <= now + 5 * 60 * 1_000
        && parsedOccurredAt >= now - 25 * 24 * 60 * 60 * 1_000;
    const scrubbedLog = scrubSentryLog({
        body: row.summary.slice(0, 4_000),
        attributes: {
            ...compactAttributes(row, exportRunId),
            'sentry.environment': environment,
            'sentry.sdk.name': SENTRY_EXPORTER_NAME,
            'sentry.sdk.version': SENTRY_EXPORTER_VERSION,
            'sentry.timestamp.sequence': sequence,
        },
    });
    const scrubbedAttributes = scrubbedLog.attributes || {};

    return {
        // Preserve normal operational chronology. Very old backfills use the
        // ingestion time so Sentry does not discard them outside its lookback.
        timestamp: (canUseOccurredAt ? parsedOccurredAt : now) / 1_000,
        level,
        body: typeof scrubbedLog.body === 'string' ? scrubbedLog.body : 'Audit event',
        severity_number: severity,
        attributes: Object.fromEntries(
            Object.entries(scrubbedAttributes)
                .filter((entry): entry is [string, string | number | boolean] => (
                    ['string', 'number', 'boolean'].includes(typeof entry[1])
                ))
                .map(([key, value]) => [key, typedAttribute(value)]),
        ),
    };
}

function serializeSentryEnvelope(logs: SerializedSentryLog[]) {
    return [
        JSON.stringify({
            sdk: { name: SENTRY_EXPORTER_NAME, version: SENTRY_EXPORTER_VERSION },
        }),
        JSON.stringify({
            type: 'log',
            item_count: logs.length,
            content_type: 'application/vnd.sentry.items.log+json',
        }),
        JSON.stringify({ version: 2, items: logs }),
    ].join('\n');
}

function splitSentryEnvelopes(rows: ClaimedAuditLog[], exportRunId: string) {
    const encoder = new TextEncoder();
    const envelopes: string[] = [];
    let current: SerializedSentryLog[] = [];
    let currentItemBytes = 0;

    rows.forEach((row, index) => {
        const log = serializedAuditLog(row, index, exportRunId);
        const logBytes = encoder.encode(JSON.stringify(log)).byteLength;

        // Leave several KiB for the envelope headers, container JSON, commas,
        // and future Sentry metadata while remaining below the 1 MB limit.
        if (logBytes + 4_096 > MAX_SENTRY_ENVELOPE_BYTES) {
            throw new Error(`Audit log ${row.audit_log_id} is too large for Sentry ingestion`);
        }

        if (current.length && currentItemBytes + logBytes + 4_096 > MAX_SENTRY_ENVELOPE_BYTES) {
            envelopes.push(serializeSentryEnvelope(current));
            current = [];
            currentItemBytes = 0;
        }

        current.push(log);
        currentItemBytes += logBytes + (current.length > 1 ? 1 : 0);
    });

    if (current.length) envelopes.push(serializeSentryEnvelope(current));

    for (const envelope of envelopes) {
        if (encoder.encode(envelope).byteLength > MAX_SENTRY_ENVELOPE_BYTES) {
            throw new Error('A generated Sentry envelope exceeded the safe delivery size');
        }
    }

    return envelopes;
}

async function safeSentryResponseDetail(response: Response) {
    try {
        const responseBody = await response.text();
        return scrubSentryText(responseBody)
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, MAX_SENTRY_ERROR_DETAIL_LENGTH);
    } catch {
        return '';
    }
}

async function postEnvelopeToSentry(
    envelope: string,
    endpoint: string,
): Promise<SentryEnvelopeReceipt> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SENTRY_REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-sentry-envelope' },
            body: envelope,
            signal: controller.signal,
            cache: 'no-store',
        });
        const sentryError = scrubSentryText(response.headers.get('x-sentry-error') || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, MAX_SENTRY_ERROR_DETAIL_LENGTH);

        if (!response.ok || sentryError) {
            const retryAfter = response.headers.get('retry-after');
            const retryDetail = retryAfter ? ` (retry after ${retryAfter})` : '';
            const responseDetail = response.ok ? '' : await safeSentryResponseDetail(response);
            const detail = sentryError || responseDetail;
            const rejectionDetail = detail ? `: ${detail}` : '';

            throw new Error(
                `Sentry rejected the log envelope with HTTP ${response.status}${retryDetail}${rejectionDetail}`,
            );
        }

        return {
            httpStatus: response.status,
            rateLimitHeaderPresent: Boolean(response.headers.get('x-sentry-rate-limits')),
        };
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error('Sentry audit delivery timed out before an HTTP acknowledgement');
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

async function sendBatchToSentry(
    rows: ClaimedAuditLog[],
    endpoint: string,
    exportRunId: string,
) {
    for (const envelope of splitSentryEnvelopes(rows, exportRunId)) {
        const receipt = await postEnvelopeToSentry(envelope, endpoint);
        if (receipt.rateLimitHeaderPresent) {
            console.warn('[audit-export] Sentry accepted the envelope and announced a rate-limit window.');
        }
    }
}

export async function sendRawSentryLogsProbe(probeId: string): Promise<RawSentryProbeResult> {
    if (!isSentryAuditConfigured()) {
        throw new AuditExportConfigurationError(
            'Sentry audit export is not configured. Add SENTRY_DSN before running the probe.',
        );
    }

    const dsn = getSentryDsn();
    const environment = getSentryEnvironment();
    const scrubbedLog = scrubSentryLog({
        body: 'PatLau Sentry Logs raw verification probe',
        attributes: {
            source: 'patlau_sentry_probe',
            probe_id: probeId,
            probe_transport: 'raw',
            'sentry.environment': environment,
            'sentry.sdk.name': SENTRY_EXPORTER_NAME,
            'sentry.sdk.version': SENTRY_EXPORTER_VERSION,
        },
    });
    const attributes = scrubbedLog.attributes || {};
    const log: SerializedSentryLog = {
        timestamp: Date.now() / 1_000,
        level: 'info',
        body: typeof scrubbedLog.body === 'string' ? scrubbedLog.body : 'Sentry Logs verification probe',
        severity_number: 9,
        attributes: Object.fromEntries(
            Object.entries(attributes)
                .filter((entry): entry is [string, string | number | boolean] => (
                    ['string', 'number', 'boolean'].includes(typeof entry[1])
                ))
                .map(([key, value]) => [key, typedAttribute(value)]),
        ),
    };
    const receipt = await postEnvelopeToSentry(
        serializeSentryEnvelope([log]),
        getSentryEnvelopeEndpoint(dsn),
    );

    return {
        accepted: true,
        ...receipt,
        destination: getSentryDestination(dsn),
    };
}

async function markBatchFailed(rows: ClaimedAuditLog[], error: unknown) {
    if (!rows.length) return;
    const leaseToken = rows[0].export_lease_token;
    const message = error instanceof Error ? error.message : String(error || 'Sentry export failed');
    const { error: failError } = await serverAdmin.rpc('fail_audit_log_export', {
        p_audit_log_ids: rows.map((row) => row.audit_log_id),
        p_lease_token: leaseToken,
        p_error: message.slice(0, 2_000),
    });

    if (failError) {
        console.error('[audit-export] Could not release failed lease:', failError.message);
    }
}

export async function getAuditExportStatus(): Promise<AuditExportStatus | null> {
    const { data, error } = await serverAdmin.rpc('get_audit_export_status');
    if (error) return null;

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;

    return {
        pending_count: Number(row.pending_count || 0),
        retry_count: Number(row.retry_count || 0),
        in_flight_count: Number(row.in_flight_count || 0),
        dead_count: Number(row.dead_count || 0),
        exported_buffer_count: Number(row.exported_buffer_count || 0),
        oldest_pending_at: row.oldest_pending_at || null,
        last_exported_at: row.last_exported_at || null,
    };
}

/**
 * Drains the durable Supabase outbox with at-least-once delivery. A Sentry
 * acknowledgement is recorded only after every envelope receives an HTTP 2xx
 * response. Rows that are pending, retrying, leased, or dead-lettered are never
 * pruned. A network failure after ingestion can produce a retry duplicate; the
 * stable event ID makes that duplicate recognizable in Sentry.
 */
export async function exportAuditLogsToSentry(options: {
    batchSize?: number;
    maxBatches?: number;
    requeueDead?: boolean;
} = {}): Promise<AuditExportResult> {
    if (!isSentryAuditConfigured()) {
        throw new AuditExportConfigurationError(
            'Sentry audit export is not configured. Add SENTRY_DSN before exporting.',
        );
    }
    // Validate the endpoint before leasing anything from Supabase.
    const sentryEndpoint = getSentryEnvelopeEndpoint(getSentryDsn());
    const exportRunId = randomUUID();

    let requeued = 0;
    if (options.requeueDead) {
        const { data, error } = await serverAdmin.rpc('requeue_dead_audit_log_exports', {
            p_batch_size: 500,
        });
        if (error) throw new Error(`Could not requeue failed audit exports: ${error.message}`);
        requeued = Number(data || 0);
    }

    const batchSize = Math.min(500, Math.max(1, options.batchSize
        || boundedInteger(process.env.AUDIT_EXPORT_BATCH_SIZE, DEFAULT_BATCH_SIZE, 1, 500)));
    const maxBatches = Math.min(100, Math.max(1, options.maxBatches
        || boundedInteger(process.env.AUDIT_EXPORT_MAX_BATCHES, DEFAULT_MAX_BATCHES, 1, 100)));
    let claimed = 0;
    let exported = 0;
    let batches = 0;

    for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
        const { data, error } = await serverAdmin.rpc('claim_audit_log_export', {
            p_batch_size: batchSize,
            p_lease_seconds: EXPORT_LEASE_SECONDS,
        });

        if (error) throw new Error(`Could not claim the audit export queue: ${error.message}`);
        const rows = (data || []) as ClaimedAuditLog[];
        if (!rows.length) break;

        claimed += rows.length;
        batches += 1;

        const leaseToken = rows[0].export_lease_token;
        if (!leaseToken || rows.some((row) => row.export_lease_token !== leaseToken)) {
            await markBatchFailed(rows, new Error('Claimed rows did not share one valid lease token'));
            throw new Error('The audit export lease was invalid. No rows were acknowledged.');
        }

        try {
            await sendBatchToSentry(rows, sentryEndpoint, exportRunId);

            const { data: completed, error: completeError } = await serverAdmin.rpc(
                'complete_audit_log_export',
                {
                    p_audit_log_ids: rows.map((row) => row.audit_log_id),
                    p_lease_token: leaseToken,
                },
            );

            if (completeError || Number(completed) !== rows.length) {
                throw new Error(completeError?.message || 'Supabase did not acknowledge the complete export batch');
            }

            exported += rows.length;
        } catch (error) {
            await markBatchFailed(rows, error);
            throw error;
        }

        if (rows.length < batchSize) break;
    }

    let pruned = 0;
    if (isAuditPruningEnabled()) {
        const { data: prunedData, error: pruneError } = await serverAdmin.rpc(
            'prune_exported_audit_logs',
            {
                p_retention_days: getAuditRetentionDays(),
                p_batch_size: 5_000,
            },
        );
        if (pruneError) throw new Error(`Audit export succeeded, but cleanup failed: ${pruneError.message}`);
        pruned = Number(prunedData || 0);
    }

    return {
        claimed,
        exported,
        pruned,
        requeued,
        batches,
        exportRunId,
        status: await getAuditExportStatus(),
    };
}
