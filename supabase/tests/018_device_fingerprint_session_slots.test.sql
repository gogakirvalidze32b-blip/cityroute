begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(47);

select ok(
  not has_table_privilege('authenticated', 'public.profile_active_sessions', 'select'),
  'authenticated clients cannot bypass the session registry RLS boundary'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000801',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'session-fingerprint-179@example.test', '',
    pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()
  ),
  (
    '00000000-0000-0000-0000-000000000802',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'session-fingerprint-99@example.test', '',
    pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()
  )
on conflict (id) do nothing;

insert into public.profiles (
  id, subscription_status, subscription_plan, subscription_expires_at,
  device_slots, subscription_payment_id
)
values
  (
    '00000000-0000-0000-0000-000000000801',
    'active', 'full', pg_catalog.now() + interval '30 days', 2, 'fingerprint-179-test'
  ),
  (
    '00000000-0000-0000-0000-000000000802',
    'active', 'premium', pg_catalog.now() + interval '30 days', 1, null
  )
on conflict (id) do update
set subscription_status = excluded.subscription_status,
    subscription_plan = excluded.subscription_plan,
    subscription_expires_at = excluded.subscription_expires_at,
    device_slots = excluded.device_slots,
    subscription_payment_id = excluded.subscription_payment_id;

insert into public.payment_transactions (
  user_id, provider, payment_id, merchant_payment_id, amount, currency,
  status, metadata, paid_at
)
values (
  '00000000-0000-0000-0000-000000000801',
  'bog',
  'fingerprint-179-test',
  'merchant-fingerprint-179-test',
  179,
  'GEL',
  'success',
  '{"provider":"bog","device_slots":2,"bank_status":"completed","bank_amount":"179","bank_currency":"GEL","bank_external_order_id":"merchant-fingerprint-179-test"}',
  pg_catalog.now()
);

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
values
  ('00000000-0000-0000-0000-000000000811', '00000000-0000-0000-0000-000000000801', pg_catalog.now() - interval '5 minutes', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000812', '00000000-0000-0000-0000-000000000801', pg_catalog.now() - interval '4 minutes', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000813', '00000000-0000-0000-0000-000000000801', pg_catalog.now() - interval '3 minutes', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000814', '00000000-0000-0000-0000-000000000801', pg_catalog.now() - interval '2 minutes', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000815', '00000000-0000-0000-0000-000000000801', pg_catalog.now() - interval '1 minute', pg_catalog.now(), pg_catalog.now() - interval '1 second'),
  ('00000000-0000-0000-0000-000000000816', '00000000-0000-0000-0000-000000000801', pg_catalog.now() - interval '6 minutes', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000817', '00000000-0000-0000-0000-000000000801', pg_catalog.now() - interval '7 minutes', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000821', '00000000-0000-0000-0000-000000000802', pg_catalog.now() - interval '3 minutes', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000822', '00000000-0000-0000-0000-000000000802', pg_catalog.now() - interval '2 minutes', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000823', '00000000-0000-0000-0000-000000000802', pg_catalog.now() - interval '1 minute', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000824', '00000000-0000-0000-0000-000000000802', pg_catalog.now() - interval '4 minutes', pg_catalog.now(), null);

insert into public.profile_active_sessions (
  profile_id, session_id, session_created_at, activated_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000801',
    '00000000-0000-0000-0000-000000000811',
    pg_catalog.now() - interval '5 minutes',
    pg_catalog.now() - interval '5 minutes',
    pg_catalog.now()
  ),
  (
    '00000000-0000-0000-0000-000000000801',
    '00000000-0000-0000-0000-000000000816',
    pg_catalog.now() - interval '6 minutes',
    pg_catalog.now() - interval '6 minutes',
    pg_catalog.now()
  );

select is(
  public.current_device_session_limit('00000000-0000-0000-0000-000000000801'),
  2,
  'verified 179 GEL entitlement retains two session slots'
);

reset role;
set local role postgres;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000801', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000801","session_id":"00000000-0000-0000-0000-000000000811","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"device-179-a"}', true);
select is(
  public.has_current_active_session(),
  false,
  'legacy session entry without a device fingerprint is inactive until reactivation'
);
select is(public.activate_current_session()->>'status', 'active', 'first 179 GEL device activates');
select is(public.has_current_active_session(), true, 'first 179 GEL device has access');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000801","session_id":"00000000-0000-0000-0000-000000000816","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"device-179-b"}', true);
select is(
  public.activate_current_session()->>'status',
  'active',
  'the second legacy session is preserved and activates with its fingerprint'
);
select is(
  public.activate_current_session()->>'status',
  'active',
  'the second legacy session remains active on refresh'
);
select is(
  public.has_current_active_session(),
  true,
  'the second legacy session remains eligible after activation'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000801","session_id":"00000000-0000-0000-0000-000000000811","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"device-179-a"}', true);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000801","session_id":"00000000-0000-0000-0000-000000000812","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"device-179-b"}', true);
select is(public.activate_current_session()->>'status', 'active', 'new 179 GEL session replaces the old session on device B');
select is(public.has_current_active_session(), true, 'new session on device B has access');

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000801","session_id":"00000000-0000-0000-0000-000000000813","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"device-179-a"}', true);
select is(public.activate_current_session()->>'status', 'active', 'same-device re-login reuses its 179 GEL slot');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000801","session_id":"00000000-0000-0000-0000-000000000811","role":"authenticated"}',
  true
);
select is(public.has_current_active_session(), false, 'previous auth session on device A is retired');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000801","session_id":"00000000-0000-0000-0000-000000000813","role":"authenticated"}',
  true
);
select is(public.has_current_active_session(), true, 'new auth session on device A is active');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000801","session_id":"00000000-0000-0000-0000-000000000812","role":"authenticated"}',
  true
);
select is(public.has_current_active_session(), true, 'device B remains active after device A re-login');
reset role;
set local role postgres;
select is(
  (select count(*)::integer
   from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000801'),
  2,
  'same-device re-login leaves exactly two active rows'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000801","session_id":"00000000-0000-0000-0000-000000000814","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"device-179-c"}', true);
select is(public.activate_current_session()->>'status', 'blocked', 'third distinct 179 GEL device is blocked');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000801","session_id":"00000000-0000-0000-0000-000000000813","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"device-179-a"}', true);
select is(public.has_current_active_session(), true, 'blocked third device does not revoke device A');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000801","session_id":"00000000-0000-0000-0000-000000000812","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"device-179-b"}', true);
select is(public.has_current_active_session(), true, 'blocked third device does not revoke device B');
reset role;
set local role postgres;
select is(
  (select count(*)::integer
   from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000801'),
  2,
  'blocked third-device attempt leaves both existing sessions registered'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000801","session_id":"00000000-0000-0000-0000-000000000817","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"device-179-b"}', true);
select is(
  public.activate_current_session()->>'status',
  'blocked',
  'older 179 GEL auth session cannot replace a newer active session on the same device'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000801","session_id":"00000000-0000-0000-0000-000000000812","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"device-179-b"}', true);
select is(public.has_current_active_session(), true, 'newer 179 GEL session retains access after the stale-session attempt');
reset role;
set local role postgres;
select is(
  (select count(*)::integer
   from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000801'
     and session_id = '00000000-0000-0000-0000-000000000812'
     and device_fingerprint = 'device-179-b'),
  1,
  'older 179 GEL attempt does not release the newer session slot'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000801","session_id":"00000000-0000-0000-0000-000000000813","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"device-179-a"}', true);
select is(public.activate_current_session()->>'status', 'active', 'refresh of the same auth session is idempotent');
reset role;
set local role postgres;
select is(
  (select count(*)::integer
   from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000801'),
  2,
  'refresh does not consume an additional 179 GEL slot'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000801","session_id":"00000000-0000-0000-0000-000000000813","role":"authenticated"}',
  true
);
select is(
  (public.deactivate_current_session()->>'deactivated_sessions')::integer,
  1,
  'logout deactivates only the current device session and reports the count'
);
reset role;
set local role postgres;
select is(
  (select count(*)::integer
   from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000801'),
  1,
  'logout preserves the other active-device row'
);
set local role authenticated;
select is(
  public.deactivate_current_session()->>'status',
  'inactive',
  'repeated logout succeeds when the current device is already inactive'
);
select is(public.has_current_active_session(), false, 'logged-out device A loses access');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000801","session_id":"00000000-0000-0000-0000-000000000812","role":"authenticated"}',
  true
);
select is(public.has_current_active_session(), true, 'logout preserves the other device session');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000801","session_id":"00000000-0000-0000-0000-000000000814","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"device-179-c"}', true);
select is(public.activate_current_session()->>'status', 'active', 'new login activates after another device logs out');
select is(public.has_current_active_session(), true, 'new login has app access after another device logs out');
reset role;
set local role postgres;
select is(
  (select count(*)::integer
   from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000801'),
  2,
  'the existing second device and the newly logged-in device remain active'
);

insert into public.profile_active_sessions (
  profile_id, session_id, session_created_at, activated_at, updated_at, device_fingerprint
)
values (
  '00000000-0000-0000-0000-000000000801',
  '00000000-0000-0000-0000-000000000815',
  pg_catalog.now() - interval '1 minute',
  pg_catalog.now() - interval '1 minute',
  pg_catalog.now(),
  'expired-device'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000801","session_id":"00000000-0000-0000-0000-000000000814","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"device-179-c"}', true);
select is(public.activate_current_session()->>'status', 'active', 'valid device remains active after expired-row cleanup');
reset role;
set local role postgres;
select is(
  (select count(*)::integer
   from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000801'
     and session_id = '00000000-0000-0000-0000-000000000815'),
  0,
  'expired auth session is removed from the active-device count'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000801","session_id":"00000000-0000-0000-0000-000000000815","role":"authenticated"}',
  true
);
select is(public.activate_current_session()->>'status', 'blocked', 'expired auth session cannot reactivate');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000802', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000802","session_id":"00000000-0000-0000-0000-000000000821","role":"authenticated"}',
  true
);
select set_config('request.headers', '{}', true);
select is(
  public.activate_current_session()->>'status',
  'blocked',
  'session activation fails closed when the device fingerprint header is missing'
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"device-99-a"}', true);
select is(public.activate_current_session()->>'status', 'active', '99 GEL device A activates');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000802","session_id":"00000000-0000-0000-0000-000000000822","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"device-99-b"}', true);
select is(public.activate_current_session()->>'status', 'active', 'new 99 GEL device replaces the previous session');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000802","session_id":"00000000-0000-0000-0000-000000000821","role":"authenticated"}',
  true
);
select is(public.has_current_active_session(), false, 'replaced 99 GEL session is revoked');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000802","session_id":"00000000-0000-0000-0000-000000000822","role":"authenticated"}',
  true
);
select is(public.has_current_active_session(), true, 'new 99 GEL session remains active');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000802","session_id":"00000000-0000-0000-0000-000000000823","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"device-99-b"}', true);
select is(public.activate_current_session()->>'status', 'active', 'same-device 99 GEL re-login reuses the one slot');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000802","session_id":"00000000-0000-0000-0000-000000000822","role":"authenticated"}',
  true
);
select is(public.has_current_active_session(), false, 'previous 99 GEL auth session on the same device is retired');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000802","session_id":"00000000-0000-0000-0000-000000000823","role":"authenticated"}',
  true
);
select is(public.has_current_active_session(), true, 'latest 99 GEL session keeps the device slot');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000802","session_id":"00000000-0000-0000-0000-000000000824","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"device-99-b"}', true);
select is(
  public.activate_current_session()->>'status',
  'blocked',
  'older 99 GEL auth session cannot replace a newer active session on the same device'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000802","session_id":"00000000-0000-0000-0000-000000000823","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"device-99-b"}', true);
select is(public.has_current_active_session(), true, 'newer 99 GEL session retains access after the stale-session attempt');
reset role;
set local role postgres;
select is(
  (select count(*)::integer
   from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000802'
     and session_id = '00000000-0000-0000-0000-000000000823'
     and device_fingerprint = 'device-99-b'),
  1,
  'older 99 GEL attempt does not release the newer session slot'
);
select is(
  (select count(*)::integer
   from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000802'),
  1,
  '99 GEL replacement and same-device re-login retain exactly one active session'
);

select * from finish();
rollback;
