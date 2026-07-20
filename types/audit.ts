export type AuditOutcome = 'success' | 'failure' | 'denied' | 'accepted' | 'warning';
export type AuditEventKind = 'activity' | 'data_change' | 'security' | 'system';

export interface AuditLogEntry {
    id: number;
    occurred_at: string;
    event_kind: AuditEventKind;
    category: string;
    event_type: string;
    action: string;
    outcome: AuditOutcome;
    summary: string;
    actor_user_id: string | null;
    actor_email: string | null;
    actor_name: string | null;
    actor_role: string | null;
    actor_source: string;
    target_table: string | null;
    target_record_id: Record<string, unknown> | null;
    target_label: string | null;
    changed_fields: string[] | null;
    old_values: Record<string, unknown> | null;
    new_values: Record<string, unknown> | null;
    metadata: Record<string, unknown>;
    request_id: string | null;
    request_path: string | null;
    request_method: string | null;
    ip_address: string | null;
    user_agent: string | null;
}

export interface AuditLogResponse {
    logs: AuditLogEntry[];
    total: number;
    page: number;
    pageSize: number;
    metrics: {
        today: number;
        attention: number;
        matching: number;
    };
}
