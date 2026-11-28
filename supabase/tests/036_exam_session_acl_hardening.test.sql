-- Run only after operations/036_exam_session_acl_hardening.sql.
-- Catalog-level regression test: API roles cannot bypass the Edge dispatcher.

begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

select ok(
  not exists (
    select 1
    from unnest(array[
      'public.current_exam_device_is_active()',
      'public.current_exam_tab_id()',
      'public.assert_current_exam_device_slot()',
      'public.create_exam_session(text,text,text,jsonb,jsonb,bigint,timestamptz,text,text)',
      'public.get_exam_session(uuid)',
      'public.list_active_exam_sessions()',
      'public.update_exam_session(uuid,bigint,text,jsonb,jsonb,bigint)',
      'public.finish_exam_session(uuid,bigint,jsonb,jsonb,bigint,jsonb)',
      'public.abandon_exam_session(uuid,bigint)'
    ]) as required(signature)
    where to_regprocedure(required.signature) is null
  ),
  'all legacy exam-session routines exist for ACL verification'
);

select ok(
  not exists (
    select 1
    from unnest(array[
      'public.current_exam_device_is_active()',
      'public.current_exam_tab_id()',
      'public.assert_current_exam_device_slot()',
      'public.create_exam_session(text,text,text,jsonb,jsonb,bigint,timestamptz,text,text)',
      'public.get_exam_session(uuid)',
      'public.list_active_exam_sessions()',
      'public.update_exam_session(uuid,bigint,text,jsonb,jsonb,bigint)',
      'public.finish_exam_session(uuid,bigint,jsonb,jsonb,bigint,jsonb)',
      'public.abandon_exam_session(uuid,bigint)'
    ]) as required(signature)
    where has_function_privilege('anon', to_regprocedure(required.signature), 'EXECUTE')
  ),
  'anon cannot execute legacy exam-session routines'
);

select ok(
  not exists (
    select 1
    from unnest(array[
      'public.current_exam_device_is_active()',
      'public.current_exam_tab_id()',
      'public.assert_current_exam_device_slot()',
      'public.create_exam_session(text,text,text,jsonb,jsonb,bigint,timestamptz,text,text)',
      'public.get_exam_session(uuid)',
      'public.list_active_exam_sessions()',
      'public.update_exam_session(uuid,bigint,text,jsonb,jsonb,bigint)',
      'public.finish_exam_session(uuid,bigint,jsonb,jsonb,bigint,jsonb)',
      'public.abandon_exam_session(uuid,bigint)'
    ]) as required(signature)
    where has_function_privilege('authenticated', to_regprocedure(required.signature), 'EXECUTE')
  ),
  'authenticated cannot execute legacy exam-session routines directly'
);

select ok(
  not exists (
    select 1
    from unnest(array[
      'public.current_exam_device_is_active()',
      'public.current_exam_tab_id()',
      'public.assert_current_exam_device_slot()',
      'public.create_exam_session(text,text,text,jsonb,jsonb,bigint,timestamptz,text,text)',
      'public.get_exam_session(uuid)',
      'public.list_active_exam_sessions()',
      'public.update_exam_session(uuid,bigint,text,jsonb,jsonb,bigint)',
      'public.finish_exam_session(uuid,bigint,jsonb,jsonb,bigint,jsonb)',
      'public.abandon_exam_session(uuid,bigint)'
    ]) as required(signature)
    where has_function_privilege('service_role', to_regprocedure(required.signature), 'EXECUTE')
  ),
  'service_role does not use legacy RPCs as an alternate path'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.exam_edge_dispatch(text,uuid,uuid,text,text,text,text,text,uuid,bigint,jsonb,integer,integer,text,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.exam_edge_dispatch(text,uuid,uuid,text,text,text,text,text,uuid,bigint,jsonb,integer,integer,text,text,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.exam_edge_dispatch(text,uuid,uuid,text,text,text,text,text,uuid,bigint,jsonb,integer,integer,text,text,text)',
    'EXECUTE'
  ),
  'only service_role can execute the Edge dispatcher among API roles'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_proc proc
    where proc.oid = to_regprocedure(
      'public.exam_edge_dispatch(text,uuid,uuid,text,text,text,text,text,uuid,bigint,jsonb,integer,integer,text,text,text)'
    )
      and pg_catalog.pg_get_userbyid(proc.proowner) = 'postgres'
      and proc.prosecdef
      and proc.proconfig @> array[
        'search_path=pg_catalog',
        'row_security=off'
      ]::text[]
  ),
  'dispatcher remains postgres-owned SECURITY DEFINER with fixed search_path and RLS disabled'
);

select ok(
  not has_table_privilege(
    'anon', 'public.exam_sessions',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  )
  and not has_table_privilege(
    'authenticated', 'public.exam_sessions',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  )
  and not has_table_privilege(
    'service_role', 'public.exam_sessions',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  )
  and not has_table_privilege(
    'anon', 'public.exam_tab_capabilities',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  )
  and not has_table_privilege(
    'authenticated', 'public.exam_tab_capabilities',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  )
  and not has_table_privilege(
    'service_role', 'public.exam_tab_capabilities',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  )
  and not has_table_privilege(
    'anon', 'public.exam_tab_page_leases',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  )
  and not has_table_privilege(
    'authenticated', 'public.exam_tab_page_leases',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  )
  and not has_table_privilege(
    'service_role', 'public.exam_tab_page_leases',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  ),
  'API roles cannot directly access exam session, capability, or lease tables'
);

select * from finish();
rollback;
