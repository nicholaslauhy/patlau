import { randomUUID } from 'node:crypto';
import * as Sentry from '@sentry/nextjs';
import { scrubSentryText } from './sentry-scrub';
import { sendSentryLogBatch } from './sentry-log-sink';

const SDK_FLUSH_TIMEOUT_MS = 10_000;

export interface SentryLogsProbeResult {
    probeId: string;
    sdk: {
        initialized: boolean;
        logsEnabled: boolean;
        queueDrained: boolean;
        transportAccepted: boolean;
        deliveryBatchId: string | null;
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
        sdk: {
            initialized: false,
            logsEnabled: false,
            queueDrained: false,
            transportAccepted: false,
            deliveryBatchId: null,
            error: null,
        },
    };

    try {
        const client = Sentry.getClient();
        result.sdk.initialized = Boolean(client);
        result.sdk.logsEnabled = client?.getOptions().enableLogs === true;

        if (result.sdk.initialized && result.sdk.logsEnabled) {
            result.sdk.deliveryBatchId = await sendSentryLogBatch([{
                level: 'info',
                body: 'PatLau Sentry Logs SDK verification probe',
                attributes: {
                    source: 'patlau_sentry_probe',
                    probe_id: probeId,
                    probe_transport: 'sdk_tracked',
                    audit_log_id: -1,
                },
            }], SDK_FLUSH_TIMEOUT_MS);
            result.sdk.queueDrained = true;
            result.sdk.transportAccepted = true;
        }
    } catch (error) {
        result.sdk.error = safeErrorMessage(error);
    }

    return result;
}
