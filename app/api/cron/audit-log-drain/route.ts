import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import {
    AuditExportConfigurationError,
    exportAuditLogsToSentry,
} from '../../../lib/sentry-audit';

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

export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
        return jsonNoStore({ error: 'Scheduled audit export is not configured.' }, 503);
    }
    if (request.headers.get('authorization') !== `Bearer ${secret}`) {
        return jsonNoStore({ error: 'Unauthorized' }, 401);
    }

    try {
        const result = await exportAuditLogsToSentry();
        return jsonNoStore({ success: true, result });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Audit export failed.';
        console.error('[audit-export] Scheduled export failed:', message);
        Sentry.captureException(error, {
            tags: { subsystem: 'audit-export', trigger: 'scheduled' },
        });
        return jsonNoStore(
            { error: message },
            error instanceof AuditExportConfigurationError ? 503 : 500,
        );
    }
}
