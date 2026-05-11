import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
    try {
        const { email, name, role, password } = await request.json();

        if (!email || !name || !role) {
            return NextResponse.json(
                { error: 'Email, name, and role are required' },
                { status: 400 }
            );
        }

        const normalizedEmail = email.toLowerCase().trim();
        const normalizedName = name.trim();

        // List all users to check for duplicates
        const { data: usersData, error: listErr } = await supabaseAdmin.auth.admin.listUsers();

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
        const { data: userData, error: createErr } = await supabaseAdmin.auth.admin.createUser({
            email: normalizedEmail,
            password: password || undefined,
            user_metadata: {
                name: normalizedName,
                role: role,
            },
            email_confirm: true,
        });

        if (createErr) {
            console.error('Create user error:', createErr);
            return NextResponse.json(
                { error: createErr.message || 'Failed to create user' },
                { status: 400 }
            );
        }

        // Send reset password email so user can set their own password
        const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL}/reset`;
        const { error: resetErr } = await supabaseAdmin.auth.resetPasswordForEmail(normalizedEmail, {
            redirectTo,
        });

        if (resetErr) {
            console.error('Reset email error:', resetErr);
            // User was created but email failed — still return success
            return NextResponse.json({
                message: 'User created but password reset email failed to send',
                user: userData.user,
                warning: 'Email delivery issue — user may need to request reset manually',
            });
        }

        return NextResponse.json({
            message: 'User created successfully',
            user: userData.user,
        });
    } catch (error) {
        console.error('Create user route error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}