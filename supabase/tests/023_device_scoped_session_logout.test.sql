begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(28);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000931',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'device-logout-023@example.test', '',
  pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()
)
on conflict (id) do nothing;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000932',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'device-logout-023-other@example.test', '',
  pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()
)
on conflict (id) do nothing;

insert into public.profiles (
  id, subscription_status, subscription_plan, subscription_expires_at,
  device_slots, subscription_payment_id
)
values (
  '00000000-0000-0000-0000-000000000931',
  'active', 'premium', pg_catalog.now() + interval '30 days',
  2, null
)
on conflict (id) do update
set subscription_status = excluded.subscription_status,
    subscription_plan = excluded.subscription_plan,
    subscription_expires_at = excluded.subscription_expires_at,
    device_slots = excluded.device_slots,
    subscription_payment_id = excluded.subscription_payment_id;

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
values
  (
    '00000000-0000-0000-0000-000000000941',
    '00000000-0000-0000-0000-000000000931',
    pg_catalog.now() - interval '2 minutes', pg_catalog.now(), null
  ),
  (
    '00000000-0000-0000-0000-000000000942',
    '00000000-0000-0000-0000-000000000931',
    pg_catalog.now() - interval '1 minute', pg_catalog.now(), null
  );

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
values
  (
    '00000000-0000-0000-0000-000000000945',
    '00000000-0000-0000-0000-000000000932',
    pg_catalog.now() - interval '1 minute', pg_catalog.now(), null
  ),
  (
    '00000000-0000-0000-0000-000000000946',
    '00000000-0000-0000-0000-000000000931',
    pg_catalog.now() - interval '1 minute', pg_catalog.now(), null
  );

insert into public.profile_active_sessions (
  profile_id, session_id, session_created_at, activated_at, updated_at, device_fingerprint
)
values
  (
    '00000000-0000-0000-0000-000000000931',
    '00000000-0000-0000-0000-000000000941',
    pg_catalog.now() - interval '2 minutes', pg_catalog.now() - interval '2 minutes',
    pg_catalog.now(), 'device-logout-023-a'
  ),
  (
    '00000000-0000-0000-0000-000000000931',
    '00000000-0000-0000-0000-000000000942',
    pg_catalog.now() - interval '1 minute', pg_catalog.now() - interval '1 minute',
    pg_catalog.now(), 'device-logout-023-b'
  );

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000931","session_id":"00000000-0000-0000-0000-000000000941","role":"authenticated"}',
  true
);
select set_config(
  'test.logout_response',
  public.deactivate_current_session()::text,
  true
);
select is(
  current_setting('test.logout_response')::jsonb->>'status',
  'deactivated',
  'logout deactivates the current device session'
);
select is(
  (current_setting('test.logout_response')::jsonb->>'deactivated_sessions')::integer,
  1,
  'logout reports one deactivated session'
);
select is(
  jsonb_typeof(current_setting('test.logout_response')::jsonb->'deactivated_sessions'),
  'number',
  'deactivated_sessions is returned as a JSON number'
);
reset role;
set local role authenticated;
select set_config(
  'test.logout_response',
  public.deactivate_current_session()::text,
  true
);
select is(
  current_setting('test.logout_response')::jsonb->>'status',
  'inactive',
  'repeated logout reports an inactive session'
);
select is(
  (current_setting('test.logout_response')::jsonb->>'deactivated_sessions')::integer,
  0,
  'repeated logout reports zero deactivated sessions'
);
reset role;
set local role postgres;
select is(
  (
    select count(*)::integer
    from public.profile_active_sessions
    where profile_id = '00000000-0000-0000-0000-000000000931'
  ),
  1,
  'the other device session remains registered'
);
select is(
  (
    select count(*)::integer
    from public.profile_revoked_sessions
    where profile_id = '00000000-0000-0000-0000-000000000931'
      and session_id = '00000000-0000-0000-0000-000000000941'
  ),
  1,
  'logout revokes the current device session'
);
select is(
  (
    select count(*)::integer
    from public.profile_revoked_sessions
    where profile_id = '00000000-0000-0000-0000-000000000931'
      and session_id = '00000000-0000-0000-0000-000000000942'
  ),
  0,
  'logout does not revoke the other device session'
);
set local role authenticated;
select is(public.has_current_active_session(), false, 'logged-out device loses access');

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000931","session_id":"00000000-0000-0000-0000-000000000942","role":"authenticated"}',
  true
);
select is(public.has_current_active_session(), true, 'the other device remains active');
select is(
  public.deactivate_current_session()->>'status',
  'deactivated',
  'the other device can later log out independently'
);
select is(public.has_current_active_session(), false, 'the second device loses access only after its own logout');

reset role;
set local role postgres;
insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
values
  (
    '00000000-0000-0000-0000-000000000943',
    '00000000-0000-0000-0000-000000000931',
    pg_catalog.now() - interval '2 minutes', pg_catalog.now(), null
  ),
  (
    '00000000-0000-0000-0000-000000000944',
    '00000000-0000-0000-0000-000000000931',
    pg_catalog.now() - interval '1 minute', pg_catalog.now(), null
  );

insert into public.profile_active_sessions (
  profile_id, session_id, session_created_at, activated_at, updated_at, device_fingerprint
)
values
  (
    '00000000-0000-0000-0000-000000000931',
    '00000000-0000-0000-0000-000000000943',
    pg_catalog.now() - interval '2 minutes', pg_catalog.now() - interval '2 minutes',
    pg_catalog.now(), 'device-logout-023-a-reverse'
  ),
  (
    '00000000-0000-0000-0000-000000000931',
    '00000000-0000-0000-0000-000000000944',
    pg_catalog.now() - interval '1 minute', pg_catalog.now() - interval '1 minute',
    pg_catalog.now(), 'device-logout-023-b-reverse'
  );

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000931","session_id":"00000000-0000-0000-0000-000000000944","role":"authenticated"}',
  true
);
select is(
  public.deactivate_current_session()->>'status',
  'deactivated',
  'Device B can log out independently while Device A is active'
);
select is(public.has_current_active_session(), false, 'Device B loses access after its logout');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000931","session_id":"00000000-0000-0000-0000-000000000943","role":"authenticated"}',
  true
);
select is(public.has_current_active_session(), true, 'Device B logout leaves Device A active');
reset role;
set local role postgres;
select is(
  (
    select count(*)::integer
    from public.profile_active_sessions
    where profile_id = '00000000-0000-0000-0000-000000000931'
      and session_id = '00000000-0000-0000-0000-000000000943'
  ),
  1,
  'Device B logout preserves Device A active-session row'
);
select is(
  (
    select count(*)::integer
    from public.profile_revoked_sessions
    where profile_id = '00000000-0000-0000-0000-000000000931'
      and session_id in (
        '00000000-0000-0000-0000-000000000943',
        '00000000-0000-0000-0000-000000000944'
      )
  ),
  1,
  'Device B logout revokes only Device B'
);

insert into public.profile_active_sessions (
  profile_id, session_id, session_created_at, activated_at, updated_at, device_fingerprint
)
values (
  '00000000-0000-0000-0000-000000000931',
  '00000000-0000-0000-0000-000000000945',
  pg_catalog.now() - interval '1 minute', pg_catalog.now() - interval '1 minute',
  pg_catalog.now(), 'device-logout-023-foreign-session'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000931","session_id":"00000000-0000-0000-0000-000000000945","role":"authenticated"}',
  true
);
select set_config(
  'test.logout_response',
  public.deactivate_current_session()::text,
  true
);
select is(
  current_setting('test.logout_response')::jsonb->>'status',
  'inactive',
  'a session owned by another user cannot be deactivated'
);
select is(
  (current_setting('test.logout_response')::jsonb->>'deactivated_sessions')::integer,
  0,
  'foreign session ownership mismatch reports zero deactivated sessions'
);
reset role;
set local role postgres;
select is(
  (
    select count(*)::integer
    from public.profile_active_sessions
    where profile_id = '00000000-0000-0000-0000-000000000931'
      and session_id = '00000000-0000-0000-0000-000000000945'
  ),
  1,
  'ownership mismatch preserves the active-session row'
);
select is(
  (
    select count(*)::integer
    from public.profile_revoked_sessions
    where profile_id = '00000000-0000-0000-0000-000000000931'
      and session_id = '00000000-0000-0000-0000-000000000945'
  ),
  0,
  'ownership mismatch does not create a revoked-session row'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000931","session_id":"00000000-0000-0000-0000-000000000946","role":"authenticated"}',
  true
);
select set_config(
  'test.logout_response',
  public.deactivate_current_session()::text,
  true
);
select is(
  current_setting('test.logout_response')::jsonb->>'status',
  'inactive',
  'an owned but inactive session reports inactive'
);
select is(
  (current_setting('test.logout_response')::jsonb->>'deactivated_sessions')::integer,
  0,
  'an owned but inactive session reports zero deactivated sessions'
);
reset role;
set local role postgres;
select is(
  (
    select count(*)::integer
    from public.profile_revoked_sessions
    where profile_id = '00000000-0000-0000-0000-000000000931'
      and session_id = '00000000-0000-0000-0000-000000000946'
  ),
  0,
  'an owned but inactive session is not added to revoked sessions'
);
select is(
  has_function_privilege('authenticated', 'public.deactivate_current_session()', 'EXECUTE'),
  true,
  'authenticated can execute the logout RPC'
);
select is(
  has_function_privilege('anon', 'public.deactivate_current_session()', 'EXECUTE'),
  false,
  'anon cannot execute the logout RPC'
);
select is(
  has_function_privilege('service_role', 'public.deactivate_current_session()', 'EXECUTE'),
  false,
  'service_role cannot execute the logout RPC'
);
select is(
  not exists (
    select 1
    from pg_catalog.pg_proc p
    cross join lateral aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))
    ) privilege
    where p.oid = 'public.deactivate_current_session()'::regprocedure
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ),
  true,
  'PUBLIC has no explicit EXECUTE grant on the logout RPC'
);

reset role;
select * from finish();
rollback;
