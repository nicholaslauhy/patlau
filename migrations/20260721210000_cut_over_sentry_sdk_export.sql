-- Cut audit delivery over from the retired hand-built Sentry envelopes to the
-- official @sentry/nextjs Logs transport. Any retained row previously marked
-- exported is requeued once because a raw HTTP 2xx did not prove it was indexed.

begin;

create table if not exists audit_private.migration_markers (
    marker text primary key,
    applied_at timestamptz not null default pg_catalog.clock_timestamp()
);

comment on table audit_private.migration_markers is
    'Persistent private markers for one-time audit infrastructure transitions.';

revoke all on table audit_private.migration_markers
    from public, anon, authenticated, service_role;

alter table audit_private.audit_log_exports
    add column if not exists export_transport text;

do $$
declare
    marker_inserted integer := 0;
    requeued_count integer := 0;
begin
    insert into audit_private.migration_markers (marker)
    values ('sentry_nextjs_sdk_export_v1')
    on conflict (marker) do nothing;

    get diagnostics marker_inserted = row_count;

    if marker_inserted = 1 then
        update audit_private.audit_log_exports
        set
            status = 'retry',
            attempt_count = 0,
            next_attempt_at = pg_catalog.clock_timestamp(),
            lease_token = null,
            leased_until = null,
            exported_at = null,
            export_transport = null,
            last_error = 'Requeued during the official Sentry SDK exporter cutover',
            updated_at = pg_catalog.clock_timestamp()
        where status = 'exported'
          and export_transport is null;

        get diagnostics requeued_count = row_count;

        insert into public.audit_logs (
            event_kind,
            category,
            event_type,
            action,
            outcome,
            summary,
            actor_source,
            metadata
        ) values (
            'system',
            'system',
            'system.audit.sentry_sdk_export_cutover',
            'enable_sentry_sdk_audit_export',
            'success',
            'Audit export was moved to the official Sentry SDK transport',
            'database_migration',
            pg_catalog.jsonb_build_object(
                'requeued_legacy_exports', requeued_count,
                'transport', 'sentry_nextjs_sdk_v1',
                'pruning_remains_operator_controlled', true
            )
        );
    end if;
end;
$$;

alter table audit_private.audit_log_exports
    drop constraint if exists audit_log_exports_transport_state_check;
alter table audit_private.audit_log_exports
    add constraint audit_log_exports_transport_state_check check (
        (
            status = 'exported'
            and export_transport is not distinct from 'sentry_nextjs_sdk_v1'
        )
        or
        (
            status <> 'exported'
            and export_transport is null
        )
    );

comment on column audit_private.audit_log_exports.export_transport is
    'The verified application transport that acknowledged an exported audit row.';

create or replace function public.complete_audit_log_export_v2(
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
        export_transport = 'sentry_nextjs_sdk_v1',
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

comment on function public.complete_audit_log_export_v2(bigint[], uuid) is
    'Acknowledges a lease only after the tracked official Sentry SDK transport returned HTTP 2xx.';

-- The legacy raw-envelope completion path must not be able to acknowledge a
-- row after cutover, even if an older application deployment is briefly live.
revoke all on function public.complete_audit_log_export(bigint[], uuid)
    from public, anon, authenticated, service_role;
revoke all on function public.complete_audit_log_export_v2(bigint[], uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.complete_audit_log_export_v2(bigint[], uuid)
    to service_role;

select pg_catalog.pg_notify('pgrst', 'reload schema');

commit;
