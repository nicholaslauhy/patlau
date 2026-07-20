begin;

create extension if not exists pgcrypto;
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- A single append-only timeline is used for both understandable application
-- events and trigger-captured row changes. It deliberately has no foreign keys:
-- deleting a user or student must not delete the history that explains it.
create table if not exists public.audit_logs (
    id bigint generated always as identity primary key,
    occurred_at timestamptz not null default clock_timestamp(),
    event_kind text not null default 'data_change'
        check (event_kind in ('activity', 'data_change', 'security', 'system')),
    category text not null default 'system',
    event_type text not null,
    action text not null,
    outcome text not null default 'success'
        check (outcome in ('success', 'failure', 'denied', 'accepted', 'warning')),
    summary text not null,
    actor_user_id uuid,
    actor_email text,
    actor_name text,
    actor_role text,
    actor_source text not null default 'database',
    target_table text,
    target_record_id jsonb,
    target_label text,
    changed_fields text[],
    old_values jsonb,
    new_values jsonb,
    metadata jsonb not null default '{}'::jsonb,
    request_id text,
    request_path text,
    request_method text,
    ip_address inet,
    user_agent text,
    search_text text not null default ''
);

comment on table public.audit_logs is
    'Append-only, superuser-viewed history of application activities and database row changes.';
comment on column public.audit_logs.old_values is
    'Redacted row snapshot before a database change.';
comment on column public.audit_logs.new_values is
    'Redacted row snapshot after a database change.';

create index if not exists audit_logs_occurred_at_idx
    on public.audit_logs (occurred_at desc, id desc);
create index if not exists audit_logs_category_time_idx
    on public.audit_logs (category, occurred_at desc);
create index if not exists audit_logs_actor_time_idx
    on public.audit_logs (actor_user_id, occurred_at desc)
    where actor_user_id is not null;
create index if not exists audit_logs_target_time_idx
    on public.audit_logs (target_table, occurred_at desc)
    where target_table is not null;
create index if not exists audit_logs_outcome_time_idx
    on public.audit_logs (outcome, occurred_at desc);
create index if not exists audit_logs_record_id_idx
    on public.audit_logs using gin (target_record_id);
create index if not exists audit_logs_search_text_trgm_idx
    on public.audit_logs using gin (search_text extensions.gin_trgm_ops);
create index if not exists audit_logs_security_dedupe_idx
    on public.audit_logs (event_type, outcome, ip_address, occurred_at desc)
    where ip_address is not null and event_kind = 'security';

-- Authentication throttling must be atomic. Keeping its short-lived counters
-- outside the exposed API schemas also prevents counter rows from cluttering
-- the permanent audit trail.
create schema if not exists audit_private;
revoke all on schema audit_private from public, anon, authenticated, service_role;

create table if not exists audit_private.rate_limit_buckets (
    event_type text not null,
    ip_address inet not null,
    target_label text not null default '',
    bucket_start timestamptz not null,
    attempt_count integer not null default 1 check (attempt_count > 0),
    primary key (event_type, ip_address, target_label, bucket_start)
);

create index if not exists audit_rate_limit_bucket_expiry_idx
    on audit_private.rate_limit_buckets (bucket_start);

alter table audit_private.rate_limit_buckets enable row level security;
drop policy if exists "rate limit buckets are private"
    on audit_private.rate_limit_buckets;
create policy "rate limit buckets are private"
    on audit_private.rate_limit_buckets
    for all to anon, authenticated
    using (false)
    with check (false);
revoke all on table audit_private.rate_limit_buckets
    from public, anon, authenticated, service_role;

create or replace function public.claim_audit_rate_limit(
    p_event_type text,
    p_ip_address text,
    p_target_label text,
    p_limit integer,
    p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    now_value timestamptz := pg_catalog.clock_timestamp();
    bucket_value timestamptz := pg_catalog.date_trunc('minute', now_value);
    normalized_target text := coalesce(pg_catalog.substr(p_target_label, 1, 254), '');
    normalized_ip inet;
    current_count bigint;
begin
    if coalesce(pg_catalog.length(p_event_type), 0) = 0
       or coalesce(pg_catalog.length(p_ip_address), 0) = 0
       or p_limit < 1
       or p_window_seconds < 1
       or p_window_seconds > 86400 then
        raise exception 'Invalid audit rate-limit arguments';
    end if;

    begin
        normalized_ip := p_ip_address::inet;
    exception when invalid_text_representation then
        raise exception 'Invalid audit rate-limit IP address';
    end;

    -- Serialize callers for this exact scope before checking and incrementing.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            p_event_type || '|' || normalized_ip::text || '|' || normalized_target,
            0
        )
    );

    delete from audit_private.rate_limit_buckets
    where bucket_start < now_value - interval '1 day';

    select coalesce(pg_catalog.sum(attempt_count), 0)
    into current_count
    from audit_private.rate_limit_buckets
    where event_type = p_event_type
      and ip_address = normalized_ip
      and target_label = normalized_target
      and bucket_start >= now_value - pg_catalog.make_interval(secs => p_window_seconds);

    if current_count >= p_limit then
        return false;
    end if;

    insert into audit_private.rate_limit_buckets (
        event_type,
        ip_address,
        target_label,
        bucket_start,
        attempt_count
    ) values (
        p_event_type,
        normalized_ip,
        normalized_target,
        bucket_value,
        1
    )
    on conflict (event_type, ip_address, target_label, bucket_start)
    do update set attempt_count =
        audit_private.rate_limit_buckets.attempt_count + 1;

    return true;
end;
$$;

comment on function public.claim_audit_rate_limit(text, text, text, integer, integer) is
    'Atomically reserves one request inside a private rolling rate-limit window.';

-- Redaction is enforced inside Supabase as a second line of defence. Application
-- code must still avoid passing credentials, but a future column named password,
-- token, code, secret, session, cookie, or API key will be masked automatically.
create or replace function public.audit_redact_json(input_value jsonb)
returns jsonb
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
    output_value jsonb;
    item_key text;
    item_value jsonb;
    normalized_key text;
begin
    if input_value is null then
        return null;
    end if;

    if jsonb_typeof(input_value) = 'object' then
        output_value := '{}'::jsonb;
        for item_key, item_value in select key, value from jsonb_each(input_value)
        loop
            normalized_key := lower(regexp_replace(item_key, '([a-z0-9])([A-Z])', '\1_\2', 'g'));
            normalized_key := regexp_replace(normalized_key, '[^a-z0-9]+', '_', 'g');
            if normalized_key ~ '(^|_)(password|passcode|secret|token|code|api_key|authorization|cookie|session)(_|$)' then
                output_value := output_value || jsonb_build_object(item_key, '[REDACTED]');
            else
                output_value := output_value || jsonb_build_object(
                    item_key,
                    public.audit_redact_json(item_value)
                );
            end if;
        end loop;
        return output_value;
    end if;

    if jsonb_typeof(input_value) = 'array' then
        select coalesce(jsonb_agg(public.audit_redact_json(value)), '[]'::jsonb)
        into output_value
        from jsonb_array_elements(input_value);
        return output_value;
    end if;

    return input_value;
end;
$$;

create or replace function public.prepare_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    new.old_values := public.audit_redact_json(new.old_values);
    new.new_values := public.audit_redact_json(new.new_values);
    new.metadata := coalesce(public.audit_redact_json(new.metadata), '{}'::jsonb);
    new.search_text := lower(
        coalesce(new.summary, '') || ' ' ||
        coalesce(new.event_type, '') || ' ' ||
        coalesce(new.action, '') || ' ' ||
        coalesce(new.category, '') || ' ' ||
        coalesce(new.outcome, '') || ' ' ||
        coalesce(new.actor_name, '') || ' ' ||
        coalesce(new.actor_email, '') || ' ' ||
        coalesce(new.actor_role, '') || ' ' ||
        coalesce(new.target_table, '') || ' ' ||
        coalesce(new.target_label, '') || ' ' ||
        coalesce(new.target_record_id::text, '')
    );
    return new;
end;
$$;

drop trigger if exists audit_logs_prepare_insert on public.audit_logs;
create trigger audit_logs_prepare_insert
before insert on public.audit_logs
for each row execute function public.prepare_audit_log();

-- This trigger is intentionally best-effort. An audit infrastructure problem is
-- raised as a database warning but never changes the success/failure behaviour of
-- an attendance, payment, or student operation.
create or replace function public.capture_audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    old_row jsonb;
    new_row jsonb;
    target_row jsonb;
    record_id jsonb;
    changed text[];
    claims jsonb := '{}'::jsonb;
    headers jsonb := '{}'::jsonb;
    jwt_role text;
    audit_actor_id uuid;
    audit_actor_email text;
    audit_actor_name text;
    audit_actor_role text;
    audit_actor_source text;
    audit_event_kind text := 'data_change';
    audit_category text;
    audit_event_type text;
    audit_action text;
    audit_summary text;
    audit_label text;
    audit_request_id text;
    audit_request_path text;
    audit_request_method text;
    audit_user_agent text;
    audit_ip inet;
    forwarded_ip text;
    referer_path text;
    actor_display text;
begin
    if tg_op = 'INSERT' then
        new_row := to_jsonb(new);
        target_row := new_row;
    elsif tg_op = 'UPDATE' then
        old_row := to_jsonb(old);
        new_row := to_jsonb(new);
        target_row := new_row;

        if old_row = new_row then
            return new;
        end if;

        select array_agg(key order by key)
        into changed
        from (
            select key from jsonb_object_keys(old_row) as old_keys(key)
            union
            select key from jsonb_object_keys(new_row) as new_keys(key)
        ) as all_keys
        where old_row -> key is distinct from new_row -> key;
    else
        old_row := to_jsonb(old);
        target_row := old_row;
    end if;

    begin
        claims := coalesce(
            nullif(current_setting('request.jwt.claims', true), '')::jsonb,
            '{}'::jsonb
        );
    exception when others then
        claims := '{}'::jsonb;
    end;

    begin
        headers := coalesce(
            nullif(current_setting('request.headers', true), '')::jsonb,
            '{}'::jsonb
        );
    exception when others then
        headers := '{}'::jsonb;
    end;

    jwt_role := claims ->> 'role';
    audit_actor_id := auth.uid();
    audit_actor_source := case
        when audit_actor_id is not null then 'authenticated'
        when jwt_role = 'service_role' then 'service_role'
        when jwt_role = 'anon' then 'anonymous'
        else 'database'
    end;

    -- A service-role request can carry trusted actor context from a server route.
    -- Client-supplied headers are ignored unless the request itself uses the
    -- protected service-role JWT.
    if jwt_role = 'service_role' then
        begin
            if coalesce(headers ->> 'x-audit-user-id', '') ~
               '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
                audit_actor_id := (headers ->> 'x-audit-user-id')::uuid;
            end if;
        exception when others then
            audit_actor_id := null;
        end;
        audit_actor_source := coalesce(nullif(headers ->> 'x-audit-source', ''), 'service_role');
    end if;

    -- Append-only semantic tables carry the true actor in their own row. This
    -- is more accurate than the service-role database connection used by APIs.
    if tg_table_name = 'student_audit' then
        begin
            audit_actor_id := nullif(target_row ->> 'created_by', '')::uuid;
        exception when others then
            audit_actor_id := null;
        end;
        audit_actor_source := 'attendance_api';
    elsif tg_table_name = 'makeup_payment_events' then
        begin
            audit_actor_id := nullif(target_row ->> 'actor_user_id', '')::uuid;
        exception when others then
            audit_actor_id := null;
        end;
        audit_actor_source := 'payment_event';
    elsif tg_table_name = 'support_status_events' then
        begin
            audit_actor_id := nullif(target_row ->> 'actor_user_id', '')::uuid;
        exception when others then
            audit_actor_id := null;
        end;
        audit_actor_source := coalesce(nullif(target_row ->> 'actor_type', ''), 'support_system');
    elsif tg_table_name = 'support_messages' then
        begin
            audit_actor_id := nullif(target_row ->> 'sender_user_id', '')::uuid;
        exception when others then
            audit_actor_id := null;
        end;
        audit_actor_source := case target_row ->> 'sender_type'
            when 'parent' then 'telegram_parent'
            when 'ai' then 'support_ai'
            when 'superuser' then 'support_superuser'
            else coalesce(audit_actor_source, 'support_system')
        end;
    end if;

    if audit_actor_id is not null then
        select
            user_record.email,
            coalesce(
                user_record.raw_user_meta_data ->> 'name',
                user_record.raw_user_meta_data ->> 'username'
            ),
            coalesce(
                user_record.raw_app_meta_data ->> 'role',
                user_record.raw_user_meta_data ->> 'role',
                jwt_role
            )
        into audit_actor_email, audit_actor_name, audit_actor_role
        from auth.users as user_record
        where user_record.id = audit_actor_id;
    end if;

    if audit_actor_id is null and tg_table_name = 'support_status_events' then
        audit_actor_role := nullif(target_row ->> 'actor_type', '');
    elsif audit_actor_id is null and tg_table_name = 'support_messages' then
        audit_actor_role := nullif(target_row ->> 'sender_type', '');
    end if;

    audit_actor_role := coalesce(audit_actor_role, jwt_role, 'system');
    actor_display := coalesce(audit_actor_name, audit_actor_email, initcap(replace(audit_actor_source, '_', ' ')));

    record_id := jsonb_strip_nulls(jsonb_build_object(
        'id', target_row -> 'id',
        'student_id', target_row -> 'student_id',
        'user_id', target_row -> 'user_id',
        'auth_user_id', target_row -> 'auth_user_id',
        'conversation_id', target_row -> 'conversation_id',
        'email', target_row -> 'email',
        'payment_month', target_row -> 'payment_month',
        'day_name', target_row -> 'day_name',
        'training_type', target_row -> 'training_type',
        'period_key', target_row -> 'period_key'
    ));

    audit_label := coalesce(
        target_row ->> 'student_name',
        target_row ->> 'name',
        target_row ->> 'title',
        target_row ->> 'email',
        target_row ->> 'telegram_handle',
        target_row ->> 'username',
        target_row ->> 'id',
        target_row ->> 'student_id'
    );

    audit_category := case
        when tg_table_name ~ 'attendance|student_audit' then 'attendance'
        when tg_table_name ~ 'payment|paid' then 'payments'
        when tg_table_name ~ 'makeup' then 'makeup'
        when tg_table_name ~ '^support_' then 'support'
        when tg_table_name ~ 'student|session' then 'students'
        when tg_table_name ~ 'profile' then 'profiles'
        else 'system'
    end;

    referer_path := split_part(split_part(coalesce(headers ->> 'referer', ''), '?', 1), '#', 1);
    referer_path := regexp_replace(referer_path, '^https?://[^/]+', '', 'i');

    if jwt_role = 'service_role' then
        audit_request_id := coalesce(
            nullif(headers ->> 'x-audit-request-id', ''),
            nullif(headers ->> 'x-request-id', ''),
            nullif(headers ->> 'x-vercel-id', '')
        );
        audit_request_path := coalesce(
            nullif(headers ->> 'x-audit-path', ''),
            nullif(referer_path, '')
        );
        audit_request_method := nullif(headers ->> 'x-audit-method', '');
        audit_user_agent := left(coalesce(
            nullif(headers ->> 'x-audit-user-agent', ''),
            headers ->> 'user-agent',
            ''
        ), 500);
        forwarded_ip := split_part(coalesce(
            nullif(headers ->> 'x-audit-ip', ''),
            headers ->> 'x-forwarded-for',
            ''
        ), ',', 1);
    else
        audit_request_id := coalesce(
            nullif(headers ->> 'x-request-id', ''),
            nullif(headers ->> 'x-vercel-id', '')
        );
        audit_request_path := nullif(referer_path, '');
        audit_request_method := null;
        audit_user_agent := left(coalesce(headers ->> 'user-agent', ''), 500);
        forwarded_ip := split_part(coalesce(headers ->> 'x-forwarded-for', ''), ',', 1);
    end if;

    audit_request_path := nullif(left(
        split_part(split_part(coalesce(audit_request_path, ''), '?', 1), '#', 1),
        500
    ), '');
    begin
        if btrim(forwarded_ip) <> '' then
            audit_ip := btrim(forwarded_ip)::inet;
        end if;
    exception when others then
        audit_ip := null;
    end;

    -- Chat content is already available in the dedicated Chats history. Keep the
    -- delivery and sender metadata here without duplicating private conversations.
    if tg_table_name = 'support_messages' then
        old_row := case when old_row is null then null else old_row - 'content' - 'source_refs' end;
        new_row := case when new_row is null then null else new_row - 'content' - 'source_refs' end;
    elsif tg_table_name = 'support_conversations' then
        old_row := case when old_row is null then null else old_row - 'last_message_preview' - 'escalation_reason' end;
        new_row := case when new_row is null then null else new_row - 'last_message_preview' - 'escalation_reason' end;
    elsif tg_table_name = 'support_contacts' then
        old_row := case when old_row is null then null else old_row - 'telegram_chat_id' - 'telegram_user_id' end;
        new_row := case when new_row is null then null else new_row - 'telegram_chat_id' - 'telegram_user_id' end;
    end if;

    audit_event_type := 'data.' || lower(tg_op);
    audit_action := lower(tg_op);
    audit_summary := actor_display || ' ' || case tg_op
        when 'INSERT' then 'created'
        when 'UPDATE' then 'updated'
        when 'DELETE' then 'deleted'
        else lower(tg_op)
    end || ' ' || replace(tg_table_name, '_', ' ') ||
        coalesce(' "' || audit_label || '"', '');

    if tg_table_name = 'student_audit' and tg_op = 'INSERT' then
        audit_event_kind := 'activity';
        audit_category := 'attendance';
        audit_action := coalesce(nullif(target_row ->> 'action', ''), 'record_attendance');
        audit_event_type := 'attendance.' || audit_action;
        audit_summary := actor_display || ' recorded "' || audit_action || '" for student ' ||
            coalesce(target_row ->> 'student_id', 'unknown');
    elsif tg_table_name = 'makeup_payment_events' and tg_op = 'INSERT' then
        audit_event_kind := 'activity';
        audit_category := 'payments';
        audit_action := case target_row ->> 'event_type'
            when 'reversed' then 'reverse_payment'
            else 'record_payment'
        end;
        audit_event_type := 'payments.makeup.' || coalesce(nullif(target_row ->> 'event_type', ''), 'recorded');
        audit_summary := actor_display || ' ' || replace(audit_action, '_', ' ') ||
            ' for makeup payment ' || coalesce(target_row ->> 'makeup_topup_payment_id', 'unknown');
    elsif tg_table_name = 'support_status_events' and tg_op = 'INSERT' then
        audit_event_kind := 'activity';
        audit_category := 'support';
        audit_action := 'change_status';
        audit_event_type := 'support.status_changed';
        audit_summary := actor_display || ' changed support conversation status from ' ||
            coalesce(target_row ->> 'from_status', 'new') || ' to ' ||
            coalesce(target_row ->> 'to_status', 'unknown');
    elsif tg_table_name = 'support_messages' and tg_op = 'INSERT' then
        audit_event_kind := 'activity';
        audit_category := 'support';
        audit_action := case
            when target_row ->> 'direction' = 'inbound' then 'receive_parent_message'
            when target_row ->> 'sender_type' = 'ai' then 'send_ai_reply'
            when target_row ->> 'sender_type' = 'superuser' then 'send_support_reply'
            else 'record_support_message'
        end;
        audit_event_type := 'support.message.' || coalesce(nullif(target_row ->> 'direction', ''), 'recorded');
        audit_summary := actor_display || ' ' || replace(audit_action, '_', ' ') ||
            ' for conversation ' || coalesce(target_row ->> 'conversation_id', 'unknown');
    end if;

    insert into public.audit_logs (
        event_kind,
        category,
        event_type,
        action,
        outcome,
        summary,
        actor_user_id,
        actor_email,
        actor_name,
        actor_role,
        actor_source,
        target_table,
        target_record_id,
        target_label,
        changed_fields,
        old_values,
        new_values,
        metadata,
        request_id,
        request_path,
        request_method,
        ip_address,
        user_agent
    ) values (
        audit_event_kind,
        audit_category,
        audit_event_type,
        audit_action,
        'success',
        audit_summary,
        audit_actor_id,
        audit_actor_email,
        audit_actor_name,
        audit_actor_role,
        audit_actor_source,
        tg_table_name,
        nullif(record_id, '{}'::jsonb),
        audit_label,
        changed,
        public.audit_redact_json(old_row),
        public.audit_redact_json(new_row),
        jsonb_build_object('schema', tg_table_schema),
        audit_request_id,
        audit_request_path,
        audit_request_method,
        audit_ip,
        nullif(audit_user_agent, '')
    );

    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
exception when others then
    raise warning 'Audit logging failed for %.%: %', tg_table_schema, tg_table_name, sqlerrm;
    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;

create or replace function public.refresh_audit_triggers()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    table_record record;
    trigger_count integer := 0;
begin
    for table_record in
        select namespace_record.nspname as schema_name, class_record.relname as table_name
        from pg_class as class_record
        join pg_namespace as namespace_record on namespace_record.oid = class_record.relnamespace
        where namespace_record.nspname = 'public'
          and class_record.relkind in ('r', 'p')
          and not class_record.relispartition
          and class_record.relname not in (
              'audit_logs',
              'reset_codes'
          )
    loop
        execute format(
            'drop trigger if exists %I on %I.%I',
            'capture_audit_row_change',
            table_record.schema_name,
            table_record.table_name
        );
        execute format(
            'create trigger %I after insert or update or delete on %I.%I for each row execute function public.capture_audit_row_change()',
            'capture_audit_row_change',
            table_record.schema_name,
            table_record.table_name
        );
        trigger_count := trigger_count + 1;
    end loop;

    return trigger_count;
end;
$$;

select public.refresh_audit_triggers();

alter table public.audit_logs enable row level security;

drop policy if exists "audit logs are service only" on public.audit_logs;
create policy "audit logs are service only"
on public.audit_logs for all to anon, authenticated
using (false) with check (false);

revoke all privileges on public.audit_logs from public, anon, authenticated;
revoke all privileges on sequence public.audit_logs_id_seq from public, anon, authenticated;
revoke all privileges on public.audit_logs from service_role;
revoke all privileges on sequence public.audit_logs_id_seq from service_role;
grant select, insert on public.audit_logs to service_role;
grant usage, select on sequence public.audit_logs_id_seq to service_role;

revoke all on function public.audit_redact_json(jsonb) from public, anon, authenticated;
revoke all on function public.prepare_audit_log() from public, anon, authenticated;
revoke all on function public.capture_audit_row_change() from public, anon, authenticated;
revoke all on function public.refresh_audit_triggers() from public, anon, authenticated;
revoke all on function public.claim_audit_rate_limit(text, text, text, integer, integer)
    from public, anon, authenticated;
grant execute on function public.audit_redact_json(jsonb) to service_role;
grant execute on function public.claim_audit_rate_limit(text, text, text, integer, integer)
    to service_role;
revoke all on function public.refresh_audit_triggers() from service_role;

-- New public tables are private by default. A migration that intentionally adds
-- a browser-writable table must grant authenticated access explicitly.
alter default privileges for role postgres in schema public
    revoke all privileges on tables from anon, authenticated;
alter default privileges for role postgres in schema public
    revoke all privileges on sequences from anon, authenticated;

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
    'system.audit.enabled',
    'enable_audit',
    'success',
    'Comprehensive audit logging was enabled',
    'database_migration',
    jsonb_build_object('triggered_tables', (
        select count(*)
        from pg_trigger
        where tgname = 'capture_audit_row_change'
          and not tgisinternal
    ))
where not exists (
    select 1 from public.audit_logs where event_type = 'system.audit.enabled'
);

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
    'system.audit.hardened',
    'harden_audit',
    'success',
    'Audit logging integrity and sensitive-data protections were verified',
    'database_migration',
    jsonb_build_object(
        'triggered_tables', (
            select count(*)
            from pg_trigger
            where tgname = 'capture_audit_row_change'
              and not tgisinternal
        ),
        'append_only_service_role', true,
        'camel_case_redaction', true,
        'referer_query_stripping', true
    )
where not exists (
    select 1 from public.audit_logs where event_type = 'system.audit.hardened'
);

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
    'system.audit.rate_limits_hardened',
    'harden_audit',
    'success',
    'Atomic authentication rate limits and webhook log-flood protection were enabled',
    'database_migration',
    jsonb_build_object(
        'private_counters', true,
        'atomic_claims', true,
        'retention_hours', 24
    )
where not exists (
    select 1 from public.audit_logs
    where event_type = 'system.audit.rate_limits_hardened'
);

select pg_catalog.pg_notify('pgrst', 'reload schema');

commit;
