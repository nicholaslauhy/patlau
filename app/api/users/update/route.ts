import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { getOptionalAuditActor, safeAuditError, writeAuditEvent } from '../../../lib/audit-server';
import { getStoredUserRole } from '../../../lib/server-auth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

type UserRole = 'member' | 'admin' | 'superuser';

const VALID_ROLES: UserRole[] = ['member', 'admin', 'superuser'];

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
                eventType: 'user.role_change',
                action: 'change_user_role',
                outcome: 'denied',
                summary: 'An unauthorized user role change was denied.',
                actorSource: 'anonymous',
                targetTable: 'auth.users',
            });
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        if (caller.role !== 'superuser') {
            await writeAuditEvent({
                request,
                actor: caller,
                eventKind: 'security',
                category: 'users',
                eventType: 'user.role_change',
                action: 'change_user_role',
                outcome: 'denied',
                summary: 'A signed-in user without permission attempted to change an account role.',
                targetTable: 'auth.users',
                metadata: { reason: 'insufficient_role' },
            });
            return NextResponse.json(
                { error: 'Forbidden' },
                { status: 403 }
            );
        }

        const { userId, role } = await request.json();

        if (!userId || !role) {
            return NextResponse.json(
                { error: 'userId and role are required' },
                { status: 400 }
            );
        }

        if (!VALID_ROLES.includes(role as UserRole)) {
            return NextResponse.json(
                { error: 'Invalid role' },
                { status: 400 }
            );
        }

        // Important: prevent self-demotion / self-role-change
        if (caller.user.id === userId) {
            await writeAuditEvent({
                request,
                actor: caller,
                eventKind: 'security',
                category: 'users',
                eventType: 'user.role_change',
                action: 'change_user_role',
                outcome: 'denied',
                summary: 'Denied an attempt to change the caller\'s own role.',
                targetTable: 'auth.users',
                targetRecordId: { user_id: userId },
                targetLabel: caller.user.user_metadata?.name || caller.user.email || userId,
                newValues: { role },
                metadata: { reason: 'self_role_change' },
            });
            return NextResponse.json(
                { error: 'You cannot change your own role.' },
                { status: 403 }
            );
        }

        // Get target user first so we preserve existing metadata like name
        const { data: targetData, error: targetError } =
            await supabaseAdmin.auth.admin.getUserById(userId);

        if (targetError || !targetData.user) {
            return NextResponse.json(
                { error: 'Target user not found' },
                { status: 404 }
            );
        }

        const existingMetadata = targetData.user.user_metadata || {};
        const existingAppMetadata = targetData.user.app_metadata || {};
        const previousRole = getStoredUserRole(targetData.user);
        const targetLabel = targetData.user.user_metadata?.name || targetData.user.email || userId;

        const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
            app_metadata: {
                ...existingAppMetadata,
                role,
            },
            user_metadata: {
                ...existingMetadata,
                role
            }
        });

        if (error) {
            console.error('Update user role error:', error);
            await writeAuditEvent({
                request,
                actor: caller,
                category: 'users',
                eventType: 'user.role_change',
                action: 'change_user_role',
                outcome: 'failure',
                summary: `Failed to change ${targetLabel}'s role.`,
                targetTable: 'auth.users',
                targetRecordId: { user_id: userId },
                targetLabel,
                oldValues: { role: previousRole },
                newValues: { role },
                metadata: { reason: 'auth_user_update_failed' },
            });
            return NextResponse.json(
                { error: 'Failed to update user role' },
                { status: 400 }
            );
        }

        await writeAuditEvent({
            request,
            actor: caller,
            eventKind: 'security',
            category: 'users',
            eventType: 'user.role_change',
            action: 'change_user_role',
            outcome: 'success',
            summary: `Changed ${targetLabel}'s role from ${previousRole} to ${role}.`,
            targetTable: 'auth.users',
            targetRecordId: { user_id: userId },
            targetLabel,
            changedFields: ['role'],
            oldValues: { role: previousRole },
            newValues: { role },
        });

        return NextResponse.json({
            message: 'User role updated successfully',
            user: data.user
        });
    } catch (error) {
        console.error('Update user route error:', safeAuditError(error));
        await writeAuditEvent({
            request,
            actor: caller,
            category: 'users',
            eventType: 'user.role_change',
            action: 'change_user_role',
            outcome: 'failure',
            summary: 'A user role change failed unexpectedly.',
            targetTable: 'auth.users',
            metadata: { reason: 'unexpected_error' },
        });
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
