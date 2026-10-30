begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(31);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000901',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'bog-verified-99@example.test', '',
    pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()
  ),
  (
    '00000000-0000-0000-0000-000000000902',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'bog-verified-179@example.test', '',
    pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()
  ),
  (
    '00000000-0000-0000-0000-000000000903',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'bog-pending-99@example.test', '',
    pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()
  ),
  (
    '00000000-0000-0000-0000-000000000904',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'bog-mismatch-179@example.test', '',
    pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()
  )
on conflict (id) do nothing;

insert into public.profiles (
  id, subscription_status, subscription_plan, subscription_expires_at,
  device_slots, subscription_payment_id
)
values
  ('00000000-0000-0000-0000-000000000901', 'trial', 'premium', pg_catalog.now() + interval '12 hours', 1, null),
  ('00000000-0000-0000-0000-000000000902', 'trial', 'premium', pg_catalog.now() + interval '12 hours', 1, null),
  ('00000000-0000-0000-0000-000000000903', 'trial', 'premium', pg_catalog.now() + interval '12 hours', 1, null),
  ('00000000-0000-0000-0000-000000000904', 'trial', 'premium', pg_catalog.now() + interval '12 hours', 1, null)
on conflict (id) do update
set subscription_status = excluded.subscription_status,
    subscription_plan = excluded.subscription_plan,
    subscription_expires_at = excluded.subscription_expires_at,
    device_slots = excluded.device_slots,
    subscription_payment_id = excluded.subscription_payment_id;

insert into public.payment_transactions (
  user_id, provider, payment_id, merchant_payment_id, amount, currency, status, metadata
)
values
  (
    '00000000-0000-0000-0000-000000000901', 'bog', 'bog-verified-99', 'merchant-verified-99',
    99, 'GEL', 'pending', '{"provider":"bog","device_slots":1}'
  ),
  (
    '00000000-0000-0000-0000-000000000902', 'bog', 'bog-verified-179', 'merchant-verified-179',
    179, 'GEL', 'pending', '{"provider":"bog","device_slots":2}'
  ),
  (
    '00000000-0000-0000-0000-000000000903', 'bog', 'bog-pending-99', 'merchant-pending-99',
    99, 'GEL', 'pending', '{"provider":"bog","device_slots":1}'
  ),
  (
    '00000000-0000-0000-0000-000000000904', 'bog', 'bog-mismatch-179', 'merchant-mismatch-179',
    179, 'GEL', 'pending', '{"provider":"bog","device_slots":2}'
  );

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(
  public.update_bog_payment_status(
    'bog-verified-99', 'success', 'bank-transaction-99',
    '{"bank_status":"completed","bank_amount":"99.00","bank_currency":"GEL","bank_external_order_id":"merchant-verified-99"}'
  )->>'status',
  'success',
  'verified 99 GEL receipt is accepted'
);
reset role;
set local role postgres;

select is(
  (select subscription_status from public.profiles where id = '00000000-0000-0000-0000-000000000901'),
  'active',
  'verified 99 GEL payment activates Premium'
);
select is(
  (select subscription_plan from public.profiles where id = '00000000-0000-0000-0000-000000000901'),
  'premium',
  '99 GEL activation assigns the Premium plan'
);
select is(
  (select device_slots from public.profiles where id = '00000000-0000-0000-0000-000000000901'),
  1,
  '99 GEL activation grants one device slot'
);
select is(
  (select subscription_payment_id from public.profiles where id = '00000000-0000-0000-0000-000000000901'),
  'bog-verified-99',
  '99 GEL payment is linked to its profile'
);
select ok(
  (select status = 'success' and paid_at is not null
   from public.payment_transactions where payment_id = 'bog-verified-99'),
  'verified 99 GEL transaction is marked paid'
);
select is(
  public.current_device_session_limit('00000000-0000-0000-0000-000000000901'),
  1,
  '99 GEL Premium entitlement has a one-device limit'
);
select is(
  public.current_verified_premium_device_slots('00000000-0000-0000-0000-000000000901'),
  1,
  '99 GEL payment is the authoritative one-device entitlement'
);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(
  (public.update_bog_payment_status(
    'bog-verified-99', 'success', 'bank-transaction-99',
    '{"bank_status":"completed","bank_amount":"99.00","bank_currency":"GEL","bank_external_order_id":"merchant-verified-99"}'
  )->>'duplicate_or_stale')::boolean,
  true,
  'duplicate success verification is idempotent'
);
reset role;
set local role postgres;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(
  public.update_bog_payment_status(
    'bog-verified-179', 'success', 'bank-transaction-179',
    '{"bank_status":"completed","bank_amount":"179.00","bank_currency":"GEL","bank_external_order_id":"merchant-verified-179"}'
  )->>'status',
  'success',
  'verified 179 GEL receipt is accepted'
);
reset role;
set local role postgres;

select is(
  (select subscription_status from public.profiles where id = '00000000-0000-0000-0000-000000000902'),
  'active',
  'verified 179 GEL payment activates Premium'
);
select is(
  (select device_slots from public.profiles where id = '00000000-0000-0000-0000-000000000902'),
  2,
  '179 GEL activation grants two device slots'
);
select is(
  (select subscription_payment_id from public.profiles where id = '00000000-0000-0000-0000-000000000902'),
  'bog-verified-179',
  '179 GEL payment is linked to its profile'
);
select is(
  public.current_device_session_limit('00000000-0000-0000-0000-000000000902'),
  2,
  'verified 179 GEL Premium entitlement has a two-device limit'
);
select is(
  public.current_verified_premium_device_slots('00000000-0000-0000-0000-000000000902'),
  2,
  '179 GEL payment is the authoritative two-device entitlement'
);
update public.profiles
set subscription_expires_at = pg_catalog.now() - interval '1 second'
where id = '00000000-0000-0000-0000-000000000902';
select is(
  public.current_verified_premium_device_slots('00000000-0000-0000-0000-000000000902'),
  0,
  'expired subscription no longer grants paid device slots'
);
update public.profiles
set subscription_expires_at = pg_catalog.now() + interval '30 days'
where id = '00000000-0000-0000-0000-000000000902';

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(
  public.update_bog_payment_status(
    'bog-pending-99', 'processing', null,
    '{"bank_status":"processing","bank_amount":"99.00","bank_currency":"GEL","bank_external_order_id":"merchant-pending-99"}'
  )->>'status',
  'processing',
  'bank processing status is recorded without treating it as success'
);
reset role;
set local role postgres;
select is(
  (select subscription_status from public.profiles where id = '00000000-0000-0000-0000-000000000903'),
  'trial',
  'pending payment does not activate Premium'
);
select is(
  (select status from public.payment_transactions where payment_id = 'bog-pending-99'),
  'processing',
  'pending payment remains non-successful'
);
select is(
  public.current_verified_premium_device_slots('00000000-0000-0000-0000-000000000903'),
  0,
  'pending payment grants no paid device slots'
);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok(
  $$select public.update_bog_payment_status(
    'bog-mismatch-179', 'success', 'bank-transaction-mismatch',
    '{"bank_status":"completed","bank_amount":"99.00","bank_currency":"GEL","bank_external_order_id":"merchant-mismatch-179"}'
  )$$,
  'P0001',
  'BOG receipt amount does not match the stored transaction',
  'a mismatched bank receipt cannot activate Premium'
);
reset role;
set local role postgres;

select is(
  (select status from public.payment_transactions where payment_id = 'bog-mismatch-179'),
  'pending',
  'mismatched receipt leaves the transaction pending'
);
select is(
  (select subscription_status from public.profiles where id = '00000000-0000-0000-0000-000000000904'),
  'trial',
  'mismatched receipt leaves Premium inactive'
);

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
values
  ('00000000-0000-0000-0000-000000000911', '00000000-0000-0000-0000-000000000902', pg_catalog.now(), pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000912', '00000000-0000-0000-0000-000000000902', pg_catalog.now(), pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000913', '00000000-0000-0000-0000-000000000902', pg_catalog.now(), pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000921', '00000000-0000-0000-0000-000000000901', pg_catalog.now(), pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000922', '00000000-0000-0000-0000-000000000901', pg_catalog.now(), pg_catalog.now(), null);

insert into public.profile_active_sessions (
  profile_id, session_id, session_created_at, activated_at, updated_at, device_fingerprint
)
values
  (
    '00000000-0000-0000-0000-000000000902',
    '00000000-0000-0000-0000-000000000911',
    pg_catalog.now(), pg_catalog.now() - interval '2 minutes', pg_catalog.now(), 'paid-device-a-020'
  ),
  (
    '00000000-0000-0000-0000-000000000902',
    '00000000-0000-0000-0000-000000000912',
    pg_catalog.now(), pg_catalog.now() - interval '1 minute', pg_catalog.now(), 'paid-device-b-020'
  ),
  (
    '00000000-0000-0000-0000-000000000901',
    '00000000-0000-0000-0000-000000000921',
    pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), 'logout-device-a-020'
  ),
  (
    '00000000-0000-0000-0000-000000000901',
    '00000000-0000-0000-0000-000000000922',
    pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), 'logout-device-b-020'
  );

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000902","session_id":"00000000-0000-0000-0000-000000000913","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"paid-device-c-020"}', true);
select is(
  public.activate_current_session()->>'status',
  'blocked',
  'a third device is blocked for verified 179 GEL Premium'
);
reset role;
set local role postgres;

select is(
  (select count(*)::integer
   from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000902'),
  2,
  'blocking a third device preserves both existing 179 GEL sessions'
);
select is(
  (select count(*)::integer
   from public.profile_revoked_sessions
   where profile_id = '00000000-0000-0000-0000-000000000902'
     and session_id in (
       '00000000-0000-0000-0000-000000000911',
       '00000000-0000-0000-0000-000000000912'
     )),
  0,
  'a third-device attempt does not revoke either existing session'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000901","session_id":"00000000-0000-0000-0000-000000000921","role":"authenticated"}',
  true
);
select is(
  (public.deactivate_current_session()->>'deactivated_sessions')::integer,
  2,
  'logout revokes every active device session on the account'
);
reset role;
set local role postgres;

select is(
  (select count(*)::integer
   from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000901'),
  0,
  'account-wide logout removes all active session rows'
);
select is(
  (select count(*)::integer
   from public.profile_revoked_sessions
   where profile_id = '00000000-0000-0000-0000-000000000901'
     and session_id in (
       '00000000-0000-0000-0000-000000000921',
       '00000000-0000-0000-0000-000000000922'
     )),
  2,
  'account-wide logout records every device session as revoked'
);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(
  public.update_bog_payment_status(
    'bog-verified-179', 'refunded', 'bank-refund-179',
    '{"bank_status":"refunded","bank_amount":"179.00","bank_currency":"GEL","bank_external_order_id":"merchant-verified-179","bank_refund_amount":"179.00"}'
  )->>'status',
  'refunded',
  'verified bank refund is recorded'
);
reset role;
set local role postgres;
select is(
  public.current_verified_premium_device_slots('00000000-0000-0000-0000-000000000902'),
  0,
  'refunded payment no longer grants paid device slots'
);

select * from finish();
rollback;
