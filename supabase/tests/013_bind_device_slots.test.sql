begin;

create extension if not exists pgtap with schema extensions;
select plan(33);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'device-trial@example.test', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'device-premium-one@example.test', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'device-premium-two@example.test', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'device-legacy@example.test', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'device-shared-account@example.test', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'device-new-account@example.test', '', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
values
  ('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000101', now() - interval '2 minutes', now(), null),
  ('00000000-0000-0000-0000-000000000112', '00000000-0000-0000-0000-000000000101', now() - interval '1 minute', now(), null),
  ('00000000-0000-0000-0000-000000000121', '00000000-0000-0000-0000-000000000102', now() - interval '2 minutes', now(), null),
  ('00000000-0000-0000-0000-000000000122', '00000000-0000-0000-0000-000000000102', now() - interval '1 minute', now(), null),
  ('00000000-0000-0000-0000-000000000131', '00000000-0000-0000-0000-000000000103', now() - interval '3 minutes', now(), null),
  ('00000000-0000-0000-0000-000000000132', '00000000-0000-0000-0000-000000000103', now() - interval '2 minutes', now(), null),
  ('00000000-0000-0000-0000-000000000133', '00000000-0000-0000-0000-000000000103', now() - interval '1 minute', now(), null),
  ('00000000-0000-0000-0000-000000000141', '00000000-0000-0000-0000-000000000104', now() - interval '1 minute', now(), null),
  ('00000000-0000-0000-0000-000000000142', '00000000-0000-0000-0000-000000000104', now(), now(), null),
  ('00000000-0000-0000-0000-000000000151', '00000000-0000-0000-0000-000000000105', now(), now(), null),
  ('00000000-0000-0000-0000-000000000161', '00000000-0000-0000-0000-000000000106', now() - interval '1 minute', now(), null),
  ('00000000-0000-0000-0000-000000000162', '00000000-0000-0000-0000-000000000106', now(), now(), null)
on conflict (id) do nothing;

insert into public.profiles (id, subscription_status, subscription_plan, subscription_expires_at, device_slots)
values
  ('00000000-0000-0000-0000-000000000101', 'trial', 'premium', now() + interval '12 hours', 2),
  ('00000000-0000-0000-0000-000000000102', 'active', 'premium', now() + interval '30 days', 1),
  ('00000000-0000-0000-0000-000000000103', 'active', 'premium', now() + interval '30 days', 2),
  ('00000000-0000-0000-0000-000000000104', 'active', 'premium', now() + interval '30 days', 1),
  ('00000000-0000-0000-0000-000000000105', 'active', 'premium', now() + interval '30 days', 1),
  ('00000000-0000-0000-0000-000000000106', 'active', 'premium', now() + interval '30 days', 1)
on conflict (id) do update
set subscription_status = excluded.subscription_status,
    subscription_plan = excluded.subscription_plan,
    subscription_expires_at = excluded.subscription_expires_at,
    device_slots = excluded.device_slots,
    device_fingerprint = null,
    device_bound_at = null;

update public.profiles
set subscription_payment_id = case id
  when '00000000-0000-0000-0000-000000000102'::uuid then 'device-test-99'
  when '00000000-0000-0000-0000-000000000103'::uuid then 'device-test-179'
  when '00000000-0000-0000-0000-000000000106'::uuid then 'device-test-179-pending'
  else null
end
where id in (
  '00000000-0000-0000-0000-000000000102',
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000104',
  '00000000-0000-0000-0000-000000000105',
  '00000000-0000-0000-0000-000000000106'
);

insert into public.payment_transactions (
  user_id, provider, payment_id, merchant_payment_id, amount, currency, status, metadata, paid_at
)
values
  ('00000000-0000-0000-0000-000000000102', 'bog', 'device-test-99', 'device-test-merchant-99', 99, 'GEL', 'success', '{"provider":"bog","device_slots":1}', now()),
  ('00000000-0000-0000-0000-000000000103', 'bog', 'device-test-179', 'device-test-merchant-179', 179, 'GEL', 'success', '{"provider":"bog","device_slots":2,"bank_status":"completed","bank_amount":"179","bank_currency":"GEL","bank_external_order_id":"device-test-merchant-179"}', now()),
  ('00000000-0000-0000-0000-000000000106', 'bog', 'device-test-179-pending', 'device-test-merchant-179-pending', 179, 'GEL', 'pending', '{"provider":"bog","device_slots":2}', null)
on conflict (provider, payment_id) do update
set user_id = excluded.user_id,
    amount = excluded.amount,
    currency = excluded.currency,
    status = excluded.status,
    metadata = excluded.metadata;

update public.profiles
set device_fingerprint = 'legacy-device-001',
    device_bound_at = now() - interval '1 day'
where id = '00000000-0000-0000-0000-000000000104';

insert into public.routes (id, city_id, slug, name_ka, polyline, sort_order)
select '00000000-0000-0000-0000-000000000201', id,
       'device-access-test', 'Device access test', '[]'::jsonb, 999
from public.cities
where slug = 'telavi'
on conflict (id) do nothing;

insert into public.pins (id, route_id, lat, lng, instruction_ka, sort_order)
values (
  '00000000-0000-0000-0000-000000000202',
  '00000000-0000-0000-0000-000000000201',
  41.9167,
  45.475,
  'Device access test',
  999
)
on conflict (id) do nothing;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000101', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000101","session_id":"00000000-0000-0000-0000-000000000111","role":"authenticated"}', true);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"trial-device-001"}', true);
select is(public.bind_device('trial-device-001')->>'status', 'ok', 'trial session A activates');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000101","session_id":"00000000-0000-0000-0000-000000000112","role":"authenticated"}', true);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"trial-device-002"}', true);
select is(public.bind_device('trial-device-002')->>'status', 'ok', 'trial session B replaces session A at the one-session limit');
reset role;
select ok(
  exists (
    select 1 from public.profile_revoked_sessions
    where profile_id = '00000000-0000-0000-0000-000000000101'
      and session_id = '00000000-0000-0000-0000-000000000111'
  ),
  'replaced trial session A is revoked'
);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000101","session_id":"00000000-0000-0000-0000-000000000112","role":"authenticated"}', true);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"trial-device-002"}', true);
select is(public.bind_device('trial-device-002')->>'status', 'ok', 'active trial session remains idempotent');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000102', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000102","session_id":"00000000-0000-0000-0000-000000000121","role":"authenticated"}', true);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"premium-one-001"}', true);
select is(public.bind_device('premium-one-001')->>'status', 'ok', '99 GEL session A activates');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000102","session_id":"00000000-0000-0000-0000-000000000122","role":"authenticated"}', true);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"premium-one-002"}', true);
select is(public.bind_device('premium-one-002')->>'status', 'ok', '99 GEL session B replaces session A at the one-session limit');
reset role;
select is(public.verified_device_slot_limit('00000000-0000-0000-0000-000000000102'), 1, 'verified 99 GEL payment grants one device slot');
select ok(
  exists (
    select 1 from public.profile_revoked_sessions
    where profile_id = '00000000-0000-0000-0000-000000000102'
      and session_id = '00000000-0000-0000-0000-000000000121'
  ),
  'replaced 99 GEL session A is revoked'
);
select is(
  (select count(*)::integer from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000102'),
  1,
  '99 GEL account retains exactly one active session'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000105', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000105","session_id":"00000000-0000-0000-0000-000000000151","role":"authenticated"}', true);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"premium-one-002"}', true);
select is(public.bind_device('premium-one-002')->>'status', 'ok', 'the same device fingerprint can activate a separate account session');
reset role;
select is(
  (select count(*)::integer from public.profile_active_sessions
   where device_fingerprint = 'premium-one-002'
     and profile_id in (
       '00000000-0000-0000-0000-000000000102',
       '00000000-0000-0000-0000-000000000105'
     )),
  2,
  'same device fingerprint is tracked independently for each account'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000106', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000106","session_id":"00000000-0000-0000-0000-000000000161","role":"authenticated"}', true);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"new-account-device-001"}', true);
select is(public.bind_device('new-account-device-001')->>'status', 'ok', 'new account session A activates');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000106","session_id":"00000000-0000-0000-0000-000000000162","role":"authenticated"}', true);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"new-account-device-002"}', true);
select is(public.bind_device('new-account-device-002')->>'status', 'ok', 'pending 179 GEL account remains limited to one active session');
reset role;
select is(public.verified_device_slot_limit('00000000-0000-0000-0000-000000000106'), 1, 'pending 179 GEL payment does not grant two device slots');
select ok(
  exists (
    select 1 from public.profile_revoked_sessions
    where profile_id = '00000000-0000-0000-0000-000000000106'
      and session_id = '00000000-0000-0000-0000-000000000161'
  ),
  'new account session A is revoked when session B takes its slot'
);

select is(public.verified_device_slot_limit('00000000-0000-0000-0000-000000000103'), 2, 'verified 179 GEL payment grants two device slots');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000103', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000103","session_id":"00000000-0000-0000-0000-000000000131","role":"authenticated"}', true);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"premium-two-001"}', true);
select is(public.bind_device('premium-two-001')->>'status', 'ok', '179 GEL session A activates');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000103","session_id":"00000000-0000-0000-0000-000000000132","role":"authenticated"}', true);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"premium-two-002"}', true);
select is(public.bind_device('premium-two-002')->>'status', 'ok', '179 GEL session B activates within the two-session limit');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000103","session_id":"00000000-0000-0000-0000-000000000133","role":"authenticated"}', true);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"premium-two-003"}', true);
select is(public.bind_device('premium-two-003')->>'status', 'blocked', '179 GEL blocks a third simultaneous session');
reset role;
select is(
  (select count(*)::integer from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000103'),
  2,
  '179 GEL sessions A and B remain active after session C is blocked'
);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000103","session_id":"00000000-0000-0000-0000-000000000131","role":"authenticated"}', true);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"premium-two-001"}', true);
select is(public.bind_device('premium-two-001')->>'status', 'ok', 'active 179 GEL session A remains idempotent');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000104', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000104","session_id":"00000000-0000-0000-0000-000000000141","role":"authenticated"}', true);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"legacy-device-001"}', true);
select is(public.bind_device('legacy-device-001')->>'status', 'ok', 'legacy fingerprint can activate a current Auth session');
reset role;
select ok(
  exists (
    select 1 from public.profile_active_sessions
    where profile_id = '00000000-0000-0000-0000-000000000104'
      and session_id = '00000000-0000-0000-0000-000000000141'
      and device_fingerprint = 'legacy-device-001'
  ),
  'legacy fingerprint is stored on the active session'
);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000104","session_id":"00000000-0000-0000-0000-000000000141","role":"authenticated"}', true);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"legacy-device-001"}', true);
select is(public.has_current_device_access(), true, 'active Auth session passes the device access guard');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000104","session_id":"00000000-0000-0000-0000-000000000142","role":"authenticated"}', true);
select is(public.has_current_device_access(), false, 'inactive Auth session fails the device access guard');
select is(
  (select count(*)::integer from public.routes where id = '00000000-0000-0000-0000-000000000201'),
  0,
  'route rows are not readable from an inactive Auth session'
);
select is(
  (select count(*)::integer from public.pins where id = '00000000-0000-0000-0000-000000000202'),
  0,
  'pin rows are not readable from an inactive Auth session'
);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000104","session_id":"00000000-0000-0000-0000-000000000141","role":"authenticated"}', true);
select is(public.has_current_device_access(), true, 'restored active Auth session passes the device access guard');
select is(
  (select count(*)::integer from public.routes where id = '00000000-0000-0000-0000-000000000201'),
  1,
  'route rows are readable from the active Auth session'
);
select is(
  (select count(*)::integer from public.pins where id = '00000000-0000-0000-0000-000000000202'),
  1,
  'pin rows are readable from the active Auth session'
);
select throws_ok(
  $$update public.profiles set device_slots = 2 where id = '00000000-0000-0000-0000-000000000104'$$,
  '42501',
  null,
  'authenticated users cannot change their paid device-slot entitlement'
);
reset role;
select ok(
  pg_get_functiondef('public.activate_current_session()'::regprocedure) LIKE '%for update%',
  'session activation serializes concurrent attempts with a profile row lock'
);
select ok(
  not has_table_privilege('authenticated', 'public.profile_active_sessions', 'select'),
  'authenticated users cannot read the active session registry directly'
);

select * from finish();
rollback;
