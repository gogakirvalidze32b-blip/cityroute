begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(14);

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

select pg_temp.confirm_bog('00000000-0000-0000-0000-000000000972', 'snapshot-paid-179', 'merchant-snapshot-paid-179', 179, 2);
select set_config('cityroute.bog_payment_write', 'on', true);
insert into public.payment_transactions (
  user_id, provider, payment_id, merchant_payment_id, amount, currency,
  status, metadata, paid_at
)
values (
  '00000000-0000-0000-0000-000000000973',
  'bog', 'snapshot-failed-99', 'merchant-snapshot-failed-99',
  99, 'GEL', 'failed',
  '{"provider":"bog","device_slots":1,"bank_status":"rejected","bank_amount":"99","bank_currency":"GEL","bank_external_order_id":"merchant-snapshot-failed-99"}',
  null
);
select set_config('cityroute.bog_payment_write', 'off', true);

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
  'trial',
  'a failed payment does not become Premium'
);
select is(
  public.get_current_account_entitlement()->>'payment_status',
  null,
  'an unlinked failed payment is not shown as the account payment'
);
select is(
  (public.get_current_account_entitlement()->>'access_active')::boolean,
  true,
  'the account remains on Trial access'
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
