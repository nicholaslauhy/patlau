import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
    try {
        const { email, name, role } = await request.json();

        if (!email || !name || !role) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`;

        // 1) Primary: invitation email
        const { data: inviteData, error: inviteError } =
            await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
                redirectTo,
                data: { name, role }
            });

        if (!inviteError) {
            return NextResponse.json({
                message: 'Invite email sent successfully',
                user: inviteData.user ?? null
            });
        }

        // 2) Fallback: ensure user exists, then send recovery email
        const { data: existingUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers();
        if (listError) {
            console.error('listUsers failed:', listError);
            return NextResponse.json(
                { error: `Invite failed; list users failed: ${listError.message}` },
                { status: 500 }
            );
        }

        const existingUser = (existingUsers?.users || []).find((u) => u.email?.toLowerCase() === email.toLowerCase());

        if (!existingUser) {
            const { error: createError } = await supabaseAdmin.auth.admin.createUser({
                email,
                email_confirm: false,
                user_metadata: { name, role }
            });

            if (createError) {
                console.error('createUser fallback failed:', createError);
                return NextResponse.json(
                    { error: `Invite failed and fallback create failed: ${createError.message}` },
                    { status: 500 }
                );
            }
        }

        const { error: recoveryError } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
            redirectTo
        });

        if (recoveryError) {
            console.error('recovery fallback failed:', recoveryError);
            return NextResponse.json(
                {
                    error: 'Both invite and fallback email failed',
                    details: {
                        invite: inviteError.message,
                        fallback: recoveryError.message
                    }
                },
                { status: 500 }
            );
        }

        return NextResponse.json({
            message: 'Invite failed, fallback recovery email sent',
            warning: inviteError.message
        });
    } catch (error) {
        console.error('Create user error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}