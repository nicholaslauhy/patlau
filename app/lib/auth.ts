import { createBrowserClient } from '@supabase/ssr';

export type UserRole = 'superuser' | 'admin' | 'member';

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function getUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

export async function getUserRole(): Promise<UserRole | null> {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        return (user?.user_metadata?.role as UserRole) || null;
    } catch {
        return null;
    }
}

export function hasAccess(userRole: UserRole | null, requiredRoles: UserRole[]): boolean {
    if (!userRole) return false;
    return requiredRoles.includes(userRole);
}

// Role access matrix
export const roleAccess = {
    member: ['dashboard'],
    admin: ['dashboard', 'attendance', 'payment', 'add'],
    superuser: ['dashboard', 'attendance', 'payment', 'add', 'settings']
};

export function canAccess(role: UserRole | null, page: string): boolean {
    if (!role) return false;
    const access = roleAccess[role] || [];
    return access.includes(page);
}