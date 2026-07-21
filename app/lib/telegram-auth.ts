import { getAuthenticatedUser, getStoredUserRole, type UserRole } from './server-auth';
import { writeAuditEvent, type AuditActor } from './audit-server';

export type TelegramAuthorization =
    | { authorized: true; actor: AuditActor | null; source: 'authenticated_api' | 'cron' }
    | { authorized: false; status: 401 | 403 };

function programmeLabel(value: string) {
    return value
        .replaceAll('_', ' ')
        .replace(/\b\w/g, (character) => character.toUpperCase());
}

export async function authorizeTelegramSender(
    request: Request,
    allowedRoles: readonly UserRole[],
    programme: string,
): Promise<TelegramAuthorization> {
    const authorization = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authorization === `Bearer ${cronSecret}`) {
        return { authorized: true, actor: null, source: 'cron' };
    }

    const user = await getAuthenticatedUser(request);
    const actor = user ? { user, role: getStoredUserRole(user) } : null;
    const allowed = actor ? allowedRoles.includes(actor.role) : false;

    if (!allowed) {
        await writeAuditEvent({
            request,
            actor,
            eventKind: 'security',
            category: 'notifications',
            eventType: `telegram.${programme}.denied`,
            action: 'send_telegram',
            outcome: 'denied',
            summary: actor
                ? `${actor.user.user_metadata?.name || actor.user.email || 'User'} was denied permission to send ${programme.replaceAll('_', ' ')}`
                : `An unauthenticated ${programme.replaceAll('_', ' ')} send was denied`,
            actorSource: actor ? 'authenticated_api' : 'anonymous_api',
            targetTable: 'telegram',
            targetLabel: programmeLabel(programme),
            metadata: { reason: actor ? 'insufficient_role' : 'missing_or_invalid_authentication' },
        });
        return { authorized: false, status: actor ? 403 : 401 };
    }

    return { authorized: true, actor, source: 'authenticated_api' };
}
