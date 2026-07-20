-- Harden the live Supabase access model without changing the application role matrix.
-- This migration is intentionally transactional: any failed preflight assertion rolls
-- back every policy, grant, function and metadata change below.

begin;

-- Authorization roles belong in protected app metadata. Preserve provider metadata
-- and copy only the three application roles currently used by the website.
do $$
begin
    if exists (
        select 1
        from auth.users
        where raw_user_meta_data ? 'role'
          and raw_user_meta_data ->> 'role' not in ('member', 'admin', 'superuser')
    ) then
        raise exception 'Unexpected role found in auth.users.raw_user_meta_data';
    end if;
end;
$$;

update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('role', raw_user_meta_data ->> 'role')
where raw_user_meta_data ->> 'role' in ('member', 'admin', 'superuser')
  and (raw_app_meta_data ->> 'role') is distinct from (raw_user_meta_data ->> 'role');

do $$
begin
    if exists (
        select 1
        from auth.users
        where raw_user_meta_data ->> 'role' in ('member', 'admin', 'superuser')
          and raw_app_meta_data ->> 'role' is distinct from raw_user_meta_data ->> 'role'
    ) then
        raise exception 'Role backfill did not complete';
    end if;
end;
$$;

-- Read the latest protected role from Auth. Looking it up by auth.uid() avoids a
-- temporary loss of access for users whose existing JWT predates the backfill.
create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select user_record.raw_app_meta_data ->> 'role'
    from auth.users as user_record
    where user_record.id = auth.uid();
$$;

comment on function public.current_app_role() is
    'Returns the current authenticated user role from protected Auth app metadata.';

revoke all on function public.current_app_role() from public;
grant execute on function public.current_app_role() to authenticated, service_role;

create or replace function public.is_support_superuser()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select (select public.current_app_role()) = 'superuser';
$$;

revoke all on function public.is_support_superuser() from public;
grant execute on function public.is_support_superuser() to authenticated, service_role;

-- The students table accumulated overlapping policies. Consolidate them into the
-- same effective role behavior used by the current UI: every signed-in role can
-- read and record attendance, admins can add students, and only superusers delete.
do $$
declare
    policy_record record;
begin
    for policy_record in
        select policyname
        from pg_policies
        where schemaname = 'public' and tablename = 'students'
    loop
        execute format('drop policy if exists %I on public.students', policy_record.policyname);
    end loop;
end;
$$;

create policy "students read for signed-in roles"
on public.students for select to authenticated
using ((select public.current_app_role()) in ('member', 'admin', 'superuser'));

create policy "students add for administrators"
on public.students for insert to authenticated
with check ((select public.current_app_role()) in ('admin', 'superuser'));

create policy "students attendance updates for signed-in roles"
on public.students for update to authenticated
using ((select public.current_app_role()) in ('member', 'admin', 'superuser'))
with check ((select public.current_app_role()) in ('member', 'admin', 'superuser'));

create policy "students delete for superusers"
on public.students for delete to authenticated
using ((select public.current_app_role()) = 'superuser');

-- Rewrite every remaining role policy in place. ALTER POLICY preserves its name,
-- command, target roles and permissive/restrictive behavior.
do $$
declare
    policy_record record;
    using_expression text;
    check_expression text;
    alter_statement text;
begin
    for policy_record in
        select schemaname, tablename, policyname, qual, with_check
        from pg_policies
        where coalesce(qual, '') ilike '%user_metadata%'
           or coalesce(with_check, '') ilike '%user_metadata%'
    loop
        using_expression := policy_record.qual;
        check_expression := policy_record.with_check;

        if using_expression is not null then
            using_expression := replace(
                using_expression,
                'COALESCE(((auth.jwt() -> ''app_metadata''::text) ->> ''role''::text), ((auth.jwt() -> ''user_metadata''::text) ->> ''role''::text))',
                '(select public.current_app_role())'
            );
            using_expression := replace(
                using_expression,
                '((auth.jwt() -> ''user_metadata''::text) ->> ''role''::text)',
                '(select public.current_app_role())'
            );
        end if;

        if check_expression is not null then
            check_expression := replace(
                check_expression,
                'COALESCE(((auth.jwt() -> ''app_metadata''::text) ->> ''role''::text), ((auth.jwt() -> ''user_metadata''::text) ->> ''role''::text))',
                '(select public.current_app_role())'
            );
            check_expression := replace(
                check_expression,
                '((auth.jwt() -> ''user_metadata''::text) ->> ''role''::text)',
                '(select public.current_app_role())'
            );
        end if;

        if coalesce(using_expression, '') ilike '%user_metadata%'
           or coalesce(check_expression, '') ilike '%user_metadata%' then
            raise exception 'Policy %.%.% still contains user_metadata',
                policy_record.schemaname,
                policy_record.tablename,
                policy_record.policyname;
        end if;

        alter_statement := format(
            'alter policy %I on %I.%I',
            policy_record.policyname,
            policy_record.schemaname,
            policy_record.tablename
        );

        if using_expression is not null then
            alter_statement := alter_statement || format(' using (%s)', using_expression);
        end if;

        if check_expression is not null then
            alter_statement := alter_statement || format(' with check (%s)', check_expression);
        end if;

        execute alter_statement;
    end loop;
end;
$$;

do $$
begin
    if exists (
        select 1
        from pg_policies
        where coalesce(qual, '') ilike '%user_metadata%'
           or coalesce(with_check, '') ilike '%user_metadata%'
    ) then
        raise exception 'Insecure user_metadata policy references remain';
    end if;
end;
$$;

-- The default-value table is used only by owner-executed database functions.
alter table public.training_value_rules enable row level security;
drop policy if exists "service-managed training value rules" on public.training_value_rules;
create policy "service-managed training value rules"
on public.training_value_rules for all to anon, authenticated
using (false) with check (false);

-- These two tables are intentionally accessed only through service-role routes.
-- An explicit deny policy documents that design and removes the no-policy advisory.
drop policy if exists "service-only payment summary log" on public.payment_summary_log;
create policy "service-only payment summary log"
on public.payment_summary_log for all to anon, authenticated
using (false) with check (false);

drop policy if exists "service-only reset codes" on public.reset_codes;
create policy "service-only reset codes"
on public.reset_codes for all to anon, authenticated
using (false) with check (false);

-- Weekend payment history is a superuser page. Replace the previous unrestricted
-- authenticated INSERT and DELETE rules while retaining the same superuser workflow.
drop policy if exists "Allow delete for authenticated users" on public.payment_history;
drop policy if exists "Enable insert for authenticated users" on public.payment_history;
drop policy if exists "Enable read access for authenticated users" on public.payment_history;

create policy "payment history read for superusers"
on public.payment_history for select to authenticated
using ((select public.current_app_role()) = 'superuser');

create policy "payment history insert for superusers"
on public.payment_history for insert to authenticated
with check ((select public.current_app_role()) = 'superuser');

create policy "payment history delete for superusers"
on public.payment_history for delete to authenticated
using ((select public.current_app_role()) = 'superuser');

-- Fix the three mutable-search-path findings without changing name resolution.
alter function public.create_payment_history_table()
    set search_path = pg_catalog, public;
alter function public.normalize_student_name(text)
    set search_path = pg_catalog, public;
alter function public.set_support_updated_at()
    set search_path = pg_catalog, public;

-- The website has no anonymous public-schema data access. Authentication and both
-- Telegram webhooks use Auth or server-side service-role clients instead.
revoke all privileges on all tables in schema public from anon;
revoke all privileges on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
revoke usage on schema public from anon;

-- Remove PUBLIC's implicit function execution and explicitly regrant only the RPCs
-- called by signed-in pages. Trigger functions continue to execute through triggers.
revoke execute on all functions in schema public from public;
grant execute on function public.current_app_role() to authenticated, service_role;
grant execute on function public.is_support_superuser() to authenticated, service_role;

do $$
declare
    function_record record;
begin
    for function_record in
        select function_oid::regprocedure as function_signature
        from unnest(array[
            'apply_matchplay_makeup_usage',
            'apply_weekday_makeup_usage',
            'apply_weekend_makeup_usage',
            'cancel_weekend_missed_credit',
            'complete_cross_programme_makeup',
            'find_latest_makeup_credit',
            'reset_weekend_course_and_makeup',
            'undo_cross_programme_makeup',
            'undo_matchplay_makeup_status',
            'undo_one_to_one_makeup_status',
            'undo_weekday_attendance_action'
        ]::text[]) as allowed(function_name)
        cross join lateral (
            select procedure_record.oid as function_oid
            from pg_proc as procedure_record
            join pg_namespace as namespace_record
              on namespace_record.oid = procedure_record.pronamespace
            where namespace_record.nspname = 'public'
              and procedure_record.proname = allowed.function_name
        ) as matching_functions
    loop
        execute format(
            'grant execute on function %s to authenticated',
            function_record.function_signature
        );
    end loop;
end;
$$;

grant usage on schema public to authenticated, service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Direct client access is not used for these service-only or legacy tables.
revoke all privileges on table
    public.payment_summary_log,
    public.reset_codes,
    public.student_audit,
    public.support_announcements,
    public.support_contacts,
    public.support_conversations,
    public.support_knowledge,
    public.support_messages,
    public.support_status_events,
    public.training_value_rules,
    public.one_to_one_payments,
    public.training_sessions
from authenticated;

-- Future objects should not silently regain anonymous access or PUBLIC execution.
alter default privileges for role postgres in schema public
    revoke all privileges on tables from anon;
alter default privileges for role postgres in schema public
    revoke all privileges on sequences from anon;
alter default privileges for role postgres in schema public
    revoke execute on functions from public;

commit;
