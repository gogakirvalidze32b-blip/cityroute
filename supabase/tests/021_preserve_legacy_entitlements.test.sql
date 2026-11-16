begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(5);

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

select pg_temp.confirm_bog('00000000-0000-0000-0000-000000000951', 'legacy-179-021', 'merchant-legacy-179-021', 179, 2);
select set_config('cityroute.bog_payment_write', 'on', true);
insert into public.payment_transactions (
  user_id, provider, payment_id, merchant_payment_id, amount, currency, status, metadata
)
values (
  '00000000-0000-0000-0000-000000000952',
  'bog', 'failed-payment-021', 'merchant-failed-021', 99, 'GEL', 'failed',
  '{"provider":"bog","device_slots":1,"bank_status":"rejected","bank_amount":"99","bank_currency":"GEL","bank_external_order_id":"merchant-failed-021"}'
);
select set_config('cityroute.bog_payment_write', 'off', true);

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
  'verified 179 GEL profile retains its two-device limit'
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
  'verified 179 GEL profile retains access'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000952","session_id":"00000000-0000-0000-0000-000000000962","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"failed-device-021"}', true);
select is(
  (public.activate_current_session()->>'access_active')::boolean,
  true,
  'a failed BOG payment leaves the account on Trial'
);
reset role;
set local role postgres;

select is(
  (select subscription_status from public.profiles where id = '00000000-0000-0000-0000-000000000952'),
  'trial',
  'a failed payment does not activate the profile'
);
select is(
  (select status from public.payment_transactions where payment_id = 'failed-payment-021'),
  'failed',
  'failed payment remains failed'
);

select * from finish();
rollback;
