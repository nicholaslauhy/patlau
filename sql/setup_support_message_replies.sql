begin;

alter table public.support_messages
    add column if not exists reply_to_message_id bigint;

-- Fail safely if an earlier manual change created the column with a type that
-- cannot reference support_messages.id.
do $migration$
declare
    reply_column_type oid;
    reply_column_not_null boolean;
    reply_column_generated "char";
    reply_column_identity "char";
    reply_column_has_default boolean;
begin
    select
        attribute.atttypid,
        attribute.attnotnull,
        attribute.attgenerated,
        attribute.attidentity,
        attribute.atthasdef
      into
        reply_column_type,
        reply_column_not_null,
        reply_column_generated,
        reply_column_identity,
        reply_column_has_default
      from pg_catalog.pg_attribute as attribute
     where attribute.attrelid = 'public.support_messages'::regclass
       and attribute.attname = 'reply_to_message_id'
       and not attribute.attisdropped;

    if reply_column_type is distinct from 'pg_catalog.int8'::regtype::oid
       or reply_column_not_null
       or reply_column_generated <> ''
       or reply_column_identity <> ''
       or reply_column_has_default
    then
        raise exception
            'public.support_messages.reply_to_message_id must be a nullable, non-generated bigint with no default';
    end if;
end;
$migration$;

-- PostgreSQL requires the referenced column pair to be unique for the
-- same-conversation foreign key. support_messages.id is already globally
-- unique, so this cannot reject any otherwise-valid existing row.
do $migration$
declare
    existing_constraint_type "char";
    existing_constraint_deferrable boolean;
    existing_constraint_columns text[];
begin
    select
        constraint_record.contype,
        constraint_record.condeferrable,
        array_agg(attribute.attname order by key_column.ordinality)
      into
        existing_constraint_type,
        existing_constraint_deferrable,
        existing_constraint_columns
      from pg_catalog.pg_constraint as constraint_record
      cross join lateral unnest(constraint_record.conkey)
          with ordinality as key_column(attnum, ordinality)
      join pg_catalog.pg_attribute as attribute
        on attribute.attrelid = constraint_record.conrelid
       and attribute.attnum = key_column.attnum
     where constraint_record.conrelid = 'public.support_messages'::regclass
       and constraint_record.conname = 'support_messages_conversation_id_id_key'
     group by
        constraint_record.contype,
        constraint_record.condeferrable;

    if existing_constraint_type is null then
        alter table public.support_messages
            add constraint support_messages_conversation_id_id_key
            unique (conversation_id, id);
    elsif existing_constraint_type <> 'u'
       or existing_constraint_deferrable
       or existing_constraint_columns
            is distinct from array['conversation_id', 'id']::text[]
    then
        raise exception
            'support_messages_conversation_id_id_key must be a non-deferrable UNIQUE (conversation_id, id) constraint';
    end if;
end;
$migration$;

alter table public.support_messages
    drop constraint if exists support_messages_reply_not_self;

alter table public.support_messages
    add constraint support_messages_reply_not_self
    check (
        reply_to_message_id is null
        or reply_to_message_id <> id
    )
    not valid;

alter table public.support_messages
    validate constraint support_messages_reply_not_self;

do $migration$
begin
    if exists (
        select 1
          from public.support_messages as reply
          left join public.support_messages as target
            on target.id = reply.reply_to_message_id
         where reply.reply_to_message_id is not null
           and (
                target.id is null
                or target.conversation_id is distinct from reply.conversation_id
           )
    ) then
        raise exception using
            errcode = '23503',
            message = 'Existing support message replies must target a message in the same conversation.';
    end if;
end;
$migration$;

create index if not exists support_messages_reply_target_idx
    on public.support_messages (reply_to_message_id, conversation_id);

-- These trigger functions are retained only on PostgreSQL releases older than
-- 15, whose foreign keys cannot SET NULL on just one referencing column.
create or replace function public.validate_support_message_reply_target()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
    if new.reply_to_message_id is null then
        return new;
    end if;

    if new.reply_to_message_id = new.id then
        raise exception using
            errcode = '23514',
            message = 'A support message cannot reply to itself.';
    end if;

    -- FOR SHARE serializes this check with a concurrent move or deletion of
    -- the target message.
    perform 1
      from public.support_messages as target
     where target.id = new.reply_to_message_id
       and target.conversation_id = new.conversation_id
       for share;

    if not found then
        raise exception using
            errcode = '23503',
            message = 'The replied-to message must belong to the same conversation.';
    end if;

    return new;
end;
$function$;

create or replace function public.guard_support_message_reply_target_move()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
    if new.conversation_id is distinct from old.conversation_id
       and exists (
            select 1
              from public.support_messages as reply
             where reply.reply_to_message_id = old.id
               and reply.conversation_id is distinct from new.conversation_id
       ) then
        raise exception using
            errcode = '23503',
            message = 'A replied-to message cannot be moved to another conversation.';
    end if;

    return new;
end;
$function$;

revoke all on function public.validate_support_message_reply_target()
    from public, anon, authenticated;
revoke all on function public.guard_support_message_reply_target_move()
    from public, anon, authenticated;

drop trigger if exists support_messages_validate_reply_target
    on public.support_messages;
drop trigger if exists support_messages_guard_reply_target_move
    on public.support_messages;

alter table public.support_messages
    drop constraint if exists support_messages_reply_same_conversation_fk;
alter table public.support_messages
    drop constraint if exists support_messages_reply_target_fk;

do $migration$
begin
    if current_setting('server_version_num')::integer >= 150000 then
        -- PostgreSQL 15+ can null only reply_to_message_id when the quoted
        -- message is deleted, preserving the conversation_id of the reply.
        execute $ddl$
            alter table public.support_messages
                add constraint support_messages_reply_same_conversation_fk
                foreign key (conversation_id, reply_to_message_id)
                references public.support_messages (conversation_id, id)
                on update restrict
                on delete set null (reply_to_message_id)
                not valid
        $ddl$;

        alter table public.support_messages
            validate constraint support_messages_reply_same_conversation_fk;

        execute
            'drop function if exists public.validate_support_message_reply_target()';
        execute
            'drop function if exists public.guard_support_message_reply_target_move()';
    else
        -- Compatibility path: the simple FK handles target existence and
        -- deletion, while serialized triggers enforce conversation ownership.
        alter table public.support_messages
            add constraint support_messages_reply_target_fk
            foreign key (reply_to_message_id)
            references public.support_messages (id)
            on update restrict
            on delete set null
            not valid;

        alter table public.support_messages
            validate constraint support_messages_reply_target_fk;

        create trigger support_messages_validate_reply_target
        before insert or update of conversation_id, reply_to_message_id
        on public.support_messages
        for each row
        execute function public.validate_support_message_reply_target();

        create trigger support_messages_guard_reply_target_move
        before update of conversation_id
        on public.support_messages
        for each row
        execute function public.guard_support_message_reply_target_move();
    end if;
end;
$migration$;

comment on column public.support_messages.reply_to_message_id is
    'Optional same-conversation support message quoted by this message.';

-- Existing table grants and RLS policies intentionally remain unchanged.
select pg_catalog.pg_notify('pgrst', 'reload schema');

commit;
