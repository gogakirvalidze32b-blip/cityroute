begin;

-- Apply supabase/operations/015_single_active_auth_session_storage.sql
-- is not required: the existing 010 Storage policies query
-- support_conversations, whose RLS is restricted to active sessions below.
-- The preflight verifies those Storage policies before relying on that guard.

select pg_catalog.pg_advisory_xact_lock(15, 20261029);

do $$
declare
  run_role_oid oid;
  run_role_superuser boolean;
  plan_function oid;
  support_conversation_type oid := 'public.support_conversations'::regtype;
begin
  run_role_oid := current_user::regrole::oid;
  select rolsuper
  into run_role_superuser
  from pg_catalog.pg_roles
  where rolname = current_user;

  if to_regclass('public.profiles') is null
     or to_regclass('public.cities') is null
     or to_regclass('public.routes') is null
     or to_regclass('public.pins') is null
     or to_regclass('public.payment_transactions') is null
     or to_regclass('public.support_admins') is null
     or to_regclass('public.support_conversations') is null
     or to_regclass('public.support_messages') is null
     or to_regclass('public.support_message_attachments') is null
     or to_regclass('storage.objects') is null
     or to_regprocedure('storage.foldername(text)') is null
  then
    raise exception 'Required CityRoute schema is missing; apply the preceding migrations first';
  end if;

  if to_regclass('public.profile_active_sessions') is not null
     or to_regclass('public.profile_revoked_sessions') is not null
     or to_regprocedure('public.has_current_active_session()') is not null
     or to_regprocedure('public.current_device_session_limit(uuid)') is not null
     or to_regprocedure('public.activate_current_session()') is not null
     or to_regprocedure('public.deactivate_current_session()') is not null
     or to_regprocedure('public.get_or_create_support_conversation_without_session_guard()') is not null
     or to_regprocedure('public.send_support_message_without_session_guard(uuid,text,uuid,jsonb,boolean)') is not null
     or to_regprocedure('public.mark_support_read_without_session_guard(uuid,boolean)') is not null
     or to_regprocedure('public.support_admin_list_conversations_without_session_guard(text,integer)') is not null
     or to_regprocedure('public.support_admin_set_status_without_session_guard(uuid,text)') is not null
  then
    raise exception 'Session migration objects already exist; do not rerun 015 or drop objects manually';
  end if;

  if to_regclass('auth.sessions') is null
     or not exists (
       select 1
       from information_schema.columns
       where table_schema = 'auth'
         and table_name = 'sessions'
         and column_name = 'id'
     )
     or not exists (
       select 1
       from information_schema.columns
       where table_schema = 'auth'
         and table_name = 'sessions'
         and column_name = 'user_id'
     )
     or not exists (
       select 1
       from information_schema.columns
       where table_schema = 'auth'
         and table_name = 'sessions'
         and column_name = 'created_at'
         and data_type = 'timestamp with time zone'
     )
     or not exists (
       select 1
       from information_schema.columns
       where table_schema = 'auth'
         and table_name = 'sessions'
         and column_name = 'id'
         and data_type = 'uuid'
     )
     or not exists (
       select 1
       from information_schema.columns
       where table_schema = 'auth'
         and table_name = 'sessions'
         and column_name = 'user_id'
         and data_type = 'uuid'
     )
  then
    raise exception 'auth.sessions must expose id, user_id, and created_at for session enforcement';
  end if;

  if to_regprocedure('public.has_active_access(uuid)') is null
     or to_regprocedure('public.bind_device(text)') is null
     or to_regprocedure('public.has_current_device_access()') is null
     or to_regprocedure('public.get_or_create_support_conversation()') is null
     or to_regprocedure('public.send_support_message(uuid,text,uuid,jsonb,boolean)') is null
     or to_regprocedure('public.mark_support_read(uuid,boolean)') is null
     or to_regprocedure('public.support_admin_list_conversations(text,integer)') is null
     or to_regprocedure('public.support_admin_set_status(uuid,text)') is null
     or to_regprocedure('public.is_support_admin()') is null
  then
    raise exception 'A guarded RPC signature is missing; inspect existing migrations before applying session enforcement';
  end if;

  if (select prorettype from pg_catalog.pg_proc
      where oid = to_regprocedure('public.has_active_access(uuid)')) <> 'boolean'::regtype
     or (select prorettype from pg_catalog.pg_proc
         where oid = to_regprocedure('public.has_current_device_access()')) <> 'boolean'::regtype
     or (select prorettype from pg_catalog.pg_proc
         where oid = to_regprocedure('public.bind_device(text)')) <> 'jsonb'::regtype
     or (select prorettype from pg_catalog.pg_proc
         where oid = to_regprocedure('public.get_or_create_support_conversation()'))
       <> support_conversation_type
     or (select prorettype from pg_catalog.pg_proc
         where oid = to_regprocedure('public.send_support_message(uuid,text,uuid,jsonb,boolean)'))
       <> 'jsonb'::regtype
     or (select prorettype from pg_catalog.pg_proc
         where oid = to_regprocedure('public.mark_support_read(uuid,boolean)')) <> 'void'::regtype
     or (select prorettype from pg_catalog.pg_proc
         where oid = to_regprocedure('public.support_admin_set_status(uuid,text)'))
       <> support_conversation_type
  then
    raise exception 'An existing RPC return type differs from migration 015; inspect Production before applying';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid = to_regprocedure('public.support_admin_list_conversations(text,integer)')
      and p.prorettype = 'record'::regtype
      and p.proretset
      and p.pronargdefaults = 2
      and p.proallargtypes = array[
        'text'::regtype, 'integer'::regtype,
        'uuid'::regtype, 'uuid'::regtype, 'text'::regtype,
        'timestamp with time zone'::regtype, 'text'::regtype,
        'text'::regtype, 'integer'::regtype,
        'timestamp with time zone'::regtype, 'text'::regtype, 'text'::regtype
      ]::oid[]
      and p.proargnames::text[] = array[
        'p_status', 'p_limit', 'id', 'user_id', 'status',
        'last_message_at', 'last_message_preview', 'last_sender_type',
        'admin_unread_count', 'created_at', 'full_name', 'email'
      ]::text[]
  ) then
    raise exception 'support_admin_list_conversations(text,integer) return columns do not match migration 009';
  end if;

  select p.oid
  into plan_function
  from pg_catalog.pg_proc p
  where p.oid = to_regprocedure('public.select_subscription_plan(text)');

  if plan_function is not null
     and (select prorettype from pg_catalog.pg_proc where oid = plan_function) <> 'jsonb'::regtype
  then
    raise exception 'select_subscription_plan(text) must return jsonb for migration 015';
  end if;

  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role')
     or not pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE')
  then
    raise exception 'Migration role is missing required database roles or CREATE privilege on public';
  end if;

  if not run_role_superuser and exists (
    select 1
    from (values
      ('public', 'profiles'),
      ('public', 'cities'),
      ('public', 'routes'),
      ('public', 'pins'),
      ('public', 'payment_transactions'),
      ('public', 'support_admins'),
      ('public', 'support_conversations'),
      ('public', 'support_messages'),
      ('public', 'support_message_attachments')
    ) as required(schema_name, table_name)
    join pg_catalog.pg_class c
      on c.oid = pg_catalog.to_regclass(required.schema_name || '.' || required.table_name)
    where c.relowner <> run_role_oid
  ) then
    raise exception 'Migration role must own every public table whose RLS policies are changed';
  end if;

  if not run_role_superuser and exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid = any(array[
      to_regprocedure('public.has_active_access(uuid)'),
      to_regprocedure('public.has_current_device_access()'),
      to_regprocedure('public.bind_device(text)'),
      to_regprocedure('public.get_or_create_support_conversation()'),
      to_regprocedure('public.send_support_message(uuid,text,uuid,jsonb,boolean)'),
      to_regprocedure('public.mark_support_read(uuid,boolean)'),
      to_regprocedure('public.support_admin_list_conversations(text,integer)'),
      to_regprocedure('public.support_admin_set_status(uuid,text)'),
      to_regprocedure('public.is_support_admin()'),
      to_regprocedure('public.select_subscription_plan(text)')
    ])
    and p.proowner <> run_role_oid
  ) then
    raise exception 'Migration role must own every existing function replaced or renamed by migration 015';
  end if;

  if not run_role_superuser and plan_function is not null
     and not exists (
       select 1
       from pg_catalog.pg_proc p
       where p.oid = plan_function
         and p.proowner = run_role_oid
     )
  then
    raise exception 'Migration role must own select_subscription_plan(text) before replacing it';
  end if;

  if not pg_catalog.has_table_privilege(current_user, 'auth.sessions', 'SELECT')
     or not pg_catalog.has_table_privilege(current_user, 'public.profiles', 'SELECT')
     or not pg_catalog.has_table_privilege(current_user, 'public.payment_transactions', 'SELECT')
  then
    raise exception 'Migration role is missing SELECT privileges required by session and payment entitlement checks';
  end if;

  if exists (
    select 1
    from (values
      ('profiles', 'id', 'uuid'),
      ('profiles', 'subscription_status', 'text'),
      ('profiles', 'subscription_plan', 'text'),
      ('profiles', 'subscription_expires_at', 'timestamp with time zone'),
      ('profiles', 'device_slots', 'integer'),
      ('profiles', 'subscription_payment_id', 'text'),
      ('payment_transactions', 'user_id', 'uuid'),
      ('payment_transactions', 'provider', 'text'),
      ('payment_transactions', 'payment_id', 'text'),
      ('payment_transactions', 'merchant_payment_id', 'text'),
      ('payment_transactions', 'amount', 'numeric'),
      ('payment_transactions', 'currency', 'text'),
      ('payment_transactions', 'status', 'text'),
      ('payment_transactions', 'metadata', 'jsonb'),
      ('payment_transactions', 'paid_at', 'timestamp with time zone')
    ) as required(table_name, column_name, data_type)
    where not exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = required.table_name
        and c.column_name = required.column_name
        and c.data_type = required.data_type
    )
  ) then
    raise exception 'Profile or payment entitlement columns do not match the session migration contract';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'cities'
      and policyname = 'cities_read_subscribed' and cmd = 'SELECT'
  ) or not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'routes'
      and policyname = 'routes_read_subscribed' and cmd = 'SELECT'
  ) or not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'pins'
      and policyname = 'pins_read_subscribed' and cmd = 'SELECT'
  ) then
    raise exception 'Expected 014 protected-data policies are missing; inspect live RLS before applying';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'support_attachments_insert_own'
      and cmd = 'INSERT'
      and with_check like '%support_conversations%'
      and with_check like '%support-attachments%'
  ) or not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'support_attachments_select_participants'
      and cmd = 'SELECT'
      and qual like '%support_conversations%'
      and qual like '%support-attachments%'
      and qual like '%is_support_admin%'
  ) then
    raise exception 'Expected 010 support attachment Storage policies are missing or incompatible with the session guard';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class c
    where c.oid = 'public.support_conversations'::regclass
      and c.relrowsecurity
  ) or not exists (
    select 1
    from pg_catalog.pg_class c
    where c.oid = 'storage.objects'::regclass
      and c.relrowsecurity
  ) then
    raise exception 'RLS must already be enabled on support_conversations and storage.objects';
  end if;
end;
$$;

create table public.profile_active_sessions (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  session_id uuid not null,
  session_created_at timestamptz not null,
  activated_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (profile_id, session_id)
);

create index profile_active_sessions_order_idx
  on public.profile_active_sessions (profile_id, activated_at, session_id);

alter table public.profile_active_sessions enable row level security;
revoke all on public.profile_active_sessions from public, anon, authenticated;

create table public.profile_revoked_sessions (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  session_id uuid not null,
  revoked_at timestamptz not null default pg_catalog.now(),
  primary key (profile_id, session_id)
);

alter table public.profile_revoked_sessions enable row level security;
revoke all on public.profile_revoked_sessions from public, anon, authenticated;

create function public.current_device_session_limit(p_profile_id uuid)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce((
    select case
      when p.subscription_status = 'active'
        and p.subscription_plan = 'premium'
        and p.device_slots = 2
        and (p.subscription_expires_at is null or p.subscription_expires_at > pg_catalog.now())
        and exists (
          select 1
          from public.payment_transactions t
          where t.user_id = p.id
            and t.provider = 'bog'
            and t.payment_id = p.subscription_payment_id
            and t.status = 'success'
            and t.amount = 179
            and t.currency = 'GEL'
            and t.paid_at is not null
            and t.metadata->>'device_slots' = '2'
            and t.metadata->>'bank_status' = 'completed'
            and t.metadata->>'bank_currency' = 'GEL'
            and t.metadata->>'bank_external_order_id' = t.merchant_payment_id
            and case
              when coalesce(t.metadata->>'bank_amount', '') ~ '^[0-9]+(\.[0-9]+)?$'
                then (t.metadata->>'bank_amount')::numeric = 179
              else false
            end
        )
      then 2
      else 1
    end
    from public.profiles p
    where p.id = p_profile_id
  ), 0);
$$;

revoke all on function public.current_device_session_limit(uuid) from public, anon, authenticated;

create or replace function public.has_current_active_session()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  with caller as (
    select auth.uid() as user_id,
           nullif(auth.jwt() ->> 'session_id', '')::uuid as session_id
  ),
  eligible_sessions as (
    select active.session_id,
           pg_catalog.row_number() over (
             order by active.activated_at, active.session_created_at, active.session_id
           ) as slot_number
    from public.profile_active_sessions active
    join caller c on c.user_id = active.profile_id
    join auth.sessions s
      on s.id = active.session_id
     and s.user_id = active.profile_id
    where not exists (
      select 1
      from public.profile_revoked_sessions revoked
      where revoked.profile_id = active.profile_id
        and revoked.session_id = active.session_id
    )
  )
  select exists (
    select 1
    from caller c
    join eligible_sessions active on active.session_id = c.session_id
    where active.slot_number <= public.current_device_session_limit(c.user_id)
  );
$$;

revoke all on function public.has_current_active_session() from public, anon;
grant execute on function public.has_current_active_session() to authenticated;

create or replace function public.has_active_access(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select uid = auth.uid()
    and public.has_current_active_session()
    and exists (
      select 1
      from public.profiles p
      where p.id = uid
        and (
          (
            p.subscription_status = 'active'
            and (
              p.subscription_expires_at is null
              or p.subscription_expires_at > pg_catalog.now()
            )
          )
          or (
            p.subscription_status = 'trial'
            and p.subscription_expires_at > pg_catalog.now()
          )
        )
    );
$$;

revoke all on function public.has_active_access(uuid) from public, anon;
grant execute on function public.has_active_access(uuid) to authenticated;

create or replace function public.has_current_device_access()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select public.has_current_active_session();
$$;

revoke all on function public.has_current_device_access() from public, anon;
grant execute on function public.has_current_device_access() to authenticated;

create or replace function public.bind_device(fp text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  activation_result jsonb;
begin
  if auth.uid() is null then
    return pg_catalog.jsonb_build_object(
      'status', 'blocked',
      'message', 'ეს სესია აღარ არის აქტიური. ხელახლა შედით.'
    );
  end if;

  activation_result := public.activate_current_session();
  if activation_result->>'status' is distinct from 'active' then
    return activation_result;
  end if;

  if fp is null or pg_catalog.length(pg_catalog.btrim(fp)) < 8
     or pg_catalog.length(pg_catalog.btrim(fp)) > 256
  then
    raise exception 'Invalid device fingerprint';
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'ok',
    'fingerprint', pg_catalog.btrim(fp)
  );
end;
$$;

revoke all on function public.bind_device(text) from public, anon;
grant execute on function public.bind_device(text) to authenticated;

create or replace function public.activate_current_session()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  uid uuid := auth.uid();
  current_session_id uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  current_session_created_at timestamptz;
  session_limit integer;
  active_session_count integer;
begin
  if uid is null or current_session_id is null then
    return pg_catalog.jsonb_build_object(
      'status', 'blocked',
      'message', 'ვერ მოხერხდა აქტიური სესიის დადგენა. ხელახლა შედით.'
    );
  end if;

  select s.created_at
  into current_session_created_at
  from auth.sessions s
  where s.id = current_session_id
    and s.user_id = uid;

  if not found then
    return pg_catalog.jsonb_build_object(
      'status', 'blocked',
      'message', 'სესია აღარ არის მოქმედი. ხელახლა შედით.'
    );
  end if;

  perform 1
  from public.profiles p
  where p.id = uid
  for update;

  if not found then
    return pg_catalog.jsonb_build_object(
      'status', 'blocked',
      'message', 'ანგარიშის ინფორმაცია ვერ მოიძებნა'
    );
  end if;

  if exists (
    select 1
    from public.profile_revoked_sessions revoked
    where revoked.profile_id = uid
      and revoked.session_id = current_session_id
  ) then
    return pg_catalog.jsonb_build_object(
      'status', 'blocked',
      'message', 'ეს სესია გასულია. ხელახლა შედით.'
    );
  end if;

  session_limit := public.current_device_session_limit(uid);

  delete from public.profile_active_sessions active
  where active.profile_id = uid
    and not exists (
      select 1
      from auth.sessions s
      where s.id = active.session_id
        and s.user_id = active.profile_id
    );

  with ranked_sessions as (
    select active.session_id,
           pg_catalog.row_number() over (
             order by active.activated_at, active.session_created_at, active.session_id
           ) as slot_number
    from public.profile_active_sessions active
    join auth.sessions s
      on s.id = active.session_id
     and s.user_id = active.profile_id
    where active.profile_id = uid
      and not exists (
        select 1
        from public.profile_revoked_sessions revoked
        where revoked.profile_id = active.profile_id
          and revoked.session_id = active.session_id
      )
  )
  insert into public.profile_revoked_sessions (profile_id, session_id)
  select uid, ranked.session_id
  from ranked_sessions ranked
  where ranked.slot_number > session_limit
  on conflict (profile_id, session_id) do nothing;

  delete from public.profile_active_sessions active
  where active.profile_id = uid
    and exists (
      select 1
      from public.profile_revoked_sessions revoked
      where revoked.profile_id = active.profile_id
        and revoked.session_id = active.session_id
    );

  if exists (
    select 1
    from public.profile_revoked_sessions revoked
    where revoked.profile_id = uid
      and revoked.session_id = current_session_id
  ) then
    return pg_catalog.jsonb_build_object(
      'status', 'blocked',
      'message', 'ეს სესია გასულია. ხელახლა შედით.'
    );
  end if;

  if exists (
    select 1
    from public.profile_active_sessions active
    where active.profile_id = uid
      and active.session_id = current_session_id
  ) then
    return pg_catalog.jsonb_build_object(
      'status', 'active',
      'device_limit', session_limit
    );
  end if;

  select count(*)::integer
  into active_session_count
  from public.profile_active_sessions active
  join auth.sessions s
    on s.id = active.session_id
   and s.user_id = active.profile_id
  where active.profile_id = uid
    and not exists (
      select 1
      from public.profile_revoked_sessions revoked
      where revoked.profile_id = active.profile_id
        and revoked.session_id = active.session_id
    );

  if session_limit = 1 and active_session_count > 0 then
    if exists (
      select 1
      from public.profile_active_sessions active
      join auth.sessions s
        on s.id = active.session_id
       and s.user_id = active.profile_id
      where active.profile_id = uid
        and s.created_at > current_session_created_at
        and not exists (
          select 1
          from public.profile_revoked_sessions revoked
          where revoked.profile_id = active.profile_id
            and revoked.session_id = active.session_id
        )
    ) then
      return pg_catalog.jsonb_build_object(
        'status', 'blocked',
        'message', 'ამ ანგარიშზე უფრო ახალი სესია უკვე აქტიურია. ხელახლა შედით.'
      );
    end if;

    insert into public.profile_revoked_sessions (profile_id, session_id)
    select active.profile_id, active.session_id
    from public.profile_active_sessions active
    where active.profile_id = uid
    on conflict (profile_id, session_id) do nothing;

    delete from public.profile_active_sessions active
    where active.profile_id = uid;

    active_session_count := 0;
  end if;

  if active_session_count >= session_limit then
    return pg_catalog.jsonb_build_object(
      'status', 'blocked',
      'message', pg_catalog.format(
        'ამ ანგარიშზე ერთდროულად მაქსიმუმ %s მოწყობილობა შეიძლება იყოს აქტიური. გამოდით სხვა მოწყობილობიდან და სცადეთ ხელახლა.',
        session_limit
      )
    );
  end if;

  insert into public.profile_active_sessions (
    profile_id,
    session_id,
    session_created_at,
    activated_at,
    updated_at
  )
  values (
    uid,
    current_session_id,
    current_session_created_at,
    pg_catalog.now(),
    pg_catalog.now()
  );

  return pg_catalog.jsonb_build_object(
    'status', 'active',
    'device_limit', session_limit
  );
end;
$$;

revoke all on function public.activate_current_session() from public, anon;
grant execute on function public.activate_current_session() to authenticated;

create or replace function public.deactivate_current_session()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  uid uuid := auth.uid();
  current_session_id uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  if uid is null or current_session_id is null then
    return pg_catalog.jsonb_build_object('status', 'inactive');
  end if;

  perform 1
  from public.profiles p
  where p.id = uid
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('status', 'inactive');
  end if;

  if not exists (
    select 1
    from auth.sessions s
    where s.id = current_session_id
      and s.user_id = uid
  ) then
    return pg_catalog.jsonb_build_object('status', 'inactive');
  end if;

  insert into public.profile_revoked_sessions (profile_id, session_id)
  values (uid, current_session_id)
  on conflict (profile_id, session_id) do nothing;

  delete from public.profile_active_sessions
  where profile_id = uid
    and session_id = current_session_id;

  return pg_catalog.jsonb_build_object('status', 'deactivated');
end;
$$;

revoke all on function public.deactivate_current_session() from public, anon;
grant execute on function public.deactivate_current_session() to authenticated;

create or replace function public.select_subscription_plan(chosen text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  uid uuid := auth.uid();
begin
  if not public.has_current_active_session() then
    raise exception 'This session is no longer active; sign in again'
      using errcode = '28000';
  end if;

  if chosen is null or chosen not in ('nav', 'panel', 'full', 'premium') then
    raise exception 'Invalid plan';
  end if;

  update public.profiles
  set subscription_plan = chosen,
      updated_at = pg_catalog.now()
  where id = uid;

  if not found then
    raise exception 'Profile not found';
  end if;

  return pg_catalog.jsonb_build_object('status', 'ok', 'plan', chosen);
end;
$$;

revoke all on function public.select_subscription_plan(text) from public, anon;
grant execute on function public.select_subscription_plan(text) to authenticated;

alter function public.get_or_create_support_conversation()
  rename to get_or_create_support_conversation_without_session_guard;
revoke all on function public.get_or_create_support_conversation_without_session_guard()
  from public, anon, authenticated;

create function public.get_or_create_support_conversation()
returns public.support_conversations
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if not public.has_current_active_session() then
    raise exception 'This session is no longer active; sign in again'
      using errcode = '28000';
  end if;

  return public.get_or_create_support_conversation_without_session_guard();
end;
$$;

revoke all on function public.get_or_create_support_conversation() from public, anon;
grant execute on function public.get_or_create_support_conversation() to authenticated;

alter function public.send_support_message(uuid, text, uuid, jsonb, boolean)
  rename to send_support_message_without_session_guard;
revoke all on function public.send_support_message_without_session_guard(
  uuid, text, uuid, jsonb, boolean
) from public, anon, authenticated;

create function public.send_support_message(
  p_conversation_id uuid,
  p_body text,
  p_client_id uuid,
  p_attachments jsonb default '[]'::jsonb,
  p_as_admin boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if not public.has_current_active_session() then
    raise exception 'This session is no longer active; sign in again'
      using errcode = '28000';
  end if;

  return public.send_support_message_without_session_guard(
    p_conversation_id,
    p_body,
    p_client_id,
    p_attachments,
    p_as_admin
  );
end;
$$;

revoke all on function public.send_support_message(
  uuid, text, uuid, jsonb, boolean
) from public, anon;
grant execute on function public.send_support_message(
  uuid, text, uuid, jsonb, boolean
) to authenticated;

alter function public.mark_support_read(uuid, boolean)
  rename to mark_support_read_without_session_guard;
revoke all on function public.mark_support_read_without_session_guard(uuid, boolean)
  from public, anon, authenticated;

create function public.mark_support_read(
  p_conversation_id uuid,
  p_as_admin boolean default false
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if not public.has_current_active_session() then
    raise exception 'This session is no longer active; sign in again'
      using errcode = '28000';
  end if;

  perform public.mark_support_read_without_session_guard(p_conversation_id, p_as_admin);
end;
$$;

revoke all on function public.mark_support_read(uuid, boolean) from public, anon;
grant execute on function public.mark_support_read(uuid, boolean) to authenticated;

alter function public.support_admin_list_conversations(text, integer)
  rename to support_admin_list_conversations_without_session_guard;
revoke all on function public.support_admin_list_conversations_without_session_guard(
  text, integer
) from public, anon, authenticated;

create function public.support_admin_list_conversations(
  p_status text default null,
  p_limit integer default 100
)
returns table (
  id uuid,
  user_id uuid,
  status text,
  last_message_at timestamptz,
  last_message_preview text,
  last_sender_type text,
  admin_unread_count integer,
  created_at timestamptz,
  full_name text,
  email text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if not public.has_current_active_session() then
    raise exception 'This session is no longer active; sign in again'
      using errcode = '28000';
  end if;

  return query
  select *
  from public.support_admin_list_conversations_without_session_guard(p_status, p_limit);
end;
$$;

revoke all on function public.support_admin_list_conversations(text, integer) from public, anon;
grant execute on function public.support_admin_list_conversations(text, integer)
  to authenticated;

alter function public.support_admin_set_status(uuid, text)
  rename to support_admin_set_status_without_session_guard;
revoke all on function public.support_admin_set_status_without_session_guard(uuid, text)
  from public, anon, authenticated;

create function public.support_admin_set_status(
  p_conversation_id uuid,
  p_status text
)
returns public.support_conversations
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if not public.has_current_active_session() then
    raise exception 'This session is no longer active; sign in again'
      using errcode = '28000';
  end if;

  return public.support_admin_set_status_without_session_guard(p_conversation_id, p_status);
end;
$$;

revoke all on function public.support_admin_set_status(uuid, text) from public, anon;
grant execute on function public.support_admin_set_status(uuid, text) to authenticated;

create or replace function public.is_support_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select public.has_current_active_session()
    and exists (
      select 1
      from public.support_admins a
      where a.user_id = auth.uid()
    );
$$;

revoke all on function public.is_support_admin() from public, anon;
grant execute on function public.is_support_admin() to authenticated, service_role;

alter table public.payment_transactions enable row level security;
drop policy if exists payment_transactions_read_own_active_session
  on public.payment_transactions;
create policy payment_transactions_read_own_active_session
  on public.payment_transactions for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.has_current_active_session())
  );
drop policy if exists payment_transactions_active_session_guard
  on public.payment_transactions;
create policy payment_transactions_active_session_guard
  on public.payment_transactions as restrictive for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.has_current_active_session())
  );

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    and (select public.has_current_active_session())
  );
drop policy if exists profiles_active_session_select_guard on public.profiles;
create policy profiles_active_session_select_guard
  on public.profiles as restrictive for select to authenticated
  using (
    id = (select auth.uid())
    and (select public.has_current_active_session())
  );

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles for update to authenticated
  using (
    id = (select auth.uid())
    and (select public.has_current_active_session())
  )
  with check (
    id = (select auth.uid())
    and (select public.has_current_active_session())
  );
drop policy if exists profiles_active_session_update_guard on public.profiles;
create policy profiles_active_session_update_guard
  on public.profiles as restrictive for update to authenticated
  using (
    id = (select auth.uid())
    and (select public.has_current_active_session())
  )
  with check (
    id = (select auth.uid())
    and (select public.has_current_active_session())
  );

drop policy if exists cities_read_subscribed on public.cities;
create policy cities_read_subscribed
  on public.cities for select to authenticated
  using (
    public.has_active_access((select auth.uid()))
    and (select public.has_current_active_session())
  );
drop policy if exists cities_active_session_guard on public.cities;
create policy cities_active_session_guard
  on public.cities as restrictive for select to authenticated
  using (
    public.has_active_access((select auth.uid()))
    and (select public.has_current_active_session())
  );

drop policy if exists routes_read_subscribed on public.routes;
create policy routes_read_subscribed
  on public.routes for select to authenticated
  using (
    public.has_active_access((select auth.uid()))
    and (select public.has_current_active_session())
  );
drop policy if exists routes_active_session_guard on public.routes;
create policy routes_active_session_guard
  on public.routes as restrictive for select to authenticated
  using (
    public.has_active_access((select auth.uid()))
    and (select public.has_current_active_session())
  );

drop policy if exists pins_read_subscribed on public.pins;
create policy pins_read_subscribed
  on public.pins for select to authenticated
  using (
    public.has_active_access((select auth.uid()))
    and (select public.has_current_active_session())
  );
drop policy if exists pins_active_session_guard on public.pins;
create policy pins_active_session_guard
  on public.pins as restrictive for select to authenticated
  using (
    public.has_active_access((select auth.uid()))
    and (select public.has_current_active_session())
  );

drop policy if exists support_admins_select_own on public.support_admins;
create policy support_admins_select_own
  on public.support_admins for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.has_current_active_session())
  );
drop policy if exists support_admins_active_session_guard on public.support_admins;
create policy support_admins_active_session_guard
  on public.support_admins as restrictive for select to authenticated
  using ((select public.has_current_active_session()));

drop policy if exists support_conversations_select on public.support_conversations;
create policy support_conversations_select
  on public.support_conversations for select to authenticated
  using (
    (select public.has_current_active_session())
    and (
      user_id = (select auth.uid())
      or (select public.is_support_admin())
    )
  );
drop policy if exists support_conversations_active_session_guard
  on public.support_conversations;
create policy support_conversations_active_session_guard
  on public.support_conversations as restrictive for select to authenticated
  using ((select public.has_current_active_session()));

drop policy if exists support_messages_select on public.support_messages;
create policy support_messages_select
  on public.support_messages for select to authenticated
  using (
    (select public.has_current_active_session())
    and (
      exists (
        select 1
        from public.support_conversations c
        where c.id = support_messages.conversation_id
          and c.user_id = (select auth.uid())
      )
      or (select public.is_support_admin())
    )
  );
drop policy if exists support_messages_active_session_guard
  on public.support_messages;
create policy support_messages_active_session_guard
  on public.support_messages as restrictive for select to authenticated
  using ((select public.has_current_active_session()));

drop policy if exists support_attachments_select on public.support_message_attachments;
create policy support_attachments_select
  on public.support_message_attachments for select to authenticated
  using (
    (select public.has_current_active_session())
    and (
      exists (
        select 1
        from public.support_conversations c
        where c.id = support_message_attachments.conversation_id
          and c.user_id = (select auth.uid())
      )
      or (select public.is_support_admin())
    )
  );
drop policy if exists support_attachments_active_session_guard
  on public.support_message_attachments;
create policy support_attachments_active_session_guard
  on public.support_message_attachments as restrictive for select to authenticated
  using ((select public.has_current_active_session()));

-- 010's storage.objects policies authorize users through a subquery against
-- support_conversations; PostgreSQL applies that table's RLS to the subquery.
-- The admin SELECT branch is separately guarded by is_support_admin().

commit;
