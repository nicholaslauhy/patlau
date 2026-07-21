import { randomUUID } from 'node:crypto';
import { serverAdmin } from './server-auth';
import { auditDisplaySummary, auditDisplayTargetLabel } from './audit-display';
import { scrubSentryLog, scrubSentryValue } from './sentry-scrub';
import {
    requireSentryLogsClient,
    sendSentryLogBatch,
    type SentryAuditLogRecord,
} from './sentry-log-sink';

const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_MAX_BATCHES = 20;
const DEFAULT_RETENTION_DAYS = 7;
const EXPORT_LEASE_SECONDS = 300;
const MAX_JSON_ATTRIBUTE_LENGTH = 16_000;

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
    display_summary?: string | null;
    actor_user_id: string | null;
    actor_email: string | null;
    actor_name: string | null;
    actor_role: string | null;
    actor_source: string;
    target_table: string | null;
    target_record_id: Record<string, unknown> | null;
    target_label: string | null;
    display_target_label?: string | null;
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
        target_label: auditDisplayTargetLabel(row),
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

function auditLogRecord(
    row: ClaimedAuditLog,
    exportRunId: string,
): SentryAuditLogRecord {
    const level = row.outcome === 'failure'
        ? 'error'
        : row.outcome === 'denied' || row.outcome === 'warning'
            ? 'warn'
            : 'info' as const;
    const scrubbedLog = scrubSentryLog({
        body: auditDisplaySummary(row).slice(0, 4_000),
        attributes: {
            ...compactAttributes(row, exportRunId),
            audit_export_transport: 'sentry_nextjs_sdk',
            audit_export_protocol: 2,
        },
    });

    return {
        level,
        body: typeof scrubbedLog.body === 'string' ? scrubbedLog.body : 'Audit event',
        attributes: Object.fromEntries(
            Object.entries(scrubbedLog.attributes || {})
                .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value)),
        ) as Record<string, string | number | boolean>,
    };
}

async function sendBatchToSentry(
    rows: ClaimedAuditLog[],
    exportRunId: string,
) {
    // The claim RPC deliberately keeps its stable shape. Hydrate presentation
    // columns separately when the human-readable logging migration is present,
    // and safely fall back while website/database deployments overlap.
    const { data: presentations, error } = await serverAdmin
        .from('audit_logs')
        .select('id, display_summary, display_target_label')
        .in('id', rows.map((row) => row.audit_log_id));
    const presentationColumnsAreNotDeployed = Boolean(error) && (
        error?.code === 'PGRST204'
        || error?.code === '42703'
    ) && /display_(summary|target_label)/i.test(error?.message || '');

    if (error && !presentationColumnsAreNotDeployed) {
        throw new Error(`Could not load audit presentation snapshots: ${error.message}`);
    }

    const presentationById = error
        ? new Map<number, { display_summary?: string | null; display_target_label?: string | null }>()
        : new Map((presentations || []).map((entry) => [Number(entry.id), entry]));
    const presentedRows = rows.map((row) => ({
        ...row,
        ...presentationById.get(row.audit_log_id),
    }));

    await sendSentryLogBatch(presentedRows.map((row) => auditLogRecord(row, exportRunId)));
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
    // Validate the supported SDK path before leasing anything from Supabase.
    try {
        requireSentryLogsClient();
    } catch (error) {
        throw new AuditExportConfigurationError(
            error instanceof Error ? error.message : 'The Sentry server SDK is unavailable.',
        );
    }
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
            await sendBatchToSentry(rows, exportRunId);

            const { data: completed, error: completeError } = await serverAdmin.rpc(
                'complete_audit_log_export_v2',
                {
                    p_audit_log_ids: rows.map((row) => row.audit_log_id),
                    p_lease_token: leaseToken,
                },
            );

            if (completeError || Number(completed) !== rows.length) {
                throw new Error(
                    completeError?.message
                    || 'Supabase did not acknowledge the official-SDK export batch',
                );
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
