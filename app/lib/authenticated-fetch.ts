'use client';

import { createBrowserClient } from '@supabase/ssr';

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export async function authenticatedFetch(
    input: RequestInfo | URL,
    init: RequestInit = {},
) {
    const {
        data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
        throw new Error('Your session has expired. Please sign in again.');
    }

    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${session.access_token}`);

    return fetch(input, { ...init, headers });
}
