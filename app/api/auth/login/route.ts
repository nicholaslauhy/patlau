import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { auditRateLimitExceeded, safeAuditError, writeAuditEvent } from '../../../lib/audit-server';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: NextRequest) {
    let attemptedIdentifier = '';

    try {
        const addressLimited = await auditRateLimitExceeded({
            request,
            eventType: 'authentication.login',
            limit: 60,
            windowMs: 10 * 60_000,
        });
        if (addressLimited) {
            await writeAuditEvent({
                request,
                eventKind: 'security',
                category: 'authentication',
                eventType: 'authentication.login.rate_limited',
                action: 'login',
                outcome: 'denied',
                summary: 'A sign-in attempt was rate-limited',
                actorSource: 'anonymous',
                targetTable: 'auth.users',
                metadata: { scope: 'ip' },
            });
            return NextResponse.json(
                { error: 'Too many sign-in attempts. Please wait before trying again.' },
                { status: 429, headers: { 'Retry-After': '600' } },
            );
        }

        const body = await request.json();
        const { emailOrUsername, password } = body;
        attemptedIdentifier = String(emailOrUsername || '').trim().slice(0, 254);

        if (!emailOrUsername || !password) {
            await writeAuditEvent({
                request,
                eventKind: 'security',
                category: 'authentication',
                eventType: 'authentication.login',
                action: 'login',
                outcome: 'denied',
                summary: 'Sign-in was denied because credentials were incomplete',
                actorSource: 'anonymous',
                targetTable: 'auth.users',
                targetLabel: attemptedIdentifier || null,
                metadata: { reason: 'missing_credentials' },
            });
            return NextResponse.json({ error: 'Email/username and password are required' }, { status: 400 });
        }

        const identifierLimited = await auditRateLimitExceeded({
            request,
            eventType: 'authentication.login',
            targetLabel: attemptedIdentifier.toLowerCase(),
            limit: 12,
            windowMs: 10 * 60_000,
        });
        if (identifierLimited) {
            await writeAuditEvent({
                request,
                eventKind: 'security',
                category: 'authentication',
                eventType: 'authentication.login.rate_limited',
                action: 'login',
                outcome: 'denied',
                summary: 'A sign-in attempt was rate-limited',
                actorSource: 'anonymous',
                targetTable: 'auth.users',
                targetLabel: attemptedIdentifier.toLowerCase(),
                metadata: { scope: 'account' },
            });
            return NextResponse.json(
                { error: 'Too many sign-in attempts. Please wait before trying again.' },
                { status: 429, headers: { 'Retry-After': '600' } },
            );
        }

        let loginEmail = attemptedIdentifier;
        if (!emailOrUsername.includes('@')) {
            const listRes = await supabaseAdmin.auth.admin.listUsers();

            if (listRes.error || !listRes.data?.users) {
                await writeAuditEvent({
                    request,
                    eventKind: 'security',
                    category: 'authentication',
                    eventType: 'authentication.login',
                    action: 'login',
                    outcome: 'failure',
                    summary: 'Sign-in could not complete because the account lookup failed',
                    actorSource: 'anonymous',
                    targetTable: 'auth.users',
                    targetLabel: attemptedIdentifier,
                    metadata: { reason: 'account_lookup_failed' },
                });
                return NextResponse.json({ error: 'User not found' }, { status: 404 });
            }

            const user = listRes.data.users.find((u: any) =>
                u.user_metadata?.username === emailOrUsername || u.user_metadata?.name === emailOrUsername
            );

            if (!user || !user.email) {
                await writeAuditEvent({
                    request,
                    eventKind: 'security',
                    category: 'authentication',
                    eventType: 'authentication.login',
                    action: 'login',
                    outcome: 'denied',
                    summary: 'Sign-in was denied for an unknown account',
                    actorSource: 'anonymous',
                    targetTable: 'auth.users',
                    targetLabel: attemptedIdentifier,
                    metadata: { reason: 'account_not_found' },
                });
                return NextResponse.json({ error: 'User not found' }, { status: 404 });
            }
            loginEmail = user.email;
        }

        const signInRes = await supabaseClient.auth.signInWithPassword({
            email: loginEmail,
            password,
        });

        if (signInRes.error) {
            await writeAuditEvent({
                request,
                eventKind: 'security',
                category: 'authentication',
                eventType: 'authentication.login',
                action: 'login',
                outcome: 'denied',
                summary: 'Sign-in was denied',
                actorSource: 'anonymous',
                targetTable: 'auth.users',
                targetLabel: attemptedIdentifier || loginEmail,
                metadata: { reason: safeAuditError(signInRes.error) },
            });
            return NextResponse.json({ error: signInRes.error.message || 'Login failed' }, { status: 401 });
        }

        const authenticatedUser = signInRes.data?.user;
        if (authenticatedUser) {
            await writeAuditEvent({
                request,
                actor: { user: authenticatedUser },
                eventKind: 'security',
                category: 'authentication',
                eventType: 'authentication.login',
                action: 'login',
                outcome: 'success',
                summary: `${authenticatedUser.user_metadata?.name || authenticatedUser.email || 'User'} signed in`,
                actorSource: 'authenticated',
                targetTable: 'auth.users',
                targetRecordId: { id: authenticatedUser.id },
                targetLabel: authenticatedUser.email || loginEmail,
            });
        }

        return NextResponse.json({
            message: 'Login successful',
            session: signInRes.data?.session ?? null,
            user: signInRes.data?.user ?? null,
        });
    } catch (err: any) {
        const auditError = safeAuditError(err);
        console.error('[auth/login] unexpected error:', auditError);
        await writeAuditEvent({
            request,
            eventKind: 'security',
            category: 'authentication',
            eventType: 'authentication.login',
            action: 'login',
            outcome: 'failure',
            summary: 'Sign-in failed unexpectedly',
            actorSource: 'anonymous',
            targetTable: 'auth.users',
            targetLabel: attemptedIdentifier || null,
            metadata: { error: auditError },
        });
        return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 });
    }
}
