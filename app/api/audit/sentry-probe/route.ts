import { NextRequest, NextResponse } from 'next/server';
import { writeAuditEvent } from '../../../lib/audit-server';
import { runSentryLogsProbe } from '../../../lib/sentry-probe';
import { requireRole } from '../../../lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

function jsonNoStore(body: unknown, status = 200) {
    return NextResponse.json(body, {
        status,
        headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    });
}

export async function POST(request: NextRequest) {
    const caller = await requireRole(request, ['superuser']);
    if (!caller) return jsonNoStore({ error: 'Unauthorized' }, 401);

    const result = await runSentryLogsProbe();

    await writeAuditEvent({
        request,
        actor: caller,
        eventKind: 'activity',
        category: 'system',
        eventType: 'audit.sentry_probe.requested',
        action: 'test_sentry_logs',
        outcome: result.sdk.transportAccepted && result.sdk.queueDrained ? 'success' : 'warning',
        summary: `${caller.user.user_metadata?.name || caller.user.email || 'Superuser'} tested Sentry Logs delivery`,
        actorSource: 'audit_viewer',
        targetTable: 'audit_logs',
        targetRecordId: { probe_id: result.probeId },
        targetLabel: 'Sentry Logs',
        metadata: {
            sdk_initialized: result.sdk.initialized,
            sdk_logs_enabled: result.sdk.logsEnabled,
            sdk_queue_drained: result.sdk.queueDrained,
            sdk_transport_accepted: result.sdk.transportAccepted,
            delivery_batch_id: result.sdk.deliveryBatchId,
        },
    });

    return jsonNoStore({
        success: result.sdk.transportAccepted && result.sdk.queueDrained,
        result,
    });
}
