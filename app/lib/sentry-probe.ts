import { randomUUID } from 'node:crypto';
import * as Sentry from '@sentry/nextjs';
import { sendRawSentryLogsProbe } from './sentry-audit';
import { scrubSentryText } from './sentry-scrub';

const SDK_FLUSH_TIMEOUT_MS = 10_000;

export interface SentryLogsProbeResult {
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

function safeErrorMessage(error: unknown) {
    return scrubSentryText(error instanceof Error ? error.message : String(error || 'Unknown error'))
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500);
}

export async function runSentryLogsProbe(): Promise<SentryLogsProbeResult> {
    const probeId = randomUUID();
    const result: SentryLogsProbeResult = {
        probeId,
        raw: {
            accepted: false,
            httpStatus: null,
            rateLimitHeaderPresent: false,
            error: null,
            destination: null,
        },
        sdk: {
            initialized: false,
            logsEnabled: false,
            queueDrained: false,
            error: null,
        },
    };

    try {
        const raw = await sendRawSentryLogsProbe(probeId);
        result.raw = {
            accepted: raw.accepted,
            httpStatus: raw.httpStatus,
            rateLimitHeaderPresent: raw.rateLimitHeaderPresent,
            error: null,
            destination: raw.destination,
        };
    } catch (error) {
        result.raw.error = safeErrorMessage(error);
    }

    try {
        const client = Sentry.getClient();
        result.sdk.initialized = Boolean(client);
        result.sdk.logsEnabled = client?.getOptions().enableLogs === true;

        if (result.sdk.initialized && result.sdk.logsEnabled) {
            Sentry.logger.info('PatLau Sentry Logs SDK verification probe', {
                source: 'patlau_sentry_probe',
                probe_id: probeId,
                probe_transport: 'sdk',
            });
            result.sdk.queueDrained = await Sentry.flush(SDK_FLUSH_TIMEOUT_MS);
        }
    } catch (error) {
        result.sdk.error = safeErrorMessage(error);
    }

    return result;
}

export async function emitAuditExportSummary(options: {
    exportRunId: string;
    exported: number;
    batches: number;
}) {
    const client = Sentry.getClient();
    if (!client || client.getOptions().enableLogs !== true) return false;

    Sentry.logger.info('PatLau audit export accepted by Sentry ingestion', {
        source: 'patlau_audit_export_summary',
        audit_export_run_id: options.exportRunId,
        exported_record_count: options.exported,
        export_batch_count: options.batches,
    });

    return Sentry.flush(SDK_FLUSH_TIMEOUT_MS);
}
