const REGISTRY_SYMBOL = Symbol.for('patlau.sentry.audit.delivery.v1');

interface TransportResponse {
    statusCode?: number;
}

interface AuditTransport<TEnvelope, TResponse extends TransportResponse> {
    send(envelope: TEnvelope): PromiseLike<TResponse>;
    flush(timeout?: number): PromiseLike<boolean>;
}

interface DeliveryTracker {
    expectedIds: Set<number>;
    observedIds: Set<number>;
    pendingSends: number;
    failure: Error | null;
    waiters: Set<() => void>;
}

interface DeliveryRegistry {
    installed: boolean;
    batches: Map<string, DeliveryTracker>;
}

function registry() {
    const globalRegistry = globalThis as typeof globalThis & {
        [REGISTRY_SYMBOL]?: DeliveryRegistry;
    };
    if (!globalRegistry[REGISTRY_SYMBOL]) {
        globalRegistry[REGISTRY_SYMBOL] = {
            installed: false,
            batches: new Map(),
        };
    }
    return globalRegistry[REGISTRY_SYMBOL];
}

function wakeTracker(tracker: DeliveryTracker) {
    for (const resolve of tracker.waiters) resolve();
    tracker.waiters.clear();
}

function failTracker(tracker: DeliveryTracker, error: unknown) {
    if (!tracker.failure) {
        tracker.failure = error instanceof Error ? error : new Error(String(error || 'Sentry transport failed'));
    }
    wakeTracker(tracker);
}

function typedAttributeValue(attributes: unknown, key: string) {
    if (!attributes || typeof attributes !== 'object') return undefined;
    const attribute = (attributes as Record<string, unknown>)[key];
    if (attribute && typeof attribute === 'object' && 'value' in attribute) {
        return (attribute as { value?: unknown }).value;
    }
    return attribute;
}

function trackedRowsInEnvelope(envelope: unknown) {
    const tracked = new Map<string, Set<number>>();
    const envelopeParts = Array.isArray(envelope) ? envelope : [];
    const items = Array.isArray(envelopeParts[1]) ? envelopeParts[1] : [];

    for (const item of items) {
        if (item?.[0]?.type !== 'log') continue;
        const logs = (item?.[1] as { items?: unknown[] } | undefined)?.items;
        if (!Array.isArray(logs)) continue;

        for (const log of logs) {
            if (!log || typeof log !== 'object') continue;
            const attributes = (log as { attributes?: unknown }).attributes;
            const batchId = typedAttributeValue(attributes, 'audit_delivery_batch_id');
            const auditLogId = typedAttributeValue(attributes, 'audit_log_id');
            if (typeof batchId !== 'string' || typeof auditLogId !== 'number') continue;

            if (!tracked.has(batchId)) tracked.set(batchId, new Set());
            tracked.get(batchId)?.add(auditLogId);
        }
    }

    return tracked;
}

function explicitSuccess(response: TransportResponse) {
    return typeof response.statusCode === 'number'
        && response.statusCode >= 200
        && response.statusCode < 300;
}

/**
 * Wraps Sentry's supported Node transport without altering envelopes. It only
 * observes marked audit rows so the durable Supabase outbox can require an
 * explicit transport acknowledgement before completing a lease.
 */
export function createAuditTrackingTransport<TEnvelope, TResponse extends TransportResponse>(
    baseTransport: AuditTransport<TEnvelope, TResponse>,
): AuditTransport<TEnvelope, TResponse> {
    registry().installed = true;

    return {
        send(envelope) {
            const tracked = trackedRowsInEnvelope(envelope);
            const active = new Map<string, { tracker: DeliveryTracker; ids: Set<number> }>();

            for (const [batchId, ids] of tracked) {
                const tracker = registry().batches.get(batchId);
                if (!tracker) continue;
                tracker.pendingSends += 1;
                active.set(batchId, { tracker, ids });
            }

            let request: PromiseLike<TResponse>;
            try {
                request = baseTransport.send(envelope);
            } catch (error) {
                for (const { tracker } of active.values()) {
                    tracker.pendingSends = Math.max(0, tracker.pendingSends - 1);
                    failTracker(tracker, error);
                }
                throw error;
            }

            return Promise.resolve(request).then(
                (response) => {
                    for (const { tracker, ids } of active.values()) {
                        tracker.pendingSends = Math.max(0, tracker.pendingSends - 1);
                        if (!explicitSuccess(response)) {
                            failTracker(
                                tracker,
                                new Error(
                                    typeof response.statusCode === 'number'
                                        ? `Sentry rejected the audit log envelope with HTTP ${response.statusCode}`
                                        : 'Sentry did not return an explicit HTTP status for the audit log envelope',
                                ),
                            );
                            continue;
                        }
                        for (const id of ids) {
                            if (tracker.expectedIds.has(id)) tracker.observedIds.add(id);
                        }
                        wakeTracker(tracker);
                    }
                    return response;
                },
                (error) => {
                    for (const { tracker } of active.values()) {
                        tracker.pendingSends = Math.max(0, tracker.pendingSends - 1);
                        failTracker(tracker, error);
                    }
                    throw error;
                },
            );
        },
        flush(timeout) {
            return baseTransport.flush(timeout);
        },
    };
}

export function isAuditTrackingTransportInstalled() {
    return registry().installed;
}

export function registerAuditDeliveryBatch(batchId: string, auditLogIds: number[]) {
    if (!isAuditTrackingTransportInstalled()) {
        throw new Error('The Sentry audit-aware server transport is not installed');
    }
    if (!batchId || auditLogIds.length === 0 || new Set(auditLogIds).size !== auditLogIds.length) {
        throw new Error('Audit delivery tracking requires one non-empty batch of unique row IDs');
    }
    if (registry().batches.has(batchId)) {
        throw new Error('The audit delivery batch ID is already active');
    }

    registry().batches.set(batchId, {
        expectedIds: new Set(auditLogIds),
        observedIds: new Set(),
        pendingSends: 0,
        failure: null,
        waiters: new Set(),
    });
}

export function cancelAuditDeliveryBatch(batchId: string) {
    registry().batches.delete(batchId);
}

function waitForTrackerChange(tracker: DeliveryTracker, timeoutMs: number) {
    return new Promise<void>((resolve, reject) => {
        const onChange = () => {
            clearTimeout(timer);
            resolve();
        };
        const timer = setTimeout(() => {
            tracker.waiters.delete(onChange);
            reject(new Error('Timed out while waiting for Sentry to acknowledge the audit log envelope'));
        }, timeoutMs);
        tracker.waiters.add(onChange);
    });
}

export async function confirmAuditDeliveryBatch(batchId: string, timeoutMs = 10_000) {
    const tracker = registry().batches.get(batchId);
    if (!tracker) throw new Error('The audit delivery tracker was unavailable');
    const deadline = Date.now() + timeoutMs;

    try {
        while (tracker.pendingSends > 0 && !tracker.failure) {
            const remaining = deadline - Date.now();
            if (remaining <= 0) throw new Error('Timed out while confirming Sentry audit delivery');
            await waitForTrackerChange(tracker, remaining);
        }

        if (tracker.failure) throw tracker.failure;
        const missingIds = [...tracker.expectedIds].filter((id) => !tracker.observedIds.has(id));
        if (missingIds.length > 0) {
            throw new Error(
                `Sentry did not acknowledge ${missingIds.length} audit ${missingIds.length === 1 ? 'row' : 'rows'}`,
            );
        }
    } finally {
        registry().batches.delete(batchId);
    }
}
