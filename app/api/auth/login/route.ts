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
        const { emailOrUsername, password } = await request.json();

        if (!emailOrUsername || !password) {
            return NextResponse.json(
                { error: 'Email/username and password are required' },
                { status: 400 }
            );
        }

        // First, try direct email login
        let loginEmail = emailOrUsername;

        // If it doesn't look like an email, search for user by username in metadata
        if (!emailOrUsername.includes('@')) {
            const { data, error: searchError } = await supabaseAdmin.auth.admin.listUsers();

            if (searchError || !data?.users) {
                return NextResponse.json(
                    { error: 'User not found' },
                    { status: 404 }
                );
            }

            // Find user by username (stored in user_metadata.name or custom username field)
            const user = data.users.find(
                (u: any) => u.user_metadata?.username === emailOrUsername ||
                    u.user_metadata?.name === emailOrUsername
            );

            if (!user || !user.email) {
                return NextResponse.json(
                    { error: 'User not found' },
                    { status: 404 }
                );
            }

            loginEmail = user.email;
        }

        // Now attempt login with the resolved email
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email: loginEmail,
            password,
        });

        if (error) {
            return NextResponse.json(
                { error: error.message || 'Login failed' },
                { status: 401 }
            );
        }

        return NextResponse.json({
            message: 'Login successful',
            session: data.session,
            user: data.user
        });
    } catch (error) {
        console.error('Login route error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}