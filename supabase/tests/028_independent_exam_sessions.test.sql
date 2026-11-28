begin;

select plan(55);

select has_table('public', 'exam_sessions', 'exam_sessions table exists');
select has_column('public', 'exam_sessions', 'session_id', 'session_id primary identifier exists');
select has_column('auth', 'users', 'id', 'Supabase Auth users table exists');
select has_column('auth', 'sessions', 'id', 'Supabase Auth sessions identifier exists');
select has_column('auth', 'sessions', 'user_id', 'Supabase Auth session owner exists');
select has_column('auth', 'sessions', 'not_after', 'Supabase Auth session expiry exists');

select has_function('public', 'create_exam_session', array['text','text','text','jsonb','jsonb','bigint','timestamp with time zone','text','text'],
  'create RPC exists');
select has_function('public', 'get_exam_session', array['uuid'], 'get RPC exists');
select has_function('public', 'list_active_exam_sessions', array[], 'list RPC exists');
select has_function('public', 'update_exam_session', array['uuid','bigint','text','jsonb','jsonb','bigint'],
  'update RPC exists');
select has_function('public', 'finish_exam_session', array['uuid','bigint','jsonb','jsonb','bigint','jsonb'],
  'finish RPC exists');
select has_function('public', 'abandon_exam_session', array['uuid','bigint'],
  'abandon RPC exists');
select has_function('public', 'current_exam_device_is_active', array[]::text[],
  'server-side current device ownership helper exists');

select col_is_pk('public', 'exam_sessions', 'session_id', 'session primary key is session_id');
select col_is_not_null('public', 'exam_sessions', 'user_id', 'owner is required');
select col_is_not_null('public', 'exam_sessions', 'device_id', 'device owner is required');
select col_is_not_null('public', 'exam_sessions', 'route_slug', 'route is required');
select col_is_not_null('public', 'exam_sessions', 'version', 'version is required');
select col_is_not_null('public', 'exam_sessions', 'progress', 'progress is required');
select col_is_not_null('public', 'exam_sessions', 'errors', 'errors are required');
select col_is_not_null('public', 'exam_sessions', 'elapsed_ms', 'elapsed time is required');

select policies_are('public', 'exam_sessions', array[
  'exam_sessions_select_own',
  'exam_sessions_insert_own',
  'exam_sessions_update_own',
  'exam_sessions_delete_own'
], 'exam_sessions has owner-only RLS policies');

select is(pg_catalog.to_regclass('public.profile_active_sessions'), 'public.profile_active_sessions'::regclass,
  'server-side device registry exists');
select ok(
  pg_catalog.to_regclass('public.profile_active_sessions_order_idx') is not null
  and pg_catalog.to_regclass('public.profile_active_sessions_device_fingerprint_idx') is not null,
  'device registry ordering and unique fingerprint indexes exist'
);
select ok(
  (select relrowsecurity
   from pg_catalog.pg_class
   where oid = 'public.profile_active_sessions'::regclass)
  and
  (select relrowsecurity
   from pg_catalog.pg_class
   where oid = 'public.profile_revoked_sessions'::regclass),
  'device registry tables retain RLS'
);
select ok(
  has_function_privilege('authenticated', 'auth.uid()'::regprocedure, 'EXECUTE')
  and has_function_privilege('authenticated', 'auth.jwt()'::regprocedure, 'EXECUTE'),
  'authenticated callers can use Supabase Auth identity helpers'
);
select ok(
  not has_table_privilege('authenticated', 'public.profile_active_sessions', 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('authenticated', 'public.profile_revoked_sessions', 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('anon', 'public.profile_active_sessions', 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('anon', 'public.profile_revoked_sessions', 'SELECT, INSERT, UPDATE, DELETE'),
  'device registry tables remain inaccessible directly to browser roles'
);

select ok(
  pg_catalog.pg_get_indexdef(
    (select indexrelid from pg_catalog.pg_index where indrelid = 'public.exam_sessions'::regclass
      and indexrelid = 'public.exam_sessions_user_device_migration_key_idx'::regclass)
  ) like '%(user_id, device_id, migration_key)%',
  'migration key uniqueness is scoped by user and device'
);

select ok(
  pg_catalog.pg_get_functiondef('public.create_exam_session(text,text,text,jsonb,jsonb,bigint,timestamptz,text,text)'::regprocedure)
    like '%current_exam_device_is_active%',
  'create RPC requires server-side current device ownership'
);

select ok(
  pg_catalog.pg_get_functiondef('public.update_exam_session(uuid,bigint,text,jsonb,jsonb,bigint)'::regprocedure)
    like '%status in (''active'', ''paused'')%',
  'update RPC allows only active or paused sessions'
);

select ok(
  pg_catalog.pg_get_functiondef('public.finish_exam_session(uuid,bigint,jsonb,jsonb,bigint,jsonb)'::regprocedure)
    like '%status in (''active'', ''paused'')%',
  'finish RPC allows only active or paused sessions'
);

select ok(
  pg_catalog.pg_get_functiondef('public.finish_exam_session(uuid,bigint,jsonb,jsonb,bigint,jsonb)'::regprocedure)
    like '%Abandoned exam sessions cannot be finished%',
  'finish RPC rejects abandoned sessions'
);

select ok(
  pg_catalog.pg_get_functiondef('public.abandon_exam_session(uuid,bigint)'::regprocedure)
    like '%current_exam_device_is_active%',
  'abandon RPC requires server-side current device ownership'
);

select ok(
  pg_catalog.pg_get_functiondef('public.abandon_exam_session(uuid,bigint)'::regprocedure)
    like '%current_status = ''abandoned''%',
  'abandon RPC has idempotent abandoned handling'
);

select ok(
  pg_catalog.pg_get_functiondef('public.abandon_exam_session(uuid,bigint)'::regprocedure)
    like '%Completed exam sessions cannot be abandoned%',
  'abandon RPC rejects completed sessions'
);

select ok(
  pg_catalog.pg_get_functiondef('public.create_exam_session(text,text,text,jsonb,jsonb,bigint,timestamptz,text,text)'::regprocedure)
    like '%existing_session.device_id = header_device_id%',
  'migration lookup is device scoped'
);

select ok(
  has_function_privilege('authenticated', 'public.create_exam_session(text,text,text,jsonb,jsonb,bigint,timestamptz,text,text)'::regprocedure, 'EXECUTE'),
  'authenticated can execute create RPC'
);
select ok(
  not has_function_privilege('anon', 'public.create_exam_session(text,text,text,jsonb,jsonb,bigint,timestamptz,text,text)'::regprocedure, 'EXECUTE'),
  'anon cannot execute create RPC'
);
select ok(
  has_function_privilege('authenticated', 'public.get_exam_session(uuid)'::regprocedure, 'EXECUTE'),
  'authenticated can execute get RPC'
);
select ok(
  has_function_privilege('authenticated', 'public.list_active_exam_sessions()'::regprocedure, 'EXECUTE'),
  'authenticated can execute list RPC'
);
select ok(
  has_function_privilege('authenticated', 'public.update_exam_session(uuid,bigint,text,jsonb,jsonb,bigint)'::regprocedure, 'EXECUTE'),
  'authenticated can execute update RPC'
);
select ok(
  has_function_privilege('authenticated', 'public.finish_exam_session(uuid,bigint,jsonb,jsonb,bigint,jsonb)'::regprocedure, 'EXECUTE'),
  'authenticated can execute finish RPC'
);
select ok(
  has_function_privilege('authenticated', 'public.abandon_exam_session(uuid,bigint)'::regprocedure, 'EXECUTE'),
  'authenticated can execute abandon RPC'
);

select ok(
  not has_table_privilege('authenticated', 'public.exam_sessions', 'INSERT, UPDATE, DELETE, SELECT'),
  'direct authenticated table privileges are revoked'
);

select ok(
  not has_table_privilege('anon', 'public.exam_sessions', 'INSERT, UPDATE, DELETE, SELECT'),
  'direct anon table privileges are revoked'
);

select ok(
  not has_table_privilege('service_role', 'public.exam_sessions', 'INSERT, UPDATE, DELETE, SELECT'),
  'direct service_role table privileges are revoked'
);

select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.exam_sessions'::regclass),
  'exam_sessions has enabled and forced RLS'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.current_exam_device_is_active()'::regprocedure,
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.current_exam_device_is_active()'::regprocedure,
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.current_exam_device_is_active()'::regprocedure,
    'EXECUTE'
  ),
  'current device helper is executable only by authenticated callers'
);

select ok(
  (select prosecdef and proconfig @> array['search_path=pg_catalog, public, auth']
   from pg_catalog.pg_proc
   where oid = 'public.current_exam_device_is_active()'::regprocedure),
  'current device helper is SECURITY DEFINER with a fixed search_path'
);

select ok(
  pg_catalog.pg_get_functiondef('public.current_exam_device_is_active()'::regprocedure)
    like '%active.device_fingerprint = c.device_id%',
  'server registry fingerprint must match the current device header'
);

select ok(
  pg_catalog.pg_get_functiondef('public.current_exam_device_is_active()'::regprocedure)
    like '%profile_revoked_sessions revoked%',
  'revoked auth sessions are rejected by current device ownership'
);

select ok(
  pg_catalog.pg_get_functiondef('public.current_exam_device_is_active()'::regprocedure)
    like '%active.session_id = c.session_id%',
  'current JWT auth session must own the registry device binding'
);

select ok(
  pg_catalog.pg_get_functiondef('public.update_exam_session(uuid,bigint,text,jsonb,jsonb,bigint)'::regprocedure)
    like '%errcode = ''40001''%',
  'update RPC preserves version conflict handling'
);

select ok(
  pg_catalog.pg_get_functiondef('public.finish_exam_session(uuid,bigint,jsonb,jsonb,bigint,jsonb)'::regprocedure)
    like '%errcode = ''40001''%',
  'finish RPC preserves version conflict handling'
);

select ok(
  pg_catalog.pg_get_functiondef('public.abandon_exam_session(uuid,bigint)'::regprocedure)
    like '%errcode = ''40001''%',
  'abandon RPC preserves version conflict handling'
);

select finish();
rollback;
