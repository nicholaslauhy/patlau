-- Preserve request-origin evidence in Sentry and give operators a constrained
-- way to retry terminal export failures. This replaces only the claim RPC's
-- return shape; the private queue and its existing state remain unchanged.

begin;

drop function if exists public.claim_audit_log_export(integer, integer);

create function public.claim_audit_log_export(
    p_batch_size integer default 100,
    p_lease_seconds integer default 300
)
returns table (
    audit_log_id bigint,
    stable_event_id text,
    export_lease_token uuid,
    occurred_at timestamptz,
    event_kind text,
    category text,
    event_type text,
    action text,
    outcome text,
    summary text,
    actor_user_id uuid,
    actor_email text,
    actor_name text,
    actor_role text,
    actor_source text,
    target_table text,
    target_record_id jsonb,
    target_label text,
    changed_fields text[],
    old_values jsonb,
    new_values jsonb,
    metadata jsonb,
    request_id text,
    request_path text,
    request_method text,
    ip_address text,
    user_agent text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    now_value timestamptz := pg_catalog.clock_timestamp();
    batch_lease_token uuid := pg_catalog.gen_random_uuid();
begin
    if p_batch_size is null or p_batch_size < 1 or p_batch_size > 500 then
        raise exception 'Audit export batch size must be between 1 and 500';
    end if;
    if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 3600 then
        raise exception 'Audit export lease must be between 30 and 3600 seconds';
    end if;

    update audit_private.audit_log_exports as export_state
    set
        status = 'dead',
        lease_token = null,
        leased_until = null,
        next_attempt_at = now_value,
        last_error = coalesce(
            export_state.last_error,
            'Export lease expired after the maximum number of attempts'
        ),
        updated_at = now_value
    where export_state.status = 'in_flight'
      and export_state.leased_until <= now_value
      and export_state.attempt_count >= 20;

    return query
    with candidates as materialized (
        select export_state.audit_log_id
        from audit_private.audit_log_exports as export_state
        where export_state.attempt_count < 20
          and (
              (
                  export_state.status in ('pending', 'retry')
                  and export_state.next_attempt_at <= now_value
              )
              or
              (
                  export_state.status = 'in_flight'
                  and export_state.leased_until <= now_value
              )
          )
        order by
            case when export_state.status = 'in_flight' then 0 else 1 end,
            export_state.next_attempt_at,
            export_state.audit_log_id
        limit p_batch_size
        for update of export_state skip locked
    ),
    claimed as (
        update audit_private.audit_log_exports as export_state
        set
            status = 'in_flight',
            attempt_count = export_state.attempt_count + 1,
            lease_token = batch_lease_token,
            leased_until = now_value
                + pg_catalog.make_interval(secs => p_lease_seconds),
            exported_at = null,
            last_error = case
                when export_state.status = 'in_flight'
                    then 'Previous export lease expired before acknowledgement'
                else export_state.last_error
            end,
            updated_at = now_value
        from candidates
        where export_state.audit_log_id = candidates.audit_log_id
        returning
            export_state.audit_log_id,
            export_state.stable_event_id,
            export_state.lease_token
    )
    select
        audit_row.id,
        claimed.stable_event_id,
        claimed.lease_token,
        audit_row.occurred_at,
        audit_row.event_kind,
        audit_row.category,
        audit_row.event_type,
        audit_row.action,
        audit_row.outcome,
        audit_row.summary,
        audit_row.actor_user_id,
        audit_row.actor_email,
        audit_row.actor_name,
        audit_row.actor_role,
        audit_row.actor_source,
        audit_row.target_table,
        audit_row.target_record_id,
        audit_row.target_label,
        audit_row.changed_fields,
        audit_row.old_values,
        audit_row.new_values,
        audit_row.metadata,
        audit_row.request_id,
        audit_row.request_path,
        audit_row.request_method,
        audit_row.ip_address::text,
        audit_row.user_agent
    from claimed
    join public.audit_logs as audit_row
      on audit_row.id = claimed.audit_log_id
    order by audit_row.id;
end;
$$;

comment on function public.claim_audit_log_export(integer, integer) is
    'Leases an audit batch for Sentry export, including bounded request-origin evidence.';

create or replace function public.requeue_dead_audit_log_exports(
    p_batch_size integer default 500
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    requeued_count integer;
    now_value timestamptz := pg_catalog.clock_timestamp();
begin
    if p_batch_size is null or p_batch_size < 1 or p_batch_size > 500 then
        raise exception 'Audit requeue batch size must be between 1 and 500';
    end if;

    with candidates as materialized (
        select export_state.audit_log_id
        from audit_private.audit_log_exports as export_state
        where export_state.status = 'dead'
        order by export_state.updated_at, export_state.audit_log_id
        limit p_batch_size
        for update of export_state skip locked
    )
    update audit_private.audit_log_exports as export_state
    set
        status = 'retry',
        attempt_count = 0,
        next_attempt_at = now_value,
        lease_token = null,
        leased_until = null,
        exported_at = null,
        last_error = pg_catalog.left(
            'Requeued by a superuser. Previous failure: '
                || coalesce(export_state.last_error, 'not recorded'),
            2000
        ),
        updated_at = now_value
    from candidates
    where export_state.audit_log_id = candidates.audit_log_id;

    get diagnostics requeued_count = row_count;
    return requeued_count;
end;
$$;

comment on function public.requeue_dead_audit_log_exports(integer) is
    'Requeues a bounded terminal audit-export batch after an explicit operator action.';

revoke all on function public.claim_audit_log_export(integer, integer)
    from public, anon, authenticated, service_role;
revoke all on function public.requeue_dead_audit_log_exports(integer)
    from public, anon, authenticated, service_role;

grant execute on function public.claim_audit_log_export(integer, integer)
    to service_role;
grant execute on function public.requeue_dead_audit_log_exports(integer)
    to service_role;

select pg_catalog.pg_notify('pgrst', 'reload schema');

commit;
