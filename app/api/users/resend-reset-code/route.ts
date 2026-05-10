import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
const supabaseAuthClient = createClient(supabaseUrl, anonKey);

type UserRole = 'member' | 'admin' | 'superuser';

function generateCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(request: NextRequest) {
    try {
        const authHeader = request.headers.get('authorization');

        if (!authHeader?.startsWith('Bearer ')) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        const token = authHeader.replace('Bearer ', '');

        const {
            data: { user: caller },
            error: authError
        } = await supabaseAuthClient.auth.getUser(token);

        if (authError || !caller) {
            return NextResponse.json(
                { error: 'Invalid or expired token' },
                { status: 401 }
            );
        }

        const callerRole = caller.user_metadata?.role as UserRole | undefined;

        if (callerRole !== 'admin' && callerRole !== 'superuser') {
            return NextResponse.json(
                { error: 'Only admins and superusers can resend reset codes' },
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

        const targetRole = (targetUser.user_metadata?.role || 'member') as UserRole;

        if (callerRole === 'admin' && targetRole !== 'member') {
            return NextResponse.json(
                { error: 'Admins can only resend reset codes to member accounts' },
                { status: 403 }
            );
        }

        const code = generateCode();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

        const { error: upsertErr } = await supabaseAdmin
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
            return NextResponse.json(
                { error: 'Failed to generate reset code' },
                { status: 500 }
            );
        }

        if (!process.env.BREVO_API_KEY) {
            return NextResponse.json(
                { error: 'BREVO_API_KEY is missing' },
                { status: 500 }
            );
        }

        if (!process.env.BREVO_SENDER_EMAIL) {
            return NextResponse.json(
                { error: 'BREVO_SENDER_EMAIL is missing' },
                { status: 500 }
            );
        }

        if (!process.env.NEXT_PUBLIC_SITE_URL) {
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
            console.error('Brevo email send failed:', errorText);

            return NextResponse.json(
                { error: `Brevo failed: ${errorText}` },
                { status: 500 }
            );
        }

        return NextResponse.json({
            message: 'Reset code sent successfully'
        });
    } catch (error) {
        console.error('Resend reset code route error:', error);

        return NextResponse.json(
            {
                error: 'Internal server error',
                details: error instanceof Error ? error.message : String(error)
            },
            { status: 500 }
        );
    }
}