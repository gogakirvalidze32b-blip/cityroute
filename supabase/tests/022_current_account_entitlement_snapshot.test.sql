begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(14);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000971',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'snapshot-trial-022@example.test', '',
    pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()
  ),
  (
    '00000000-0000-0000-0000-000000000972',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'snapshot-paid-022@example.test', '',
    pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()
  ),
  (
    '00000000-0000-0000-0000-000000000973',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'snapshot-failed-022@example.test', '',
    pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()
  )
on conflict (id) do nothing;

insert into public.profiles (
  id, subscription_status, subscription_plan, subscription_expires_at,
  device_slots, subscription_payment_id
)
values
  (
    '00000000-0000-0000-0000-000000000971',
    'trial', 'premium', pg_catalog.now() + interval '12 hours', 1, null
  ),
  (
    '00000000-0000-0000-0000-000000000972',
    'active', 'premium', pg_catalog.now() + interval '30 days', 2, 'snapshot-paid-179'
  ),
  (
    '00000000-0000-0000-0000-000000000973',
    'active', 'premium', pg_catalog.now() + interval '30 days', 1, 'snapshot-failed-99'
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
values
  (
    '00000000-0000-0000-0000-000000000972',
    'bog', 'snapshot-paid-179', 'merchant-snapshot-paid-179',
    179, 'GEL', 'success',
    '{"provider":"bog","device_slots":2,"bank_status":"completed","bank_amount":"179","bank_currency":"GEL","bank_external_order_id":"merchant-snapshot-paid-179"}',
    pg_catalog.now()
  ),
  (
    '00000000-0000-0000-0000-000000000973',
    'bog', 'snapshot-failed-99', 'merchant-snapshot-failed-99',
    99, 'GEL', 'failed',
    '{"provider":"bog","device_slots":1,"bank_status":"rejected","bank_amount":"99","bank_currency":"GEL","bank_external_order_id":"merchant-snapshot-failed-99"}',
    null
  );

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
values
  ('00000000-0000-0000-0000-000000000981', '00000000-0000-0000-0000-000000000971', pg_catalog.now(), pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000982', '00000000-0000-0000-0000-000000000972', pg_catalog.now(), pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000983', '00000000-0000-0000-0000-000000000973', pg_catalog.now(), pg_catalog.now(), null);

insert into public.profile_active_sessions (
  profile_id, session_id, session_created_at, activated_at, updated_at, device_fingerprint
)
values
  (
    '00000000-0000-0000-0000-000000000971',
    '00000000-0000-0000-0000-000000000981',
    pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), 'snapshot-trial-device'
  ),
  (
    '00000000-0000-0000-0000-000000000972',
    '00000000-0000-0000-0000-000000000982',
    pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), 'snapshot-paid-device'
  ),
  (
    '00000000-0000-0000-0000-000000000973',
    '00000000-0000-0000-0000-000000000983',
    pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), 'snapshot-failed-device'
  );

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000971","session_id":"00000000-0000-0000-0000-000000000981","role":"authenticated"}',
  true
);
select is(
  public.get_current_account_entitlement()->>'entitlement',
  'trial',
  'the authoritative snapshot identifies a current Trial'
);
select is(
  (public.get_current_account_entitlement()->>'access_active')::boolean,
  true,
  'the current Trial snapshot reports active access'
);
select is(
  (public.get_current_account_entitlement()->>'device_limit')::integer,
  1,
  'the Trial snapshot reports the current one-device limit'
);
select is(
  public.get_current_account_entitlement()->>'payment_status',
  null,
  'the Trial snapshot has no linked payment status'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000972","session_id":"00000000-0000-0000-0000-000000000982","role":"authenticated"}',
  true
);
select is(
  public.get_current_account_entitlement()->>'entitlement',
  'paid',
  'a verified BOG payment is identified as Paid Premium'
);
select is(
  public.get_current_account_entitlement()->>'payment_status',
  'success',
  'the snapshot returns the status of the linked payment'
);
select is(
  (public.get_current_account_entitlement()->>'payment_amount')::numeric,
  179::numeric,
  'the snapshot returns the verified payment amount'
);
select is(
  public.get_current_account_entitlement()->>'payment_currency',
  'GEL',
  'the snapshot returns the payment currency'
);
select is(
  (public.get_current_account_entitlement()->>'device_limit')::integer,
  2,
  'the verified 179 GEL snapshot reports two devices'
);
select is(
  (public.get_current_account_entitlement()->>'access_active')::boolean,
  true,
  'the verified Paid Premium snapshot reports active access'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000973","session_id":"00000000-0000-0000-0000-000000000983","role":"authenticated"}',
  true
);
select is(
  public.get_current_account_entitlement()->>'entitlement',
  'inactive',
  'a linked failed payment is not reported as Premium'
);
select is(
  public.get_current_account_entitlement()->>'payment_status',
  'failed',
  'the failed payment state is visible in the snapshot'
);
select is(
  (public.get_current_account_entitlement()->>'access_active')::boolean,
  false,
  'a linked failed payment does not grant access'
);

reset role;
set local role postgres;
set local role anon;
select is(
  pg_catalog.has_function_privilege(
    'anon',
    'public.get_current_account_entitlement()',
    'EXECUTE'
  ),
  false,
  'anonymous callers cannot execute the account entitlement snapshot'
);

select * from finish();
rollback;
