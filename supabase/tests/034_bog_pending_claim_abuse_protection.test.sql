begin;
set local role postgres;

do $preflight$
begin
  if to_regclass('public.payment_transactions') is null
     or to_regclass('public.device_slot_packages') is null
     or to_regprocedure('public.create_bog_pending_payment(uuid,text,text,uuid,numeric,integer,jsonb)') is null
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'cityroute_bog_confirmer')
  then
    raise exception 'Migrations 0291, 032, 033, and 034 must be applied before this test';
  end if;
end
$preflight$;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select ok(
  (select prosecdef
     and proconfig @> array['search_path=pg_catalog, public, auth']
   from pg_catalog.pg_proc
  where oid = 'public.create_bog_pending_payment(uuid,text,text,uuid,numeric,integer,jsonb)'::regprocedure),
  'pending-claim RPC is SECURITY DEFINER with a pinned search_path'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.create_bog_pending_payment(uuid,text,text,uuid,numeric,integer,jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.create_bog_pending_payment(uuid,text,text,uuid,numeric,integer,jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.create_bog_pending_payment(uuid,text,text,uuid,numeric,integer,jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'cityroute_bog_confirmer',
    'public.create_bog_pending_payment(uuid,text,text,uuid,numeric,integer,jsonb)',
    'execute'
  ),
  'only authenticated users can execute the pending-claim RPC'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm034-owner@example.test', '', pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000c02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm034-other@example.test', '', pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000c03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm034-tbc-renew@example.test', '', pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now())
on conflict (id) do nothing;

insert into public.profiles (
  id, full_name, trial_started_at, subscription_status, subscription_expires_at, subscription_plan
)
select u.id, '', pg_catalog.now(), 'trial', pg_catalog.now() + interval '12 hours', null
from auth.users u
where u.id in (
  '00000000-0000-0000-0000-000000000c01',
  '00000000-0000-0000-0000-000000000c02',
  '00000000-0000-0000-0000-000000000c03'
)
and not exists (select 1 from public.profiles p where p.id = u.id);

alter table public.profiles disable trigger profiles_protect_trial_lifecycle;
update public.profiles
set subscription_status = 'active',
    subscription_plan = 'premium',
    subscription_expires_at = pg_catalog.now() - interval '1 day'
where id = '00000000-0000-0000-0000-000000000c03';
alter table public.profiles enable trigger profiles_protect_trial_lifecycle;

insert into public.payment_transactions (
  user_id, provider, payment_id, merchant_payment_id, amount, currency, status, metadata
)
values (
  '00000000-0000-0000-0000-000000000c03', 'tbc', 'm034-tbc-renewal',
  'm034-mer-tbc-renewal', 99, 'GEL', 'pending', '{}'::jsonb
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000c01"}',
  true
);

select lives_ok(
  $$select public.create_bog_pending_payment(
      '00000000-0000-0000-0000-000000000c01',
      'unissued:00000000-0000-0000-0000-000000000c11',
      'cr-00000000-0000-0000-0000-000000000c11',
      '00000000-0000-0000-0000-000000000c11',
      99, 1,
      pg_catalog.jsonb_build_object(
        'provider', 'bog', 'device_slots', 1, 'package_price', 99,
        'checkout_phase', 'claimed',
        'claim_expires_at', (pg_catalog.statement_timestamp() + interval '30 seconds')::text,
        'client_request_ids', pg_catalog.jsonb_build_array('m034-owner-claim-1')
      )
    )$$,
  'authenticated owner can create a 99 GEL one-device claim'
);
select lives_ok(
  $$select public.create_bog_pending_payment(
      '00000000-0000-0000-0000-000000000c01',
      'unissued:00000000-0000-0000-0000-000000000c11',
      'cr-00000000-0000-0000-0000-000000000c11',
      '00000000-0000-0000-0000-000000000c11',
      99, 1,
      pg_catalog.jsonb_build_object(
        'provider', 'bog', 'device_slots', 1, 'package_price', 99,
        'checkout_phase', 'claimed',
        'claim_expires_at', (pg_catalog.statement_timestamp() + interval '30 seconds')::text,
        'client_request_ids', pg_catalog.jsonb_build_array('m034-owner-claim-1-retry')
      )
    )$$,
  'retrying the same idempotency key and payment identity succeeds'
);
-- Counts must run as postgres: authenticated SELECT is gated by active-session RLS.
reset role;
set local role postgres;
select is(
  (select count(*) from public.payment_transactions
    where provider = 'bog'
      and user_id = '00000000-0000-0000-0000-000000000c01'
      and idempotency_key = '00000000-0000-0000-0000-000000000c11'),
  1::bigint,
  'same-key retry returns the existing claim without inserting a duplicate'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000c01"}',
  true
);
select throws_ok(
  $$select public.create_bog_pending_payment(
      '00000000-0000-0000-0000-000000000c01',
      'bog-different-payment-id',
      'cr-00000000-0000-0000-0000-000000000c11',
      '00000000-0000-0000-0000-000000000c11',
      99, 1,
      '{"provider":"bog","device_slots":1,"package_price":99,"checkout_url":"https://payment.bog.ge/order/m034"}'::jsonb
    )$$,
  '23505',
  'BOG idempotency key is already bound to another payment attempt',
  'an idempotency key cannot be rebound to a different payment ID'
);

select lives_ok(
  $$select public.create_bog_pending_payment(
      '00000000-0000-0000-0000-000000000c01',
      'unissued:00000000-0000-0000-0000-000000000c12',
      'cr-00000000-0000-0000-0000-000000000c12',
      '00000000-0000-0000-0000-000000000c12',
      179, 2,
      pg_catalog.jsonb_build_object(
        'provider', 'bog', 'device_slots', 2, 'package_price', 179,
        'checkout_phase', 'claimed',
        'claim_expires_at', (pg_catalog.statement_timestamp() + interval '30 seconds')::text,
        'client_request_ids', pg_catalog.jsonb_build_array('m034-owner-claim-2')
      )
    )$$,
  'authenticated owner can create a 179 GEL two-device claim'
);
select lives_ok(
  $$select public.create_bog_pending_payment(
      '00000000-0000-0000-0000-000000000c01',
      'unissued:00000000-0000-0000-0000-000000000c13',
      'cr-00000000-0000-0000-0000-000000000c13',
      '00000000-0000-0000-0000-000000000c13',
      99, 1,
      pg_catalog.jsonb_build_object(
        'provider', 'bog', 'device_slots', 1, 'package_price', 99,
        'checkout_phase', 'claimed',
        'claim_expires_at', (pg_catalog.statement_timestamp() + interval '30 seconds')::text,
        'client_request_ids', pg_catalog.jsonb_build_array('m034-owner-claim-3')
      )
    )$$,
  'owner can create a third concurrent checkout claim'
);
select throws_ok(
  $$select public.create_bog_pending_payment(
      '00000000-0000-0000-0000-000000000c01',
      'unissued:00000000-0000-0000-0000-000000000c14',
      'cr-00000000-0000-0000-0000-000000000c14',
      '00000000-0000-0000-0000-000000000c14',
      99, 1,
      pg_catalog.jsonb_build_object(
        'provider', 'bog', 'device_slots', 1, 'package_price', 99,
        'checkout_phase', 'claimed',
        'claim_expires_at', (pg_catalog.statement_timestamp() + interval '30 seconds')::text,
        'client_request_ids', pg_catalog.jsonb_build_array('m034-owner-claim-4')
      )
    )$$,
  'P0001',
  'Too many active BOG checkout attempts',
  'a fourth active claim for the same user is rejected'
);
reset role;
set local role postgres;
select is(
  (select count(*) from public.payment_transactions
    where provider = 'bog'
      and user_id = '00000000-0000-0000-0000-000000000c01'
      and status in ('pending', 'processing')),
  3::bigint,
  'rejected fourth attempt does not create a payment row'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000c01"}',
  true
);

select throws_ok(
  $$select public.create_bog_pending_payment(
      '00000000-0000-0000-0000-000000000c02',
      'unissued:00000000-0000-0000-0000-000000000c21',
      'cr-00000000-0000-0000-0000-000000000c21',
      '00000000-0000-0000-0000-000000000c21',
      99, 1,
      pg_catalog.jsonb_build_object(
        'provider', 'bog', 'device_slots', 1, 'package_price', 99,
        'checkout_phase', 'claimed',
        'claim_expires_at', (pg_catalog.statement_timestamp() + interval '30 seconds')::text,
        'client_request_ids', pg_catalog.jsonb_build_array('m034-forged-owner')
      )
    )$$,
  '42501',
  'Authenticated checkout user does not match pending BOG payment owner',
  'a user cannot create a claim for a different account'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000c02"}',
  true
);
select lives_ok(
  $$select public.create_bog_pending_payment(
      '00000000-0000-0000-0000-000000000c02',
      'unissued:00000000-0000-0000-0000-000000000c21',
      'cr-00000000-0000-0000-0000-000000000c21',
      '00000000-0000-0000-0000-000000000c21',
      99, 1,
      pg_catalog.jsonb_build_object(
        'provider', 'bog', 'device_slots', 1, 'package_price', 99,
        'checkout_phase', 'claimed',
        'claim_expires_at', (pg_catalog.statement_timestamp() + interval '1 second')::text,
        'client_request_ids', pg_catalog.jsonb_build_array('m034-other-claim-1')
      )
    )$$,
  'another user can create a claim while the first user is at the limit'
);
reset role;
set local role postgres;
select is(
  (select count(*) from public.payment_transactions
    where provider = 'bog'
      and user_id = '00000000-0000-0000-0000-000000000c02'
      and status in ('pending', 'processing')),
  1::bigint,
  'active-claim cap is isolated per user'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000c02"}',
  true
);
select lives_ok(
  $$select public.create_bog_pending_payment(
      '00000000-0000-0000-0000-000000000c02',
      'unissued:00000000-0000-0000-0000-000000000c22',
      'cr-00000000-0000-0000-0000-000000000c22',
      '00000000-0000-0000-0000-000000000c22',
      99, 1,
      pg_catalog.jsonb_build_object(
        'provider', 'bog', 'device_slots', 1, 'package_price', 99,
        'checkout_phase', 'claimed',
        'claim_expires_at', (pg_catalog.statement_timestamp() + interval '30 seconds')::text,
        'client_request_ids', pg_catalog.jsonb_build_array('m034-other-claim-2')
      )
    )$$,
  'second user second claim is accepted'
);
select lives_ok(
  $$select public.create_bog_pending_payment(
      '00000000-0000-0000-0000-000000000c02',
      'unissued:00000000-0000-0000-0000-000000000c23',
      'cr-00000000-0000-0000-0000-000000000c23',
      '00000000-0000-0000-0000-000000000c23',
      99, 1,
      pg_catalog.jsonb_build_object(
        'provider', 'bog', 'device_slots', 1, 'package_price', 99,
        'checkout_phase', 'claimed',
        'claim_expires_at', (pg_catalog.statement_timestamp() + interval '30 seconds')::text,
        'client_request_ids', pg_catalog.jsonb_build_array('m034-other-claim-3')
      )
    )$$,
  'second user third claim is accepted'
);
select pg_catalog.pg_sleep(2);
select lives_ok(
  $$select public.create_bog_pending_payment(
      '00000000-0000-0000-0000-000000000c02',
      'unissued:00000000-0000-0000-0000-000000000c24',
      'cr-00000000-0000-0000-0000-000000000c24',
      '00000000-0000-0000-0000-000000000c24',
      99, 1,
      pg_catalog.jsonb_build_object(
        'provider', 'bog', 'device_slots', 1, 'package_price', 99,
        'checkout_phase', 'claimed',
        'claim_expires_at', (pg_catalog.statement_timestamp() + interval '30 seconds')::text,
        'client_request_ids', pg_catalog.jsonb_build_array('m034-other-claim-4')
      )
    )$$,
  'a claim is accepted after the previous pending claim expires'
);
reset role;
set local role postgres;
select is(
  (select count(*) from public.payment_transactions transaction
    where transaction.provider = 'bog'
      and transaction.user_id = '00000000-0000-0000-0000-000000000c02'
      and transaction.status in ('pending', 'processing')
      and (
        transaction.status = 'processing'
        or transaction.metadata->>'checkout_phase' is distinct from 'claimed'
        or coalesce(
          (transaction.metadata->>'claim_expires_at')::timestamptz,
          'infinity'::timestamptz
        ) > pg_catalog.statement_timestamp()
      )),
  3::bigint,
  'only unexpired pending claims count against the per-user cap'
);

reset role;
select set_config('cityroute.premium_activation', 'on', true);
select throws_ok(
  $$update public.profiles
    set subscription_status = 'active',
        subscription_plan = 'premium',
        subscription_expires_at = pg_catalog.now() + interval '30 days',
        device_slots = 1,
        subscription_payment_id = 'unissued:00000000-0000-0000-0000-000000000c11'
    where id = '00000000-0000-0000-0000-000000000c01'$$,
  '42501',
  'subscription expiry can change only during confirmed premium activation',
  'an unverified BOG pending claim cannot activate Premium after migration 034'
);
select set_config('cityroute.premium_activation', 'off', true);
select lives_ok(
  $$select public.update_payment_status(
      'tbc', 'm034-tbc-renewal', 'success', 'm034-tbc-renewal-tx', '{}'::jsonb
    )$$,
  'migration 034 preserves successful TBC renewal'
);
select is(
  (select subscription_status from public.profiles
   where id = '00000000-0000-0000-0000-000000000c03'),
  'active',
  'TBC renewal keeps the Premium profile active after migration 034'
);
select ok(
  (select subscription_expires_at between pg_catalog.now() + interval '29 days'
                                      and pg_catalog.now() + interval '31 days'
   from public.profiles
   where id = '00000000-0000-0000-0000-000000000c03'),
  'TBC renewal extends expiry through the existing TBC function after migration 034'
);
select * from finish();
rollback;
