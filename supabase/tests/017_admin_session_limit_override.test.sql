begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000701',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'session-override-target@example.test', '',
    pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()
  ),
  (
    '00000000-0000-0000-0000-000000000702',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'session-override-admin@example.test', '',
    pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()
  )
on conflict (id) do nothing;

insert into public.profiles (
  id, subscription_status, subscription_plan, subscription_expires_at,
  device_slots, subscription_payment_id
)
values
  (
    '00000000-0000-0000-0000-000000000701',
    'trial', 'premium', pg_catalog.now() + interval '12 hours', 1, null
  ),
  (
    '00000000-0000-0000-0000-000000000702',
    'active', 'premium', pg_catalog.now() + interval '30 days', 1, null
  )
on conflict (id) do nothing;

insert into public.support_admins (user_id, note)
values ('00000000-0000-0000-0000-000000000702', 'pgTAP session override fixture')
on conflict (user_id) do nothing;

insert into auth.sessions (id, user_id, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000711', '00000000-0000-0000-0000-000000000701', pg_catalog.now() - interval '3 minutes', pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000712', '00000000-0000-0000-0000-000000000701', pg_catalog.now() - interval '2 minutes', pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000713', '00000000-0000-0000-0000-000000000701', pg_catalog.now() - interval '1 minute', pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000721', '00000000-0000-0000-0000-000000000702', pg_catalog.now() - interval '1 minute', pg_catalog.now())
on conflict (id) do nothing;

insert into public.profile_active_sessions (
  profile_id, session_id, session_created_at, activated_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000702',
    '00000000-0000-0000-0000-000000000721',
    pg_catalog.now() - interval '1 minute',
    pg_catalog.now() - interval '1 minute',
    pg_catalog.now()
  ),
  (
    '00000000-0000-0000-0000-000000000701',
    '00000000-0000-0000-0000-000000000711',
    pg_catalog.now() - interval '3 minutes',
    pg_catalog.now() - interval '3 minutes',
    pg_catalog.now()
  ),
  (
    '00000000-0000-0000-0000-000000000701',
    '00000000-0000-0000-0000-000000000712',
    pg_catalog.now() - interval '2 minutes',
    pg_catalog.now() - interval '2 minutes',
    pg_catalog.now()
  )
on conflict (profile_id, session_id) do nothing;

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.device_session_limit_overrides'::regclass),
  'override grants are protected by RLS'
);
select ok(
  not has_table_privilege('authenticated', 'public.device_session_limit_overrides', 'select')
    and not has_table_privilege('authenticated', 'public.device_session_limit_overrides', 'insert')
    and not has_table_privilege('authenticated', 'public.device_session_limit_overrides', 'update')
    and not has_table_privilege('authenticated', 'public.device_session_limit_overrides', 'delete'),
  'authenticated clients cannot read or modify override records directly'
);
select ok(
  not has_function_privilege('anon', 'public.grant_device_session_limit_override(uuid,text)', 'execute'),
  'anonymous callers cannot grant overrides'
);
select is(
  public.current_device_session_limit('00000000-0000-0000-0000-000000000701'),
  1,
  'an account without verified 179 GEL entitlement or override remains limited to one'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000702', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000702","session_id":"00000000-0000-0000-0000-000000000721","role":"authenticated"}',
  true
);
select lives_ok(
  $$select * from public.grant_device_session_limit_override(
    '00000000-0000-0000-0000-000000000701',
    'Permanent verified support exception'
  )$$,
  'an active support admin can grant a permanent two-session override'
);
select is(
  public.is_support_admin(),
  true,
  'the granting actor is recognized as a support admin with an active session'
);

reset role;
select is(
  public.current_device_session_limit('00000000-0000-0000-0000-000000000701'),
  2,
  'an authorized active override changes the effective limit to two'
);
select is(
  (select count(*)::integer from public.payment_transactions where user_id = '00000000-0000-0000-0000-000000000701'),
  0,
  'manual override does not create or alter payment records'
);
select is(
  (select count(*)::integer from public.device_session_limit_overrides
   where profile_id = '00000000-0000-0000-0000-000000000701'
     and granted_by = '00000000-0000-0000-0000-000000000702'
     and granted_at is not null
     and revoked_at is null),
  1,
  'override records its admin actor and grant time'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000701', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000701","session_id":"00000000-0000-0000-0000-000000000713","role":"authenticated"}',
  true
);
select throws_ok(
  $$select * from public.grant_device_session_limit_override(
    '00000000-0000-0000-0000-000000000701',
    'Attempt by non-admin'
  )$$,
  '42501',
  'Only an active support admin may grant session overrides',
  'a non-admin cannot grant an override'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000702', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000702","session_id":"00000000-0000-0000-0000-000000000799","role":"authenticated"}',
  true
);
select throws_ok(
  $$select * from public.grant_device_session_limit_override(
    '00000000-0000-0000-0000-000000000701',
    'Attempt without active admin session'
  )$$,
  '42501',
  'Only an active support admin may grant session overrides',
  'a listed support admin without an active session cannot grant an override'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000701","session_id":"00000000-0000-0000-0000-000000000711","role":"authenticated"}',
  true
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000701', true);
select is(
  public.has_current_active_session(),
  true,
  'the first existing session remains active'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000701","session_id":"00000000-0000-0000-0000-000000000712","role":"authenticated"}',
  true
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000701', true);
select is(
  public.has_current_active_session(),
  true,
  'the second existing session remains active'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000701","session_id":"00000000-0000-0000-0000-000000000713","role":"authenticated"}',
  true
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000701', true);
select is(
  public.activate_current_session()->>'status',
  'blocked',
  'the third session is blocked'
);
reset role;
select is(
  (select count(*)::integer from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000701'),
  2,
  'blocking the third session leaves both existing sessions active'
);
select is(
  (select count(*)::integer from public.profile_revoked_sessions
   where profile_id = '00000000-0000-0000-0000-000000000701'
     and session_id in (
       '00000000-0000-0000-0000-000000000711',
       '00000000-0000-0000-0000-000000000712'
     )),
  0,
  'the third-session attempt does not revoke either existing session'
);

update public.device_session_limit_overrides
set granted_at = pg_catalog.now() - interval '365 days'
where profile_id = '00000000-0000-0000-0000-000000000701'
  and revoked_at is null;
select is(
  public.current_device_session_limit('00000000-0000-0000-0000-000000000701'),
  2,
  'a permanent override remains active until manually revoked'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000702', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000702","session_id":"00000000-0000-0000-0000-000000000721","role":"authenticated"}',
  true
);
select throws_ok(
  $$select * from public.grant_device_session_limit_override(
    '00000000-0000-0000-0000-000000000701',
    'Duplicate permanent support override'
  )$$,
  '23505',
  'An active session override already exists; revoke it before granting another',
  'only one active override can exist per account'
);
reset role;
select set_config(
  'test.active_override_id',
  (
    select id::text
    from public.device_session_limit_overrides
    where profile_id = '00000000-0000-0000-0000-000000000701'
      and revoked_at is null
    order by id desc
    limit 1
  ),
  true
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000702', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000702","session_id":"00000000-0000-0000-0000-000000000721","role":"authenticated"}',
  true
);
select lives_ok(
  $$select public.revoke_device_session_limit_override(
    current_setting('test.active_override_id')::bigint,
    'Temporary access no longer required'
  )$$,
  'an active support admin can revoke an override with an audit reason'
);
reset role;
select is(
  public.current_device_session_limit('00000000-0000-0000-0000-000000000701'),
  1,
  'a revoked override stops granting the extra slot'
);

select * from finish();
rollback;
