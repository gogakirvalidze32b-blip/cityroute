-- Runs safely before migration 030: those assertions are skipped.
-- After supabase/operations/030_edge_only_exam_sessions.sql, they check that
-- browser RPCs are closed and an expired tab lease cannot reach a session.

begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

create function pg_temp.edge_dispatch_ready()
returns boolean
language sql
stable
as $$
  select to_regprocedure('public.exam_edge_dispatch(text,uuid,uuid,text,text,text,text,text,uuid,bigint,jsonb,integer,integer)') is not null;
$$;

create function pg_temp.expired_lease_is_rejected()
returns boolean
language plpgsql
as $$
declare
  ignored jsonb;
begin
  -- Strings stay unchecked until 030 has created the lease tables.
  execute 'insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    ''00000000-0000-0000-0000-000000030001'',
    ''00000000-0000-0000-0000-000000000000'',
    ''authenticated'', ''authenticated'', ''edge-lease@example.test'', '''',
    pg_catalog.now(), ''{}'', ''{}'', pg_catalog.now(), pg_catalog.now()
  ) on conflict (id) do nothing';
  execute 'insert into public.profiles (
    id, subscription_status, subscription_plan, subscription_expires_at,
    device_slots, subscription_payment_id
  ) values (
    ''00000000-0000-0000-0000-000000030001'',
    ''trial'', ''premium'', pg_catalog.now() + interval ''12 hours'', 1, null
  ) on conflict (id) do nothing';
  execute 'insert into auth.sessions (id, user_id, created_at, updated_at) values (
    ''00000000-0000-0000-0000-000000030011'',
    ''00000000-0000-0000-0000-000000030001'',
    pg_catalog.now(), pg_catalog.now()
  ) on conflict (id) do nothing';
  execute 'insert into public.profile_active_sessions (
    profile_id, session_id, session_created_at, activated_at, updated_at,
    device_fingerprint, last_activity_at, last_seen_at
  ) values (
    ''00000000-0000-0000-0000-000000030001'',
    ''00000000-0000-0000-0000-000000030011'',
    pg_catalog.now(), pg_catalog.now(), pg_catalog.now(),
    ''030-device-one'', pg_catalog.now(), pg_catalog.now()
  ) on conflict (profile_id, session_id) do nothing';
  execute 'insert into public.exam_tab_capabilities (
    user_id, device_id, tab_id, auth_session_id, capability_hash, expires_at, revoked_at
  ) values (
    ''00000000-0000-0000-0000-000000030001'',
    ''030-device-one'', ''tab-030-one'',
    ''00000000-0000-0000-0000-000000030011'',
    repeat(''ab'', 32), pg_catalog.now() + interval ''1 day'', null
  ) on conflict (user_id, device_id, tab_id) do update
    set expires_at = excluded.expires_at, revoked_at = null, capability_hash = excluded.capability_hash';
  execute 'insert into public.exam_tab_page_leases (
    user_id, device_id, tab_id, auth_session_id, page_instance_hash, lease_hash, expires_at
  ) values (
    ''00000000-0000-0000-0000-000000030001'',
    ''030-device-one'', ''tab-030-one'',
    ''00000000-0000-0000-0000-000000030011'',
    repeat(''cd'', 32), repeat(''ef'', 32), pg_catalog.now() - interval ''1 minute''
  ) on conflict (user_id, device_id, tab_id) do update
    set expires_at = excluded.expires_at, lease_hash = excluded.lease_hash';
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config(
    'request.jwt.claims',
    '{"role":"service_role","sub":"00000000-0000-0000-0000-000000030001","session_id":"00000000-0000-0000-0000-000000030011"}',
    true
  );
  execute 'select public.exam_edge_dispatch(
    ''session.get'',
    ''00000000-0000-0000-0000-000000030001''::uuid,
    ''00000000-0000-0000-0000-000000030011''::uuid,
    ''030-device-one'',
    ''tab-030-one'',
    repeat(''ab'', 32),
    repeat(''cd'', 32),
    repeat(''ef'', 32),
    ''00000000-0000-0000-0000-000000030099''::uuid,
    null,
    ''{}''::jsonb,
    90,
    86400
  )' into ignored;
  return false;
exception
  when others then
    return sqlerrm = 'exam_page_lease_invalid';
end;
$$;

create function pg_temp.null_tab_id_migration_key_is_rejected()
returns boolean
language plpgsql
as $$
declare
  created_session jsonb;
  ignored jsonb;
begin
  execute 'insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    ''00000000-0000-0000-0000-000000030001'',
    ''00000000-0000-0000-0000-000000000000'',
    ''authenticated'', ''authenticated'', ''edge-lease@example.test'', '''',
    pg_catalog.now(), ''{}'', ''{}'', pg_catalog.now(), pg_catalog.now()
  ) on conflict (id) do nothing';
  execute 'insert into public.profiles (
    id, subscription_status, subscription_plan, subscription_expires_at,
    device_slots, subscription_payment_id
  ) values (
    ''00000000-0000-0000-0000-000000030001'',
    ''trial'', ''premium'', pg_catalog.now() + interval ''12 hours'', 1, null
  ) on conflict (id) do nothing';
  execute 'insert into auth.sessions (id, user_id, created_at, updated_at) values (
    ''00000000-0000-0000-0000-000000030011'',
    ''00000000-0000-0000-0000-000000030001'',
    pg_catalog.now(), pg_catalog.now()
  ) on conflict (id) do nothing';
  execute 'insert into public.profile_active_sessions (
    profile_id, session_id, session_created_at, activated_at, updated_at,
    device_fingerprint, last_activity_at, last_seen_at
  ) values (
    ''00000000-0000-0000-0000-000000030001'',
    ''00000000-0000-0000-0000-000000030011'',
    pg_catalog.now(), pg_catalog.now(), pg_catalog.now(),
    ''030-device-one'', pg_catalog.now(), pg_catalog.now()
  ) on conflict (profile_id, session_id) do nothing';

  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config(
    'request.jwt.claims',
    '{"role":"service_role","sub":"00000000-0000-0000-0000-000000030001","session_id":"00000000-0000-0000-0000-000000030011"}',
    true
  );
  execute $register_first$
    select public.exam_edge_dispatch(
      'tab.register',
      '00000000-0000-0000-0000-000000030001',
      '00000000-0000-0000-0000-000000030011',
      '030-device-one', 'tab-030-null-a',
      repeat('11', 32), repeat('22', 32), repeat('33', 32),
      null, null, '{}'::jsonb, 90, 86400
    )
  $register_first$ into ignored;
  execute $create_first$
    select public.exam_edge_dispatch(
      'session.create',
      '00000000-0000-0000-0000-000000030001',
      '00000000-0000-0000-0000-000000030011',
      '030-device-one', 'tab-030-null-a',
      repeat('11', 32), repeat('22', 32), repeat('33', 32),
      null, null,
      '{"routeSlug":"route-1","progress":{},"errors":{},"elapsedMs":0,"migrationKey":"030-null-tab-key"}'::jsonb,
      90, 86400
    )
  $create_first$ into created_session;

  execute 'update public.exam_sessions set tab_id = null where session_id = $1'
    using (created_session ->> 'session_id')::uuid;

  execute $register_second$
    select public.exam_edge_dispatch(
      'tab.register',
      '00000000-0000-0000-0000-000000030001',
      '00000000-0000-0000-0000-000000030011',
      '030-device-one', 'tab-030-null-b',
      repeat('44', 32), repeat('55', 32), repeat('66', 32),
      null, null, '{}'::jsonb, 90, 86400
    )
  $register_second$ into ignored;
  execute $create_second$
    select public.exam_edge_dispatch(
      'session.create',
      '00000000-0000-0000-0000-000000030001',
      '00000000-0000-0000-0000-000000030011',
      '030-device-one', 'tab-030-null-b',
      repeat('44', 32), repeat('55', 32), repeat('66', 32),
      null, null,
      '{"routeSlug":"route-1","progress":{},"errors":{},"elapsedMs":0,"migrationKey":"030-null-tab-key"}'::jsonb,
      90, 86400
    )
  $create_second$ into ignored;
  return false;
exception
  when others then
    return sqlstate = '42501'
      and sqlerrm = 'exam_session_idempotency_owner_mismatch';
end;
$$;

select case
  when not pg_temp.edge_dispatch_ready() then skip(1, '030 edge dispatch is not installed yet')
  else ok(
    not has_function_privilege(
      'authenticated',
      'public.create_exam_session(text,text,text,jsonb,jsonb,bigint,timestamptz,text,text)',
      'execute'
    ),
    'after 030, authenticated clients cannot call the browser create RPC'
  )
end;

select case
  when not pg_temp.edge_dispatch_ready() then skip(1, '030 edge dispatch is not installed yet')
  else ok(
    not has_function_privilege('anon', 'public.exam_edge_dispatch(text,uuid,uuid,text,text,text,text,text,uuid,bigint,jsonb,integer,integer)', 'execute')
      and not has_function_privilege('authenticated', 'public.exam_edge_dispatch(text,uuid,uuid,text,text,text,text,text,uuid,bigint,jsonb,integer,integer)', 'execute')
      and has_function_privilege('service_role', 'public.exam_edge_dispatch(text,uuid,uuid,text,text,text,text,text,uuid,bigint,jsonb,integer,integer)', 'execute')
      and (select role.rolname = 'postgres'
           from pg_catalog.pg_proc proc
           join pg_catalog.pg_roles role on role.oid = proc.proowner
           where proc.oid = 'public.exam_edge_dispatch(text,uuid,uuid,text,text,text,text,text,uuid,bigint,jsonb,integer,integer)'::regprocedure),
    'after 030, only service_role can execute the edge dispatch'
  )
end;

select case
  when not pg_temp.edge_dispatch_ready() then skip(1, '030 edge dispatch is not installed yet')
  else ok(
    pg_temp.expired_lease_is_rejected(),
    'an expired tab lease cannot read or change an exam session'
  )
end;

select case
  when not pg_temp.edge_dispatch_ready() then skip(1, '030 edge dispatch is not installed yet')
  else ok(
    (select relrowsecurity and relforcerowsecurity
     from pg_catalog.pg_class
     where oid = 'public.exam_tab_capabilities'::regclass)
      and (select relrowsecurity and relforcerowsecurity
           from pg_catalog.pg_class
           where oid = 'public.exam_tab_page_leases'::regclass)
      and not has_table_privilege('service_role', 'public.exam_tab_capabilities', 'select,insert,update,delete')
      and not has_table_privilege('service_role', 'public.exam_tab_page_leases', 'select,insert,update,delete'),
    'capability and lease tables force RLS and grant no direct service_role table privileges'
  )
end;

select case
  when not pg_temp.edge_dispatch_ready() then skip(1, '030 edge dispatch is not installed yet')
  else ok(
    pg_temp.null_tab_id_migration_key_is_rejected(),
    'an existing 028 session with a NULL tab_id cannot be claimed by another tab'
  )
end;

select * from finish();
rollback;
