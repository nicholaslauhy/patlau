import { createClient, type User } from '@supabase/supabase-js';

export type UserRole = 'member' | 'admin' | 'superuser';

const VALID_ROLES = new Set<UserRole>(['member', 'admin', 'superuser']);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
});

export const serverAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
});

export function getStoredUserRole(user: Pick<User, 'app_metadata' | 'user_metadata'>): UserRole {
    const appRole = user.app_metadata?.role;
    if (VALID_ROLES.has(appRole as UserRole)) return appRole as UserRole;

    // Temporary migration fallback. Once every production account has
    // app_metadata.role, authorization no longer depends on this value.
    const legacyRole = user.user_metadata?.role;
    return VALID_ROLES.has(legacyRole as UserRole) ? legacyRole as UserRole : 'member';
}

export async function getAuthenticatedUser(request: Request): Promise<User | null> {
    const authorization = request.headers.get('authorization');
    if (!authorization?.startsWith('Bearer ')) return null;

    const { data, error } = await authClient.auth.getUser(authorization.slice(7));
    if (error || !data.user) return null;

    // Read the current protected metadata from Auth instead of trusting a
    // potentially stale access-token payload after a role change.
    const { data: current, error: currentError } =
        await serverAdmin.auth.admin.getUserById(data.user.id);

    return currentError || !current.user ? null : current.user;
}

export async function requireRole(
    request: Request,
    allowedRoles: readonly UserRole[],
): Promise<{ user: User; role: UserRole } | null> {
    const user = await getAuthenticatedUser(request);
    if (!user) return null;

    const role = getStoredUserRole(user);
    return allowedRoles.includes(role) ? { user, role } : null;
}
