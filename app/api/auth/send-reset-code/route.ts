import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { auditRateLimitExceeded, safeAuditError, writeAuditEvent } from '../../../lib/audit-server';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function generateCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(request: NextRequest) {
    let normalizedEmail = '';

    try {
        const addressLimited = await auditRateLimitExceeded({
            request,
            eventType: 'authentication.password_reset_requested',
            limit: 20,
            windowMs: 15 * 60_000,
        });
        if (addressLimited) {
            await writeAuditEvent({
                request,
                eventKind: 'security',
                category: 'authentication',
                eventType: 'authentication.password_reset_requested.rate_limited',
                action: 'request_password_reset',
                outcome: 'denied',
                summary: 'A password reset request was rate-limited',
                actorSource: 'anonymous',
                targetTable: 'auth.users',
                metadata: { scope: 'ip' },
            });
            return NextResponse.json(
                { error: 'Too many reset requests. Please wait before trying again.' },
                { status: 429, headers: { 'Retry-After': '900' } },
            );
        }

        const { email } = await request.json();
        normalizedEmail = String(email || '').trim().toLowerCase().slice(0, 254);
        if (!normalizedEmail) {
            await writeAuditEvent({
                request,
                eventKind: 'security',
                category: 'authentication',
                eventType: 'authentication.password_reset_requested',
                action: 'request_password_reset',
                outcome: 'denied',
                summary: 'Password reset request was denied because the email was missing',
                actorSource: 'anonymous',
                targetTable: 'auth.users',
                metadata: { reason: 'missing_email' },
            });
            return NextResponse.json({ error: 'Email required' }, { status: 400 });
        }

        const emailLimited = await auditRateLimitExceeded({
            request,
            eventType: 'authentication.password_reset_requested',
            targetLabel: normalizedEmail,
            limit: 3,
            windowMs: 15 * 60_000,
        });
        if (emailLimited) {
            await writeAuditEvent({
                request,
                eventKind: 'security',
                category: 'authentication',
                eventType: 'authentication.password_reset_requested.rate_limited',
                action: 'request_password_reset',
                outcome: 'denied',
                summary: 'A password reset request was rate-limited',
                actorSource: 'anonymous',
                targetTable: 'auth.users',
                targetLabel: normalizedEmail,
                metadata: { scope: 'account' },
            });
            return NextResponse.json(
                { error: 'Too many reset requests. Please wait before trying again.' },
                { status: 429, headers: { 'Retry-After': '900' } },
            );
        }

        // Check if user exists
        const { data: users, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
        if (listErr || !users?.users) {
            await writeAuditEvent({
                request,
                eventKind: 'security',
                category: 'authentication',
                eventType: 'authentication.password_reset_requested',
                action: 'request_password_reset',
                outcome: 'failure',
                summary: 'Password reset request could not complete the account lookup',
                actorSource: 'anonymous',
                targetTable: 'auth.users',
                targetLabel: normalizedEmail,
                metadata: { reason: 'account_lookup_failed' },
            });
            return NextResponse.json({ error: 'User lookup failed' }, { status: 500 });
        }

        const targetUser = users.users.find((u: { email?: string }) =>
            u.email?.toLowerCase() === normalizedEmail
        );

        if (!targetUser) {
            await writeAuditEvent({
                request,
                eventKind: 'security',
                category: 'authentication',
                eventType: 'authentication.password_reset_requested',
                action: 'request_password_reset',
                outcome: 'accepted',
                summary: 'Password reset request was accepted for processing',
                actorSource: 'anonymous',
                targetTable: 'auth.users',
                targetLabel: normalizedEmail,
                metadata: { accountMatched: false },
            });
            // For security, don't reveal if email exists
            return NextResponse.json({ message: 'If email exists, a code will be sent' });
        }

        // Generate code
        const code = generateCode();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min expiry

        // Store code in DB
        const { error: insertErr } = await supabaseAdmin
            .from('reset_codes')
            .upsert({ email: normalizedEmail, code, expires_at: expiresAt.toISOString(), used: false }, { onConflict: 'email' });

        if (insertErr) {
            const auditError = safeAuditError(insertErr.message);
            console.error('Failed to store reset code:', auditError);
            await writeAuditEvent({
                request,
                eventKind: 'security',
                category: 'authentication',
                eventType: 'authentication.password_reset_requested',
                action: 'request_password_reset',
                outcome: 'failure',
                summary: 'Password reset request could not be stored',
                actorSource: 'anonymous',
                targetTable: 'auth.users',
                targetRecordId: { id: targetUser.id },
                targetLabel: normalizedEmail,
                metadata: { error: auditError },
            });
            return NextResponse.json({ error: 'Failed to generate code' }, { status: 500 });
        }

        const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'api-key': process.env.BREVO_API_KEY || '',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                sender: {
                    name: 'Nicholas Lau',
                    email: process.env.BREVO_SENDER_EMAIL,
                },
                to: [{ email: normalizedEmail }],
                subject: 'Password Reset Code',
                htmlContent: `
                  <p>Your password reset code is:</p>
                  <h2 style="font-family: monospace; letter-spacing: 4px; font-size: 24px;">${code}</h2>
                  <p>This code expires in 15 minutes.</p>
                  <p>
                    <a href="${process.env.NEXT_PUBLIC_SITE_URL}/reset?code=${code}&email=${encodeURIComponent(normalizedEmail)}">
                      Click here to reset directly
                    </a>
                  </p>
                `,
            }),
        });

        if (!brevoRes.ok) {
            const errorText = await brevoRes.text();
            console.error('Brevo email send failed with HTTP status:', brevoRes.status);
            await writeAuditEvent({
                request,
                eventKind: 'security',
                category: 'authentication',
                eventType: 'authentication.password_reset_requested',
                action: 'request_password_reset',
                outcome: 'failure',
                summary: 'Password reset email could not be delivered',
                actorSource: 'anonymous',
                targetTable: 'auth.users',
                targetRecordId: { id: targetUser.id },
                targetLabel: normalizedEmail,
                metadata: { provider: 'brevo', httpStatus: brevoRes.status },
            });

            return NextResponse.json(
                { error: `Brevo failed: ${errorText}` },
                { status: 500 }
            );
        }

        await writeAuditEvent({
            request,
            eventKind: 'security',
            category: 'authentication',
            eventType: 'authentication.password_reset_requested',
            action: 'request_password_reset',
            outcome: 'success',
            summary: 'Password reset code was requested and delivered',
            actorSource: 'anonymous',
            targetTable: 'auth.users',
            targetRecordId: { id: targetUser.id },
            targetLabel: normalizedEmail,
            metadata: { provider: 'brevo' },
        });

        return NextResponse.json({ message: 'Code sent to email' });
    } catch (err: any) {
        const auditError = safeAuditError(err);
        console.error('send-reset-code error:', auditError);
        await writeAuditEvent({
            request,
            eventKind: 'security',
            category: 'authentication',
            eventType: 'authentication.password_reset_requested',
            action: 'request_password_reset',
            outcome: 'failure',
            summary: 'Password reset request failed unexpectedly',
            actorSource: 'anonymous',
            targetTable: 'auth.users',
            targetLabel: normalizedEmail || null,
            metadata: { error: auditError },
        });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
