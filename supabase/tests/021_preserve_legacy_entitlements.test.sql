begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000951',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'legacy-premium-021@example.test', '',
    pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()
  ),
  (
    '00000000-0000-0000-0000-000000000952',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'failed-payment-021@example.test', '',
    pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()
  )
on conflict (id) do nothing;

insert into public.profiles (
  id, subscription_status, subscription_plan, subscription_expires_at,
  device_slots, subscription_payment_id
)
values
  (
    '00000000-0000-0000-0000-000000000951',
    'active', 'premium', pg_catalog.now() + interval '30 days', 2, null
  ),
  (
    '00000000-0000-0000-0000-000000000952',
    'active', 'premium', pg_catalog.now() + interval '30 days', 1, 'failed-payment-021'
  )
on conflict (id) do update
set subscription_status = excluded.subscription_status,
    subscription_plan = excluded.subscription_plan,
    subscription_expires_at = excluded.subscription_expires_at,
    device_slots = excluded.device_slots,
    subscription_payment_id = excluded.subscription_payment_id;

insert into public.payment_transactions (
  user_id, provider, payment_id, merchant_payment_id, amount, currency, status, metadata
)
values (
  '00000000-0000-0000-0000-000000000952',
  'bog', 'failed-payment-021', 'merchant-failed-021', 99, 'GEL', 'failed',
  '{"provider":"bog","device_slots":1,"bank_status":"rejected","bank_amount":"99","bank_currency":"GEL","bank_external_order_id":"merchant-failed-021"}'
);

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
values
  (
    '00000000-0000-0000-0000-000000000961',
    '00000000-0000-0000-0000-000000000951',
    pg_catalog.now(), pg_catalog.now(), null
  ),
  (
    '00000000-0000-0000-0000-000000000962',
    '00000000-0000-0000-0000-000000000952',
    pg_catalog.now(), pg_catalog.now(), null
  );

select is(
  public.current_device_session_limit('00000000-0000-0000-0000-000000000951'),
  2,
  'legacy active profile retains its recorded two-device limit'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000951","session_id":"00000000-0000-0000-0000-000000000961","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"legacy-device-021"}', true);
select is(
  (public.activate_current_session()->>'access_active')::boolean,
  true,
  'legacy active profile without a payment link retains access'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000952","session_id":"00000000-0000-0000-0000-000000000962","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"failed-device-021"}', true);
select is(
  (public.activate_current_session()->>'access_active')::boolean,
  false,
  'a linked failed BOG payment does not grant Premium access'
);
reset role;

select is(
  (select subscription_status from public.profiles where id = '00000000-0000-0000-0000-000000000952'),
  'active',
  'migration does not rewrite an existing active profile'
);
select is(
  (select status from public.payment_transactions where payment_id = 'failed-payment-021'),
  'failed',
  'failed payment remains failed'
);

select * from finish();
rollback;
