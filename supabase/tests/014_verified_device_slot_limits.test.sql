begin;

create extension if not exists pgtap with schema extensions;
select plan(35);

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

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
values
  ('00000000-0000-0000-0000-000000000211', '00000000-0000-0000-0000-000000000201', now() - interval '3 minutes', now(), null),
  ('00000000-0000-0000-0000-000000000212', '00000000-0000-0000-0000-000000000201', now() - interval '2 minutes', now(), null),
  ('00000000-0000-0000-0000-000000000213', '00000000-0000-0000-0000-000000000201', now() - interval '1 minute', now(), null),
  ('00000000-0000-0000-0000-000000000221', '00000000-0000-0000-0000-000000000202', now() - interval '2 minutes', now(), null),
  ('00000000-0000-0000-0000-000000000222', '00000000-0000-0000-0000-000000000202', now() - interval '1 minute', now(), null),
  ('00000000-0000-0000-0000-000000000231', '00000000-0000-0000-0000-000000000203', now() - interval '2 minutes', now(), null),
  ('00000000-0000-0000-0000-000000000232', '00000000-0000-0000-0000-000000000203', now() - interval '1 minute', now(), null),
  ('00000000-0000-0000-0000-000000000241', '00000000-0000-0000-0000-000000000204', now() - interval '2 minutes', now(), null),
  ('00000000-0000-0000-0000-000000000242', '00000000-0000-0000-0000-000000000204', now() - interval '1 minute', now(), null),
  ('00000000-0000-0000-0000-000000000251', '00000000-0000-0000-0000-000000000205', now() - interval '2 minutes', now(), null),
  ('00000000-0000-0000-0000-000000000252', '00000000-0000-0000-0000-000000000205', now() - interval '1 minute', now(), null),
  ('00000000-0000-0000-0000-000000000261', '00000000-0000-0000-0000-000000000206', now() - interval '3 minutes', now(), null),
  ('00000000-0000-0000-0000-000000000262', '00000000-0000-0000-0000-000000000206', now() - interval '2 minutes', now(), null),
  ('00000000-0000-0000-0000-000000000263', '00000000-0000-0000-0000-000000000206', now() - interval '1 minute', now(), null)
on conflict (id) do nothing;

insert into public.profiles (
  id, subscription_status, subscription_plan, subscription_expires_at,
  device_slots, subscription_payment_id, device_fingerprint, device_bound_at
)
values
  ('00000000-0000-0000-0000-000000000201', 'active', 'full', '2027-01-01T00:00:00Z', 2, 'test-paid-179', null, null),
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
  user_id, provider, payment_id, merchant_payment_id, amount, currency, status, metadata, paid_at
)
values
  ('00000000-0000-0000-0000-000000000201', 'bog', 'test-paid-179', 'test-merchant-179', 179, 'GEL', 'success', '{"provider":"bog","device_slots":2,"bank_status":"completed","bank_amount":"179","bank_currency":"GEL","bank_external_order_id":"test-merchant-179"}', now()),
  ('00000000-0000-0000-0000-000000000202', 'bog', 'test-paid-99', 'test-merchant-99', 99, 'GEL', 'success', '{"provider":"bog","device_slots":1}', now()),
  ('00000000-0000-0000-0000-000000000203', 'bog', 'test-unverified-179', 'test-merchant-unverified', 179, 'GEL', 'success', '{"provider":"bog","device_slots":2}', now()),
  ('00000000-0000-0000-0000-000000000206', 'bog', 'test-wrong-owner-179', 'test-merchant-wrong-owner', 179, 'GEL', 'success', '{"provider":"bog","device_slots":2,"bank_status":"completed","bank_amount":"179","bank_currency":"GEL","bank_external_order_id":"test-merchant-wrong-owner"}', now()),
  ('00000000-0000-0000-0000-000000000205', 'bog', 'test-pending-179', 'test-merchant-pending', 179, 'GEL', 'pending', '{"provider":"bog","device_slots":2}', null),
  ('00000000-0000-0000-0000-000000000206', 'bog', 'test-paid-179-legacy-plan', 'test-merchant-179-legacy-plan', 179, 'GEL', 'success', '{"provider":"bog","device_slots":2,"bank_status":"completed","bank_amount":"179","bank_currency":"GEL","bank_external_order_id":"test-merchant-179-legacy-plan"}', now())
on conflict (provider, payment_id) do update
set user_id = excluded.user_id,
    amount = excluded.amount,
    currency = excluded.currency,
    status = excluded.status,
    metadata = excluded.metadata,
    paid_at = excluded.paid_at;

select is(public.current_device_session_limit('00000000-0000-0000-0000-000000000201'), 2, 'verified 179 GEL full plan grants two active-session slots');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000201', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000201","session_id":"00000000-0000-0000-0000-000000000211","role":"authenticated"}', true);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"verified-179-device-001"}', true);
select is(public.bind_device('verified-179-device-001')->>'status', 'ok', 'verified 179 GEL session A activates');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000201","session_id":"00000000-0000-0000-0000-000000000212","role":"authenticated"}', true);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"verified-179-device-002"}', true);
select is(public.bind_device('verified-179-device-002')->>'status', 'ok', 'verified 179 GEL session B activates within its two-session limit');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000201","session_id":"00000000-0000-0000-0000-000000000213","role":"authenticated"}', true);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"verified-179-device-003"}', true);
select is(public.bind_device('verified-179-device-003')->>'status', 'blocked', 'verified 179 GEL full plan blocks session C');
reset role;
select is(
  (select count(*)::integer from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000201'),
  2,
  'verified 179 GEL sessions A and B remain active after C is blocked'
);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000201","session_id":"00000000-0000-0000-0000-000000000211","role":"authenticated"}', true);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"verified-179-device-001"}', true);
select is(public.deactivate_current_session()->>'status', 'deactivated', 'logging out session A revokes only session A');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000201","session_id":"00000000-0000-0000-0000-000000000213","role":"authenticated"}', true);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"verified-179-device-003"}', true);
select is(public.activate_current_session()->>'status', 'active', 'blocked session C can activate after session A logs out');
select is(public.has_current_active_session(), true, 'session C has access after activating in a released account slot');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000201","session_id":"00000000-0000-0000-0000-000000000212","role":"authenticated"}', true);
select is(public.has_current_active_session(), true, 'session A logout preserves session B');
reset role;
select is(
  (select count(*)::integer from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000201'),
  2,
  'session B and session C remain active after session A logout'
);

select is(public.current_device_session_limit('00000000-0000-0000-0000-000000000206'), 2, 'verified 179 GEL full plan grants two slots');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000206', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000206","session_id":"00000000-0000-0000-0000-000000000261","role":"authenticated"}', true);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"legacy-plan-179-device-001"}', true);
select is(public.bind_device('legacy-plan-179-device-001')->>'status', 'ok', 'legacy full-plan session A activates');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000206","session_id":"00000000-0000-0000-0000-000000000262","role":"authenticated"}', true);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"legacy-plan-179-device-002"}', true);
select is(public.bind_device('legacy-plan-179-device-002')->>'status', 'ok', 'legacy full-plan session B uses the second slot');
reset role;
select is(
  (select count(*)::integer from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000206'),
  2,
  'verified legacy full-plan account keeps both sessions active'
);

select is(public.current_device_session_limit('00000000-0000-0000-0000-000000000202'), 1, '99 GEL account retains a one-session limit');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000202', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000202","session_id":"00000000-0000-0000-0000-000000000221","role":"authenticated"}', true);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"verified-99-device-001"}', true);
select is(public.bind_device('verified-99-device-001')->>'status', 'ok', 'verified 99 GEL session A activates');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000202","session_id":"00000000-0000-0000-0000-000000000222","role":"authenticated"}', true);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"verified-99-device-002"}', true);
select is(public.bind_device('verified-99-device-002')->>'status', 'ok', 'verified 99 GEL session B takes the single slot');
reset role;
select ok(
  exists (
    select 1 from public.profile_revoked_sessions
    where profile_id = '00000000-0000-0000-0000-000000000202'
      and session_id = '00000000-0000-0000-0000-000000000221'
  ),
  'replaced 99 GEL session A is revoked'
);

select is(public.current_device_session_limit('00000000-0000-0000-0000-000000000203'), 1, 'unverified 179 GEL metadata cannot grant a second session slot');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000203', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000203","session_id":"00000000-0000-0000-0000-000000000231","role":"authenticated"}', true);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"unverified-179-device-001"}', true);
select is(public.bind_device('unverified-179-device-001')->>'status', 'ok', 'unverified 179 GEL session A can activate');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000203","session_id":"00000000-0000-0000-0000-000000000232","role":"authenticated"}', true);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"unverified-179-device-002"}', true);
select is(public.bind_device('unverified-179-device-002')->>'status', 'ok', 'unverified 179 GEL session B replaces session A within one slot');
select is(public.has_current_device_access(), true, 'unverified 179 GEL session B has current-session access');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000203","session_id":"00000000-0000-0000-0000-000000000231","role":"authenticated"}', true);
select is(public.has_current_device_access(), false, 'replaced unverified 179 GEL session A no longer has access');

reset role;
select is(public.current_device_session_limit('00000000-0000-0000-0000-000000000204'), 1, 'another account payment cannot grant this account a second slot');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000204', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000204","session_id":"00000000-0000-0000-0000-000000000241","role":"authenticated"}', true);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"wrong-owner-device-001"}', true);
select is(public.bind_device('wrong-owner-device-001')->>'status', 'ok', 'account with another owner payment activates one session');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000204","session_id":"00000000-0000-0000-0000-000000000242","role":"authenticated"}', true);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"wrong-owner-device-002"}', true);
select is(public.bind_device('wrong-owner-device-002')->>'status', 'ok', 'new wrong-owner account session takes its one slot');
reset role;
select ok(
  exists (
    select 1 from public.profile_revoked_sessions
    where profile_id = '00000000-0000-0000-0000-000000000204'
      and session_id = '00000000-0000-0000-0000-000000000241'
  ),
  'wrong-owner payment does not prevent replacement of a one-slot session'
);

select is(public.current_device_session_limit('00000000-0000-0000-0000-000000000205'), 1, 'pending 179 GEL payment retains one active-session slot');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000205', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000205","session_id":"00000000-0000-0000-0000-000000000251","role":"authenticated"}', true);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"pending-179-device-001"}', true);
select is(public.bind_device('pending-179-device-001')->>'status', 'ok', 'pending 179 GEL session A can activate');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000205","session_id":"00000000-0000-0000-0000-000000000252","role":"authenticated"}', true);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"pending-179-device-002"}', true);
select is(public.bind_device('pending-179-device-002')->>'status', 'ok', 'pending 179 GEL session B takes its one slot');
reset role;
select ok(
  exists (
    select 1 from public.profile_revoked_sessions
    where profile_id = '00000000-0000-0000-0000-000000000205'
      and session_id = '00000000-0000-0000-0000-000000000251'
  ),
  'pending payment does not grant a second active session'
);

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
select ok(
  pg_get_functiondef('public.activate_current_session()'::regprocedure) LIKE '%for update%',
  'session activation serializes concurrent attempts with a profile row lock'
);

select * from finish();
rollback;
