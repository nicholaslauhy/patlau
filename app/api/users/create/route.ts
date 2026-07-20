import { NextRequest, NextResponse } from 'next/server';
import { getOptionalAuditActor, safeAuditError, writeAuditEvent } from '../../../lib/audit-server';
import { serverAdmin, type UserRole } from '../../../lib/server-auth';

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
                eventType: 'user.create',
                action: 'create_user',
                outcome: 'denied',
                summary: 'An unauthorized user creation was denied.',
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
                eventType: 'user.create',
                action: 'create_user',
                outcome: 'denied',
                summary: 'A signed-in user without permission attempted to create an account.',
                targetTable: 'auth.users',
                metadata: { reason: 'insufficient_role' },
            });
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { email, name, role, password } = await request.json();

        if (!email || !name || !role) {
            return NextResponse.json(
                { error: 'Email, name, and role are required' },
                { status: 400 }
            );
        }

        const normalizedEmail = email.toLowerCase().trim();
        const normalizedName = name.trim();
        const requestedRole = role as UserRole;

        if (!VALID_ROLES.includes(requestedRole)) {
            return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
        }

        if (caller.role === 'admin' && requestedRole !== 'member') {
            await writeAuditEvent({
                request,
                actor: caller,
                eventKind: 'security',
                category: 'users',
                eventType: 'user.create',
                action: 'create_user',
                outcome: 'denied',
                summary: `Denied an attempt to create ${normalizedName || normalizedEmail} with the ${requestedRole} role.`,
                targetTable: 'auth.users',
                targetLabel: normalizedName || normalizedEmail,
                newValues: { name: normalizedName, email: normalizedEmail, role: requestedRole },
                metadata: { reason: 'role_hierarchy_violation' },
            });
            return NextResponse.json(
                { error: 'Admins can only create member accounts' },
                { status: 403 },
            );
        }

        // List all users to check for duplicates
        const { data: usersData, error: listErr } = await serverAdmin.auth.admin.listUsers();

        if (listErr || !usersData?.users) {
            console.error('Failed to list users:', listErr);
            return NextResponse.json(
                { error: 'Failed to check for duplicate users' },
                { status: 500 }
            );
        }

        // Check for duplicate email
        const existingEmail = usersData.users.find(
            (u: any) => u.email?.toLowerCase() === normalizedEmail
        );

        if (existingEmail) {
            return NextResponse.json(
                { error: `Email "${normalizedEmail}" is already in use` },
                { status: 409 }
            );
        }

        // Check for duplicate username (stored in user_metadata.name)
        const existingUsername = usersData.users.find(
            (u: any) => u.user_metadata?.name?.toLowerCase() === normalizedName.toLowerCase()
        );

        if (existingUsername) {
            return NextResponse.json(
                { error: `Username "${normalizedName}" is already taken` },
                { status: 409 }
            );
        }

        // Create the user with metadata
        const { data: userData, error: createErr } = await serverAdmin.auth.admin.createUser({
            email: normalizedEmail,
            password: password || undefined,
            app_metadata: {
                role: requestedRole,
            },
            user_metadata: {
                name: normalizedName,
                // Kept in sync temporarily for older deployed clients. All
                // authorization uses protected app_metadata after migration.
                role: requestedRole,
            },
            email_confirm: true,
        });

        if (createErr) {
            console.error('Create user error:', createErr);
            await writeAuditEvent({
                request,
                actor: caller,
                category: 'users',
                eventType: 'user.create',
                action: 'create_user',
                outcome: 'failure',
                summary: `Failed to create account ${normalizedName || normalizedEmail}.`,
                targetTable: 'auth.users',
                targetLabel: normalizedName || normalizedEmail,
                newValues: { name: normalizedName, email: normalizedEmail, role: requestedRole },
                metadata: { reason: 'auth_user_creation_failed' },
            });
            return NextResponse.json(
                { error: createErr.message || 'Failed to create user' },
                { status: 400 }
            );
        }

        // Send reset password email so user can set their own password
        const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL}/reset`;
        const { error: resetErr } = await serverAdmin.auth.resetPasswordForEmail(normalizedEmail, {
            redirectTo,
        });

        if (resetErr) {
            console.error('Reset email error:', resetErr);
            await writeAuditEvent({
                request,
                actor: caller,
                category: 'users',
                eventType: 'user.create',
                action: 'create_user',
                outcome: 'warning',
                summary: `Created ${normalizedName}, but the password setup email could not be sent.`,
                targetTable: 'auth.users',
                targetRecordId: { user_id: userData.user?.id },
                targetLabel: normalizedName,
                changedFields: ['name', 'email', 'role'],
                newValues: { name: normalizedName, email: normalizedEmail, role: requestedRole },
                metadata: { setup_email_sent: false },
            });
            // User was created but email failed — still return success
            return NextResponse.json({
                message: 'User created but password reset email failed to send',
                user: userData.user,
                warning: 'Email delivery issue — user may need to request reset manually',
            });
        }

        await writeAuditEvent({
            request,
            actor: caller,
            category: 'users',
            eventType: 'user.create',
            action: 'create_user',
            outcome: 'success',
            summary: `Created ${normalizedName} with the ${requestedRole} role.`,
            targetTable: 'auth.users',
            targetRecordId: { user_id: userData.user?.id },
            targetLabel: normalizedName,
            changedFields: ['name', 'email', 'role'],
            newValues: { name: normalizedName, email: normalizedEmail, role: requestedRole },
            metadata: { setup_email_sent: true },
        });

        return NextResponse.json({
            message: 'User created successfully',
            user: userData.user,
        });
    } catch (error) {
        console.error('Create user route error:', safeAuditError(error));
        await writeAuditEvent({
            request,
            actor: caller,
            category: 'users',
            eventType: 'user.create',
            action: 'create_user',
            outcome: 'failure',
            summary: 'A user creation failed unexpectedly.',
            targetTable: 'auth.users',
            metadata: { reason: 'unexpected_error' },
        });
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}
