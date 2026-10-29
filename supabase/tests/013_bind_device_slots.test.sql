begin;

create extension if not exists pgtap with schema extensions;
select plan(29);

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
  user_id, provider, payment_id, amount, currency, status, metadata
)
values
  ('00000000-0000-0000-0000-000000000102', 'bog', 'device-test-99', 99, 'GEL', 'success', '{"provider":"bog","device_slots":1}'),
  ('00000000-0000-0000-0000-000000000103', 'bog', 'device-test-179', 179, 'GEL', 'success', '{"provider":"bog","device_slots":2}'),
  ('00000000-0000-0000-0000-000000000106', 'bog', 'device-test-179-pending', 179, 'GEL', 'pending', '{"provider":"bog","device_slots":2}')
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
select is(public.bind_device('trial-device-001')->>'status', 'bound', 'trial allows its first device');
select is(public.bind_device('trial-device-002')->>'status', 'blocked', 'trial remains limited to one even with two stored slots');
select is(public.bind_device('trial-device-001')->>'status', 'ok', 'same trial device is idempotent');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000102', true);
select is(public.bind_device('premium-one-001')->>'status', 'bound', 'one-slot Premium allows its first device');
select is(public.bind_device('premium-one-002')->>'status', 'blocked', 'one-slot Premium blocks its second device');
reset role;
select is(public.verified_device_slot_limit('00000000-0000-0000-0000-000000000102'), 1, 'verified 99 GEL payment grants one device');
set local role authenticated;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000105', true);
select is(
  public.bind_device('premium-one-001')->>'fingerprint',
  'premium-one-001',
  'the same device fingerprint is reused when signing into another account'
);
select is(public.bind_device('premium-one-second-account-device')->>'status', 'blocked', 'shared fingerprint does not give a second account an extra slot');
reset role;
select is(
  (select count(*)::integer
   from public.profile_devices
   where fingerprint = 'premium-one-001'
     and profile_id in (
       '00000000-0000-0000-0000-000000000102',
       '00000000-0000-0000-0000-000000000105'
     )),
  2,
  'shared device identity is preserved while each account has its own registry binding'
);
set local role authenticated;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000106', true);
select is(public.bind_device('new-account-device-001')->>'status', 'bound', 'a new account can bind its first new device');
select is(public.bind_device('new-account-device-001')->>'status', 'ok', 'the new account device remains idempotent');
reset role;
select is(public.verified_device_slot_limit('00000000-0000-0000-0000-000000000106'), 1, 'pending 179 GEL payment does not grant two devices');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000106', true);
select is(public.bind_device('new-account-device-002')->>'status', 'blocked', 'pending payment blocks a second device');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000103', true);
reset role;
select is(public.verified_device_slot_limit('00000000-0000-0000-0000-000000000103'), 2, 'verified 179 GEL payment grants two devices');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000103', true);
select is(public.bind_device('premium-two-001')->>'status', 'bound', 'two-slot Premium allows its first device');
select is(public.bind_device('premium-two-002')->>'status', 'bound', 'two-slot Premium allows its second device');
select is(public.bind_device('premium-two-003')->>'status', 'blocked', 'two-slot Premium blocks its third device');
select is(public.bind_device('premium-two-001')->>'status', 'ok', 'registered Premium device remains idempotent');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000104', true);
select is(public.bind_device('legacy-device-001')->>'status', 'ok', 'existing single-fingerprint accounts retain their device');
reset role;
select ok(
  exists (
    select 1 from public.profile_devices
    where profile_id = '00000000-0000-0000-0000-000000000104'
      and fingerprint = 'legacy-device-001'
  ),
  'legacy single-fingerprint accounts are migrated on binding'
);
set local role authenticated;
select set_config(
  'request.headers',
  '{"x-cityroute-device-fingerprint":"legacy-device-001"}',
  true
);
select is(public.has_current_device_access(), true, 'registered current device passes the RLS guard');
select set_config('request.headers', '{}', true);
select is(public.has_current_device_access(), false, 'missing device header fails the RLS guard');
select is(
  (select count(*)::integer from public.routes where id = '00000000-0000-0000-0000-000000000201'),
  0,
  'route rows are not readable without the bound device header'
);
select is(
  (select count(*)::integer from public.pins where id = '00000000-0000-0000-0000-000000000202'),
  0,
  'pin rows are not readable without the bound device header'
);
select set_config(
  'request.headers',
  '{"x-cityroute-device-fingerprint":"legacy-device-001"}',
  true
);
select is(
  (select count(*)::integer from public.routes where id = '00000000-0000-0000-0000-000000000201'),
  1,
  'route rows are readable on an entitled registered device'
);
select is(
  (select count(*)::integer from public.pins where id = '00000000-0000-0000-0000-000000000202'),
  1,
  'pin rows are readable on an entitled registered device'
);
select set_config('request.headers', '{}', true);
select throws_ok(
  $$update public.profiles set device_slots = 2 where id = '00000000-0000-0000-0000-000000000104'$$,
  '42501',
  null,
  'authenticated users cannot change their paid device-slot entitlement'
);
select like(
  pg_get_functiondef('public.bind_device(text)'::regprocedure),
  '%for update%',
  'bind_device locks the profile row to serialize concurrent binding attempts'
);

select ok(
  not has_table_privilege('authenticated', 'public.profile_devices', 'select'),
  'authenticated users cannot read the device registry directly'
);

select * from finish();
rollback;
