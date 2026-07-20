import { getOptionalAuditActor, safeAuditError, writeAuditEvent } from './audit-server';

interface TelegramAuditInput {
    request: Request;
    programme: string;
    category?: string;
    outcome: 'success' | 'failure';
    providerMessageId?: string | number | null;
    targetLabel?: string | null;
    error?: unknown;
}

export async function recordTelegramDelivery(input: TelegramAuditInput) {
    try {
        const actor = await getOptionalAuditActor(input.request);
        const actorName = actor?.user.user_metadata?.name || actor?.user.email || 'System';
        const programmeLabel = input.programme.replaceAll('_', ' ');

        await writeAuditEvent({
            request: input.request,
            actor,
            eventKind: input.outcome === 'success' ? 'activity' : 'system',
            category: input.category || 'notifications',
            eventType: `telegram.${input.programme}.${input.outcome === 'success' ? 'sent' : 'failed'}`,
            action: 'send_telegram',
            outcome: input.outcome,
            summary: input.outcome === 'success'
                ? `${actorName} sent the ${programmeLabel} Telegram notification`
                : `${programmeLabel} Telegram notification failed`,
            actorSource: actor ? 'authenticated_api' : 'system_api',
            targetTable: 'telegram',
            targetLabel: input.targetLabel || programmeLabel,
            metadata: {
                provider_message_id: input.providerMessageId || null,
                ...(input.error ? { error: safeAuditError(input.error) } : {}),
            },
        });
    } catch (error) {
        // Telegram delivery is the business operation. Audit infrastructure is
        // deliberately best-effort and must never turn a delivered message into
        // an error response.
        console.error('[audit] Telegram delivery audit failed:', safeAuditError(error));
    }
}
