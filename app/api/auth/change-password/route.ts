import { NextResponse } from 'next/server';
import { safeAuditError, writeAuditEvent } from '../../../lib/audit-server';
import { getAuthenticatedUser, getStoredUserRole, serverAdmin } from '../../../lib/server-auth';

function jsonNoStore(body: unknown, status = 200) {
    return NextResponse.json(body, {
        status,
        headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    });
}

export async function POST(request: Request) {
    const user = await getAuthenticatedUser(request);
    if (!user) return jsonNoStore({ error: 'Unauthorized' }, 401);

    const actor = { user, role: getStoredUserRole(user) };
    const body = await request.json().catch(() => ({}));
    const password = typeof body.password === 'string' ? body.password : '';

    if (password.length < 6 || password.length > 128) {
        await writeAuditEvent({
            request,
            actor,
            eventKind: 'security',
            category: 'authentication',
            eventType: 'authentication.password_change_denied',
            action: 'change_password',
            outcome: 'denied',
            summary: 'A password change was denied because the new password was invalid',
            actorSource: 'authenticated_api',
            targetTable: 'auth.users',
            targetRecordId: { id: user.id },
            targetLabel: user.email || null,
            metadata: { reason: 'password_policy' },
        });
        return jsonNoStore({ error: 'Password must contain between 6 and 128 characters.' }, 400);
    }

    try {
        const { error } = await serverAdmin.auth.admin.updateUserById(user.id, { password });
        if (error) {
            await writeAuditEvent({
                request,
                actor,
                eventKind: 'security',
                category: 'authentication',
                eventType: 'authentication.password_change_failed',
                action: 'change_password',
                outcome: 'failure',
                summary: 'An authenticated password change failed',
                actorSource: 'authenticated_api',
                targetTable: 'auth.users',
                targetRecordId: { id: user.id },
                targetLabel: user.email || null,
                metadata: { error: safeAuditError(error) },
            });
            return jsonNoStore({ error: error.message || 'Failed to update password.' }, 400);
        }

        await writeAuditEvent({
            request,
            actor,
            eventKind: 'security',
            category: 'authentication',
            eventType: 'authentication.password_changed',
            action: 'change_password',
            outcome: 'success',
            summary: `${user.user_metadata?.name || user.email || 'User'} changed their password`,
            actorSource: 'authenticated_api',
            targetTable: 'auth.users',
            targetRecordId: { id: user.id },
            targetLabel: user.email || null,
        });

        return jsonNoStore({ message: 'Password updated.' });
    } catch (error) {
        await writeAuditEvent({
            request,
            actor,
            eventKind: 'security',
            category: 'authentication',
            eventType: 'authentication.password_change_failed',
            action: 'change_password',
            outcome: 'failure',
            summary: 'An authenticated password change failed unexpectedly',
            actorSource: 'authenticated_api',
            targetTable: 'auth.users',
            targetRecordId: { id: user.id },
            targetLabel: user.email || null,
            metadata: { error: safeAuditError(error) },
        });
        return jsonNoStore({ error: 'Failed to update password.' }, 500);
    }
}
