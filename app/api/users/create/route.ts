import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { email, name, role, password } = body || {};

        if (!email || !name || !role) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL}/reset`;

        // Attempt to create the user (with password if provided)
        const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password: password || undefined, // pass password if admin provided one
            email_confirm: false,
            user_metadata: {
                name,
                role
            }
        });

        // If creation returned an error other than "user exists", return it
        if (createError) {
            const msg = (createError?.message || '').toLowerCase();
            // If user already exists, we'll continue to send the reset email below.
            if (!msg.includes('already') && !msg.includes('user already')) {
                console.error('createUser error:', createError);
                return NextResponse.json({ error: `Failed to create user: ${createError.message}` }, { status: 500 });
            }
            // else: user already exists — continue to reset email step
        }

        // Send reset password email (this is the link the user will use to set their password)
        const { error: resetError } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
            redirectTo
        });

        if (resetError) {
            console.error('resetPasswordForEmail error:', resetError);
            // if we got a createData.user (user created) but reset fails, return that detail
            return NextResponse.json({
                error: 'Failed to send reset email',
                details: resetError.message,
            }, { status: 500 });
        }

        return NextResponse.json({
            message: 'Reset-password email sent successfully',
        });
    } catch (err) {
        console.error('Create user route error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}