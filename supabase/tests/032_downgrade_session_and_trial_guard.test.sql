-- supabase/tests/032_downgrade_session_and_trial_guard.test.sql
begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(120);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm032-trial@example.test', '', pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm032-failtrial@example.test', '', pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000a03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm032-one@example.test', '', pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000a04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm032-two@example.test', '', pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000a05', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm032-down@example.test', '', pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000a06', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm032-renew@example.test', '', pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000a07', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm032-override@example.test', '', pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000a08', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm032-failpaid@example.test', '', pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000a09', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm032-tbc-renew@example.test', '', pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now());

insert into public.profiles (
  id, full_name, trial_started_at, subscription_status, subscription_expires_at, subscription_plan
)
select u.id, '', pg_catalog.now(), 'trial', pg_catalog.now() + interval '12 hours', null
from auth.users u
where u.id in (
  '00000000-0000-0000-0000-000000000a01',
  '00000000-0000-0000-0000-000000000a02',
  '00000000-0000-0000-0000-000000000a03',
  '00000000-0000-0000-0000-000000000a04',
  '00000000-0000-0000-0000-000000000a05',
  '00000000-0000-0000-0000-000000000a06',
  '00000000-0000-0000-0000-000000000a07',
  '00000000-0000-0000-0000-000000000a08',
  '00000000-0000-0000-0000-000000000a09'
)
and not exists (
  select 1 from public.profiles p where p.id = u.id
);

alter table public.profiles disable trigger profiles_protect_trial_lifecycle;
update public.profiles
set subscription_status = 'active',
    subscription_plan = 'premium',
    subscription_expires_at = pg_catalog.now() - interval '1 day'
where id = '00000000-0000-0000-0000-000000000a09';
alter table public.profiles enable trigger profiles_protect_trial_lifecycle;

select set_config('m032.a01_trial_start', (select trial_started_at::text from public.profiles where id = '00000000-0000-0000-0000-000000000a01'), true);
select set_config('m032.a05_trial_start', (select trial_started_at::text from public.profiles where id = '00000000-0000-0000-0000-000000000a05'), true);

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
values
  ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-000000000a01', pg_catalog.now() - interval '5 minutes', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000c11', '00000000-0000-0000-0000-000000000a03', pg_catalog.now() - interval '10 minutes', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000c12', '00000000-0000-0000-0000-000000000a03', pg_catalog.now() - interval '1 minute', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000c13', '00000000-0000-0000-0000-000000000a03', pg_catalog.now() - interval '30 seconds', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000c21', '00000000-0000-0000-0000-000000000a04', pg_catalog.now() - interval '10 minutes', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000c22', '00000000-0000-0000-0000-000000000a04', pg_catalog.now() - interval '5 minutes', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000c23', '00000000-0000-0000-0000-000000000a04', pg_catalog.now() - interval '1 minute', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000d01', '00000000-0000-0000-0000-000000000a05', pg_catalog.now() - interval '3 hours', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000d02', '00000000-0000-0000-0000-000000000a05', pg_catalog.now() - interval '2 hours', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000d11', '00000000-0000-0000-0000-000000000a06', pg_catalog.now() - interval '3 hours', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000d12', '00000000-0000-0000-0000-000000000a06', pg_catalog.now() - interval '2 hours', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000d21', '00000000-0000-0000-0000-000000000a07', pg_catalog.now() - interval '3 hours', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000d22', '00000000-0000-0000-0000-000000000a07', pg_catalog.now() - interval '2 hours', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000d31', '00000000-0000-0000-0000-000000000a08', pg_catalog.now() - interval '3 hours', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000d32', '00000000-0000-0000-0000-000000000a08', pg_catalog.now() - interval '2 hours', pg_catalog.now(), null);

-- After 033, BOG inserts require the checkout-create GUC (same pattern as 033/035 tests).
select set_config('cityroute.bog_payment_create', 'on', true);
insert into public.payment_transactions (
  user_id, provider, payment_id, merchant_payment_id, amount, currency, status, metadata, paid_at
)
values
  ('00000000-0000-0000-0000-000000000a01', 'bog', 'm032-a01-99', 'm032-mer-a01-99', 99, 'GEL', 'pending', '{"provider":"bog","device_slots":1,"package_price":99}', null),
  ('00000000-0000-0000-0000-000000000a02', 'bog', 'm032-a02-99', 'm032-mer-a02-99', 99, 'GEL', 'pending', '{"provider":"bog","device_slots":1,"package_price":99}', null),
  ('00000000-0000-0000-0000-000000000a03', 'bog', 'm032-a03-99', 'm032-mer-a03-99', 99, 'GEL', 'pending', '{"provider":"bog","device_slots":1,"package_price":99}', null),
  ('00000000-0000-0000-0000-000000000a03', 'bog', 'm032-a03-179', 'm032-mer-a03-179', 179, 'GEL', 'pending', '{"provider":"bog","device_slots":2,"package_price":179}', null),
  ('00000000-0000-0000-0000-000000000a04', 'bog', 'm032-a04-179', 'm032-mer-a04-179', 179, 'GEL', 'pending', '{"provider":"bog","device_slots":2,"package_price":179}', null),
  ('00000000-0000-0000-0000-000000000a05', 'bog', 'm032-a05-179', 'm032-mer-a05-179', 179, 'GEL', 'pending', '{"provider":"bog","device_slots":2,"package_price":179}', null),
  ('00000000-0000-0000-0000-000000000a05', 'bog', 'm032-a05-99', 'm032-mer-a05-99', 99, 'GEL', 'pending', '{"provider":"bog","device_slots":1,"package_price":99}', null),
  ('00000000-0000-0000-0000-000000000a06', 'bog', 'm032-a06-179a', 'm032-mer-a06-179a', 179, 'GEL', 'pending', '{"provider":"bog","device_slots":2,"package_price":179}', null),
  ('00000000-0000-0000-0000-000000000a06', 'bog', 'm032-a06-179b', 'm032-mer-a06-179b', 179, 'GEL', 'pending', '{"provider":"bog","device_slots":2,"package_price":179}', null),
  ('00000000-0000-0000-0000-000000000a07', 'bog', 'm032-a07-179', 'm032-mer-a07-179', 179, 'GEL', 'pending', '{"provider":"bog","device_slots":2,"package_price":179}', null),
  ('00000000-0000-0000-0000-000000000a07', 'bog', 'm032-a07-99', 'm032-mer-a07-99', 99, 'GEL', 'pending', '{"provider":"bog","device_slots":1,"package_price":99}', null),
  ('00000000-0000-0000-0000-000000000a08', 'bog', 'm032-a08-179', 'm032-mer-a08-179', 179, 'GEL', 'pending', '{"provider":"bog","device_slots":2,"package_price":179}', null),
  ('00000000-0000-0000-0000-000000000a08', 'bog', 'm032-a08-99', 'm032-mer-a08-99', 99, 'GEL', 'pending', '{"provider":"bog","device_slots":1,"package_price":99}', null);
select set_config('cityroute.bog_payment_create', 'off', true);

insert into public.payment_transactions (
  user_id, provider, payment_id, merchant_payment_id, amount, currency, status, metadata
)
values (
  '00000000-0000-0000-0000-000000000a09', 'tbc', 'm032-tbc-renewal',
  'm032-mer-tbc-renewal', 99, 'GEL', 'pending', '{}'::jsonb
);

create function pg_temp.as_device(p_uid text, p_session text, p_fingerprint text)
returns void
language sql
as $$
  select set_config(
           'request.jwt.claims',
           pg_catalog.format('{"sub":"%s","session_id":"%s","role":"authenticated"}', p_uid, p_session),
           true),
         set_config(
           'request.headers',
           pg_catalog.format('{"x-cityroute-device-fingerprint":"%s"}', p_fingerprint),
           true);
$$;

select ok((select prosecdef and pg_catalog.pg_get_function_identity_arguments(oid) = 'p_payment_id text, p_status text, p_transaction_id text, p_metadata jsonb' and exists (select 1 from unnest(proconfig) cfg where cfg = 'search_path=pg_catalog, public') from pg_catalog.pg_proc where oid = 'public.update_bog_payment_status(text,text,text,jsonb)'::regprocedure), 'BOG function keeps its signature, security definer, and search path');
select ok(not has_function_privilege('service_role', 'public.update_bog_payment_status(text,text,text,jsonb)', 'execute'), 'service_role cannot call the BOG status function directly');
select ok(not has_function_privilege('authenticated', 'public.update_bog_payment_status(text,text,text,jsonb)', 'execute'), 'authenticated cannot execute BOG updates');
select ok((select not prosecdef and exists (select 1 from unnest(proconfig) cfg where cfg = 'search_path=pg_catalog') from pg_catalog.pg_proc where oid = 'public.protect_trial_lifecycle()'::regprocedure), 'trial guard is not security definer and uses pg_catalog');
select ok(not exists (
  select 1
  from pg_catalog.pg_proc proc
  cross join lateral pg_catalog.aclexplode(coalesce(proc.proacl, pg_catalog.acldefault('f'::"char", proc.proowner))) acl
  where proc.oid = 'public.protect_trial_lifecycle()'::regprocedure
    and acl.grantee = 0
    and acl.privilege_type = 'EXECUTE'
), 'PUBLIC has no execute privilege on the trial guard');
select ok(position('cityroute.premium_activation' in pg_get_functiondef('public.update_payment_status(text,text,text,text,jsonb)'::regprocedure)) = 0, 'the existing TBC payment function is unchanged');
select is(
  public.bog_fixed_device_package_matches(1, 99, null),
  true,
  'legacy 99 GEL transactions are accepted only for one device'
);
select is(
  public.bog_fixed_device_package_matches(2, 179, null),
  true,
  'legacy 179 GEL transactions are accepted only for two devices'
);
select is(
  public.bog_fixed_device_package_matches(1, 99, '99'),
  true,
  'the 99 GEL package-price snapshot matches the active one-device package'
);
select is(
  public.bog_fixed_device_package_matches(2, 179, '179'),
  true,
  'the 179 GEL package-price snapshot matches the active two-device package'
);
select ok(
  not public.bog_fixed_device_package_matches(1, 179, null)
  and not public.bog_fixed_device_package_matches(2, 179, '99')
  and not public.bog_fixed_device_package_matches(3, 299, '299'),
  'amount, device-slot, and snapshot mismatches are rejected'
);

select is((select subscription_status from public.profiles where id = '00000000-0000-0000-0000-000000000a01'), 'trial', 'a new account starts on trial');
select ok((select subscription_expires_at between pg_catalog.now() + interval '11 hours' and pg_catalog.now() + interval '13 hours' from public.profiles where id = '00000000-0000-0000-0000-000000000a01'), 'trial expires about 12 hours after creation');
select ok(position('12 hours' in pg_get_functiondef('public.handle_new_user()'::regprocedure)) > 0, 'handle_new_user grants a 12 hour trial');
select ok(position('subscription_status = ''trial''' in pg_get_functiondef('public.has_active_access(uuid)'::regprocedure)) > 0 and position('subscription_expires_at >' in pg_get_functiondef('public.has_active_access(uuid)'::regprocedure)) > 0, 'trial access ends when the stored expiry passes');

select throws_ok($$update public.profiles set trial_started_at = pg_catalog.now() - interval '1 day' where id = '00000000-0000-0000-0000-000000000a01'$$, '42501', 'trial_started_at cannot be changed', 'trial start cannot be rewritten');
select set_config('cityroute.premium_activation', 'on', true);
select throws_ok($$update public.profiles set subscription_expires_at = pg_catalog.now() + interval '1 year' where id = '00000000-0000-0000-0000-000000000a01'$$, '42501', 'subscription expiry can change only during confirmed premium activation', 'the activation flag alone cannot extend a trial');
select throws_ok($$update public.profiles set subscription_status = 'cancelled' where id = '00000000-0000-0000-0000-000000000a01'$$, '42501', 'premium activation requires a confirmed BOG payment', 'trial cannot leave its status without confirmed activation');
select throws_ok($$insert into public.profiles (id, full_name, trial_started_at, subscription_status, subscription_expires_at, subscription_plan, device_slots) values ('00000000-0000-0000-0000-000000000a02', '', pg_catalog.now(), 'active', pg_catalog.now() + interval '30 days', 'premium', 2)$$, '42501', 'a profile can be created only as a trial', 'an active premium profile cannot be inserted directly');
select set_config('cityroute.premium_activation', 'off', true);
select throws_ok($$update public.profiles set subscription_status = 'active', subscription_plan = 'premium' where id = '00000000-0000-0000-0000-000000000a01'$$, '42501', 'premium activation requires a confirmed BOG payment', 'trial cannot be promoted by changing status and plan alone');
select set_config('cityroute.premium_activation', 'on', true);
select throws_ok($$update public.profiles set subscription_status = 'active', subscription_plan = 'premium' where id = '00000000-0000-0000-0000-000000000a01'$$, '42501', 'premium activation requires a confirmed BOG payment', 'the function owner cannot promote a trial without the activation update');
select set_config('cityroute.premium_activation', 'off', true);

alter table public.profiles disable row level security;
grant update on public.profiles to service_role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('cityroute.premium_activation', 'on', true);
select throws_ok($$update public.profiles set subscription_status = 'active', subscription_plan = 'premium', subscription_expires_at = pg_catalog.now() + interval '30 days' where id = '00000000-0000-0000-0000-000000000a01'$$, '42501', 'subscription expiry can change only during confirmed premium activation', 'service_role cannot bypass the trial guard by setting the flag');
select throws_ok($$update public.profiles set subscription_status = 'active', subscription_plan = 'premium' where id = '00000000-0000-0000-0000-000000000a01'$$, '42501', 'premium activation requires a confirmed BOG payment', 'service_role cannot promote a trial by setting the activation flag');
select set_config('cityroute.premium_activation', 'off', true);
reset role;

-- 033 blocks non-pending BOG inserts entirely; assert that and seed a pending forge row instead.
select throws_ok(
  $$insert into public.payment_transactions (
    user_id, provider, payment_id, merchant_payment_id, amount, currency, status, metadata, paid_at
  ) values (
    '00000000-0000-0000-0000-000000000a01', 'bog', 'm032-a01-forged-success', 'm032-mer-a01-forged-success',
    99, 'GEL', 'success', '{"provider":"bog","device_slots":1,"package_price":99}', pg_catalog.now()
  )$$,
  '42501',
  'BOG payment rows may be inserted only through the BOG checkout claim function',
  'direct insert of a forged BOG success row is rejected after confirmer isolation'
);
select set_config('cityroute.bog_payment_create', 'on', true);
insert into public.payment_transactions (
  user_id, provider, payment_id, merchant_payment_id, amount, currency, status, metadata, paid_at
) values (
  '00000000-0000-0000-0000-000000000a01', 'bog', 'm032-a01-forged', 'm032-mer-a01-forged',
  99, 'GEL', 'pending', '{"provider":"bog","device_slots":1,"package_price":99}', null
);
select set_config('cityroute.bog_payment_create', 'off', true);
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('cityroute.premium_activation', 'on', true);
select throws_ok($$update public.profiles set subscription_status = 'active', subscription_plan = 'premium', subscription_expires_at = pg_catalog.now() + interval '30 days', device_slots = 1, subscription_payment_id = 'm032-a01-forged' where id = '00000000-0000-0000-0000-000000000a01'$$, '42501', 'subscription expiry can change only during confirmed premium activation', 'service_role cannot activate premium by pointing the profile at a forged success row');
select throws_ok($$select public.update_bog_payment_status('m032-a01-forged', 'success', 'bank-forged', '{"bank_status":"completed","bank_amount":"99.00","bank_currency":"GEL","bank_external_order_id":"m032-mer-a01-forged"}')$$, '42501', 'permission denied for function update_bog_payment_status', 'service_role cannot submit a self-made receipt to the BOG status function');
select set_config('cityroute.premium_activation', 'off', true);
reset role;
set local role postgres;
select is((select subscription_status from public.profiles where id = '00000000-0000-0000-0000-000000000a01'), 'trial', 'a forged success row does not activate premium through the BOG function');
select set_config('cityroute.premium_activation', 'on', true);
select throws_ok($$update public.profiles set subscription_status = 'active', subscription_plan = 'premium', subscription_expires_at = pg_catalog.now() + interval '30 days', device_slots = 1, subscription_payment_id = 'm032-a01-99' where id = '00000000-0000-0000-0000-000000000a01'$$, '42501', 'subscription expiry can change only during confirmed premium activation', 'the function owner cannot activate premium from a payment that is not confirmed success');
select set_config('cityroute.premium_activation', 'off', true);

select set_config('cityroute.bog_payment_create', 'on', true);
insert into public.payment_transactions (
  user_id, provider, payment_id, merchant_payment_id, amount, currency, status, metadata, paid_at
) values (
  '00000000-0000-0000-0000-000000000a02', 'bog', 'm032-a02-fake', 'm032-mer-a02-fake',
  99, 'GEL', 'pending', '{"provider":"bog","device_slots":1,"package_price":99}', null
);
select set_config('cityroute.bog_payment_create', 'off', true);
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok($$select public.update_bog_payment_status('m032-a02-fake', 'success', 'bank-fake', '{"bank_status":"completed","bank_amount":"99.00","bank_currency":"GEL","bank_external_order_id":"m032-mer-a02-fake"}')$$, '42501', 'permission denied for function update_bog_payment_status', 'service_role cannot activate premium from a forged pending row and matching fake receipt');
select throws_ok($$update public.payment_transactions set status = 'success', paid_at = pg_catalog.now(), metadata = metadata || '{"bank_status":"completed","bank_amount":"99.00","bank_currency":"GEL","bank_external_order_id":"m032-mer-a02-fake"}'::jsonb where payment_id = 'm032-a02-fake'$$, '42501', 'BOG payment status can change only through the confirmer write path', 'service_role cannot settle a BOG payment by direct table update');
reset role;
set local role postgres;
select set_config('request.jwt.claims', '{"role":"cityroute_bog_confirmer"}', true);
select throws_ok($$select public.update_bog_payment_status('m032-a02-fake', 'success', 'bank-fake', '{"bank_status":"completed","bank_amount":"1.00","bank_currency":"GEL","bank_external_order_id":"m032-mer-a02-fake"}')$$, 'P0001', 'BOG receipt amount does not match the stored transaction', 'a receipt with a different amount is rejected');
select throws_ok($$select public.update_bog_payment_status('m032-a02-fake', 'success', 'bank-fake', '{"bank_status":"completed","bank_amount":"99.00","bank_currency":"USD","bank_external_order_id":"m032-mer-a02-fake"}')$$, 'P0001', 'Verified BOG receipt does not match the stored transaction', 'a receipt with a different currency is rejected');
select throws_ok($$select public.update_bog_payment_status('m032-a02-fake', 'success', 'bank-fake', '{"bank_status":"completed","bank_amount":"99.00","bank_currency":"GEL","bank_external_order_id":"another-order"}')$$, 'P0001', 'Verified BOG receipt does not match the stored transaction', 'a receipt for another merchant order is rejected');
select throws_ok($$select public.update_bog_payment_status('m032-a02-fake', 'success', 'bank-fake', '{"bank_status":"rejected","bank_amount":"99.00","bank_currency":"GEL","bank_external_order_id":"m032-mer-a02-fake"}')$$, 'P0001', 'Payment status does not match the verified BOG receipt', 'success cannot be claimed for a rejected receipt');
select throws_ok($$select public.update_bog_payment_status('m032-a02-fake', 'success', 'bank-fake', '{"bank_amount":"99.00","bank_currency":"GEL","bank_external_order_id":"m032-mer-a02-fake"}')$$, 'P0001', 'Verified BOG receipt does not match the stored transaction', 'a receipt without a bank status is rejected');
select is((select subscription_status from public.profiles where id = '00000000-0000-0000-0000-000000000a02'), 'trial', 'rejected receipts leave the account on trial');
select is((select status from public.payment_transactions where provider = 'bog' and payment_id = 'm032-a02-fake'), 'pending', 'rejected receipts leave the payment pending');

grant update (subscription_expires_at) on table public.profiles to authenticated;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a01","role":"authenticated"}', true);
select set_config('cityroute.premium_activation', 'on', true);
select throws_ok($$update public.profiles set subscription_expires_at = pg_catalog.now() + interval '30 days' where id = '00000000-0000-0000-0000-000000000a01'$$, '42501', 'subscription expiry can change only during confirmed premium activation', 'authenticated reaches the trial guard and cannot change expiry');
select set_config('cityroute.premium_activation', 'off', true);
reset role;
set local role postgres;

select pg_temp.as_device('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000c01', 'trial-device-a');
set local role authenticated;
select is(public.activate_current_session()->>'status', 'active', 'trial can open its one device session');
select is(public.has_active_access('00000000-0000-0000-0000-000000000a01'), true, 'an unexpired trial has premium access');
select is(public.select_subscription_plan('premium')->>'status', 'ok', 'trial can record a plan name');
select is((select subscription_status from public.profiles where id = '00000000-0000-0000-0000-000000000a01'), 'trial', 'recording a plan name does not leave trial');
reset role;
set local role postgres;

select set_config('request.jwt.claims', '{"role":"cityroute_bog_confirmer"}', true);
select is(public.update_bog_payment_status('m032-a01-99', 'success', 'bank-a01', '{"bank_status":"completed","bank_amount":"99.00","bank_currency":"GEL","bank_external_order_id":"m032-mer-a01-99"}')->>'status', 'success', 'verified 99 GEL receipt is accepted');
select is(public.update_bog_payment_status('m032-a02-99', 'failed', null, '{"bank_status":"rejected","bank_amount":"99.00","bank_currency":"GEL","bank_external_order_id":"m032-mer-a02-99"}')->>'status', 'failed', 'rejected BOG receipt is not success');
select is(public.update_bog_payment_status('m032-a03-99', 'success', 'bank-a03', '{"bank_status":"completed","bank_amount":"99.00","bank_currency":"GEL","bank_external_order_id":"m032-mer-a03-99"}')->>'status', 'success', '99 GEL account is activated');
select is(public.update_bog_payment_status('m032-a04-179', 'success', 'bank-a04', '{"bank_status":"completed","bank_amount":"179.00","bank_currency":"GEL","bank_external_order_id":"m032-mer-a04-179"}')->>'status', 'success', '179 GEL account is activated');
select is(public.update_bog_payment_status('m032-a05-179', 'success', 'bank-a05-179', '{"bank_status":"completed","bank_amount":"179.00","bank_currency":"GEL","bank_external_order_id":"m032-mer-a05-179"}')->>'status', 'success', 'downgrade account first receives 179');
select is(public.update_bog_payment_status('m032-a06-179a', 'success', 'bank-a06a', '{"bank_status":"completed","bank_amount":"179.00","bank_currency":"GEL","bank_external_order_id":"m032-mer-a06-179a"}')->>'status', 'success', 'renewal account receives its first 179');
select is(public.update_bog_payment_status('m032-a07-179', 'success', 'bank-a07-179', '{"bank_status":"completed","bank_amount":"179.00","bank_currency":"GEL","bank_external_order_id":"m032-mer-a07-179"}')->>'status', 'success', 'override account receives 179');
select is(public.update_bog_payment_status('m032-a08-179', 'success', 'bank-a08-179', '{"bank_status":"completed","bank_amount":"179.00","bank_currency":"GEL","bank_external_order_id":"m032-mer-a08-179"}')->>'status', 'success', 'failed-payment account receives 179');
reset role;
set local role postgres;

select is((select subscription_status from public.profiles where id = '00000000-0000-0000-0000-000000000a01'), 'active', 'confirmed BOG success activates premium');
select is((select subscription_plan from public.profiles where id = '00000000-0000-0000-0000-000000000a01'), 'premium', 'confirmed BOG success assigns premium');
select is((select device_slots from public.profiles where id = '00000000-0000-0000-0000-000000000a01'), 1, '99 GEL assigns one device slot');
select is((select trial_started_at::text from public.profiles where id = '00000000-0000-0000-0000-000000000a01'), current_setting('m032.a01_trial_start'), 'premium activation preserves trial start');
select ok((select subscription_expires_at > pg_catalog.now() + interval '20 days' from public.profiles where id = '00000000-0000-0000-0000-000000000a01'), 'confirmed activation sets a 30 day expiry');
select set_config('m032.a01_expiry', (select subscription_expires_at::text from public.profiles where id = '00000000-0000-0000-0000-000000000a01'), true);
select set_config('request.jwt.claims', '{"role":"cityroute_bog_confirmer"}', true);
select is(public.update_bog_payment_status('m032-a01-99', 'success', 'bank-a01-dup', '{"bank_status":"completed","bank_amount":"99.00","bank_currency":"GEL","bank_external_order_id":"m032-mer-a01-99"}')->>'duplicate_or_stale', 'true', 'a repeated success receipt is duplicate');
select is((select subscription_expires_at::text from public.profiles where id = '00000000-0000-0000-0000-000000000a01'), current_setting('m032.a01_expiry'), 'a duplicate receipt does not extend expiry');
select is(public.update_bog_payment_status('m032-a01-99', 'refunded', 'bank-a01-refund', '{"bank_status":"refunded","bank_amount":"99.00","bank_currency":"GEL","bank_external_order_id":"m032-mer-a01-99","bank_refund_amount":"99.00"}')->>'status', 'refunded', 'a confirmed refund is recorded');
reset role;
select is((select subscription_status from public.profiles where id = '00000000-0000-0000-0000-000000000a01'), 'active', 'a refund does not remove paid access');
select is((select subscription_expires_at::text from public.profiles where id = '00000000-0000-0000-0000-000000000a01'), current_setting('m032.a01_expiry'), 'a refund does not change expiry');
select lives_ok($$update public.profiles set subscription_plan = 'nav' where id = '00000000-0000-0000-0000-000000000a01'$$, 'an already paid profile can change only its plan label');
select throws_ok($$update public.profiles set subscription_plan = 'premium' where id = '00000000-0000-0000-0000-000000000a01'$$, '42501', 'premium activation requires a confirmed BOG payment', 'returning to premium from another plan requires a confirmed payment');
select set_config('cityroute.premium_activation', 'on', true);
set local role service_role;
select throws_ok($$update public.profiles set device_slots = 2 where id = '00000000-0000-0000-0000-000000000a01'$$, '42501', 'device slots and payment reference can change only during confirmed premium activation', 'service_role cannot change device slots by setting the flag');
reset role;
select throws_ok($$update public.profiles set subscription_payment_id = 'forged-payment' where id = '00000000-0000-0000-0000-000000000a01'$$, '42501', 'device slots and payment reference can change only during confirmed premium activation', 'a direct payment reference change is rejected');
select set_config('cityroute.premium_activation', 'off', true);
select is((select subscription_status from public.profiles where id = '00000000-0000-0000-0000-000000000a02'), 'trial', 'rejected BOG payment leaves the account on trial');
select is((select device_slots from public.profiles where id = '00000000-0000-0000-0000-000000000a02'), 1, 'rejected BOG payment does not change device slots');
select ok((select subscription_expires_at < pg_catalog.now() + interval '20 days' from public.profiles where id = '00000000-0000-0000-0000-000000000a02'), 'rejected BOG payment does not grant 30 days');
select throws_ok($$update public.profiles set subscription_status = 'trial' where id = '00000000-0000-0000-0000-000000000a01'$$, '42501', 'trial cannot be restarted', 'premium cannot be turned back into a trial');

select is(public.current_device_session_limit('00000000-0000-0000-0000-000000000a03'), 1, '99 GEL limits the account to one device');
select pg_temp.as_device('00000000-0000-0000-0000-000000000a03', '00000000-0000-0000-0000-000000000c11', 'device-99-a');
set local role authenticated;
select is(public.activate_current_session()->>'status', 'active', '99 GEL device A activates');
select pg_temp.as_device('00000000-0000-0000-0000-000000000a03', '00000000-0000-0000-0000-000000000c12', 'device-99-b');
select is(public.activate_current_session()->>'status', 'active', '99 GEL device B replaces device A');
reset role;
select is((select count(*)::integer from public.profile_revoked_sessions where profile_id = '00000000-0000-0000-0000-000000000a03' and session_id = '00000000-0000-0000-0000-000000000c11'), 1, '99 GEL revokes the replaced device');
select is((select count(*)::integer from public.profile_active_sessions where profile_id = '00000000-0000-0000-0000-000000000a03'), 1, '99 GEL keeps one active session');
select is((select session_id::text from public.profile_active_sessions where profile_id = '00000000-0000-0000-0000-000000000a03'), '00000000-0000-0000-0000-000000000c12', '99 GEL active session belongs to the newer device');

select set_config('request.jwt.claims', '{"role":"cityroute_bog_confirmer"}', true);
select is(public.update_bog_payment_status('m032-a03-179', 'success', 'bank-a03-179', '{"bank_status":"completed","bank_amount":"179.00","bank_currency":"GEL","bank_external_order_id":"m032-mer-a03-179"}')->>'status', 'success', '99 GEL account can later receive 179');
reset role;
select is((select device_slots from public.profiles where id = '00000000-0000-0000-0000-000000000a03'), 2, '179 GEL raises the slot count to two');
select is(public.current_device_session_limit('00000000-0000-0000-0000-000000000a03'), 2, '179 GEL raises the enforced limit to two');
select is((select count(*)::integer from public.profile_revoked_sessions where profile_id = '00000000-0000-0000-0000-000000000a03' and session_id = '00000000-0000-0000-0000-000000000c11'), 1, 'the session revoked by 99 GEL stays revoked');
select pg_temp.as_device('00000000-0000-0000-0000-000000000a03', '00000000-0000-0000-0000-000000000c11', 'device-99-a');
set local role authenticated;
select is(public.activate_current_session()->>'status', 'blocked', 'the revoked 99 GEL session cannot sign in again');
select pg_temp.as_device('00000000-0000-0000-0000-000000000a03', '00000000-0000-0000-0000-000000000c13', 'device-99-c');
select is(public.activate_current_session()->>'status', 'active', 'a new login can use the second 179 GEL slot');
reset role;
select is((select count(*)::integer from public.profile_active_sessions where profile_id = '00000000-0000-0000-0000-000000000a03'), 2, 'the surviving device and the new login are both active');
select is((select count(*)::integer from public.profile_active_sessions where profile_id = '00000000-0000-0000-0000-000000000a03' and session_id = '00000000-0000-0000-0000-000000000c12'), 1, 'the device that remained after 99 GEL stays signed in');
select is((select count(*)::integer from public.profile_active_sessions where profile_id = '00000000-0000-0000-0000-000000000a03' and session_id = '00000000-0000-0000-0000-000000000c13'), 1, 'the new 179 GEL login has its own active session');

select is(public.current_device_session_limit('00000000-0000-0000-0000-000000000a04'), 2, '179 GEL limits the account to two devices');
select pg_temp.as_device('00000000-0000-0000-0000-000000000a04', '00000000-0000-0000-0000-000000000c21', 'device-179-computer');
set local role authenticated;
select is(public.activate_current_session()->>'status', 'active', '179 GEL computer session activates');
select pg_temp.as_device('00000000-0000-0000-0000-000000000a04', '00000000-0000-0000-0000-000000000c22', 'device-179-phone');
select is(public.activate_current_session()->>'status', 'active', '179 GEL phone session activates independently');
reset role;
select is((select count(distinct session_id)::integer from public.profile_active_sessions where profile_id = '00000000-0000-0000-0000-000000000a04'), 2, 'each device has its own session id');
select ok((select (array_agg(session_id order by activated_at))[1] is distinct from (array_agg(session_id order by activated_at))[2] from public.profile_active_sessions where profile_id = '00000000-0000-0000-0000-000000000a04'), 'the two device session ids are different');
select ok((select (array_agg(device_fingerprint order by activated_at))[1] is distinct from (array_agg(device_fingerprint order by activated_at))[2] from public.profile_active_sessions where profile_id = '00000000-0000-0000-0000-000000000a04'), 'each session keeps its own device identifier');
select pg_temp.as_device('00000000-0000-0000-0000-000000000a04', '00000000-0000-0000-0000-000000000c21', 'device-179-computer');
set local role authenticated;
select is(public.activate_current_session()->>'status', 'active', 'refreshing the computer session stays active');
select pg_temp.as_device('00000000-0000-0000-0000-000000000a04', '00000000-0000-0000-0000-000000000c22', 'device-179-phone');
select is(public.has_current_active_session(), true, 'computer refresh does not revoke the phone');
select pg_temp.as_device('00000000-0000-0000-0000-000000000a04', '00000000-0000-0000-0000-000000000c23', 'device-179-tablet');
select is(public.activate_current_session()->>'status', 'blocked', '179 GEL blocks a third device');
select pg_temp.as_device('00000000-0000-0000-0000-000000000a04', '00000000-0000-0000-0000-000000000c21', 'device-179-computer');
select is(public.has_current_active_session(), true, 'the third device does not revoke the computer');
select pg_temp.as_device('00000000-0000-0000-0000-000000000a04', '00000000-0000-0000-0000-000000000c22', 'device-179-phone');
select is(public.has_current_active_session(), true, 'the third device does not revoke the phone');
reset role;
select is((select count(*)::integer from public.profile_revoked_sessions where profile_id = '00000000-0000-0000-0000-000000000a04' and session_id = '00000000-0000-0000-0000-000000000c21'), 0, 'computer session is not revoked by the third device');
select is((select count(*)::integer from public.profile_revoked_sessions where profile_id = '00000000-0000-0000-0000-000000000a04' and session_id = '00000000-0000-0000-0000-000000000c22'), 0, 'phone session is not revoked by the third device');
select pg_temp.as_device('00000000-0000-0000-0000-000000000a04', '00000000-0000-0000-0000-000000000c21', 'device-179-computer');
set local role authenticated;
select is(public.deactivate_current_session()->>'status', 'deactivated', 'computer logout revokes only the computer');
select pg_temp.as_device('00000000-0000-0000-0000-000000000a04', '00000000-0000-0000-0000-000000000c22', 'device-179-phone');
select is(public.has_current_active_session(), true, 'computer logout leaves the phone signed in');
reset role;
select is((select count(*)::integer from public.profile_revoked_sessions where profile_id = '00000000-0000-0000-0000-000000000a04' and session_id = '00000000-0000-0000-0000-000000000c21'), 1, 'logout records only the computer session as revoked');
select is((select count(*)::integer from public.profile_active_sessions where profile_id = '00000000-0000-0000-0000-000000000a04'), 1, 'phone session remains the only active session');

insert into public.profile_active_sessions (
  profile_id, session_id, session_created_at, activated_at, updated_at,
  device_fingerprint, last_activity_at, last_seen_at
)
values
  ('00000000-0000-0000-0000-000000000a05', '00000000-0000-0000-0000-000000000d01', pg_catalog.now() - interval '3 hours', pg_catalog.now() - interval '3 hours', pg_catalog.now(), 'down-device-first', pg_catalog.now() - interval '2 hours', pg_catalog.now() - interval '2 hours'),
  ('00000000-0000-0000-0000-000000000a05', '00000000-0000-0000-0000-000000000d02', pg_catalog.now() - interval '2 hours', pg_catalog.now() - interval '2 hours', pg_catalog.now(), 'down-device-second', pg_catalog.now() - interval '2 hours', pg_catalog.now() - interval '2 hours'),
  ('00000000-0000-0000-0000-000000000a06', '00000000-0000-0000-0000-000000000d11', pg_catalog.now() - interval '3 hours', pg_catalog.now() - interval '3 hours', pg_catalog.now(), 'renew-device-first', pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000a06', '00000000-0000-0000-0000-000000000d12', pg_catalog.now() - interval '2 hours', pg_catalog.now() - interval '2 hours', pg_catalog.now(), 'renew-device-second', pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000a07', '00000000-0000-0000-0000-000000000d21', pg_catalog.now() - interval '3 hours', pg_catalog.now() - interval '3 hours', pg_catalog.now(), 'over-device-first', pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000a07', '00000000-0000-0000-0000-000000000d22', pg_catalog.now() - interval '2 hours', pg_catalog.now() - interval '2 hours', pg_catalog.now(), 'over-device-second', pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000a08', '00000000-0000-0000-0000-000000000d31', pg_catalog.now() - interval '3 hours', pg_catalog.now() - interval '3 hours', pg_catalog.now(), 'fail-device-first', pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000a08', '00000000-0000-0000-0000-000000000d32', pg_catalog.now() - interval '2 hours', pg_catalog.now() - interval '2 hours', pg_catalog.now(), 'fail-device-second', pg_catalog.now(), pg_catalog.now());

insert into public.device_session_limit_overrides (profile_id, session_limit, granted_by, grant_reason)
values ('00000000-0000-0000-0000-000000000a07', 2, '00000000-0000-0000-0000-000000000a07', 'support keeps two devices');

select set_config('request.jwt.claims', '{"role":"cityroute_bog_confirmer"}', true);
select is(public.update_bog_payment_status('m032-a05-99', 'success', 'bank-a05-99', '{"bank_status":"completed","bank_amount":"99.00","bank_currency":"GEL","bank_external_order_id":"m032-mer-a05-99"}')->>'status', 'success', 'downgrade receipt is accepted');
select is(public.update_bog_payment_status('m032-a06-179b', 'success', 'bank-a06b', '{"bank_status":"completed","bank_amount":"179.00","bank_currency":"GEL","bank_external_order_id":"m032-mer-a06-179b"}')->>'status', 'success', '179 renewal receipt is accepted');
select is(public.update_bog_payment_status('m032-a07-99', 'success', 'bank-a07-99', '{"bank_status":"completed","bank_amount":"99.00","bank_currency":"GEL","bank_external_order_id":"m032-mer-a07-99"}')->>'status', 'success', 'purchase under an override is accepted');
select is(public.update_bog_payment_status('m032-a08-99', 'failed', null, '{"bank_status":"rejected","bank_amount":"99.00","bank_currency":"GEL","bank_external_order_id":"m032-mer-a08-99"}')->>'status', 'failed', 'rejected downgrade does not succeed');
reset role;

select is((select device_slots from public.profiles where id = '00000000-0000-0000-0000-000000000a05'), 1, 'downgrade writes one device slot immediately');
select is(public.current_device_session_limit('00000000-0000-0000-0000-000000000a05'), 1, 'downgrade limit is one in the same transaction');
select is((select session_id::text from public.profile_active_sessions where profile_id = '00000000-0000-0000-0000-000000000a05'), '00000000-0000-0000-0000-000000000d01', 'downgrade keeps the earlier device');
select is((select count(*)::integer from public.profile_active_sessions where profile_id = '00000000-0000-0000-0000-000000000a05' and session_id = '00000000-0000-0000-0000-000000000d02'), 0, 'downgrade removes the later device from active sessions');
select is((select count(*)::integer from public.profile_revoked_sessions where profile_id = '00000000-0000-0000-0000-000000000a05' and session_id = '00000000-0000-0000-0000-000000000d02'), 1, 'downgrade records the later device as revoked');
select is((select count(*)::integer from public.profile_revoked_sessions where profile_id = '00000000-0000-0000-0000-000000000a05' and session_id = '00000000-0000-0000-0000-000000000d01'), 0, 'downgrade does not revoke the earlier device');
select is((select trial_started_at::text from public.profiles where id = '00000000-0000-0000-0000-000000000a05'), current_setting('m032.a05_trial_start'), 'downgrade preserves trial start');
select is((select count(*)::integer from public.profile_active_sessions where profile_id = '00000000-0000-0000-0000-000000000a06'), 2, '179 renewal keeps both device sessions');
select is((select count(*)::integer from public.profile_revoked_sessions where profile_id = '00000000-0000-0000-0000-000000000a06'), 0, '179 renewal revokes neither device');
select is((select count(*)::integer from public.profile_active_sessions where profile_id = '00000000-0000-0000-0000-000000000a07'), 2, 'an active override keeps both sessions after a 99 purchase');
select is(public.current_device_session_limit('00000000-0000-0000-0000-000000000a07'), 2, 'an active override stays ahead of the purchased slot count');
select is((select count(*)::integer from public.profile_active_sessions where profile_id = '00000000-0000-0000-0000-000000000a08'), 2, 'a rejected payment removes neither session');
select is((select device_slots from public.profiles where id = '00000000-0000-0000-0000-000000000a08'), 2, 'a rejected payment does not reduce the slot count');
select lives_ok(
  $$select public.update_payment_status(
      'tbc', 'm032-tbc-renewal', 'success', 'm032-tbc-renewal-tx', '{}'::jsonb
    )$$,
  'the existing TBC success path can renew an active Premium profile'
);
select is(
  (select subscription_status from public.profiles
   where id = '00000000-0000-0000-0000-000000000a09'),
  'active',
  'TBC renewal preserves active subscription status'
);
select ok(
  (select subscription_expires_at between pg_catalog.now() + interval '29 days'
                                      and pg_catalog.now() + interval '31 days'
   from public.profiles
   where id = '00000000-0000-0000-0000-000000000a09'),
  'TBC renewal updates the expiry through the existing payment function'
);

select * from finish();
rollback;
