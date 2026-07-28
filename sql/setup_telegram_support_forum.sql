begin;

create extension if not exists pgcrypto;

-- A parent remains in a private chat with the support bot. This table is the
-- single source of truth for safely provisioning and synchronising that
-- conversation's private administrator-group forum topic.
create table if not exists public.telegram_support_forum_topics (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null
        references public.support_conversations(id) on delete cascade,
    telegram_forum_chat_id text not null,
    telegram_message_thread_id bigint,
    header_message_id bigint,
    topic_name text not null,
    lifecycle_status text not null default 'provisioning',
    display_state text not null default 'needs_reply',
    expected_parent_message_id bigint
        references public.support_messages(id) on delete set null,
    provisioning_token uuid not null default gen_random_uuid(),
    provisioning_started_at timestamptz not null default now(),
    last_error_code text,
    closed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- These ADD COLUMN operations make a rerun safe if an earlier revision of this
-- setup file created the mapping table before provisioning state was added.
alter table public.telegram_support_forum_topics
    add column if not exists header_message_id bigint,
    add column if not exists lifecycle_status text,
    add column if not exists display_state text,
    add column if not exists expected_parent_message_id bigint
        references public.support_messages(id) on delete set null,
    add column if not exists provisioning_token uuid,
    add column if not exists provisioning_started_at timestamptz,
    add column if not exists last_error_code text;

alter table public.telegram_support_forum_topics
    alter column telegram_message_thread_id drop not null;

-- Upgrade the short-lived pre-provisioning schema without changing an existing
-- open or closed topic. A retired mapping becomes retryable failed state.
do $$
begin
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'telegram_support_forum_topics'
          and column_name = 'status'
    ) then
        execute $migration$
            update public.telegram_support_forum_topics
            set lifecycle_status = case status
                    when 'open' then 'open'
                    when 'closed' then 'closed'
                    else 'failed'
                end,
                display_state = case
                    when status = 'closed' then 'closed'
                    else 'needs_reply'
                end,
                last_error_code = case
                    when status = 'deleted' then 'topic_mapping_retired'
                    else last_error_code
                end
        $migration$;
    end if;

    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'telegram_support_forum_topics'
          and column_name = 'telegram_header_message_id'
    ) then
        execute $migration$
            update public.telegram_support_forum_topics
            set header_message_id = coalesce(
                header_message_id,
                telegram_header_message_id
            )
        $migration$;
    end if;
end;
$$;

update public.telegram_support_forum_topics
set lifecycle_status = coalesce(lifecycle_status, 'provisioning'),
    display_state = coalesce(display_state, 'needs_reply'),
    provisioning_token = coalesce(provisioning_token, gen_random_uuid()),
    provisioning_started_at = coalesce(provisioning_started_at, created_at, now()),
    closed_at = case
        when coalesce(lifecycle_status, 'provisioning') = 'closed'
            then coalesce(closed_at, updated_at, now())
        else closed_at
    end,
    last_error_code = case
        when coalesce(lifecycle_status, 'provisioning') = 'failed'
            then coalesce(last_error_code, 'topic_provisioning_failed')
        else last_error_code
    end;

alter table public.telegram_support_forum_topics
    alter column lifecycle_status set default 'provisioning',
    alter column lifecycle_status set not null,
    alter column display_state set default 'needs_reply',
    alter column display_state set not null,
    alter column provisioning_token set default gen_random_uuid(),
    alter column provisioning_token set not null,
    alter column provisioning_started_at set default now(),
    alter column provisioning_started_at set not null;

-- Remove constraints and indexes from the earlier status/deleted lifecycle
-- before standardising the current constraints below.
drop index if exists public.telegram_support_forum_topics_current_conversation_idx;
drop index if exists public.telegram_support_forum_topics_status_idx;

alter table public.telegram_support_forum_topics
    drop constraint if exists telegram_support_forum_topics_chat_id_format,
    drop constraint if exists telegram_support_forum_topics_thread_id_positive,
    drop constraint if exists telegram_support_forum_topics_name_length,
    drop constraint if exists telegram_support_forum_topics_status_valid,
    drop constraint if exists telegram_support_forum_topics_deleted_at_valid,
    drop constraint if exists telegram_support_forum_topics_lifecycle_valid,
    drop constraint if exists telegram_support_forum_topics_display_state_valid,
    drop constraint if exists telegram_support_forum_topics_header_id_positive,
    drop constraint if exists telegram_support_forum_topics_error_code_valid,
    drop constraint if exists telegram_support_forum_topics_state_consistent;

alter table public.telegram_support_forum_topics
    drop column if exists status,
    drop column if exists deleted_at,
    drop column if exists telegram_header_message_id;

alter table public.telegram_support_forum_topics
    add constraint telegram_support_forum_topics_chat_id_format check (
        telegram_forum_chat_id ~ '^-[0-9]{5,20}$'
    ),
    add constraint telegram_support_forum_topics_thread_id_positive check (
        telegram_message_thread_id is null
        or telegram_message_thread_id > 0
    ),
    add constraint telegram_support_forum_topics_header_id_positive check (
        header_message_id is null
        or header_message_id > 0
    ),
    add constraint telegram_support_forum_topics_name_length check (
        char_length(btrim(topic_name)) between 1 and 128
    ),
    add constraint telegram_support_forum_topics_lifecycle_valid check (
        lifecycle_status in ('provisioning', 'open', 'closed', 'failed')
    ),
    add constraint telegram_support_forum_topics_display_state_valid check (
        display_state in (
            'needs_reply',
            'coach_active',
            'waiting_parent',
            'ai_handling',
            'closed'
        )
    ),
    add constraint telegram_support_forum_topics_error_code_valid check (
        last_error_code is null
        or last_error_code ~ '^[A-Za-z0-9_.:-]{1,100}$'
    ),
    add constraint telegram_support_forum_topics_state_consistent check (
        (lifecycle_status not in ('open', 'closed')
            or telegram_message_thread_id is not null)
        and (lifecycle_status <> 'failed' or last_error_code is not null)
        and ((lifecycle_status = 'closed') = (display_state = 'closed'))
        and (lifecycle_status <> 'closed' or closed_at is not null)
    );

-- A conversation has one durable provisioning record. The token lets concurrent
-- webhook requests converge on that row instead of creating duplicate topics.
create unique index if not exists telegram_support_forum_topics_conversation_idx
    on public.telegram_support_forum_topics(conversation_id);

create unique index if not exists telegram_support_forum_topics_provisioning_token_idx
    on public.telegram_support_forum_topics(provisioning_token);

create unique index if not exists telegram_support_forum_topics_thread_idx
    on public.telegram_support_forum_topics(
        telegram_forum_chat_id,
        telegram_message_thread_id
    )
    where telegram_message_thread_id is not null;

create unique index if not exists telegram_support_forum_topics_header_idx
    on public.telegram_support_forum_topics(
        telegram_forum_chat_id,
        header_message_id
    )
    where header_message_id is not null;

create index if not exists telegram_support_forum_topics_sync_state_idx
    on public.telegram_support_forum_topics(
        lifecycle_status,
        display_state,
        updated_at desc
    );

create index if not exists telegram_support_forum_topics_provisioning_idx
    on public.telegram_support_forum_topics(provisioning_started_at)
    where lifecycle_status in ('provisioning', 'failed');

create index if not exists telegram_support_forum_topics_expected_message_idx
    on public.telegram_support_forum_topics(expected_parent_message_id)
    where expected_parent_message_id is not null;

-- One notification row is reserved before alerting the forum about a new parent
-- turn. Retried webhooks conflict on the unique turn key instead of posting a
-- duplicate alert into the topic.
create table if not exists public.telegram_support_forum_notifications (
    id uuid primary key default gen_random_uuid(),
    topic_id uuid not null
        references public.telegram_support_forum_topics(id) on delete cascade,
    expected_parent_message_id bigint not null
        references public.support_messages(id) on delete cascade,
    telegram_message_id bigint,
    delivery_status text not null default 'sending',
    failure_code text,
    delivered_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint telegram_support_forum_notifications_message_id_positive check (
        telegram_message_id is null or telegram_message_id > 0
    ),
    constraint telegram_support_forum_notifications_status_valid check (
        delivery_status in ('sending', 'delivered', 'failed')
    ),
    constraint telegram_support_forum_notifications_failure_code_valid check (
        failure_code is null
        or failure_code ~ '^[A-Za-z0-9_.:-]{1,100}$'
    ),
    constraint telegram_support_forum_notifications_state_consistent check (
        (delivery_status <> 'delivered'
            or (telegram_message_id is not null and delivered_at is not null))
        and (delivery_status <> 'failed' or failure_code is not null)
    ),
    unique (topic_id, expected_parent_message_id)
);

create unique index if not exists telegram_support_forum_notifications_message_idx
    on public.telegram_support_forum_notifications(
        topic_id,
        telegram_message_id
    )
    where telegram_message_id is not null;

create index if not exists telegram_support_forum_notifications_delivery_idx
    on public.telegram_support_forum_notifications(
        delivery_status,
        updated_at
    );

-- The first authorised administrator reply for a parent turn claims that turn.
-- Telegram's individual from.id is stored so ownership is not confused with the
-- shared supergroup chat ID.
create table if not exists public.telegram_support_forum_reply_turns (
    id uuid primary key default gen_random_uuid(),
    topic_id uuid not null
        references public.telegram_support_forum_topics(id) on delete cascade,
    conversation_id uuid not null
        references public.support_conversations(id) on delete cascade,
    expected_parent_message_id bigint not null
        references public.support_messages(id) on delete cascade,
    telegram_admin_user_id text not null,
    telegram_admin_display_name text not null,
    claimed_at timestamptz not null default now(),
    last_reply_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint telegram_support_forum_reply_turns_admin_id_format check (
        telegram_admin_user_id ~ '^[0-9]{5,20}$'
    ),
    constraint telegram_support_forum_reply_turns_admin_name_length check (
        char_length(btrim(telegram_admin_display_name)) between 1 and 80
    ),
    unique (conversation_id, expected_parent_message_id)
);

create index if not exists telegram_support_forum_reply_turns_topic_idx
    on public.telegram_support_forum_reply_turns(topic_id, claimed_at desc);

-- One row per administrator message accepted from a forum topic. The unique
-- message key makes webhook retries idempotent; delivery fields make it clear
-- whether that exact reply reached the parent.
create table if not exists public.telegram_support_forum_reply_receipts (
    id uuid primary key default gen_random_uuid(),
    topic_id uuid not null
        references public.telegram_support_forum_topics(id) on delete cascade,
    telegram_message_id bigint not null,
    telegram_admin_user_id text not null,
    telegram_admin_display_name text not null,
    support_message_id bigint
        references public.support_messages(id) on delete set null,
    telegram_parent_message_id bigint,
    delivery_status text not null default 'received',
    delivery_error text,
    delivered_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint telegram_support_forum_receipts_message_id_positive check (
        telegram_message_id > 0
    ),
    constraint telegram_support_forum_receipts_admin_id_format check (
        telegram_admin_user_id ~ '^[0-9]{5,20}$'
    ),
    constraint telegram_support_forum_receipts_admin_name_length check (
        char_length(btrim(telegram_admin_display_name)) between 1 and 80
    ),
    constraint telegram_support_forum_receipts_parent_message_id_positive check (
        telegram_parent_message_id is null or telegram_parent_message_id > 0
    ),
    constraint telegram_support_forum_receipts_delivery_status_valid check (
        delivery_status in ('received', 'sending', 'delivered', 'failed', 'ignored')
    ),
    constraint telegram_support_forum_receipts_delivery_error_length check (
        delivery_error is null or char_length(delivery_error) <= 1000
    ),
    unique (topic_id, telegram_message_id)
);

create index if not exists telegram_support_forum_receipts_delivery_idx
    on public.telegram_support_forum_reply_receipts(delivery_status, created_at);

create index if not exists telegram_support_forum_receipts_support_message_idx
    on public.telegram_support_forum_reply_receipts(support_message_id)
    where support_message_id is not null;

comment on table public.telegram_support_forum_topics is
    'Private service-role mapping between a parent-support conversation and an administrator Telegram forum topic.';
comment on column public.telegram_support_forum_topics.telegram_forum_chat_id is
    'Negative numeric Telegram supergroup chat ID. Never exposed to browser clients.';
comment on column public.telegram_support_forum_topics.telegram_message_thread_id is
    'Telegram message_thread_id for the private administrator forum topic; null while provisioning.';
comment on column public.telegram_support_forum_topics.provisioning_token is
    'Stable idempotency token used to converge concurrent topic-provisioning attempts.';
comment on column public.telegram_support_forum_topics.expected_parent_message_id is
    'Current parent turn that topic replies are expected to answer.';
comment on table public.telegram_support_forum_notifications is
    'Private idempotency and delivery state for one forum alert per parent message.';
comment on table public.telegram_support_forum_reply_turns is
    'Private ownership record identifying the individual Telegram administrator who first claimed a parent turn.';
comment on table public.telegram_support_forum_reply_receipts is
    'Private idempotency and delivery receipts for administrator replies sent from Telegram forum topics to parents.';
comment on column public.telegram_support_forum_reply_receipts.delivery_error is
    'Sanitised delivery failure detail only; secrets and Telegram bot tokens must never be stored here.';

create or replace function public.set_telegram_support_forum_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists telegram_support_forum_topics_set_updated_at
    on public.telegram_support_forum_topics;
create trigger telegram_support_forum_topics_set_updated_at
before update on public.telegram_support_forum_topics
for each row execute function public.set_telegram_support_forum_updated_at();

drop trigger if exists telegram_support_forum_notifications_set_updated_at
    on public.telegram_support_forum_notifications;
create trigger telegram_support_forum_notifications_set_updated_at
before update on public.telegram_support_forum_notifications
for each row execute function public.set_telegram_support_forum_updated_at();

drop trigger if exists telegram_support_forum_reply_turns_set_updated_at
    on public.telegram_support_forum_reply_turns;
create trigger telegram_support_forum_reply_turns_set_updated_at
before update on public.telegram_support_forum_reply_turns
for each row execute function public.set_telegram_support_forum_updated_at();

drop trigger if exists telegram_support_forum_receipts_set_updated_at
    on public.telegram_support_forum_reply_receipts;
create trigger telegram_support_forum_receipts_set_updated_at
before update on public.telegram_support_forum_reply_receipts
for each row execute function public.set_telegram_support_forum_updated_at();

alter table public.telegram_support_forum_topics enable row level security;
alter table public.telegram_support_forum_notifications enable row level security;
alter table public.telegram_support_forum_reply_turns enable row level security;
alter table public.telegram_support_forum_reply_receipts enable row level security;

-- Telegram group IDs, topic mappings and administrator identifiers are private
-- operational data. Only server-side routes using the service role may access
-- these tables; no permissive browser policy is intentionally created.
revoke all privileges on table public.telegram_support_forum_topics
    from public, anon, authenticated;
revoke all privileges on table public.telegram_support_forum_notifications
    from public, anon, authenticated;
revoke all privileges on table public.telegram_support_forum_reply_turns
    from public, anon, authenticated;
revoke all privileges on table public.telegram_support_forum_reply_receipts
    from public, anon, authenticated;

grant select, insert, update, delete on table public.telegram_support_forum_topics
    to service_role;
grant select, insert, update, delete on table public.telegram_support_forum_notifications
    to service_role;
grant select, insert, update, delete on table public.telegram_support_forum_reply_turns
    to service_role;
grant select, insert, update, delete on table public.telegram_support_forum_reply_receipts
    to service_role;

revoke all on function public.set_telegram_support_forum_updated_at()
    from public, anon, authenticated;
grant execute on function public.set_telegram_support_forum_updated_at()
    to service_role;

select pg_catalog.pg_notify('pgrst', 'reload schema');

commit;
