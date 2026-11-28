-- Behavioral coverage for migration 031. Run only after 027, 028, and 031.
-- Browser tabs share the device slot of their authenticated device.

begin;

create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000031001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tab-isolation-a@example.test', '', pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000031002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tab-isolation-b@example.test', '', pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000031003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tab-isolation-admin@example.test', '', pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now())
on conflict (id) do nothing;

insert into public.profiles (
  id, subscription_status, subscription_plan, subscription_expires_at,
  device_slots, subscription_payment_id
)
values
  ('00000000-0000-0000-0000-000000031001', 'trial', 'premium', pg_catalog.now() + interval '12 hours', 1, null),
  ('00000000-0000-0000-0000-000000031002', 'trial', 'premium', pg_catalog.now() + interval '12 hours', 1, null),
  ('00000000-0000-0000-0000-000000031003', 'active', 'premium', pg_catalog.now() + interval '30 days', 1, null)
on conflict (id) do nothing;

insert into public.support_admins (user_id, note)
values ('00000000-0000-0000-0000-000000031003', 'pgTAP tab isolation fixture')
on conflict (user_id) do nothing;

insert into auth.sessions (id, user_id, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000031011', '00000000-0000-0000-0000-000000031001', pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000031012', '00000000-0000-0000-0000-000000031001', pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000031013', '00000000-0000-0000-0000-000000031001', pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000031014', '00000000-0000-0000-0000-000000031002', pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000031015', '00000000-0000-0000-0000-000000031003', pg_catalog.now(), pg_catalog.now())
on conflict (id) do nothing;

insert into public.profile_active_sessions (
  profile_id, session_id, session_created_at, activated_at, updated_at,
  device_fingerprint, last_activity_at, last_seen_at
)
values
  ('00000000-0000-0000-0000-000000031001', '00000000-0000-0000-0000-000000031011', pg_catalog.now() - interval '3 minutes', pg_catalog.now() - interval '3 minutes', pg_catalog.now(), '031-device-a-1', pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000031001', '00000000-0000-0000-0000-000000031012', pg_catalog.now() - interval '2 minutes', pg_catalog.now() - interval '2 minutes', pg_catalog.now(), '031-device-a-2', pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000031001', '00000000-0000-0000-0000-000000031013', pg_catalog.now() - interval '1 minute', pg_catalog.now() - interval '1 minute', pg_catalog.now(), '031-device-a-3', pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000031002', '00000000-0000-0000-0000-000000031014', pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '031-device-b-1', pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000031003', '00000000-0000-0000-0000-000000031015', pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '031-device-admin', pg_catalog.now(), pg_catalog.now())
on conflict (profile_id, session_id) do nothing;

select ok(
  pg_catalog.pg_get_functiondef('public.create_exam_session(text,text,text,jsonb,jsonb,bigint,timestamptz,text,text)'::regprocedure)
    like '%pg_advisory_xact_lock%',
  'session creation serializes the same user, device, and migration key'
);

create function pg_temp.act_as(p_user uuid, p_session uuid, p_device text, p_tab text)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    pg_catalog.json_build_object('sub', p_user, 'session_id', p_session, 'role', 'authenticated')::text,
    true
  );
  perform set_config(
    'request.headers',
    pg_catalog.json_build_object(
      'x-cityroute-device-fingerprint', p_device,
      'x-cityroute-exam-tab', p_tab
    )::text,
    true
  );
end;
$$;

set local role authenticated;
select pg_temp.act_as(
  '00000000-0000-0000-0000-000000031001',
  '00000000-0000-0000-0000-000000031011',
  '031-device-a-1',
  'tab-a1-one'
);
select set_config(
  'test.session_a1',
  (
    public.create_exam_session(
      'route-1', '031-device-a-1', 'tab-a1-one',
      '{}'::jsonb, '{}'::jsonb, 0, pg_catalog.now(), '031-migration-a1', 'active'
    )
  ).session_id::text,
  true
);
select is(
  (
    public.create_exam_session(
      'route-1', '031-device-a-1', 'tab-a1-one',
      '{"retry":true}'::jsonb, '{}'::jsonb, 5, pg_catalog.now(), '031-migration-a1', 'active'
    )
  ).session_id::text,
  current_setting('test.session_a1'),
  'a repeated create on the same tab returns the original session'
);
reset role;
select is(
  (select count(*)::integer from public.exam_sessions
    where user_id = '00000000-0000-0000-0000-000000031001'
      and migration_key = '031-migration-a1'),
  1,
  'a concurrent duplicate create does not insert a second session'
);
set local role authenticated;

select pg_temp.act_as(
  '00000000-0000-0000-0000-000000031001',
  '00000000-0000-0000-0000-000000031011',
  '031-device-a-1',
  'tab-a1-two'
);
select lives_ok(
  $$select public.create_exam_session(
    'route-1', '031-device-a-1', 'tab-a1-two',
    '{}'::jsonb, '{}'::jsonb, 0, pg_catalog.now(), '031-migration-a1-tab-two', 'active'
  )$$,
  'a second tab on the same device opens its own exam session'
);
select throws_ok(
  $$select public.update_exam_session(
    current_setting('test.session_a1')::uuid, 1, 'paused', '{}'::jsonb, '{}'::jsonb, 0
  )$$,
  'P0001',
  'Exam session not found or device mismatch',
  'one tab cannot update the other tab session'
);
select throws_ok(
  $$select public.create_exam_session(
    'route-1', '031-device-a-1', 'tab-a1-two',
    '{}'::jsonb, '{}'::jsonb, 0, pg_catalog.now(), '031-migration-a1', 'active'
  )$$,
  '42501',
  'exam_session_idempotency_owner_mismatch',
  'another tab cannot claim the first tab migration key'
);
reset role;
select is(
  (select count(*)::integer from public.profile_active_sessions
    where profile_id = '00000000-0000-0000-0000-000000031001'),
  3,
  'opening exam tabs does not register extra devices'
);
set local role authenticated;

select pg_temp.act_as(
  '00000000-0000-0000-0000-000000031001',
  '00000000-0000-0000-0000-000000031011',
  '031-device-a-1',
  'tab-a1-one'
);
select is(
  (select count(*)::integer from public.list_active_exam_sessions()),
  1,
  'a tab lists only the session it owns'
);

select pg_temp.act_as(
  '00000000-0000-0000-0000-000000031002',
  '00000000-0000-0000-0000-000000031014',
  '031-device-b-1',
  'tab-b1-one'
);
select throws_ok(
  $$select public.update_exam_session(
    current_setting('test.session_a1')::uuid, 1, 'paused', '{}'::jsonb, '{}'::jsonb, 0
  )$$,
  'P0001',
  'Exam session not found or device mismatch',
  'another user cannot update this exam session'
);
select lives_ok(
  $$select public.create_exam_session(
    'route-1', '031-device-b-1', 'tab-b1-one',
    '{}'::jsonb, '{}'::jsonb, 0, pg_catalog.now(), '031-migration-b1', 'active'
  )$$,
  'the other user can create a session on that user device'
);

select pg_temp.act_as(
  '00000000-0000-0000-0000-000000031001',
  '00000000-0000-0000-0000-000000031012',
  '031-device-a-2',
  'tab-a2-one'
);
select throws_ok(
  $$select public.create_exam_session(
    'route-1', '031-device-a-2', 'tab-a2-one',
    '{}'::jsonb, '{}'::jsonb, 0, pg_catalog.now(), '031-migration-a2', 'active'
  )$$,
  '42501',
  'device_slot_limit_exceeded',
  'the second device is rejected while the account limit is one'
);

reset role;
set local role authenticated;
select pg_temp.act_as(
  '00000000-0000-0000-0000-000000031003',
  '00000000-0000-0000-0000-000000031015',
  '031-device-admin',
  'tab-admin-1'
);
select lives_ok(
  $$select public.grant_device_session_limit_override(
    '00000000-0000-0000-0000-000000031001',
    'Temporary second device for field support',
    2
  )$$,
  'an admin can grant a two-device override'
);
reset role;
select set_config(
  'test.override_id',
  (
    select id::text
    from public.device_session_limit_overrides
    where profile_id = '00000000-0000-0000-0000-000000031001'
      and revoked_at is null
    order by id desc
    limit 1
  ),
  true
);
select is(
  (select device_slots from public.profiles where id = '00000000-0000-0000-0000-000000031001'),
  1,
  'granting an override does not replace the purchased device package'
);

set local role authenticated;
select pg_temp.act_as(
  '00000000-0000-0000-0000-000000031001',
  '00000000-0000-0000-0000-000000031012',
  '031-device-a-2',
  'tab-a2-one'
);
select lives_ok(
  $$select public.create_exam_session(
    'route-1', '031-device-a-2', 'tab-a2-one',
    '{}'::jsonb, '{}'::jsonb, 0, pg_catalog.now(), '031-migration-a2', 'active'
  )$$,
  'the second device is accepted after the two-device override'
);
select pg_temp.act_as(
  '00000000-0000-0000-0000-000000031001',
  '00000000-0000-0000-0000-000000031013',
  '031-device-a-3',
  'tab-a3-one'
);
select throws_ok(
  $$select public.create_exam_session(
    'route-1', '031-device-a-3', 'tab-a3-one',
    '{}'::jsonb, '{}'::jsonb, 0, pg_catalog.now(), '031-migration-a3', 'active'
  )$$,
  '42501',
  'device_slot_limit_exceeded',
  'the third device is rejected on a two-device override'
);

reset role;
set local role authenticated;
select pg_temp.act_as(
  '00000000-0000-0000-0000-000000031003',
  '00000000-0000-0000-0000-000000031015',
  '031-device-admin',
  'tab-admin-1'
);
select lives_ok(
  format(
    'select public.revoke_device_session_limit_override(%s, %L)',
    current_setting('test.override_id'),
    'Field support window has ended'
  ),
  'an admin can revoke the override'
);
reset role;
select is(
  public.current_device_session_limit('00000000-0000-0000-0000-000000031001'),
  1,
  'revoking the override restores the one-device package limit'
);
select is(
  (select device_slots from public.profiles where id = '00000000-0000-0000-0000-000000031001'),
  1,
  'revoking the override keeps the stored package size'
);

select * from finish();
rollback;
