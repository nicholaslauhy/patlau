import { NextRequest, NextResponse } from 'next/server';
import {
    getOptionalAuditActor,
    writeAuditEvent,
} from '../../lib/audit-server';
import { serverAdmin } from '../../lib/server-auth';
import {
    buildPublicTelegramSupportAdmin,
    maskTelegramSupportChatId,
    normalizeTelegramSupportChatId,
    resolveTelegramSupportAdminChatIds,
    TELEGRAM_SUPPORT_CHAT_ID_PATTERN,
    validateTelegramSupportAdminInput,
} from '../../lib/telegram-support-admin-policy';

const SELECT_FIELDS = 'id,telegram_chat_id,display_name,active,created_at,updated_at';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Actor = NonNullable<Awaited<ReturnType<typeof getOptionalAuditActor>>>;

const json = (body: unknown, init?: ResponseInit) => {
    const response = NextResponse.json(body, init);
    response.headers.set('Cache-Control', 'no-store');
    return response;
};

const fallbackChatId = () => normalizeTelegramSupportChatId(
    process.env.TELEGRAM_PARENT_SUPPORT_ADMIN_CHAT_ID,
);

const publicAdmin = (row: Record<string, any>) => buildPublicTelegramSupportAdmin({
    id: String(row.id),
    telegram_chat_id: String(row.telegram_chat_id || ''),
    display_name: String(row.display_name || 'Telegram administrator'),
    active: row.active === true,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
}, fallbackChatId());

async function authorize(request: NextRequest, action: string) {
    const actor = await getOptionalAuditActor(request);
    if (!actor) {
        await writeAuditEvent({
            request,
            actor: null,
            eventKind: 'security',
            category: 'support',
            eventType: 'support.telegram_admin.denied',
            action,
            outcome: 'denied',
            summary: 'An unauthenticated Telegram support administrator request was denied.',
            actorSource: 'anonymous',
            targetTable: 'telegram_support_admins',
        });
        return { actor: null, response: json({ error: 'Unauthorized' }, { status: 401 }) };
    }

    if (actor.role !== 'superuser') {
        await writeAuditEvent({
            request,
            actor,
            eventKind: 'security',
            category: 'support',
            eventType: 'support.telegram_admin.denied',
            action,
            outcome: 'denied',
            summary: 'A user without permission attempted to manage Telegram support administrators.',
            targetTable: 'telegram_support_admins',
            metadata: { reason: 'insufficient_role' },
        });
        return { actor: null, response: json({ error: 'Forbidden' }, { status: 403 }) };
    }

    return { actor, response: null };
}

async function loadInternalAdmins() {
    return serverAdmin
        .from('telegram_support_admins')
        .select(SELECT_FIELDS)
        .order('active', { ascending: false })
        .order('display_name', { ascending: true });
}

export async function GET(request: NextRequest) {
    const authorization = await authorize(request, 'list_telegram_support_admins');
    if (authorization.response) return authorization.response;

    try {
        const { data, error } = await loadInternalAdmins();
        if (error) throw error;

        const rows = (data || []) as Record<string, any>[];
        const fallback = fallbackChatId();
        const fallbackRepresented = Boolean(
            fallback && rows.some((row) => String(row.telegram_chat_id) === fallback),
        );
        const effectiveChatIds = resolveTelegramSupportAdminChatIds(
            rows.map((row) => ({
                telegram_chat_id: String(row.telegram_chat_id),
                active: row.active === true,
            })),
            fallback,
        );

        return json({
            admins: rows.map(publicAdmin),
            effective_active_count: effectiveChatIds.length,
            fallback: {
                configured: TELEGRAM_SUPPORT_CHAT_ID_PATTERN.test(fallback),
                represented: fallbackRepresented,
                chat_id_hint: TELEGRAM_SUPPORT_CHAT_ID_PATTERN.test(fallback)
                    ? maskTelegramSupportChatId(fallback)
                    : null,
            },
        });
    } catch (error) {
        console.error('Failed to list Telegram support administrators.');
        return json(
            { error: 'Could not load Telegram support administrators.' },
            { status: 500 },
        );
    }
}

export async function POST(request: NextRequest) {
    const authorization = await authorize(request, 'add_telegram_support_admin');
    if (authorization.response) return authorization.response;
    const actor = authorization.actor as Actor;

    try {
        const body = await request.json();
        const validated = validateTelegramSupportAdminInput(
            body.telegram_chat_id,
            body.display_name,
        );
        if (validated.error) return json({ error: validated.error }, { status: 400 });

        const { data, error } = await serverAdmin
            .from('telegram_support_admins')
            .insert({
                telegram_chat_id: validated.telegramChatId,
                display_name: validated.displayName,
                active: true,
                created_by: actor.user.id,
            })
            .select(SELECT_FIELDS)
            .single();

        if (error?.code === '23505') {
            return json(
                { error: 'That Telegram account is already in the administrator list.' },
                { status: 409 },
            );
        }
        if (error || !data) throw error || new Error('Insert failed');

        await writeAuditEvent({
            request,
            actor,
            eventKind: 'data_change',
            category: 'support',
            eventType: 'support.telegram_admin.added',
            action: 'add_telegram_support_admin',
            outcome: 'success',
            summary: `Added ${validated.displayName} as a Telegram support administrator.`,
            actorSource: 'settings',
            targetTable: 'telegram_support_admins',
            targetRecordId: { telegram_support_admin_id: data.id },
            targetLabel: validated.displayName,
            changedFields: ['display_name', 'active'],
            newValues: { display_name: validated.displayName, active: true },
        });

        return json({ admin: publicAdmin(data) }, { status: 201 });
    } catch (error) {
        console.error('Failed to add a Telegram support administrator.');
        await writeAuditEvent({
            request,
            actor,
            category: 'support',
            eventType: 'support.telegram_admin.add_failed',
            action: 'add_telegram_support_admin',
            outcome: 'failure',
            summary: 'Failed to add a Telegram support administrator.',
            targetTable: 'telegram_support_admins',
            metadata: { reason: 'database_operation_failed' },
        });
        return json({ error: 'Could not add the Telegram administrator.' }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    const authorization = await authorize(request, 'update_telegram_support_admin');
    if (authorization.response) return authorization.response;
    const actor = authorization.actor as Actor;

    try {
        const body = await request.json();
        const id = typeof body.id === 'string' ? body.id.trim() : '';
        if (!UUID_PATTERN.test(id) || typeof body.active !== 'boolean') {
            return json({ error: 'A valid administrator and status are required.' }, { status: 400 });
        }

        const { data: current, error: currentError } = await serverAdmin
            .from('telegram_support_admins')
            .select(SELECT_FIELDS)
            .eq('id', id)
            .maybeSingle();
        if (currentError) throw currentError;
        if (!current) return json({ error: 'Telegram administrator not found.' }, { status: 404 });

        const fallback = fallbackChatId();
        if (
            body.active === false
            && fallback
            && String(current.telegram_chat_id) === fallback
        ) {
            return json({
                error: 'This account is the deployment fallback. Remove its Vercel environment variable before pausing it.',
            }, { status: 409 });
        }

        const { data, error } = await serverAdmin
            .from('telegram_support_admins')
            .update({ active: body.active })
            .eq('id', id)
            .select(SELECT_FIELDS)
            .maybeSingle();
        if (error) throw error;
        if (!data) return json({ error: 'Telegram administrator not found.' }, { status: 404 });

        const verb = body.active ? 'Enabled' : 'Paused';
        await writeAuditEvent({
            request,
            actor,
            eventKind: 'data_change',
            category: 'support',
            eventType: body.active
                ? 'support.telegram_admin.enabled'
                : 'support.telegram_admin.paused',
            action: body.active
                ? 'enable_telegram_support_admin'
                : 'pause_telegram_support_admin',
            outcome: 'success',
            summary: `${verb} Telegram support notifications for ${current.display_name}.`,
            actorSource: 'settings',
            targetTable: 'telegram_support_admins',
            targetRecordId: { telegram_support_admin_id: id },
            targetLabel: current.display_name,
            changedFields: ['active'],
            oldValues: { active: current.active === true },
            newValues: { active: body.active },
        });

        return json({ admin: publicAdmin(data) });
    } catch (error) {
        console.error('Failed to update a Telegram support administrator.');
        await writeAuditEvent({
            request,
            actor,
            category: 'support',
            eventType: 'support.telegram_admin.update_failed',
            action: 'update_telegram_support_admin',
            outcome: 'failure',
            summary: 'Failed to update a Telegram support administrator.',
            targetTable: 'telegram_support_admins',
            metadata: { reason: 'database_operation_failed' },
        });
        return json({ error: 'Could not update the Telegram administrator.' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    const authorization = await authorize(request, 'remove_telegram_support_admin');
    if (authorization.response) return authorization.response;
    const actor = authorization.actor as Actor;

    try {
        const body = await request.json();
        const id = typeof body.id === 'string' ? body.id.trim() : '';
        if (!UUID_PATTERN.test(id)) {
            return json({ error: 'A valid administrator is required.' }, { status: 400 });
        }

        const { data: current, error: currentError } = await serverAdmin
            .from('telegram_support_admins')
            .select(SELECT_FIELDS)
            .eq('id', id)
            .maybeSingle();
        if (currentError) throw currentError;
        if (!current) return json({ error: 'Telegram administrator not found.' }, { status: 404 });

        const fallback = fallbackChatId();
        if (fallback && String(current.telegram_chat_id) === fallback) {
            return json({
                error: 'This row controls the deployment fallback. Remove the fallback environment variable before deleting it.',
            }, { status: 409 });
        }

        const { data: deleted, error } = await serverAdmin
            .from('telegram_support_admins')
            .delete()
            .eq('id', id)
            .select('id')
            .maybeSingle();
        if (error) throw error;
        if (!deleted) return json({ error: 'Telegram administrator not found.' }, { status: 404 });

        await writeAuditEvent({
            request,
            actor,
            eventKind: 'data_change',
            category: 'support',
            eventType: 'support.telegram_admin.removed',
            action: 'remove_telegram_support_admin',
            outcome: 'success',
            summary: `Removed ${current.display_name} from Telegram support administrators.`,
            actorSource: 'settings',
            targetTable: 'telegram_support_admins',
            targetRecordId: { telegram_support_admin_id: id },
            targetLabel: current.display_name,
            changedFields: ['display_name', 'active'],
            oldValues: { display_name: current.display_name, active: current.active === true },
        });

        return json({ ok: true });
    } catch (error) {
        console.error('Failed to remove a Telegram support administrator.');
        await writeAuditEvent({
            request,
            actor,
            category: 'support',
            eventType: 'support.telegram_admin.remove_failed',
            action: 'remove_telegram_support_admin',
            outcome: 'failure',
            summary: 'Failed to remove a Telegram support administrator.',
            targetTable: 'telegram_support_admins',
            metadata: { reason: 'database_operation_failed' },
        });
        return json({ error: 'Could not remove the Telegram administrator.' }, { status: 500 });
    }
}
