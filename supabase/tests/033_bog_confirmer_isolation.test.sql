-- supabase/tests/033_bog_confirmer_isolation.test.sql
begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(77);
select set_config('cityroute.bog_payment_create', 'on', true);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm033-confirm@example.test', '', pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000b02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm033-forge@example.test', '', pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000b03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm033-tbc@example.test', '', pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now())
on conflict (id) do nothing;

insert into public.profiles (
  id, full_name, trial_started_at, subscription_status, subscription_expires_at, subscription_plan
)
select u.id, '', pg_catalog.now(), 'trial', pg_catalog.now() + interval '12 hours', null
from auth.users u
where u.id in (
  '00000000-0000-0000-0000-000000000b01',
  '00000000-0000-0000-0000-000000000b02',
  '00000000-0000-0000-0000-000000000b03'
)
and not exists (select 1 from public.profiles p where p.id = u.id);

insert into public.payment_transactions (
  user_id, provider, payment_id, merchant_payment_id, amount, currency, status, metadata
)
values
  ('00000000-0000-0000-0000-000000000b01', 'bog', 'm033-b01-99', 'm033-mer-b01-99', 99, 'GEL', 'pending', '{"provider":"bog","device_slots":1,"package_price":99}'),
  ('00000000-0000-0000-0000-000000000b02', 'bog', 'm033-b02-forged', 'm033-mer-b02-forged', 99, 'GEL', 'pending', '{"provider":"bog","device_slots":1,"package_price":99,"checkout_phase":"claimed"}'),
  ('00000000-0000-0000-0000-000000000b02', 'bog', 'm033-b02-claim', 'm033-mer-b02-claim', 99, 'GEL', 'pending', '{"provider":"bog","device_slots":1,"package_price":99,"checkout_phase":"bank_call","bank_call_started_at":"2026-01-01T00:00:00.000Z"}'),
  ('00000000-0000-0000-0000-000000000b03', 'tbc', 'm033-tbc-pending', 'm033-tbc-mer', 99, 'GEL', 'pending', '{"provider":"tbc"}');

insert into public.payment_transactions (
  user_id, provider, payment_id, merchant_payment_id, amount, currency, status, metadata
)
values (
  '00000000-0000-0000-0000-000000000b02', 'bog', 'm033-b02-expired-claim',
  'm033-mer-b02-expired-claim', 99, 'GEL', 'pending',
  pg_catalog.jsonb_build_object(
    'provider', 'bog',
    'device_slots', 1,
    'package_price', 99,
    'checkout_phase', 'claimed',
    'claim_expires_at', (pg_catalog.statement_timestamp() - interval '1 second')::text
  )
);
select set_config('cityroute.bog_payment_create', 'off', true);

select ok(
  exists (select 1 from pg_catalog.pg_roles where rolname = 'cityroute_bog_confirmer'),
  'cityroute_bog_confirmer role exists'
);
select ok(
  not has_function_privilege('service_role', 'public.update_bog_payment_status(text,text,text,jsonb)', 'execute'),
  'service_role has no EXECUTE on update_bog_payment_status'
);
select ok(
  has_function_privilege('cityroute_bog_confirmer', 'public.update_bog_payment_status(text,text,text,jsonb)', 'execute'),
  'cityroute_bog_confirmer can execute update_bog_payment_status'
);
select ok(
  not has_table_privilege('service_role', 'public.payment_transactions', 'insert'),
  'service_role cannot insert BOG payment rows directly'
);
select ok(
  not has_function_privilege('service_role', 'public.create_bog_pending_payment(uuid,text,text,uuid,numeric,integer,jsonb)', 'execute'),
  'service_role cannot call the BOG pending-payment creator'
);
select ok(
  has_function_privilege('authenticated', 'public.create_bog_pending_payment(uuid,text,text,uuid,numeric,integer,jsonb)', 'execute'),
  'authenticated users can create only their own pending BOG payments'
);
select ok(
  not has_function_privilege('cityroute_bog_confirmer', 'public.create_bog_pending_payment(uuid,text,text,uuid,numeric,integer,jsonb)', 'execute'),
  'settlement confirmer cannot create pending BOG payments'
);
select ok(
  not has_function_privilege('anon', 'public.create_bog_pending_payment(uuid,text,text,uuid,numeric,integer,jsonb)', 'execute'),
  'unauthenticated users cannot create pending BOG payments'
);
select ok(
  not pg_catalog.pg_has_role('service_role', 'cityroute_bog_confirmer', 'MEMBER'),
  'service_role cannot SET ROLE to cityroute_bog_confirmer'
);
select ok(
  position('BOG payment_id can change only during checkout bank_call to ready handoff'
    in pg_get_functiondef('public.protect_bog_payment_settlement()'::regprocedure)) > 0,
  'settlement trigger restricts payment_id handoff'
);
select ok(
  position('pg_get_userbyid(p.proowner) = current_user'
    in pg_get_functiondef('public.protect_bog_payment_settlement()'::regprocedure)) > 0,
  'settlement trigger requires the BOG function owner, not GUC alone'
);
select ok(
  position('v_checkout_insert_owner' in pg_get_functiondef('public.protect_bog_payment_settlement()'::regprocedure)) > 0
    and position('cityroute.bog_payment_create' in pg_get_functiondef('public.protect_bog_payment_settlement()'::regprocedure)) > 0,
  'BOG inserts require both the checkout function owner and its transaction-local GUC'
);
select ok(
  position('cityroute.premium_activation'
    in pg_get_functiondef('public.update_payment_status(text,text,text,text,jsonb)'::regprocedure)) = 0,
  'TBC update_payment_status remains unchanged'
);

alter table public.profiles disable row level security;
grant update on public.profiles to service_role;
grant update on public.payment_transactions to service_role;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- 1) GUC alone
select throws_ok(
  $$insert into public.payment_transactions (
      user_id, provider, payment_id, merchant_payment_id, idempotency_key,
      amount, currency, status, metadata
    ) values (
      '00000000-0000-0000-0000-000000000b02', 'bog', 'unissued:forged-direct',
      'cr-forged-direct', '00000000-0000-0000-0000-000000000001', 99, 'GEL', 'pending',
      '{"provider":"bog","device_slots":1,"package_price":99,"checkout_phase":"claimed"}'
    )$$,
  '42501',
  'permission denied for table payment_transactions',
  'service_role cannot create a fake pending BOG transaction directly'
);

select throws_ok(
  $throws$do $guc$
    begin
      perform set_config('cityroute.bog_payment_write', 'on', true);
      update public.payment_transactions
         set status = 'success', paid_at = pg_catalog.now()
       where payment_id = 'm033-b02-forged';
    end
  $guc$$throws$,
  '42501',
  'BOG payment status can change only through the confirmer write path',
  'service_role cannot settle by setting cityroute.bog_payment_write alone'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000b01"}', true);
select lives_ok(
  $$select public.create_bog_pending_payment(
      '00000000-0000-0000-0000-000000000b01',
      'unissued:00000000-0000-0000-0000-000000000002',
      'cr-00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000002',
      99,
      1,
      pg_catalog.jsonb_build_object(
        'provider', 'bog',
        'device_slots', 1,
        'package_price', 99,
        'checkout_phase', 'claimed',
        'claim_expires_at', (pg_catalog.statement_timestamp() + interval '30 seconds')::text,
        'client_request_ids', pg_catalog.jsonb_build_array('m033-client-claim')
      )
    )$$,
  'authenticated user can create their own 99 GEL one-device checkout'
);
select throws_ok(
  $$select public.create_bog_pending_payment(
      '00000000-0000-0000-0000-000000000b02',
      'unissued:00000000-0000-0000-0000-000000000005',
      'cr-00000000-0000-0000-0000-000000000005',
      '00000000-0000-0000-0000-000000000005',
      99,
      1,
      pg_catalog.jsonb_build_object(
        'provider', 'bog',
        'device_slots', 1,
        'package_price', 99,
        'checkout_phase', 'claimed',
        'claim_expires_at', (pg_catalog.statement_timestamp() + interval '30 seconds')::text,
        'client_request_ids', pg_catalog.jsonb_build_array('m033-client-claim')
      )
    )$$,
  '42501',
  'Authenticated checkout user does not match pending BOG payment owner',
  'authenticated user A cannot create a pending payment for user B'
);
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(
  $$select public.create_bog_pending_payment(
      '00000000-0000-0000-0000-000000000b02',
      'unissued:00000000-0000-0000-0000-000000000007',
      'cr-00000000-0000-0000-0000-000000000007',
      '00000000-0000-0000-0000-000000000007',
      99,
      1,
      '{}'::jsonb
    )$$,
  '42501',
  'permission denied for function create_bog_pending_payment',
  'unauthenticated caller cannot create a pending payment for another user'
);
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000b01"}', true);
select lives_ok(
  $$select public.create_bog_pending_payment(
      '00000000-0000-0000-0000-000000000b01',
      'unissued:00000000-0000-0000-0000-000000000006',
      'cr-00000000-0000-0000-0000-000000000006',
      '00000000-0000-0000-0000-000000000006',
      179,
      2,
      pg_catalog.jsonb_build_object(
        'provider', 'bog',
        'device_slots', 2,
        'package_price', 179,
        'checkout_phase', 'claimed',
        'claim_expires_at', (pg_catalog.statement_timestamp() + interval '30 seconds')::text,
        'client_request_ids', pg_catalog.jsonb_build_array('m033-client-claim-2')
      )
    )$$,
  'authenticated user can create their own 179 GEL two-device checkout'
);
select throws_ok(
  $$select public.create_bog_pending_payment(
      '00000000-0000-0000-0000-000000000b01',
      'unissued:00000000-0000-0000-0000-000000000003',
      'cr-00000000-0000-0000-0000-000000000003',
      '00000000-0000-0000-0000-000000000003',
      99,
      1,
      pg_catalog.jsonb_build_object(
        'provider', 'bog',
        'device_slots', 1,
        'package_price', 99,
        'checkout_phase', 'claimed',
        'claim_expires_at', (pg_catalog.statement_timestamp() + interval '30 seconds')::text,
        'client_request_ids', pg_catalog.jsonb_build_array('m033-client-claim'),
        'admin_note', 'unexpected'
      )
    )$$,
  '22023',
  'Pending BOG payment contains unsupported checkout metadata',
  'guarded checkout creation rejects unrecognized metadata keys'
);
select throws_ok(
  $$select public.create_bog_pending_payment(
      '00000000-0000-0000-0000-000000000b01',
      'unissued:00000000-0000-0000-0000-000000000004',
      'cr-00000000-0000-0000-0000-000000000004',
      '00000000-0000-0000-0000-000000000004',
      179,
      1,
      pg_catalog.jsonb_build_object(
        'provider', 'bog',
        'device_slots', 1,
        'package_price', 179,
        'checkout_phase', 'claimed',
        'claim_expires_at', (pg_catalog.statement_timestamp() + interval '30 seconds')::text,
        'client_request_ids', pg_catalog.jsonb_build_array('m033-client-claim')
      )
    )$$,
  '22023',
  'Pending BOG payment does not match an active package',
  'guarded checkout creation rejects an amount that differs from the active package catalog'
);
reset role;
set local role postgres;
select is(
  (select status from public.payment_transactions where payment_id = 'unissued:00000000-0000-0000-0000-000000000002'),
  'pending',
  'guarded checkout creation stores a pending transaction'
);
select is(
  (select user_id::text from public.payment_transactions where payment_id = 'unissued:00000000-0000-0000-0000-000000000002'),
  '00000000-0000-0000-0000-000000000b01',
  'guarded checkout creation stores the requested account owner'
);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select lives_ok(
  $$update public.payment_transactions
      set metadata = metadata || pg_catalog.jsonb_build_object(
        'claim_expires_at',
        (pg_catalog.statement_timestamp() + interval '30 seconds')::text
      )
    where payment_id = 'm033-b02-expired-claim'$$,
  'service_role may renew an expired pending claim for at most one minute'
);

-- 2) forged confirmer claims + GUC
select throws_ok(
  $throws$do $forge$
    begin
      perform set_config('request.jwt.claims', '{"role":"cityroute_bog_confirmer"}', true);
      perform set_config('cityroute.bog_payment_write', 'on', true);
      update public.payment_transactions
         set status = 'success', paid_at = pg_catalog.now()
       where payment_id = 'm033-b02-forged';
    end
  $forge$$throws$,
  '42501',
  'BOG payment status can change only through the confirmer write path',
  'service_role cannot settle by forging confirmer JWT claims plus GUC'
);

-- 3) pending identity fields
select throws_ok(
  $$update public.payment_transactions set user_id = '00000000-0000-0000-0000-000000000b01' where payment_id = 'm033-b02-forged'$$,
  '42501', 'BOG payment identity fields are immutable outside the confirmer write path',
  'service_role cannot retarget a pending BOG payment to another user'
);
select throws_ok(
  $$update public.payment_transactions set amount = 1 where payment_id = 'm033-b02-forged'$$,
  '42501', 'BOG payment identity fields are immutable outside the confirmer write path',
  'service_role cannot change a pending BOG amount'
);
select throws_ok(
  $$update public.payment_transactions set currency = 'USD' where payment_id = 'm033-b02-forged'$$,
  '42501', 'BOG payment identity fields are immutable outside the confirmer write path',
  'service_role cannot change a pending BOG currency'
);
select throws_ok(
  $$update public.payment_transactions set merchant_payment_id = 'm033-mer-hijacked' where payment_id = 'm033-b02-forged'$$,
  '42501', 'BOG payment identity fields are immutable outside the confirmer write path',
  'service_role cannot change a pending BOG merchant_payment_id'
);
select throws_ok(
  $$update public.payment_transactions set metadata = metadata || '{"device_slots":2,"package_price":179}'::jsonb where payment_id = 'm033-b02-forged'$$,
  '42501', 'BOG payment identity fields are immutable outside the confirmer write path',
  'service_role cannot upgrade pending package metadata'
);

-- 4) pending payment_id change outside handoff
select throws_ok(
  $$update public.payment_transactions set payment_id = 'bog-hijacked-order' where payment_id = 'm033-b02-forged'$$,
  '42501',
  'BOG payment_id can change only during checkout bank_call to ready handoff',
  'service_role cannot arbitrarily rewrite a pending payment_id'
);

-- 5) disallowed checkout metadata
select throws_ok(
  $$update public.payment_transactions
      set metadata = metadata || '{"verified_at":"2026-01-01T00:00:00.000Z"}'::jsonb
    where payment_id = 'm033-b02-forged'$$,
  '42501',
  'BOG checkout metadata key verified_at cannot change outside the confirmer write path',
  'service_role cannot inject non-checkout metadata keys'
);
select throws_ok(
  $$update public.payment_transactions
      set metadata = metadata || pg_catalog.jsonb_build_object(
        'checkout_phase', 'bank_call',
        'bank_call_started_at', '2099-01-01T00:00:00.000Z'
      )
    where payment_id = 'm033-b02-forged'$$,
  '42501',
  'BOG bank call timestamp may be set only when a pending claim enters bank_call',
  'service_role cannot defer bank-call timeout using a future timestamp'
);

-- 6) direct settlement UPDATE
select throws_ok(
  $$update public.payment_transactions
      set status = 'success', paid_at = pg_catalog.now()
    where payment_id = 'm033-b02-forged'$$,
  '42501',
  'BOG payment status can change only through the confirmer write path',
  'service_role cannot settle BOG payments by direct UPDATE'
);

-- 7) forged bank receipt metadata (rejected by metadata key allowlist)
select throws_ok(
  $$update public.payment_transactions
      set metadata = metadata || '{"bank_status":"completed","bank_amount":"99.00","bank_currency":"GEL","bank_external_order_id":"m033-mer-b02-forged"}'::jsonb
    where payment_id = 'm033-b02-forged'$$,
  '42501',
  'BOG checkout metadata key bank_status cannot change outside the confirmer write path',
  'service_role cannot forge bank receipt metadata on a pending row'
);

-- claim/bank payment ids cannot be planted outside the handoff
select throws_ok(
  $$update public.payment_transactions
      set metadata = metadata || '{"claim_payment_id":"m033-b02-forged","bank_payment_id":"bog-planted"}'::jsonb
    where payment_id = 'm033-b02-forged'$$,
  '42501',
  'BOG checkout handoff metadata can change only during the bank_call to ready handoff',
  'service_role cannot plant claim/bank payment ids outside handoff'
);

-- claimed cannot skip directly to ready
select throws_ok(
  $$update public.payment_transactions
      set metadata = metadata || '{"checkout_phase":"ready"}'::jsonb
    where payment_id = 'm033-b02-forged'$$,
  '42501',
  'BOG checkout handoff metadata can change only during the bank_call to ready handoff',
  'service_role cannot skip claimed checkout_phase directly to ready'
);

-- 8) wrong JWT role / direct RPC
select throws_ok(
  $$select public.update_bog_payment_status(
    'm033-b02-forged', 'success', 'bank-forged',
    '{"bank_status":"completed","bank_amount":"99.00","bank_currency":"GEL","bank_external_order_id":"m033-mer-b02-forged"}'
  )$$,
  '42501',
  'permission denied for function update_bog_payment_status',
  'service_role cannot activate Premium with a forged pending row and matching fake receipt'
);

-- 11/12) alternate Premium paths
select throws_ok(
  $$update public.profiles
      set subscription_status = 'active',
          subscription_plan = 'premium',
          subscription_expires_at = pg_catalog.now() + interval '30 days',
          device_slots = 1,
          subscription_payment_id = 'm033-b02-forged'
    where id = '00000000-0000-0000-0000-000000000b02'$$,
  '42501',
  'subscription expiry can change only during confirmed premium activation',
  'service_role cannot promote Premium by writing profiles directly'
);
-- TBC remains an intentional Premium path (032/034); BOG isolation must not break it.
select lives_ok(
  $$select public.update_payment_status(
    'tbc', 'm033-tbc-pending', 'success', 'tbc-bank', '{"provider":"tbc"}'::jsonb
  )$$,
  'TBC update_payment_status remains a valid Premium activation path'
);

-- Allowed checkout metadata + payment_id handoff still work for service_role.
select lives_ok(
  $$update public.payment_transactions
      set metadata = metadata || pg_catalog.jsonb_build_object(
        'checkout_phase', 'bank_call',
        'bank_call_started_at', pg_catalog.statement_timestamp()::text
      )
    where payment_id = 'm033-b02-forged'$$,
  'service_role may advance checkout_phase claimed to bank_call'
);
select lives_ok(
  $$update public.payment_transactions
      set payment_id = 'bog-real-order-b02',
          metadata = metadata
            || '{"checkout_phase":"ready","checkout_url":"https://payment.bog.ge/x","claim_payment_id":"m033-b02-claim","bank_payment_id":"bog-real-order-b02"}'::jsonb
    where payment_id = 'm033-b02-claim'$$,
  'service_role may complete checkout payment_id handoff bank_call to ready'
);

-- completed handoff cannot be replayed or retargeted
select throws_ok(
  $$update public.payment_transactions
      set payment_id = 'bog-second-order',
          metadata = metadata
            || '{"checkout_phase":"ready","claim_payment_id":"m033-b02-claim","bank_payment_id":"bog-second-order"}'::jsonb
    where payment_id = 'bog-real-order-b02'$$,
  '42501',
  'BOG payment_id can change only during checkout bank_call to ready handoff',
  'service_role cannot repeat payment_id handoff after ready'
);
select throws_ok(
  $$update public.payment_transactions
      set metadata = metadata || '{"checkout_phase":"bank_call"}'::jsonb
    where payment_id = 'bog-real-order-b02'$$,
  '42501',
  'BOG checkout handoff fields are immutable after ready',
  'service_role cannot reopen a completed checkout handoff'
);
select throws_ok(
  $$update public.payment_transactions
      set metadata = metadata || '{"claim_payment_id":"someone-else","bank_payment_id":"bog-real-order-b02"}'::jsonb
    where payment_id = 'bog-real-order-b02'$$,
  '42501',
  'BOG checkout handoff fields are immutable after ready',
  'service_role cannot rewrite claim_payment_id after handoff'
);
select throws_ok(
  $$update public.payment_transactions
      set metadata = metadata || '{"claim_expires_at":"2099-01-01T00:00:00.000Z"}'::jsonb
    where payment_id = 'bog-real-order-b02'$$,
  '42501',
  'BOG claim expiry may be renewed only for an expired pending claim',
  'service_role cannot extend a claim expiry after the checkout handoff'
);
select throws_ok(
  $$update public.payment_transactions
      set metadata = metadata || '{"bank_call_started_at":"2099-01-01T00:00:00.000Z"}'::jsonb
    where payment_id = 'bog-real-order-b02'$$,
  '42501',
  'BOG bank call timestamp may be set only when a pending claim enters bank_call',
  'service_role cannot change bank-call timeout metadata after handoff'
);
select lives_ok(
  $$update public.payment_transactions
      set metadata = pg_catalog.jsonb_set(
        metadata,
        '{client_request_ids}',
        coalesce(metadata->'client_request_ids', '[]'::jsonb) || '["m033-retry"]'::jsonb
      )
    where payment_id = 'bog-real-order-b02'$$,
  'service_role may append a retry request ID while the ready payment remains pending'
);
select throws_ok(
  $$update public.payment_transactions
      set metadata = pg_catalog.jsonb_set(metadata, '{client_request_ids}', '["rewritten"]'::jsonb)
    where payment_id = 'bog-real-order-b02'$$,
  '42501',
  'BOG client request IDs are append-only',
  'service_role cannot rewrite existing client request IDs'
);

reset role;
set local role postgres;

select is(
  (select subscription_status from public.profiles where id = '00000000-0000-0000-0000-000000000b02'),
  'trial',
  'forged service_role attempts leave the account on trial'
);
select is(
  (select status from public.payment_transactions where payment_id = 'm033-b02-forged'),
  'pending',
  'forged settlement attempts leave the payment pending'
);
select is(
  (select payment_id from public.payment_transactions where merchant_payment_id = 'm033-mer-b02-claim'),
  'bog-real-order-b02',
  'allowed checkout handoff rewrites payment_id to the bank order id'
);
select is(
  (select subscription_status from public.profiles where id = '00000000-0000-0000-0000-000000000b03'),
  'active',
  'TBC update_payment_status still activates Premium after BOG confirmer isolation'
);

-- 8 continued: wrong JWT role even as function owner
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok(
  $$select public.update_bog_payment_status(
    'm033-b02-forged', 'success', 'bank-wrong-role',
    '{"bank_status":"completed","bank_amount":"99.00","bank_currency":"GEL","bank_external_order_id":"m033-mer-b02-forged"}'
  )$$,
  '42501',
  'Only the BOG confirmer role can update BOG payment status',
  'wrong JWT role claim cannot confirm a BOG payment'
);

-- 9) confirmer success
select set_config('request.jwt.claims', '{"role":"cityroute_bog_confirmer"}', true);
select is(
  public.update_bog_payment_status(
    'm033-b01-99', 'processing', 'bank-b01-processing',
    '{"bank_status":"processing","bank_amount":"99.00","bank_currency":"GEL","bank_external_order_id":"m033-mer-b01-99"}'
  )->>'status',
  'processing',
  'confirmer can transition pending payment to processing'
);
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok(
  $$update public.payment_transactions
      set status = 'pending'
    where payment_id = 'm033-b01-99'$$,
  '42501',
  'BOG payment status can change only through the confirmer write path',
  'service_role cannot regress processing payment to pending'
);
select throws_ok(
  $throws$do $regression_guc$
    begin
      perform set_config('cityroute.bog_payment_write', 'on', true);
      update public.payment_transactions
         set status = 'pending'
       where payment_id = 'm033-b01-99';
    end
  $regression_guc$$throws$,
  '42501',
  'BOG payment status can change only through the confirmer write path',
  'service_role plus settlement GUC cannot regress processing payment to pending'
);
reset role;
set local role postgres;
select set_config('request.jwt.claims', '{"role":"cityroute_bog_confirmer"}', true);
select is(
  public.update_bog_payment_status(
    'm033-b01-99', 'success', 'bank-b01',
    '{"bank_status":"completed","bank_amount":"99.00","bank_currency":"GEL","bank_external_order_id":"m033-mer-b01-99"}'
  )->>'status',
  'success',
  'confirmer role can apply a matching receipt after BOG verification flow'
);
select is(
  (select subscription_status from public.profiles where id = '00000000-0000-0000-0000-000000000b01'),
  'active',
  'confirmer-applied success activates Premium'
);
select is(
  (select device_slots from public.profiles where id = '00000000-0000-0000-0000-000000000b01'),
  1,
  'confirmer-applied 99 GEL grants one device slot'
);

-- 10) duplicate does not re-extend expiry
select set_config(
  'm033.b01_expiry',
  (select subscription_expires_at::text from public.profiles where id = '00000000-0000-0000-0000-000000000b01'),
  true
);
select is(
  public.update_bog_payment_status(
    'm033-b01-99', 'success', 'bank-b01-dup',
    '{"bank_status":"completed","bank_amount":"99.00","bank_currency":"GEL","bank_external_order_id":"m033-mer-b01-99"}'
  )->>'duplicate_or_stale',
  'true',
  'repeat success through confirmer is duplicate'
);
select is(
  (select subscription_expires_at::text from public.profiles where id = '00000000-0000-0000-0000-000000000b01'),
  current_setting('m033.b01_expiry'),
  'duplicate confirmer success does not extend expiry'
);
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok(
  $$update public.payment_transactions
      set status = 'pending'
    where payment_id = 'm033-b01-99'$$,
  '42501',
  'BOG payment status can change only through the confirmer write path',
  'service_role cannot regress successful payment to pending'
);
reset role;
set local role postgres;
select set_config('request.jwt.claims', '{"role":"cityroute_bog_confirmer"}', true);
select is(
  public.update_bog_payment_status(
    'm033-b01-99', 'refunded_partially', 'bank-b01-partial-refund',
    '{"bank_status":"refunded_partially","bank_amount":"99.00","bank_refund_amount":"10.00","bank_currency":"GEL","bank_external_order_id":"m033-mer-b01-99"}'
  )->>'status',
  'refunded_partially',
  'confirmer can transition successful payment to partial refund'
);
select is(
  public.update_bog_payment_status(
    'm033-b01-99', 'refunded', 'bank-b01-refunded',
    '{"bank_status":"refunded","bank_amount":"99.00","bank_refund_amount":"99.00","bank_currency":"GEL","bank_external_order_id":"m033-mer-b01-99"}'
  )->>'status',
  'refunded',
  'confirmer can transition partial refund to full refund'
);
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok(
  $$update public.payment_transactions
      set status = 'pending'
    where payment_id = 'm033-b01-99'$$,
  '42501',
  'BOG payment status can change only through the confirmer write path',
  'service_role cannot regress refunded payment to pending'
);

reset role;
set local role postgres;
select set_config('request.jwt.claims', '{"role":"cityroute_bog_confirmer"}', true);
select throws_ok(
  $$select public.update_bog_payment_status(
    'm033-b02-forged', 'success', 'bank-wrong',
    '{"bank_status":"completed","bank_amount":"1.00","bank_currency":"GEL","bank_external_order_id":"m033-mer-b02-forged"}'
  )$$,
  'P0001',
  'BOG receipt amount does not match the stored transaction',
  'confirmer still rejects a mismatched receipt amount'
);
select is(
  (select subscription_status from public.profiles where id = '00000000-0000-0000-0000-000000000b02'),
  'trial',
  'mismatched confirmer receipt leaves Premium inactive'
);

-- Checkout handoff alone must not activate Premium without confirmer settlement.
select is(
  (select subscription_status from public.profiles where id = '00000000-0000-0000-0000-000000000b02'),
  'trial',
  'checkout payment_id handoff without confirmer leaves Premium inactive'
);
select is(
  (select status from public.payment_transactions where payment_id = 'bog-real-order-b02'),
  'pending',
  'checkout handoff keeps the payment pending until confirmer settlement'
);

reset role;
set local role postgres;
select set_config('cityroute.bog_payment_create', 'on', true);
insert into public.payment_transactions (
  user_id, provider, payment_id, merchant_payment_id, idempotency_key,
  amount, currency, status, metadata
)
values
  ('00000000-0000-0000-0000-000000000b03', 'bog', 'm033-b03-expired-1', 'cr-m033-b03-expired-1', '00000000-0000-0000-0000-000000000101', 99, 'GEL', 'pending',
   pg_catalog.jsonb_build_object('provider','bog','device_slots',1,'package_price',99,'checkout_phase','claimed','claim_expires_at',(pg_catalog.statement_timestamp() - interval '1 minute')::text)),
  ('00000000-0000-0000-0000-000000000b03', 'bog', 'm033-b03-expired-2', 'cr-m033-b03-expired-2', '00000000-0000-0000-0000-000000000102', 99, 'GEL', 'pending',
   pg_catalog.jsonb_build_object('provider','bog','device_slots',1,'package_price',99,'checkout_phase','claimed','claim_expires_at',(pg_catalog.statement_timestamp() - interval '1 minute')::text)),
  ('00000000-0000-0000-0000-000000000b03', 'bog', 'm033-b03-expired-3', 'cr-m033-b03-expired-3', '00000000-0000-0000-0000-000000000103', 99, 'GEL', 'pending',
   pg_catalog.jsonb_build_object('provider','bog','device_slots',1,'package_price',99,'checkout_phase','claimed','claim_expires_at',(pg_catalog.statement_timestamp() - interval '1 minute')::text));
select set_config('cityroute.bog_payment_create', 'off', true);

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000b01"}', true);
select lives_ok(
  $$select public.create_bog_pending_payment(
      '00000000-0000-0000-0000-000000000b01',
      'unissued:00000000-0000-0000-0000-000000000008',
      'cr-00000000-0000-0000-0000-000000000008',
      '00000000-0000-0000-0000-000000000008',
      99,
      1,
      pg_catalog.jsonb_build_object(
        'provider', 'bog',
        'device_slots', 1,
        'package_price', 99,
        'checkout_phase', 'claimed',
        'claim_expires_at', (pg_catalog.statement_timestamp() + interval '30 seconds')::text,
        'client_request_ids', pg_catalog.jsonb_build_array('m033-client-claim-3')
      )
    )$$,
  'checkout can create a third concurrent active claim'
);
select throws_ok(
  $$select public.create_bog_pending_payment(
      '00000000-0000-0000-0000-000000000b01',
      'unissued:00000000-0000-0000-0000-000000000009',
      'cr-00000000-0000-0000-0000-000000000009',
      '00000000-0000-0000-0000-000000000009',
      179,
      2,
      pg_catalog.jsonb_build_object(
        'provider', 'bog',
        'device_slots', 2,
        'package_price', 179,
        'checkout_phase', 'claimed',
        'claim_expires_at', (pg_catalog.statement_timestamp() + interval '30 seconds')::text,
        'client_request_ids', pg_catalog.jsonb_build_array('m033-client-claim-4')
      )
    )$$,
  'P0001',
  'Too many active BOG checkout attempts',
  'a fourth active pending claim is rejected'
);
select lives_ok(
  $$select public.create_bog_pending_payment(
      '00000000-0000-0000-0000-000000000b01',
      'unissued:00000000-0000-0000-0000-000000000002',
      'cr-00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000002',
      99,
      1,
      pg_catalog.jsonb_build_object(
        'provider', 'bog',
        'device_slots', 1,
        'package_price', 99,
        'checkout_phase', 'claimed',
        'claim_expires_at', (pg_catalog.statement_timestamp() + interval '30 seconds')::text,
        'client_request_ids', pg_catalog.jsonb_build_array('m033-client-claim-retry')
      )
    )$$,
  'a repeated idempotency key returns successfully without inserting another claim'
);
reset role;
set local role postgres;
select is(
  (select count(*) from public.payment_transactions
    where provider = 'bog'
      and user_id = '00000000-0000-0000-0000-000000000b01'
      and idempotency_key = '00000000-0000-0000-0000-000000000002'),
  1::bigint,
  'idempotent retry leaves exactly one payment row'
);
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000b03"}', true);
select lives_ok(
  $$select public.create_bog_pending_payment(
      '00000000-0000-0000-0000-000000000b03',
      'unissued:00000000-0000-0000-0000-000000000010',
      'cr-00000000-0000-0000-0000-000000000010',
      '00000000-0000-0000-0000-000000000010',
      99,
      1,
      pg_catalog.jsonb_build_object(
        'provider', 'bog',
        'device_slots', 1,
        'package_price', 99,
        'checkout_phase', 'claimed',
        'claim_expires_at', (pg_catalog.statement_timestamp() + interval '30 seconds')::text,
        'client_request_ids', pg_catalog.jsonb_build_array('m033-client-expired-reuse')
      )
    )$$,
  'expired claims do not consume the active-claim limit'
);
reset role;
set local role postgres;
select ok(
  position('pg_advisory_xact_lock' in pg_get_functiondef('public.create_bog_pending_payment(uuid,text,text,uuid,numeric,integer,jsonb)'::regprocedure)) > 0
    and position('v_max_active_claims constant integer := 3' in pg_get_functiondef('public.create_bog_pending_payment(uuid,text,text,uuid,numeric,integer,jsonb)'::regprocedure)) > 0,
  'pending-claim capacity is serialized per user and capped at three'
);
select ok(
  position('pg_catalog.current_user' in pg_get_functiondef('public.protect_trial_lifecycle()'::regprocedure)) = 0
    and position('= current_user' in pg_get_functiondef('public.protect_trial_lifecycle()'::regprocedure)) > 0,
  'forward correction uses PostgreSQL current_user syntax'
);

select * from finish();
rollback;
