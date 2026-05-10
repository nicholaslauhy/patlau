import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function generateCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(request: NextRequest) {
    try {
        const { email } = await request.json();
        if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 });

        // Check if user exists
        const { data: users, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
        if (listErr || !users?.users) {
            return NextResponse.json({ error: 'User lookup failed' }, { status: 500 });
        }

        const normalizedEmail = email.toLowerCase();

        const userExists = users.users.some((u: { email?: string }) =>
            u.email?.toLowerCase() === normalizedEmail
        );

        if (!userExists) {
            // For security, don't reveal if email exists
            return NextResponse.json({ message: 'If email exists, a code will be sent' });
        }

        // Generate code
        const code = generateCode();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min expiry

        // Store code in DB
        const { error: insertErr } = await supabaseAdmin
            .from('reset_codes')
            .upsert({ email: email.toLowerCase(), code, expires_at: expiresAt.toISOString(), used: false }, { onConflict: 'email' });

        if (insertErr) {
            console.error('Failed to store reset code:', insertErr);
            return NextResponse.json({ error: 'Failed to generate code' }, { status: 500 });
        }

        // Send email via Brevo
        // For now, log the code (in production, use your email service)
        console.log(`[send-reset-code] Code for ${email}: ${code}`);

        // Example: call Brevo API to send email
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
                to: [{ email }],
                subject: 'Password Reset Code',
                htmlContent: `
                  <p>Your password reset code is:</p>
                  <h2 style="font-family: monospace; letter-spacing: 4px; font-size: 24px;">${code}</h2>
                  <p>This code expires in 15 minutes.</p>
                  <p>
                    <a href="${process.env.NEXT_PUBLIC_SITE_URL}/reset?code=${code}&email=${encodeURIComponent(email)}">
                      Click here to reset directly
                    </a>
                  </p>
                `,
            }),
        });

        if (!brevoRes.ok) {
            const errorText = await brevoRes.text();
            console.error('Brevo email send failed:', errorText);

            return NextResponse.json(
                { error: `Brevo failed: ${errorText}` },
                { status: 500 }
            );
        }

        return NextResponse.json({ message: 'Code sent to email' });
    } catch (err: any) {
        console.error('send-reset-code error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}