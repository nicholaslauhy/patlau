import * as SentryNamespace from '@sentry/nextjs';
import { randomUUID } from 'node:crypto';
import {
    cancelAuditDeliveryBatch,
    confirmAuditDeliveryBatch,
    isAuditTrackingTransportInstalled,
    registerAuditDeliveryBatch,
} from './sentry-audit-transport';

type SentryModule = typeof SentryNamespace;

// Node's native ESM loader exposes @sentry/nextjs through `default`, while the
// Next.js bundler exposes named exports. Normalising the module keeps this sink
// testable with the same SDK implementation used in production.
const Sentry = ((SentryNamespace as unknown as { default?: SentryModule }).default
    || SentryNamespace) as SentryModule;

export type SentryAuditLogLevel = 'info' | 'warn' | 'error';

export interface SentryAuditLogRecord {
    level: SentryAuditLogLevel;
    body: string;
    attributes: Record<string, string | number | boolean>;
}

const DEFAULT_FLUSH_TIMEOUT_MS = 10_000;

export function requireSentryLogsClient() {
    const client = Sentry.getClient();
    if (!client) {
        throw new Error('The Sentry server SDK is not initialized. No audit rows were claimed.');
    }
    if (client.getOptions().enableLogs !== true) {
        throw new Error('Sentry Logs are not enabled on the server SDK. No audit rows were claimed.');
    }
    if (!isAuditTrackingTransportInstalled()) {
        throw new Error('The Sentry audit-aware server transport is not installed. No audit rows were claimed.');
    }
    return client;
}

/**
 * Emits audit records through Sentry's supported logger. A batch is considered
 * delivered only after the SDK has drained its local transport queue.
 */
export async function sendSentryLogBatch(
    logs: SentryAuditLogRecord[],
    flushTimeoutMs = DEFAULT_FLUSH_TIMEOUT_MS,
) {
    requireSentryLogsClient();
    const auditLogIds = logs.map((log) => log.attributes.audit_log_id);
    if (auditLogIds.some((value) => typeof value !== 'number')) {
        throw new Error('Every exported audit record must contain a numeric audit_log_id');
    }
    const deliveryBatchId = randomUUID();
    registerAuditDeliveryBatch(deliveryBatchId, auditLogIds as number[]);

    try {
        for (const log of logs) {
            const attributes = {
                ...log.attributes,
                audit_delivery_batch_id: deliveryBatchId,
            };
            if (log.level === 'error') {
                Sentry.logger.error(log.body, attributes);
            } else if (log.level === 'warn') {
                Sentry.logger.warn(log.body, attributes);
            } else {
                Sentry.logger.info(log.body, attributes);
            }
        }

        if (!await Sentry.flush(flushTimeoutMs)) {
            throw new Error('Sentry did not drain its Logs queue before the audit export timeout');
        }
        await confirmAuditDeliveryBatch(deliveryBatchId, flushTimeoutMs);
        return deliveryBatchId;
    } catch (error) {
        cancelAuditDeliveryBatch(deliveryBatchId);
        throw error;
    }
}
