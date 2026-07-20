create extension if not exists pgcrypto;

create table if not exists public.support_contacts (
    id uuid primary key default gen_random_uuid(),
    telegram_chat_id text not null unique,
    telegram_user_id text,
    username text,
    first_name text,
    last_name text,
    language_code text,
    blocked boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.support_conversations (
    id uuid primary key default gen_random_uuid(),
    contact_id uuid not null unique references public.support_contacts(id) on delete cascade,
    status text not null default 'ai_active' check (
        status in ('ai_active', 'waiting_parent', 'escalated', 'human_active', 'resolved', 'closed_parent')
    ),
    assigned_to uuid references auth.users(id) on delete set null,
    last_message_at timestamptz not null default now(),
    last_message_preview text,
    unread_count integer not null default 0 check (unread_count >= 0),
    escalation_reason text,
    resolved_at timestamptz,
    closed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.support_messages (
    id bigserial primary key,
    conversation_id uuid not null references public.support_conversations(id) on delete cascade,
    telegram_message_id text,
    direction text not null check (direction in ('inbound', 'outbound')),
    sender_type text not null check (sender_type in ('parent', 'ai', 'superuser', 'system')),
    sender_user_id uuid references auth.users(id) on delete set null,
    content text not null,
    source_refs jsonb not null default '[]'::jsonb,
    telegram_delivery_status text,
    created_at timestamptz not null default now()
);

create unique index if not exists support_messages_telegram_unique
    on public.support_messages(conversation_id, telegram_message_id)
    where telegram_message_id is not null and direction = 'inbound';

create table if not exists public.support_status_events (
    id bigserial primary key,
    conversation_id uuid not null references public.support_conversations(id) on delete cascade,
    from_status text,
    to_status text not null,
    actor_type text not null check (actor_type in ('parent', 'ai', 'superuser', 'system')),
    actor_user_id uuid references auth.users(id) on delete set null,
    reason text,
    created_at timestamptz not null default now()
);

create table if not exists public.support_knowledge (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    category text not null default 'General',
    content text not null,
    status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.support_announcements (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    content text not null,
    programme text not null default 'all',
    starts_on date not null,
    ends_on date not null,
    priority integer not null default 0,
    status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint support_announcement_date_order check (ends_on >= starts_on)
);

create index if not exists support_conversations_status_idx
    on public.support_conversations(status, last_message_at desc);
create index if not exists support_messages_conversation_idx
    on public.support_messages(conversation_id, created_at);
create index if not exists support_announcements_active_idx
    on public.support_announcements(status, starts_on, ends_on, priority desc);
create index if not exists support_knowledge_status_idx
    on public.support_knowledge(status, category, updated_at desc);

create or replace function public.set_support_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists support_contacts_set_updated_at on public.support_contacts;
create trigger support_contacts_set_updated_at before update on public.support_contacts
for each row execute function public.set_support_updated_at();
drop trigger if exists support_conversations_set_updated_at on public.support_conversations;
create trigger support_conversations_set_updated_at before update on public.support_conversations
for each row execute function public.set_support_updated_at();
drop trigger if exists support_knowledge_set_updated_at on public.support_knowledge;
create trigger support_knowledge_set_updated_at before update on public.support_knowledge
for each row execute function public.set_support_updated_at();
drop trigger if exists support_announcements_set_updated_at on public.support_announcements;
create trigger support_announcements_set_updated_at before update on public.support_announcements
for each row execute function public.set_support_updated_at();

alter table public.support_contacts enable row level security;
alter table public.support_conversations enable row level security;
alter table public.support_messages enable row level security;
alter table public.support_status_events enable row level security;
alter table public.support_knowledge enable row level security;
alter table public.support_announcements enable row level security;

create or replace function public.is_support_superuser()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'superuser';
$$;

revoke all on function public.is_support_superuser() from public;
grant execute on function public.is_support_superuser() to authenticated;

drop policy if exists "support superusers manage contacts" on public.support_contacts;
create policy "support superusers manage contacts" on public.support_contacts
for all to authenticated using (public.is_support_superuser()) with check (public.is_support_superuser());
drop policy if exists "support superusers manage conversations" on public.support_conversations;
create policy "support superusers manage conversations" on public.support_conversations
for all to authenticated using (public.is_support_superuser()) with check (public.is_support_superuser());
drop policy if exists "support superusers manage messages" on public.support_messages;
create policy "support superusers manage messages" on public.support_messages
for all to authenticated using (public.is_support_superuser()) with check (public.is_support_superuser());
drop policy if exists "support superusers manage status events" on public.support_status_events;
create policy "support superusers manage status events" on public.support_status_events
for all to authenticated using (public.is_support_superuser()) with check (public.is_support_superuser());
drop policy if exists "support superusers manage knowledge" on public.support_knowledge;
create policy "support superusers manage knowledge" on public.support_knowledge
for all to authenticated using (public.is_support_superuser()) with check (public.is_support_superuser());
drop policy if exists "support superusers manage announcements" on public.support_announcements;
create policy "support superusers manage announcements" on public.support_announcements
for all to authenticated using (public.is_support_superuser()) with check (public.is_support_superuser());
