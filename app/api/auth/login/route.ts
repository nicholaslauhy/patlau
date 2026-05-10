// DEBUGGING: enhanced logging version
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
    // log request arrival (do not log secrets in prod)
    try {
        const body = await request.json();


        const { emailOrUsername, password } = body;
        if (!emailOrUsername || !password) {
            return NextResponse.json({ error: 'Email/username and password are required' }, { status: 400 });
        }

        let loginEmail = emailOrUsername;
        if (!emailOrUsername.includes('@')) {
            const listRes = await supabaseAdmin.auth.admin.listUsers();

            if (listRes.error || !listRes.data?.users) {
                return NextResponse.json({ error: 'User not found' }, { status: 404 });
            }

            const user = listRes.data.users.find((u: any) =>
                u.user_metadata?.username === emailOrUsername || u.user_metadata?.name === emailOrUsername
            );

            if (!user || !user.email) return NextResponse.json({ error: 'User not found' }, { status: 404 });
            loginEmail = user.email;
        }

        const signInRes = await supabaseClient.auth.signInWithPassword({
            email: loginEmail,
            password,
        });

        if (signInRes.error) {
            // return the error message so client gets a friendly reason during dev
            return NextResponse.json({ error: signInRes.error.message || 'Login failed' }, { status: 401 });
        }

        // Ensure session shape
        const session = signInRes.data?.session ?? null;

        return NextResponse.json({
            message: 'Login successful',
            session: signInRes.data?.session ?? null,
            user: signInRes.data?.user ?? null,
        });
    } catch (err: any) {
        // log the full stack so you can paste it here
        console.error('[auth/login] unexpected error:', err?.stack ?? err);
        // in dev we can return the error message to aid debugging (remove for prod)
        return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 });
    }
}