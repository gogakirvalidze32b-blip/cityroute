begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(10);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000931',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'session-limit-019@example.test', '',
  pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()
)
on conflict (id) do nothing;

insert into public.profiles (
  id, subscription_status, subscription_plan, subscription_expires_at,
  device_slots, subscription_payment_id
)
values (
  '00000000-0000-0000-0000-000000000931',
  'active', 'full', pg_catalog.now() + interval '30 days',
  2, 'session-limit-019-payment'
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
  '00000000-0000-0000-0000-000000000931',
  'bog', 'session-limit-019-payment', 'merchant-session-limit-019',
  179, 'GEL', 'success',
  '{"provider":"bog","device_slots":2,"bank_status":"completed","bank_amount":"179","bank_currency":"GEL","bank_external_order_id":"merchant-session-limit-019"}',
  pg_catalog.now()
);

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
values
  ('00000000-0000-0000-0000-000000000941', '00000000-0000-0000-0000-000000000931', pg_catalog.now() - interval '3 minutes', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000942', '00000000-0000-0000-0000-000000000931', pg_catalog.now() - interval '2 minutes', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000943', '00000000-0000-0000-0000-000000000931', pg_catalog.now() - interval '1 minute', pg_catalog.now(), null);

select is(
  public.current_device_session_limit('00000000-0000-0000-0000-000000000931'),
  2,
  'verified 179 GEL payment grants exactly two device slots'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000931","session_id":"00000000-0000-0000-0000-000000000941","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"device-019-a"}', true);
select is(public.activate_current_session()->>'status', 'active', 'first device is admitted');
select is(public.has_current_active_session(), true, 'first device remains active');

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000931","session_id":"00000000-0000-0000-0000-000000000942","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"device-019-b"}', true);
select is(public.activate_current_session()->>'status', 'active', 'second device is admitted');
select is(public.has_current_active_session(), true, 'second device remains active');

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000931","session_id":"00000000-0000-0000-0000-000000000943","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"device-019-c"}', true);
select is(public.activate_current_session()->>'status', 'blocked', 'third device is rejected');
select is(public.has_current_active_session(), false, 'rejected third device has no active slot');

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000931","session_id":"00000000-0000-0000-0000-000000000941","role":"authenticated"}',
  true
);
select is(public.has_current_active_session(), true, 'third-device attempt preserves the first session');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000931","session_id":"00000000-0000-0000-0000-000000000942","role":"authenticated"}',
  true
);
select is(public.has_current_active_session(), true, 'third-device attempt preserves the second session');

reset role;
set local role postgres;
select is(
  (select count(*)::integer
   from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000931'),
  2,
  'active session registry remains capped at two devices'
);

select * from finish();
rollback;
