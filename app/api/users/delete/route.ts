import { NextRequest, NextResponse } from 'next/server';
import { getOptionalAuditActor, safeAuditError, writeAuditEvent } from '../../../lib/audit-server';
import { getStoredUserRole, serverAdmin } from '../../../lib/server-auth';

export async function POST(request: NextRequest) {
    let caller: Awaited<ReturnType<typeof getOptionalAuditActor>> = null;

    try {
        caller = await getOptionalAuditActor(request);
        if (!caller) {
            await writeAuditEvent({
                request,
                actor: null,
                eventKind: 'security',
                category: 'users',
                eventType: 'user.delete',
                action: 'delete_user',
                outcome: 'denied',
                summary: 'An unauthorized user deletion was denied.',
                actorSource: 'anonymous',
                targetTable: 'auth.users',
            });
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (caller.role !== 'admin' && caller.role !== 'superuser') {
            await writeAuditEvent({
                request,
                actor: caller,
                eventKind: 'security',
                category: 'users',
                eventType: 'user.delete',
                action: 'delete_user',
                outcome: 'denied',
                summary: 'A signed-in user without permission attempted to delete an account.',
                targetTable: 'auth.users',
                metadata: { reason: 'insufficient_role' },
            });
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { userId } = await request.json();

        if (!userId) {
            return NextResponse.json(
                { error: 'User ID is required' },
                { status: 400 }
            );
        }

        if (caller.user.id === userId) {
            await writeAuditEvent({
                request,
                actor: caller,
                eventKind: 'security',
                category: 'users',
                eventType: 'user.delete',
                action: 'delete_user',
                outcome: 'denied',
                summary: 'Denied an attempt to delete the caller\'s own account.',
                targetTable: 'auth.users',
                targetRecordId: { user_id: userId },
                targetLabel: caller.user.user_metadata?.name || caller.user.email || 'Current account',
                metadata: { reason: 'self_deletion' },
            });
            return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 403 });
        }

        const { data: targetData, error: targetError } =
            await serverAdmin.auth.admin.getUserById(userId);
        if (targetError || !targetData.user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        const targetRole = getStoredUserRole(targetData.user);
        const targetLabel = targetData.user.user_metadata?.name || targetData.user.email || 'Unknown account';
        if (caller.role === 'admin' && targetRole !== 'member') {
            await writeAuditEvent({
                request,
                actor: caller,
                eventKind: 'security',
                category: 'users',
                eventType: 'user.delete',
                action: 'delete_user',
                outcome: 'denied',
                summary: `Denied an attempt to delete ${targetLabel}'s ${targetRole} account.`,
                targetTable: 'auth.users',
                targetRecordId: { user_id: userId },
                targetLabel,
                metadata: { reason: 'role_hierarchy_violation', target_role: targetRole },
            });
            return NextResponse.json(
                { error: 'Admins can only delete member accounts' },
                { status: 403 },
            );
        }

        const avatarPath = targetData.user.user_metadata?.avatar_path as string | undefined;

        const { error } = await serverAdmin.auth.admin.deleteUser(userId);

        if (error) {
            await writeAuditEvent({
                request,
                actor: caller,
                category: 'users',
                eventType: 'user.delete',
                action: 'delete_user',
                outcome: 'failure',
                summary: `Failed to delete ${targetLabel}'s account.`,
                targetTable: 'auth.users',
                targetRecordId: { user_id: userId },
                targetLabel,
                oldValues: {
                    name: targetData.user.user_metadata?.name || null,
                    email: targetData.user.email || null,
                    role: targetRole,
                },
                metadata: { reason: 'auth_user_deletion_failed' },
            });
            return NextResponse.json(
                { error: error.message },
                { status: 400 }
            );
        }

        let photoCleanupFailed = false;
        if (avatarPath) {
            const { error: photoError } = await serverAdmin.storage.from('avatars').remove([avatarPath]);
            if (photoError) {
                photoCleanupFailed = true;
                console.warn('Unable to remove deleted user profile photo:', photoError.message);
            }
        }

        await writeAuditEvent({
            request,
            actor: caller,
            category: 'users',
            eventType: 'user.delete',
            action: 'delete_user',
            outcome: photoCleanupFailed ? 'warning' : 'success',
            summary: photoCleanupFailed
                ? `Deleted ${targetLabel}'s account, but its old profile photo could not be removed.`
                : `Deleted ${targetLabel}'s account.`,
            targetTable: 'auth.users',
            targetRecordId: { user_id: userId },
            targetLabel,
            changedFields: ['account'],
            oldValues: {
                name: targetData.user.user_metadata?.name || null,
                email: targetData.user.email || null,
                role: targetRole,
                had_profile_photo: Boolean(avatarPath),
            },
            metadata: { profile_photo_cleanup_failed: photoCleanupFailed },
        });

        return NextResponse.json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error('Delete user error:', safeAuditError(error));
        await writeAuditEvent({
            request,
            actor: caller,
            category: 'users',
            eventType: 'user.delete',
            action: 'delete_user',
            outcome: 'failure',
            summary: 'A user deletion failed unexpectedly.',
            targetTable: 'auth.users',
            metadata: { reason: 'unexpected_error' },
        });
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
