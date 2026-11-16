begin;

create extension if not exists pgtap with schema extensions;
select plan(45);

create function pg_temp.confirm_bog(p_user uuid, p_payment text, p_merchant text, p_amount numeric, p_slots integer)
returns void language plpgsql as $confirm$
declare
  v_result jsonb;
  v_amount text := case p_amount when 99 then '99.00' when 179 then '179.00' else p_amount::text end;
begin
  insert into public.payment_transactions (
    user_id, provider, payment_id, merchant_payment_id, amount, currency, status, metadata
  ) values (
    p_user, 'bog', p_payment, p_merchant, p_amount, 'GEL', 'pending',
    pg_catalog.jsonb_build_object('provider', 'bog', 'device_slots', p_slots, 'package_price', p_amount)
  );
  perform pg_catalog.set_config('request.jwt.claim.role', 'cityroute_bog_confirmer', true);
  perform pg_catalog.set_config('request.jwt.claims', '{"role":"cityroute_bog_confirmer"}', true);
  v_result := public.update_bog_payment_status(
    p_payment, 'success', p_payment || '-bank',
    pg_catalog.jsonb_build_object(
      'bank_status', 'completed', 'bank_amount', v_amount,
      'bank_currency', 'GEL', 'bank_external_order_id', p_merchant
    )
  );
  perform pg_catalog.set_config('request.jwt.claim.role', '', true);
  perform pg_catalog.set_config('request.jwt.claims', '{}', true);
  if v_result->>'status' is distinct from 'success' or v_result->>'success' is distinct from 'true' then
    raise exception 'BOG activation failed for %: %', p_payment, v_result;
  end if;
end
$confirm$;

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
select pg_temp.confirm_bog('00000000-0000-0000-0000-000000000301', 'premium-99-test', 'merchant-premium-99-test', 99, 1);

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
select pg_temp.confirm_bog('00000000-0000-0000-0000-000000000301', 'premium-179-test', 'merchant-premium-179-test', 179, 2);

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
select is(public.deactivate_current_session()->>'status', 'deactivated', 'Premium 179 device A logout revokes only device A');
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
select is(public.has_current_active_session(), true, 'device A logout preserves Premium 179 device B');
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
  2,
  'device B and the newly activated Premium 179 device C remain active'
);
select throws_ok(
  $$update public.profiles
    set subscription_payment_id = 'unverified-or-mismatched-payment'
    where id = '00000000-0000-0000-0000-000000000301'$$,
  '42501',
  'device slots and payment reference can change only during confirmed premium activation',
  'a paid payment reference cannot be replaced by hand'
);
select is(
  public.current_device_session_limit('00000000-0000-0000-0000-000000000301'),
  2,
  'the verified 179 limit remains after the rejected payment rewrite'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000301","session_id":"00000000-0000-0000-0000-000000000317","role":"authenticated"}',
  true
);
select is(
  public.has_active_access('00000000-0000-0000-0000-000000000301'),
  true,
  'access remains because the verified payment reference was not changed'
);

reset role;
select set_config('cityroute.bog_payment_write', 'on', true);
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
select set_config('cityroute.bog_payment_write', 'off', true);
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
