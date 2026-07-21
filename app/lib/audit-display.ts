import type { AuditLogEntry } from '../../types/audit';

export type AuditDisplayEntry = Pick<AuditLogEntry,
    | 'summary'
    | 'display_summary'
    | 'action'
    | 'actor_name'
    | 'actor_email'
    | 'actor_source'
    | 'target_table'
    | 'target_label'
    | 'display_target_label'
>;

const UUID_IN_TEXT = /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi;
const UUID_TEST = /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/i;
const LONG_HEX_IN_TEXT = /\b[0-9a-f]{24,}\b/gi;
const LONG_HEX_TEST = /\b[0-9a-f]{24,}\b/i;

function humanise(value: string | null | undefined) {
    if (!value) return 'System';
    return value
        .replace(/[._-]+/g, ' ')
        .replace(/\b\w/g, (character) => character.toUpperCase());
}

function auditActor(entry: AuditDisplayEntry) {
    return entry.actor_name?.trim()
        || entry.actor_email?.trim()
        || humanise(entry.actor_source);
}

export function looksLikeTechnicalIdentifier(value: string | null | undefined) {
    if (!value) return false;
    const normalized = value.trim();
    return /^\d+$/.test(normalized)
        || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(normalized)
        || /^[0-9a-f]{24,}$/i.test(normalized);
}

export function auditDisplayTargetLabel(entry: AuditDisplayEntry) {
    const resolved = entry.display_target_label?.trim();
    if (resolved) return resolved;

    const recorded = entry.target_label?.trim();
    if (!recorded || looksLikeTechnicalIdentifier(recorded)) return null;
    return recorded;
}

/**
 * Prefer the database's point-in-time presentation snapshot. The conservative
 * fallbacks keep opaque keys out of headlines while the website and database
 * migrations are being deployed independently.
 */
export function auditDisplaySummary(entry: AuditDisplayEntry) {
    const resolved = entry.display_summary?.trim();
    if (resolved) return resolved;

    const actor = auditActor(entry);
    if (entry.target_table === 'payment_history'
        && /payment history\s+["']?\d+/i.test(entry.summary)) {
        const action = entry.action === 'delete'
            ? 'removed'
            : entry.action === 'insert'
                ? 'recorded'
                : 'updated';
        return `${actor} ${action} a Weekend payment record`;
    }

    if (entry.target_table === 'student_audit'
        && (UUID_TEST.test(entry.summary) || LONG_HEX_TEST.test(entry.summary))) {
        return `${actor} recorded ${humanise(entry.action).toLowerCase()} attendance for a Weekend student`;
    }

    // The unmodified evidence remains available in Technical details.
    return entry.summary
        .replace(UUID_IN_TEXT, 'record')
        .replace(LONG_HEX_IN_TEXT, 'record')
        .replace(/(["'])\d+\1/g, 'record');
}
