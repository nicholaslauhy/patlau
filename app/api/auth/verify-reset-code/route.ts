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
    let normalizedEmail = '';

    try {
        const addressLimited = await auditRateLimitExceeded({
            request,
            eventType: 'authentication.reset_code_verified',
            limit: 40,
            windowMs: 15 * 60_000,
        });
        if (addressLimited) {
            await writeAuditEvent({
                request,
                eventKind: 'security',
                category: 'authentication',
                eventType: 'authentication.reset_code_verified.rate_limited',
                action: 'verify_reset_code',
                outcome: 'denied',
                summary: 'Reset-code verification was rate-limited',
                actorSource: 'anonymous',
                targetTable: 'auth.users',
                metadata: { scope: 'ip' },
            });
            return NextResponse.json(
                { error: 'Too many verification attempts. Please wait before trying again.' },
                { status: 429, headers: { 'Retry-After': '900' } },
            );
        }

        const { email, code } = await request.json();
        normalizedEmail = String(email || '').trim().toLowerCase().slice(0, 254);

        if (!normalizedEmail || !code) {
            await writeAuditEvent({
                request,
                eventKind: 'security',
                category: 'authentication',
                eventType: 'authentication.reset_code_verified',
                action: 'verify_reset_code',
                outcome: 'denied',
                summary: 'Reset-code verification was denied because required information was missing',
                actorSource: 'anonymous',
                targetTable: 'auth.users',
                targetLabel: normalizedEmail || null,
                metadata: { reason: 'missing_verification_input' },
            });
            return NextResponse.json(
                { error: 'Email and code required' },
                { status: 400 }
            );
        }

        const emailLimited = await auditRateLimitExceeded({
            request,
            eventType: 'authentication.reset_code_verified',
            targetLabel: normalizedEmail,
            limit: 8,
            windowMs: 15 * 60_000,
        });
        if (emailLimited) {
            await writeAuditEvent({
                request,
                eventKind: 'security',
                category: 'authentication',
                eventType: 'authentication.reset_code_verified.rate_limited',
                action: 'verify_reset_code',
                outcome: 'denied',
                summary: 'Reset-code verification was rate-limited',
                actorSource: 'anonymous',
                targetTable: 'auth.users',
                targetLabel: normalizedEmail,
                metadata: { scope: 'account' },
            });
            return NextResponse.json(
                { error: 'Too many verification attempts. Please wait before trying again.' },
                { status: 429, headers: { 'Retry-After': '900' } },
            );
        }

        const nowIso = new Date().toISOString();

        // Look up only valid, unused, non-expired code
        const { data: resetData, error: lookupErr } = await supabaseAdmin
            .from('reset_codes')
            .select('*')
            .eq('email', normalizedEmail)
            .eq('code', code)
            .eq('used', false)
            .gt('expires_at', nowIso)
            .single();

        if (lookupErr || !resetData) {
            await writeAuditEvent({
                request,
                eventKind: 'security',
                category: 'authentication',
                eventType: 'authentication.reset_code_verified',
                action: 'verify_reset_code',
                outcome: 'denied',
                summary: 'Reset-code verification was denied',
                actorSource: 'anonymous',
                targetTable: 'auth.users',
                targetLabel: normalizedEmail,
                metadata: { reason: 'invalid_or_expired' },
            });

            return NextResponse.json(
                { error: 'Invalid or expired code' },
                { status: 401 }
            );
        }

        // Mark code as used
        const { error: updateCodeErr } = await supabaseAdmin
            .from('reset_codes')
            .update({ used: true })
            .eq('id', resetData.id);

        if (updateCodeErr) {
            const auditError = safeAuditError(updateCodeErr.message);
            console.error('Failed to mark reset verification as used:', auditError);
            await writeAuditEvent({
                request,
                eventKind: 'security',
                category: 'authentication',
                eventType: 'authentication.reset_code_verified',
                action: 'verify_reset_code',
                outcome: 'failure',
                summary: 'Verified reset request could not be consumed',
                actorSource: 'anonymous',
                targetTable: 'auth.users',
                targetLabel: normalizedEmail,
                metadata: { error: auditError },
            });
            return NextResponse.json(
                { error: 'Failed to verify code' },
                { status: 500 }
            );
        }

        // Get user by email
        const { data: users, error: listErr } = await supabaseAdmin.auth.admin.listUsers();

        if (listErr || !users?.users) {
            const auditError = safeAuditError(listErr?.message || 'User lookup failed');
            console.error('Reset user lookup failed:', auditError);
            await writeAuditEvent({
                request,
                eventKind: 'security',
                category: 'authentication',
                eventType: 'authentication.reset_code_verified',
                action: 'verify_reset_code',
                outcome: 'failure',
                summary: 'Reset-code verification could not complete the account lookup',
                actorSource: 'anonymous',
                targetTable: 'auth.users',
                targetLabel: normalizedEmail,
                metadata: { error: auditError },
            });
            return NextResponse.json(
                { error: 'User lookup failed' },
                { status: 500 }
            );
        }

        const user = users.users.find((u: { email?: string }) =>
            u.email?.toLowerCase() === normalizedEmail
        );

        if (!user) {
            await writeAuditEvent({
                request,
                eventKind: 'security',
                category: 'authentication',
                eventType: 'authentication.reset_code_verified',
                action: 'verify_reset_code',
                outcome: 'failure',
                summary: 'Reset-code verification matched no account',
                actorSource: 'anonymous',
                targetTable: 'auth.users',
                targetLabel: normalizedEmail,
                metadata: { reason: 'account_not_found' },
            });
            return NextResponse.json(
                { error: 'User not found' },
                { status: 404 }
            );
        }

        // Generate magic link token
        const { data: sessionData, error: sessionErr } =
            await supabaseAdmin.auth.admin.generateLink({
                type: 'magiclink',
                email: normalizedEmail,
                options: {
                    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/reset?verified=true`,
                },
            });

        if (sessionErr || !sessionData?.properties?.hashed_token) {
            const auditError = safeAuditError(sessionErr?.message || 'Recovery session generation failed');
            console.error('Failed to generate recovery session:', auditError);
            await writeAuditEvent({
                request,
                eventKind: 'security',
                category: 'authentication',
                eventType: 'authentication.reset_code_verified',
                action: 'verify_reset_code',
                outcome: 'failure',
                summary: 'Reset-code verification could not create a recovery session',
                actorSource: 'anonymous',
                targetTable: 'auth.users',
                targetRecordId: { id: user.id },
                targetLabel: normalizedEmail,
                metadata: { error: auditError },
            });
            return NextResponse.json(
                { error: 'Failed to create session' },
                { status: 500 }
            );
        }

        // Verify token to create session
        const { data: verifyData, error: verifyErr } = await supabaseClient.auth.verifyOtp({
            token_hash: sessionData.properties.hashed_token,
            type: 'email',
        });

        if (verifyErr || !verifyData.session) {
            const auditError = safeAuditError(verifyErr?.message || 'Recovery session verification failed');
            console.error('Failed to verify recovery session:', auditError);
            await writeAuditEvent({
                request,
                eventKind: 'security',
                category: 'authentication',
                eventType: 'authentication.reset_code_verified',
                action: 'verify_reset_code',
                outcome: 'failure',
                summary: 'Reset-code verification could not establish a recovery session',
                actorSource: 'anonymous',
                targetTable: 'auth.users',
                targetRecordId: { id: user.id },
                targetLabel: normalizedEmail,
                metadata: { error: auditError },
            });
            return NextResponse.json(
                { error: 'Failed to create session' },
                { status: 500 }
            );
        }

        await writeAuditEvent({
            request,
            actor: { user },
            eventKind: 'security',
            category: 'authentication',
            eventType: 'authentication.reset_code_verified',
            action: 'verify_reset_code',
            outcome: 'success',
            summary: 'Password reset code was verified',
            actorSource: 'password_recovery',
            targetTable: 'auth.users',
            targetRecordId: { id: user.id },
            targetLabel: normalizedEmail,
        });

        return NextResponse.json({
            message: 'Code verified',
            session: {
                access_token: verifyData.session.access_token,
                refresh_token: verifyData.session.refresh_token,
            },
            user: verifyData.user,
        });
    } catch (err: any) {
        const auditError = safeAuditError(err);
        console.error('verify-reset-code error:', auditError);
        await writeAuditEvent({
            request,
            eventKind: 'security',
            category: 'authentication',
            eventType: 'authentication.reset_code_verified',
            action: 'verify_reset_code',
            outcome: 'failure',
            summary: 'Reset-code verification failed unexpectedly',
            actorSource: 'anonymous',
            targetTable: 'auth.users',
            targetLabel: normalizedEmail || null,
            metadata: { error: auditError },
        });
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
