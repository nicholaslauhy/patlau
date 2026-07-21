import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import {
    AuditExportConfigurationError,
    exportAuditLogsToSentry,
} from '../../../lib/sentry-audit';
import { writeAuditEvent } from '../../../lib/audit-server';
import { emitAuditExportSummary } from '../../../lib/sentry-probe';
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

    await writeAuditEvent({
        request,
        actor: caller,
        eventKind: 'activity',
        category: 'system',
        eventType: 'audit.export.requested',
        action: 'export_audit_logs',
        outcome: 'accepted',
        summary: `${caller.user.user_metadata?.name || caller.user.email || 'Superuser'} requested an audit export to Sentry`,
        actorSource: 'audit_viewer',
        targetTable: 'audit_logs',
        targetLabel: 'Sentry',
    });

    try {
        // A deliberate superuser export also retries any terminal failures.
        // Scheduled runs leave dead letters untouched so repeated failures stay
        // visible until an operator chooses to retry them.
        const result = await exportAuditLogsToSentry({ requeueDead: true });
        let sdkSummaryQueueDrained = false;
        try {
            sdkSummaryQueueDrained = await emitAuditExportSummary({
                exportRunId: result.exportRunId,
                exported: result.exported,
                batches: result.batches,
            });
        } catch (summaryError) {
            console.warn(
                '[audit-export] Raw export succeeded, but the SDK summary log did not flush:',
                summaryError instanceof Error ? summaryError.message : 'Unknown SDK logging error',
            );
        }

        return jsonNoStore({
            success: true,
            result: { ...result, sdkSummaryQueueDrained },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Audit export failed.';
        console.error('[audit-export] Manual export failed:', message);
        Sentry.captureException(error, {
            tags: { subsystem: 'audit-export', trigger: 'manual' },
        });
        return jsonNoStore(
            { error: message },
            error instanceof AuditExportConfigurationError ? 503 : 500,
        );
    }
}
