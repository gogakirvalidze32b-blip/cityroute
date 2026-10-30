begin;

create extension if not exists pgtap with schema extensions;
select plan(45);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000301',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'session-slots-015-test@example.test',
  '',
  pg_catalog.now(),
  '{}',
  '{}',
  pg_catalog.now(),
  pg_catalog.now()
)
on conflict (id) do nothing;

insert into public.profiles (
  id, subscription_status, subscription_plan, subscription_expires_at,
  device_slots, subscription_payment_id
)
values (
  '00000000-0000-0000-0000-000000000301',
  'trial',
  'premium',
  pg_catalog.now() + interval '12 hours',
  1,
  null
)
on conflict (id) do update
set subscription_status = excluded.subscription_status,
    subscription_plan = excluded.subscription_plan,
    subscription_expires_at = excluded.subscription_expires_at,
    device_slots = excluded.device_slots,
    subscription_payment_id = excluded.subscription_payment_id;

insert into public.cities (
  id, slug, name_ka, name_en, center_lat, center_lng, zoom, active, sort_order
)
values (
  '00000000-0000-0000-0000-000000000321',
  'session-slots-015-test',
  'სესიის ტესტი',
  'Session slots test',
  41.9,
  45.0,
  13,
  true,
  9999
);

insert into auth.sessions (id, user_id, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000311', '00000000-0000-0000-0000-000000000301', pg_catalog.now() - interval '7 minutes', pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000312', '00000000-0000-0000-0000-000000000301', pg_catalog.now() - interval '6 minutes', pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000313', '00000000-0000-0000-0000-000000000301', pg_catalog.now() - interval '5 minutes', pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000314', '00000000-0000-0000-0000-000000000301', pg_catalog.now() - interval '4 minutes', pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000315', '00000000-0000-0000-0000-000000000301', pg_catalog.now() - interval '3 minutes', pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000316', '00000000-0000-0000-0000-000000000301', pg_catalog.now() - interval '2 minutes', pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000317', '00000000-0000-0000-0000-000000000301', pg_catalog.now() - interval '1 minute', pg_catalog.now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000301', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000301","session_id":"00000000-0000-0000-0000-000000000311","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"015-trial-device-a"}', true);
select is(public.activate_current_session()->>'status', 'active', 'Trial device A activates');
select is(public.has_current_active_session(), true, 'Trial device A has server-side session access');
select is(public.has_active_access('00000000-0000-0000-0000-000000000301'), true, 'Trial subscription remains valid for device A');
select is(
  (select count(*)::integer from public.cities where id = '00000000-0000-0000-0000-000000000321'),
  1,
  'Trial device A can read protected route data'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000301","session_id":"00000000-0000-0000-0000-000000000312","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"015-trial-device-b"}', true);
select is(public.activate_current_session()->>'status', 'active', 'Trial device B replaces device A');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000301","session_id":"00000000-0000-0000-0000-000000000311","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"015-trial-device-a"}', true);
select is(public.has_current_active_session(), false, 'replaced Trial device A is blocked');
select is(
  public.activate_current_session()->>'status',
  'blocked',
  'replaced Trial JWT cannot reactivate'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000301","session_id":"00000000-0000-0000-0000-000000000312","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"015-trial-device-b"}', true);
select is(public.deactivate_current_session()->>'status', 'deactivated', 'Trial device B logout releases its slot');

reset role;
update public.profiles
set subscription_status = 'active',
    subscription_plan = 'premium',
    subscription_expires_at = pg_catalog.now() + interval '30 days',
    device_slots = 1,
    subscription_payment_id = 'premium-99-test'
where id = '00000000-0000-0000-0000-000000000301';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000301","session_id":"00000000-0000-0000-0000-000000000313","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"015-premium-99-device-a"}', true);
select is(public.activate_current_session()->>'status', 'active', 'Premium 99 device A activates');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000301","session_id":"00000000-0000-0000-0000-000000000314","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"015-premium-99-device-b"}', true);
select is(public.activate_current_session()->>'status', 'active', 'Premium 99 device B replaces device A');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000301","session_id":"00000000-0000-0000-0000-000000000313","role":"authenticated"}',
  true
);
select is(public.has_current_active_session(), false, 'replaced Premium 99 device A is blocked');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000301","session_id":"00000000-0000-0000-0000-000000000314","role":"authenticated"}',
  true
);
select is(public.deactivate_current_session()->>'status', 'deactivated', 'Premium 99 device B logout frees the slot');

reset role;
insert into public.payment_transactions (
  user_id, provider, payment_id, merchant_payment_id, amount, currency,
  status, metadata, paid_at
)
values (
  '00000000-0000-0000-0000-000000000301',
  'bog',
  'premium-179-test',
  'merchant-premium-179-test',
  179,
  'GEL',
  'success',
  '{"provider":"bog","device_slots":2,"bank_status":"completed","bank_amount":"179","bank_currency":"GEL","bank_external_order_id":"merchant-premium-179-test"}',
  pg_catalog.now()
);
update public.profiles
set device_slots = 2,
    subscription_payment_id = 'premium-179-test'
where id = '00000000-0000-0000-0000-000000000301';

select is(
  public.current_device_session_limit('00000000-0000-0000-0000-000000000301'),
  2,
  'verified successful 179 GEL BOG payment grants exactly two session slots'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000301","session_id":"00000000-0000-0000-0000-000000000315","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"015-premium-179-device-a"}', true);
select is(public.activate_current_session()->>'status', 'active', 'Premium 179 device A activates');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000301","session_id":"00000000-0000-0000-0000-000000000316","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"015-premium-179-device-b"}', true);
select is(public.activate_current_session()->>'status', 'active', 'Premium 179 device B activates without replacing A');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000301","session_id":"00000000-0000-0000-0000-000000000315","role":"authenticated"}',
  true
);
select is(public.has_current_active_session(), true, 'Premium 179 device A remains active');
select is(public.has_active_access('00000000-0000-0000-0000-000000000301'), true, 'Premium subscription access remains valid on device A');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000301","session_id":"00000000-0000-0000-0000-000000000316","role":"authenticated"}',
  true
);
select is(public.has_current_active_session(), true, 'Premium 179 device B remains active');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000301","session_id":"00000000-0000-0000-0000-000000000316","role":"authenticated","iat":1793304000,"exp":1793307600}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"015-premium-179-device-b"}', true);
select is(public.activate_current_session()->>'status', 'active', 'token refresh keeps the same Premium 179 session active');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000301","session_id":"00000000-0000-0000-0000-000000000317","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"015-premium-179-device-c"}', true);
select is(public.activate_current_session()->>'status', 'blocked', 'Premium 179 device C is blocked while A and B use both slots');
select is(public.has_current_active_session(), false, 'blocked Premium 179 device C has no protected access');
select is(
  (select count(*)::integer from public.cities where id = '00000000-0000-0000-0000-000000000321'),
  0,
  'blocked device C is denied by protected-data RLS'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000301","session_id":"00000000-0000-0000-0000-000000000315","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"015-premium-179-device-a"}', true);
select is(public.deactivate_current_session()->>'status', 'deactivated', 'Premium 179 device A logout revokes the account sessions');
select is(public.has_current_active_session(), false, 'logged-out Premium 179 device A immediately loses access');
select is(public.activate_current_session()->>'status', 'blocked', 'logged-out Premium 179 JWT cannot reactivate');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000301","session_id":"00000000-0000-0000-0000-000000000317","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"015-premium-179-device-c"}', true);
select is(public.activate_current_session()->>'status', 'active', 'Premium 179 device C can activate after A logs out');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000316","role":"authenticated"}',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000301","session_id":"00000000-0000-0000-0000-000000000316","role":"authenticated"}',
  true
);
select is(public.has_current_active_session(), false, 'account logout also revokes Premium 179 device B');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000301","session_id":"00000000-0000-0000-0000-000000000317","role":"authenticated"}',
  true
);
select is(public.has_current_active_session(), true, 'device C is active in the released slot');

reset role;
select is(
  (select count(*)::integer
   from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000301'),
  1,
  'only the newly activated Premium 179 device remains after account logout'
);
update public.profiles
set subscription_payment_id = 'unverified-or-mismatched-payment'
where id = '00000000-0000-0000-0000-000000000301';
select is(
  public.current_device_session_limit('00000000-0000-0000-0000-000000000301'),
  1,
  'a mismatched current payment reference removes the second slot'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000301","session_id":"00000000-0000-0000-0000-000000000317","role":"authenticated"}',
  true
);
select is(
  public.has_active_access('00000000-0000-0000-0000-000000000301'),
  false,
  'access is denied if the verified 179 entitlement no longer matches'
);
reset role;
update public.profiles
set subscription_payment_id = 'premium-179-test'
where id = '00000000-0000-0000-0000-000000000301';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000301","session_id":"00000000-0000-0000-0000-000000000317","role":"authenticated"}',
  true
);
select is(
  public.has_active_access('00000000-0000-0000-0000-000000000301'),
  true,
  'restoring the matching verified payment restores Premium access'
);

reset role;
update public.payment_transactions
set metadata = jsonb_set(metadata, '{bank_amount}', '"178"')
where payment_id = 'premium-179-test';
select is(
  public.current_device_session_limit('00000000-0000-0000-0000-000000000301'),
  1,
  'a BOG amount mismatch never grants the second session slot'
);
update public.payment_transactions
set metadata = jsonb_set(metadata, '{bank_amount}', '"179"')
where payment_id = 'premium-179-test';
select is(
  public.current_device_session_limit('00000000-0000-0000-0000-000000000301'),
  2,
  'a restored verified BOG amount restores the second slot'
);
select ok(
  pg_catalog.lower(pg_catalog.pg_get_functiondef('public.activate_current_session()'::regprocedure)) like '%for update%',
  'activation serializes competing logins by locking the profile row'
);
select is(
  (select count(*)::integer
   from pg_catalog.pg_constraint
   where conrelid = 'public.profile_active_sessions'::regclass
     and contype = 'p'
     and pg_catalog.pg_get_constraintdef(oid) = 'PRIMARY KEY (profile_id, session_id)'),
  1,
  'session registry has a unique key per account and auth session'
);
select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.current_device_session_limit(uuid)',
    'EXECUTE'
  ),
  'clients cannot invoke the internal entitlement calculator directly'
);
select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.activate_current_session()',
    'EXECUTE'
  ),
  'authenticated clients can request server-side session activation'
);
select is(
  (select status || ':' || amount::text || ':' || currency
   from public.payment_transactions
   where payment_id = 'premium-179-test'),
  'success:179.00:GEL',
  'session activation and logout leave the verified payment record unchanged'
);
select ok(
  (select subscription_status = 'active'
      and subscription_expires_at > pg_catalog.now()
      and subscription_payment_id = 'premium-179-test'
   from public.profiles
   where id = '00000000-0000-0000-0000-000000000301'),
  'session changes leave subscription status, expiry, and payment reference unchanged'
);
select ok(
  (select count(*) = 3
   from pg_catalog.pg_policies
   where schemaname = 'public'
     and tablename in ('cities', 'routes', 'pins')
     and policyname in (
       'cities_active_session_guard',
       'routes_active_session_guard',
       'pins_active_session_guard'
     )
     and permissive = 'RESTRICTIVE'
     and qual like '%has_active_access%'
     and qual like '%has_current_active_session%'),
  'cities, routes, and pins keep restrictive subscription and session guards'
);
select ok(
  (select count(*) = 2
   from pg_catalog.pg_policies
   where schemaname = 'public'
     and tablename = 'profiles'
     and policyname in (
       'profiles_active_session_select_guard',
       'profiles_active_session_update_guard'
     )
     and permissive = 'RESTRICTIVE'
     and (qual like '%has_current_active_session%'
       or with_check like '%has_current_active_session%')),
  'profile reads and writes keep restrictive session guards'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'payment_transactions'
      and policyname = 'payment_transactions_active_session_guard'
      and permissive = 'RESTRICTIVE'
      and qual like '%has_current_active_session%'
  ),
  'payment history keeps a restrictive session guard'
);
select ok(
  (select count(*) = 3
   from pg_catalog.pg_policies
   where schemaname = 'public'
     and tablename in (
       'support_conversations',
       'support_messages',
       'support_message_attachments'
     )
     and policyname in (
       'support_conversations_active_session_guard',
       'support_messages_active_session_guard',
       'support_attachments_active_session_guard'
     )
     and permissive = 'RESTRICTIVE'
     and qual like '%has_current_active_session%'),
  'support conversation, message, and attachment metadata keep session guards'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'support_attachments_insert_own'
      and cmd = 'INSERT'
      and with_check like '%support_conversations%'
      and with_check like '%support-attachments%'
  ) and exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'support_attachments_select_participants'
      and cmd = 'SELECT'
      and qual like '%support_conversations%'
      and qual like '%support-attachments%'
      and qual like '%is_support_admin%'
  ),
  'unchanged Storage policies use conversation/admin paths protected by session RLS'
);

select * from finish();
rollback;
