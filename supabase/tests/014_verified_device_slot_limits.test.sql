begin;

create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'verified-179@example.test', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'verified-99@example.test', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'unverified-179@example.test', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000204', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'wrong-owner-payment@example.test', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000205', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pending-179@example.test', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000206', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'legacy-plan-179@example.test', '', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (
  id, subscription_status, subscription_plan, subscription_expires_at,
  device_slots, subscription_payment_id, device_fingerprint, device_bound_at
)
values
  ('00000000-0000-0000-0000-000000000201', 'active', 'premium', '2027-01-01T00:00:00Z', 2, 'test-paid-179', null, null),
  ('00000000-0000-0000-0000-000000000202', 'active', 'premium', '2027-01-01T00:00:00Z', 1, 'test-paid-99', null, null),
  ('00000000-0000-0000-0000-000000000203', 'active', 'premium', '2027-01-01T00:00:00Z', 2, 'test-unverified-179', null, null),
  ('00000000-0000-0000-0000-000000000204', 'active', 'premium', '2027-01-01T00:00:00Z', 2, 'test-wrong-owner-179', null, null),
  ('00000000-0000-0000-0000-000000000205', 'active', 'premium', '2027-01-01T00:00:00Z', 2, 'test-pending-179', null, null),
  ('00000000-0000-0000-0000-000000000206', 'active', 'full', '2027-01-01T00:00:00Z', 2, 'test-paid-179-legacy-plan', null, null)
on conflict (id) do update
set subscription_status = excluded.subscription_status,
    subscription_plan = excluded.subscription_plan,
    subscription_expires_at = excluded.subscription_expires_at,
    device_slots = excluded.device_slots,
    subscription_payment_id = excluded.subscription_payment_id,
    device_fingerprint = null,
    device_bound_at = null;

insert into public.payment_transactions (
  user_id, provider, payment_id, merchant_payment_id, amount, currency, status, metadata
)
values
  ('00000000-0000-0000-0000-000000000201', 'bog', 'test-paid-179', 'test-merchant-179', 179, 'GEL', 'success', '{"provider":"bog","device_slots":2}'),
  ('00000000-0000-0000-0000-000000000202', 'bog', 'test-paid-99', 'test-merchant-99', 99, 'GEL', 'success', '{"provider":"bog","device_slots":1}'),
  ('00000000-0000-0000-0000-000000000203', 'bog', 'test-unverified-179', 'test-merchant-unverified', 179, 'GEL', 'success', '{"provider":"bog","device_slots":1}'),
  ('00000000-0000-0000-0000-000000000206', 'bog', 'test-wrong-owner-179', 'test-merchant-wrong-owner', 179, 'GEL', 'success', '{"provider":"bog","device_slots":2}'),
  ('00000000-0000-0000-0000-000000000205', 'bog', 'test-pending-179', 'test-merchant-pending', 179, 'GEL', 'pending', '{"provider":"bog","device_slots":2}'),
  ('00000000-0000-0000-0000-000000000206', 'bog', 'test-paid-179-legacy-plan', 'test-merchant-179-legacy-plan', 179, 'GEL', 'success', '{"provider":"bog","device_slots":2}')
on conflict (provider, payment_id) do update
set user_id = excluded.user_id,
    amount = excluded.amount,
    currency = excluded.currency,
    status = excluded.status,
    metadata = excluded.metadata;

set local role authenticated;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000201', true);
select is(public.bind_device('verified-179-device-001')->>'status', 'bound', 'confirmed 179 GEL account can bind first device');
select is(public.bind_device('verified-179-device-002')->>'status', 'bound', 'confirmed 179 GEL account can bind second device');
select is(public.bind_device('verified-179-device-003')->>'status', 'blocked', 'confirmed 179 GEL account blocks third device');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000206', true);
select is(public.bind_device('legacy-plan-179-device-001')->>'status', 'bound', 'verified 179 GEL entitlement works with a legacy full plan label');
select is(public.bind_device('legacy-plan-179-device-002')->>'status', 'bound', 'verified legacy full plan retains the second device slot');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000202', true);
select is(public.bind_device('verified-99-device-001')->>'status', 'bound', 'confirmed 99 GEL account can bind first device');
select is(public.bind_device('verified-99-device-002')->>'status', 'blocked', 'confirmed 99 GEL account blocks second device');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000203', true);
select is(public.bind_device('unverified-179-device-001')->>'status', 'bound', 'unverified 179 GEL account is not blocked on first bind');
select is(public.bind_device('unverified-179-device-002')->>'status', 'blocked', 'unverified 179 GEL metadata cannot grant a second slot');
reset role;
insert into public.profile_devices (profile_id, fingerprint, first_bound_at, last_seen_at)
values (
  '00000000-0000-0000-0000-000000000203',
  'unverified-179-device-003',
  now() + interval '1 second',
  now() + interval '1 second'
);
set local role authenticated;
select set_config(
  'request.headers',
  '{"x-cityroute-device-fingerprint":"unverified-179-device-003"}',
  true
);
select is(public.has_current_device_access(), false, 'RLS does not trust an unverified profile device_slots value of two');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000204', true);
select is(public.bind_device('wrong-owner-device-001')->>'status', 'bound', 'payment owned by another account does not block the first bind');
select is(public.bind_device('wrong-owner-device-002')->>'status', 'blocked', 'payment owned by another account cannot grant a second slot');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000205', true);
select is(public.bind_device('pending-179-device-001')->>'status', 'bound', 'pending 179 GEL account is not blocked on first bind');
select is(public.bind_device('pending-179-device-002')->>'status', 'blocked', 'pending payment cannot grant a second slot');

reset role;
select is(
  (select subscription_status || ':' || subscription_expires_at::text
   from public.profiles where id = '00000000-0000-0000-0000-000000000201'),
  'active:2027-01-01 00:00:00+00',
  'device binding leaves confirmed subscription status and expiry unchanged'
);
select is(
  (select subscription_status || ':' || subscription_expires_at::text
   from public.profiles where id = '00000000-0000-0000-0000-000000000203'),
  'active:2027-01-01 00:00:00+00',
  'unverified package fallback leaves subscription status and expiry unchanged'
);
select is(
  (select status || ':' || amount::text || ':' || (metadata->>'device_slots')
   from public.payment_transactions where payment_id = 'test-paid-179'),
  'success:179.00:2',
  'device binding leaves payment status, amount, and package metadata unchanged'
);
select like(
  pg_get_functiondef('public.bind_device(text)'::regprocedure),
  '%for update%',
  'bind_device serializes device registration with a profile row lock'
);

select * from finish();
rollback;
