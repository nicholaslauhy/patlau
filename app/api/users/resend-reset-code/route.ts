import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { createAuditedAdminClient, getOptionalAuditActor, safeAuditError, writeAuditEvent } from '../../../lib/audit-server';
import { getStoredUserRole } from '../../../lib/server-auth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

function generateCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(request: NextRequest) {
    let caller: Awaited<ReturnType<typeof getOptionalAuditActor>> = null;

    try {
        caller = await getOptionalAuditActor(request);
        if (!caller) {
            await writeAuditEvent({
                request,
                actor: null,
                eventKind: 'security',
                category: 'authentication',
                eventType: 'password_reset.admin_resend',
                action: 'resend_password_reset_code',
                outcome: 'denied',
                summary: 'An unauthorized password reset resend was denied.',
                actorSource: 'anonymous',
                targetTable: 'auth.users',
            });
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        if (caller.role !== 'admin' && caller.role !== 'superuser') {
            await writeAuditEvent({
                request,
                actor: caller,
                eventKind: 'security',
                category: 'authentication',
                eventType: 'password_reset.admin_resend',
                action: 'resend_password_reset_code',
                outcome: 'denied',
                summary: 'A signed-in user without permission attempted to resend a password reset code.',
                targetTable: 'auth.users',
                metadata: { reason: 'insufficient_role' },
            });
            return NextResponse.json(
                { error: 'Forbidden' },
                { status: 403 }
            );
        }

        const { email } = await request.json();

        if (!email) {
            return NextResponse.json(
                { error: 'Email is required' },
                { status: 400 }
            );
        }

        const normalizedEmail = email.toLowerCase();

        const { data: usersData, error: listErr } =
            await supabaseAdmin.auth.admin.listUsers();

        if (listErr || !usersData?.users) {
            console.error('User lookup failed:', listErr);
            return NextResponse.json(
                { error: 'User lookup failed' },
                { status: 500 }
            );
        }

        const targetUser = usersData.users.find((u: { email?: string }) =>
            u.email?.toLowerCase() === normalizedEmail
        );

        if (!targetUser) {
            return NextResponse.json(
                { error: 'User not found' },
                { status: 404 }
            );
        }

        const targetRole = getStoredUserRole(targetUser);
        const targetLabel = targetUser.user_metadata?.name || targetUser.email || targetUser.id;

        if (caller.role === 'admin' && targetRole !== 'member') {
            await writeAuditEvent({
                request,
                actor: caller,
                eventKind: 'security',
                category: 'authentication',
                eventType: 'password_reset.admin_resend',
                action: 'resend_password_reset_code',
                outcome: 'denied',
                summary: `Denied a password reset resend for ${targetLabel}'s ${targetRole} account.`,
                targetTable: 'auth.users',
                targetRecordId: { user_id: targetUser.id },
                targetLabel,
                metadata: { reason: 'role_hierarchy_violation', target_role: targetRole },
            });
            return NextResponse.json(
                { error: 'Admins can only resend reset codes to member accounts' },
                { status: 403 }
            );
        }

        const code = generateCode();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
        const auditedAdmin = createAuditedAdminClient(
            request,
            caller,
            'api.users.resend-reset-code',
        );

        const { error: upsertErr } = await auditedAdmin
            .from('reset_codes')
            .upsert(
                {
                    email: normalizedEmail,
                    code,
                    expires_at: expiresAt.toISOString(),
                    used: false
                },
                { onConflict: 'email' }
            );

        if (upsertErr) {
            console.error('Failed to store reset code:', upsertErr);
            await writeAuditEvent({
                request,
                actor: caller,
                eventKind: 'security',
                category: 'authentication',
                eventType: 'password_reset.admin_resend',
                action: 'resend_password_reset_code',
                outcome: 'failure',
                summary: `Failed to prepare a password reset code for ${targetLabel}.`,
                targetTable: 'auth.users',
                targetRecordId: { user_id: targetUser.id },
                targetLabel,
                metadata: { reason: 'reset_record_write_failed' },
            });
            return NextResponse.json(
                { error: 'Failed to generate reset code' },
                { status: 500 }
            );
        }

        if (!process.env.BREVO_API_KEY) {
            await writeAuditEvent({
                request,
                actor: caller,
                eventKind: 'security',
                category: 'authentication',
                eventType: 'password_reset.admin_resend',
                action: 'resend_password_reset_code',
                outcome: 'failure',
                summary: `Could not send ${targetLabel}'s password reset code because email delivery is not configured.`,
                targetTable: 'auth.users',
                targetRecordId: { user_id: targetUser.id },
                targetLabel,
                metadata: { reason: 'email_service_not_configured' },
            });
            return NextResponse.json(
                { error: 'BREVO_API_KEY is missing' },
                { status: 500 }
            );
        }

        if (!process.env.BREVO_SENDER_EMAIL) {
            await writeAuditEvent({
                request,
                actor: caller,
                eventKind: 'security',
                category: 'authentication',
                eventType: 'password_reset.admin_resend',
                action: 'resend_password_reset_code',
                outcome: 'failure',
                summary: `Could not send ${targetLabel}'s password reset code because the sender is not configured.`,
                targetTable: 'auth.users',
                targetRecordId: { user_id: targetUser.id },
                targetLabel,
                metadata: { reason: 'email_sender_not_configured' },
            });
            return NextResponse.json(
                { error: 'BREVO_SENDER_EMAIL is missing' },
                { status: 500 }
            );
        }

        if (!process.env.NEXT_PUBLIC_SITE_URL) {
            await writeAuditEvent({
                request,
                actor: caller,
                eventKind: 'security',
                category: 'authentication',
                eventType: 'password_reset.admin_resend',
                action: 'resend_password_reset_code',
                outcome: 'failure',
                summary: `Could not send ${targetLabel}'s password reset code because the site URL is not configured.`,
                targetTable: 'auth.users',
                targetRecordId: { user_id: targetUser.id },
                targetLabel,
                metadata: { reason: 'site_url_not_configured' },
            });
            return NextResponse.json(
                { error: 'NEXT_PUBLIC_SITE_URL is missing' },
                { status: 500 }
            );
        }

        const resetUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/reset?code=${code}&email=${encodeURIComponent(normalizedEmail)}`;

        const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'api-key': process.env.BREVO_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                sender: {
                    name: 'Nicholas Lau',
                    email: process.env.BREVO_SENDER_EMAIL
                },
                to: [{ email: normalizedEmail }],
                subject: `Your password reset code is ${code}`,
                htmlContent: `
                    <p>Hello user,</p>
                    <p>Your password reset code is:</p>
                    <h2 style="font-family: monospace; letter-spacing: 4px; font-size: 24px;">${code}</h2>
                    <p>This code expires in 15 minutes.</p>
                    <p><b>You do not need to request for another code. Just key in your email and the code given above.</b></p>
                    <p>
                        <a href="${resetUrl}">
                            Click here to reset your password
                        </a>
                    </p>
                    <p style="font-size: 12px; color: #6b7280;">
                      Request ID: ${Date.now()}
                    </p>
                    <p>If you did not request this, please ignore this email.</p>
                `
            })
        });

        if (!brevoRes.ok) {
            const errorText = await brevoRes.text();
            console.error('Brevo email send failed with status:', brevoRes.status);

            await writeAuditEvent({
                request,
                actor: caller,
                eventKind: 'security',
                category: 'authentication',
                eventType: 'password_reset.admin_resend',
                action: 'resend_password_reset_code',
                outcome: 'failure',
                summary: `Email delivery failed for ${targetLabel}'s password reset code.`,
                targetTable: 'auth.users',
                targetRecordId: { user_id: targetUser.id },
                targetLabel,
                metadata: { reason: 'email_delivery_failed' },
            });

            return NextResponse.json(
                { error: `Brevo failed: ${errorText}` },
                { status: 500 }
            );
        }

        await writeAuditEvent({
            request,
            actor: caller,
            eventKind: 'security',
            category: 'authentication',
            eventType: 'password_reset.admin_resend',
            action: 'resend_password_reset_code',
            outcome: 'success',
            summary: `Sent a password reset code to ${targetLabel}.`,
            targetTable: 'auth.users',
            targetRecordId: { user_id: targetUser.id },
            targetLabel,
            metadata: { target_role: targetRole, delivery: 'email' },
        });

        return NextResponse.json({
            message: 'Reset code sent successfully'
        });
    } catch (error) {
        console.error('Resend reset code route error:', safeAuditError(error));

        await writeAuditEvent({
            request,
            actor: caller,
            eventKind: 'security',
            category: 'authentication',
            eventType: 'password_reset.admin_resend',
            action: 'resend_password_reset_code',
            outcome: 'failure',
            summary: 'A password reset resend failed unexpectedly.',
            targetTable: 'auth.users',
            metadata: { reason: 'unexpected_error' },
        });

        return NextResponse.json(
            {
                error: 'Internal server error',
                details: error instanceof Error ? error.message : String(error)
            },
            { status: 500 }
        );
    }
}
