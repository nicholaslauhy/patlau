-- Keep Supabase as a short-lived, durable audit outbox while exporting the
-- searchable copy to Sentry. Nothing is deleted until a worker has explicitly
-- acknowledged the export and both retention safety windows have elapsed.

begin;

create schema if not exists audit_private;
revoke all on schema audit_private from public, anon, authenticated, service_role;

create table if not exists audit_private.audit_log_exports (
    audit_log_id bigint primary key
        references public.audit_logs(id) on delete cascade,
    stable_event_id text not null unique,
    status text not null default 'pending'
        check (status in ('pending', 'in_flight', 'retry', 'exported', 'dead')),
    attempt_count integer not null default 0
        check (attempt_count between 0 and 20),
    next_attempt_at timestamptz not null default pg_catalog.clock_timestamp(),
    lease_token uuid,
    leased_until timestamptz,
    exported_at timestamptz,
    last_error text,
    created_at timestamptz not null default pg_catalog.clock_timestamp(),
    updated_at timestamptz not null default pg_catalog.clock_timestamp(),
    constraint audit_log_exports_lease_state_check check (
        (status = 'in_flight' and lease_token is not null and leased_until is not null)
        or
        (status <> 'in_flight' and lease_token is null and leased_until is null)
    ),
    constraint audit_log_exports_completion_state_check check (
        (status = 'exported' and exported_at is not null)
        or
        (status <> 'exported' and exported_at is null)
    )
);

comment on table audit_private.audit_log_exports is
    'Private durable outbox state for at-least-once delivery of public.audit_logs to Sentry.';
comment on column audit_private.audit_log_exports.stable_event_id is
    'Stable identifier included in every Sentry attempt so a duplicate delivery can be recognized.';
comment on column audit_private.audit_log_exports.lease_token is
    'Per-batch ownership token; only the worker holding this token may complete or fail the claim.';

create index if not exists audit_log_exports_ready_idx
    on audit_private.audit_log_exports (next_attempt_at, audit_log_id)
    where status in ('pending', 'retry');
create index if not exists audit_log_exports_stale_lease_idx
    on audit_private.audit_log_exports (leased_until, audit_log_id)
    where status = 'in_flight';
create index if not exists audit_log_exports_exported_idx
    on audit_private.audit_log_exports (exported_at, audit_log_id)
    where status = 'exported';

alter table audit_private.audit_log_exports enable row level security;
drop policy if exists "audit export state is private"
    on audit_private.audit_log_exports;
create policy "audit export state is private"
    on audit_private.audit_log_exports
    for all to anon, authenticated
    using (false)
    with check (false);

revoke all on table audit_private.audit_log_exports
    from public, anon, authenticated, service_role;

-- Enqueue in the same transaction as the audit row. This makes the audit table a
-- reliable outbox: a committed audit row can never be committed without its
-- matching delivery state.
create or replace function audit_private.enqueue_audit_log_export()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into audit_private.audit_log_exports (
        audit_log_id,
        stable_event_id,
        status,
        next_attempt_at
    ) values (
        new.id,
        'supabase-audit-log:' || new.id::text,
        'pending',
        pg_catalog.clock_timestamp()
    )
    on conflict (audit_log_id) do nothing;

    return new;
end;
$$;

revoke all on function audit_private.enqueue_audit_log_export()
    from public, anon, authenticated, service_role;

drop trigger if exists audit_logs_enqueue_sentry_export on public.audit_logs;
create trigger audit_logs_enqueue_sentry_export
after insert on public.audit_logs
for each row execute function audit_private.enqueue_audit_log_export();

-- Existing history is queued without modifying any audit row. ON CONFLICT also
-- makes the migration safe to retry.
insert into audit_private.audit_log_exports (
    audit_log_id,
    stable_event_id,
    status,
    next_attempt_at
)
select
    audit_row.id,
    'supabase-audit-log:' || audit_row.id::text,
    'pending',
    pg_catalog.clock_timestamp()
from public.audit_logs as audit_row
on conflict (audit_log_id) do nothing;

-- Atomically lease a bounded batch. Row locks plus SKIP LOCKED allow multiple
-- workers without assigning the same row twice. An expired lease is reclaimable;
-- its new lease token invalidates the previous worker's acknowledgement.
create or replace function public.claim_audit_log_export(
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
    request_method text
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

    -- A worker that disappears on its twentieth attempt must not leave a row in
    -- in_flight forever. Dead rows are retained in Supabase for investigation and
    -- are deliberately never eligible for pruning.
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
        audit_row.request_method
    from claimed
    join public.audit_logs as audit_row
      on audit_row.id = claimed.audit_log_id
    order by audit_row.id;
end;
$$;

comment on function public.claim_audit_log_export(integer, integer) is
    'Leases a bounded audit batch for at-least-once Sentry export and returns the audit payload.';

-- Completion is all-or-nothing. If a lease expired and was reclaimed, the stale
-- worker cannot acknowledge even part of the batch because its token no longer
-- matches.
create or replace function public.complete_audit_log_export(
    p_audit_log_ids bigint[],
    p_lease_token uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    expected_count integer;
    unique_count integer;
    completed_count integer;
    now_value timestamptz := pg_catalog.clock_timestamp();
begin
    expected_count := pg_catalog.cardinality(p_audit_log_ids);
    if p_lease_token is null or coalesce(expected_count, 0) = 0 then
        raise exception 'Audit export completion requires IDs and a lease token';
    end if;
    if expected_count > 500 then
        raise exception 'Audit export completion accepts at most 500 IDs';
    end if;
    if pg_catalog.array_position(p_audit_log_ids, null::bigint) is not null then
        raise exception 'Audit export IDs may not contain null values';
    end if;

    select pg_catalog.count(distinct provided.audit_log_id)::integer
    into unique_count
    from pg_catalog.unnest(p_audit_log_ids) as provided(audit_log_id);

    if unique_count <> expected_count then
        raise exception 'Audit export IDs must be unique';
    end if;

    update audit_private.audit_log_exports as export_state
    set
        status = 'exported',
        next_attempt_at = now_value,
        lease_token = null,
        leased_until = null,
        exported_at = now_value,
        last_error = null,
        updated_at = now_value
    where export_state.audit_log_id = any(p_audit_log_ids)
      and export_state.status = 'in_flight'
      and export_state.lease_token = p_lease_token;

    get diagnostics completed_count = row_count;
    if completed_count <> expected_count then
        raise exception 'Audit export lease is stale or does not own the complete batch';
    end if;

    return completed_count;
end;
$$;

comment on function public.complete_audit_log_export(bigint[], uuid) is
    'Acknowledges an entire leased audit batch after Sentry ingestion returned a successful HTTP response.';

create or replace function public.fail_audit_log_export(
    p_audit_log_ids bigint[],
    p_lease_token uuid,
    p_error text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    expected_count integer;
    unique_count integer;
    failed_count integer;
    now_value timestamptz := pg_catalog.clock_timestamp();
begin
    expected_count := pg_catalog.cardinality(p_audit_log_ids);
    if p_lease_token is null or coalesce(expected_count, 0) = 0 then
        raise exception 'Audit export failure requires IDs and a lease token';
    end if;
    if expected_count > 500 then
        raise exception 'Audit export failure accepts at most 500 IDs';
    end if;
    if pg_catalog.array_position(p_audit_log_ids, null::bigint) is not null then
        raise exception 'Audit export IDs may not contain null values';
    end if;

    select pg_catalog.count(distinct provided.audit_log_id)::integer
    into unique_count
    from pg_catalog.unnest(p_audit_log_ids) as provided(audit_log_id);

    if unique_count <> expected_count then
        raise exception 'Audit export IDs must be unique';
    end if;

    update audit_private.audit_log_exports as export_state
    set
        status = case
            when export_state.attempt_count >= 20 then 'dead'
            else 'retry'
        end,
        next_attempt_at = case
            when export_state.attempt_count >= 20 then now_value
            else now_value + pg_catalog.make_interval(
                secs => least(
                    21600,
                    (
                        60 * pg_catalog.power(
                            2::numeric,
                            least(greatest(export_state.attempt_count - 1, 0), 9)
                        )
                    )::integer
                )
            )
        end,
        lease_token = null,
        leased_until = null,
        exported_at = null,
        last_error = pg_catalog.left(
            coalesce(nullif(p_error, ''), 'Unknown Sentry export failure'),
            2000
        ),
        updated_at = now_value
    where export_state.audit_log_id = any(p_audit_log_ids)
      and export_state.status = 'in_flight'
      and export_state.lease_token = p_lease_token;

    get diagnostics failed_count = row_count;
    if failed_count <> expected_count then
        raise exception 'Audit export lease is stale or does not own the complete batch';
    end if;

    return failed_count;
end;
$$;

comment on function public.fail_audit_log_export(bigint[], uuid, text) is
    'Releases an entire failed batch with bounded exponential retry and a dead-letter state after 20 attempts.';

-- Retention is deliberately conservative. A row must have a successful export,
-- be older than the configured local retention plus 48 hours, and its export
-- acknowledgement itself must be at least 48 hours old. Pending, retrying,
-- in-flight, and dead rows can never be deleted by this function.
create or replace function public.prune_exported_audit_logs(
    p_retention_days integer default 7,
    p_batch_size integer default 1000
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    now_value timestamptz := pg_catalog.clock_timestamp();
    deleted_count integer;
begin
    if p_retention_days is null or p_retention_days < 1 or p_retention_days > 365 then
        raise exception 'Audit retention must be between 1 and 365 days';
    end if;
    if p_batch_size is null or p_batch_size < 1 or p_batch_size > 5000 then
        raise exception 'Audit prune batch size must be between 1 and 5000';
    end if;

    with candidates as materialized (
        select audit_row.id
        from public.audit_logs as audit_row
        join audit_private.audit_log_exports as export_state
          on export_state.audit_log_id = audit_row.id
        where export_state.status = 'exported'
          and export_state.exported_at <= now_value - interval '48 hours'
          and audit_row.occurred_at <= now_value
              - pg_catalog.make_interval(days => p_retention_days)
              - interval '48 hours'
        order by audit_row.occurred_at, audit_row.id
        limit p_batch_size
        for update of audit_row skip locked
    ),
    deleted as (
        delete from public.audit_logs as audit_row
        using candidates
        where audit_row.id = candidates.id
        returning audit_row.id
    )
    select pg_catalog.count(*)::integer
    into deleted_count
    from deleted;

    return deleted_count;
end;
$$;

comment on function public.prune_exported_audit_logs(integer, integer) is
    'Deletes only Sentry-acknowledged audit rows after local retention and a fixed 48-hour acknowledgement grace.';

create or replace function public.get_audit_export_status()
returns table (
    pending_count bigint,
    retry_count bigint,
    in_flight_count bigint,
    dead_count bigint,
    exported_buffer_count bigint,
    oldest_pending_at timestamptz,
    last_exported_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
    select
        pg_catalog.count(*) filter (where export_state.status = 'pending'),
        pg_catalog.count(*) filter (where export_state.status = 'retry'),
        pg_catalog.count(*) filter (where export_state.status = 'in_flight'),
        pg_catalog.count(*) filter (where export_state.status = 'dead'),
        pg_catalog.count(*) filter (where export_state.status = 'exported'),
        pg_catalog.min(audit_row.occurred_at) filter (
            where export_state.status in ('pending', 'retry', 'in_flight')
        ),
        pg_catalog.max(export_state.exported_at)
    from audit_private.audit_log_exports as export_state
    join public.audit_logs as audit_row
      on audit_row.id = export_state.audit_log_id;
$$;

comment on function public.get_audit_export_status() is
    'Returns private queue health metrics for the superuser audit-log screen.';

-- PUBLIC receives function execution by default in PostgreSQL, so revoke it
-- explicitly before granting only the server-side service role.
revoke all on function public.claim_audit_log_export(integer, integer)
    from public, anon, authenticated, service_role;
revoke all on function public.complete_audit_log_export(bigint[], uuid)
    from public, anon, authenticated, service_role;
revoke all on function public.fail_audit_log_export(bigint[], uuid, text)
    from public, anon, authenticated, service_role;
revoke all on function public.prune_exported_audit_logs(integer, integer)
    from public, anon, authenticated, service_role;
revoke all on function public.get_audit_export_status()
    from public, anon, authenticated, service_role;

grant execute on function public.claim_audit_log_export(integer, integer)
    to service_role;
grant execute on function public.complete_audit_log_export(bigint[], uuid)
    to service_role;
grant execute on function public.fail_audit_log_export(bigint[], uuid, text)
    to service_role;
grant execute on function public.prune_exported_audit_logs(integer, integer)
    to service_role;
grant execute on function public.get_audit_export_status()
    to service_role;

insert into public.audit_logs (
    event_kind,
    category,
    event_type,
    action,
    outcome,
    summary,
    actor_source,
    metadata
)
select
    'system',
    'system',
    'system.audit.sentry_outbox_enabled',
    'enable_sentry_outbox',
    'success',
    'Durable Sentry audit-log export queue was enabled',
    'database_migration',
    pg_catalog.jsonb_build_object(
        'default_retention_days', 7,
        'acknowledgement_grace_hours', 48,
        'maximum_export_attempts', 20,
        'at_least_once_delivery', true
    )
where not exists (
    select 1
    from public.audit_logs
    where event_type = 'system.audit.sentry_outbox_enabled'
);

select pg_catalog.pg_notify('pgrst', 'reload schema');

commit;
