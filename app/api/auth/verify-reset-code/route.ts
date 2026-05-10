import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: NextRequest) {
    try {
        const { email, code } = await request.json();

        if (!email || !code) {
            return NextResponse.json(
                { error: 'Email and code required' },
                { status: 400 }
            );
        }

        const normalizedEmail = email.toLowerCase();
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
            console.error('Invalid or expired code:', {
                email: normalizedEmail,
                code,
                nowIso,
                lookupErr,
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
            console.error('Failed to mark code as used:', updateCodeErr);
            return NextResponse.json(
                { error: 'Failed to verify code' },
                { status: 500 }
            );
        }

        // Get user by email
        const { data: users, error: listErr } = await supabaseAdmin.auth.admin.listUsers();

        if (listErr || !users?.users) {
            console.error('User lookup failed:', listErr);
            return NextResponse.json(
                { error: 'User lookup failed' },
                { status: 500 }
            );
        }

        const user = users.users.find((u: { email?: string }) =>
            u.email?.toLowerCase() === normalizedEmail
        );

        if (!user) {
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
            console.error('Failed to generate magic link:', sessionErr);
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
            console.error('Failed to verify OTP:', verifyErr);
            return NextResponse.json(
                { error: 'Failed to create session' },
                { status: 500 }
            );
        }

        return NextResponse.json({
            message: 'Code verified',
            session: {
                access_token: verifyData.session.access_token,
                refresh_token: verifyData.session.refresh_token,
            },
            user: verifyData.user,
        });
    } catch (err: any) {
        console.error('verify-reset-code error:', err);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}