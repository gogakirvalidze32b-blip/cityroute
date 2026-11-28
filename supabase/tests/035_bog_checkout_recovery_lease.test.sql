begin;
set local role postgres;

do $preflight$
begin
  if pg_catalog.current_database() not in ('postgres', 'cityroute_bog_test')
     or pg_catalog.current_setting('port') = '54322'
     or pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
  then
    raise exception 'Lease tests require an isolated PostgreSQL 17 test database, not port 54322';
  end if;
  if to_regclass('public.payment_transactions') is null
     or to_regclass('public.bog_checkout_recovery_leases') is null
     or to_regprocedure('public.acquire_bog_checkout_recovery_lease(text,integer)') is null
     or to_regprocedure('public.release_bog_checkout_recovery_lease(text,uuid)') is null
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'cityroute_bog_confirmer')
  then
    raise exception 'Migrations 033, 034, and 035 must be applied before this test';
  end if;
end
$preflight$;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.bog_checkout_recovery_leases'::regclass),
  'recovery lease table has RLS enabled'
);
select ok(
  not (select relforcerowsecurity from pg_catalog.pg_class where oid = 'public.bog_checkout_recovery_leases'::regclass),
  'recovery lease table does not FORCE RLS against its SECURITY DEFINER owner'
);
select is(
  (select count(*) from pg_catalog.pg_policy where polrelid = 'public.bog_checkout_recovery_leases'::regclass),
  0::bigint,
  'recovery lease table has no client-facing RLS policies'
);
select ok(
  (select c.relowner = a.proowner
      and c.relowner = r.proowner
   from pg_catalog.pg_class c
   join pg_catalog.pg_proc a on a.oid = 'public.acquire_bog_checkout_recovery_lease(text,integer)'::regprocedure
   join pg_catalog.pg_proc r on r.oid = 'public.release_bog_checkout_recovery_lease(text,uuid)'::regprocedure
   where c.oid = 'public.bog_checkout_recovery_leases'::regclass),
  'lease SECURITY DEFINER functions and table share the same owner'
);
select ok(
  (select prosecdef from pg_catalog.pg_proc
    where oid = 'public.acquire_bog_checkout_recovery_lease(text,integer)'::regprocedure)
  and
  (select prosecdef from pg_catalog.pg_proc
    where oid = 'public.release_bog_checkout_recovery_lease(text,uuid)'::regprocedure),
  'both lease RPCs are SECURITY DEFINER'
);
select ok(
  (select proconfig @> array['search_path=pg_catalog, public, auth']
    from pg_catalog.pg_proc
    where oid = 'public.acquire_bog_checkout_recovery_lease(text,integer)'::regprocedure)
  and
  (select proconfig @> array['search_path=pg_catalog, public, auth']
    from pg_catalog.pg_proc
    where oid = 'public.release_bog_checkout_recovery_lease(text,uuid)'::regprocedure),
  'both lease RPCs pin a trusted search_path'
);
select ok(
  has_function_privilege('service_role', 'public.acquire_bog_checkout_recovery_lease(text,integer)', 'execute')
  and has_function_privilege('service_role', 'public.release_bog_checkout_recovery_lease(text,uuid)', 'execute'),
  'service_role can execute both lease RPCs'
);
select ok(
  not has_function_privilege('anon', 'public.acquire_bog_checkout_recovery_lease(text,integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.acquire_bog_checkout_recovery_lease(text,integer)', 'execute')
  and not has_function_privilege('cityroute_bog_confirmer', 'public.acquire_bog_checkout_recovery_lease(text,integer)', 'execute')
  and not has_function_privilege('anon', 'public.release_bog_checkout_recovery_lease(text,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.release_bog_checkout_recovery_lease(text,uuid)', 'execute')
  and not has_function_privilege('cityroute_bog_confirmer', 'public.release_bog_checkout_recovery_lease(text,uuid)', 'execute'),
  'anon, authenticated, and confirmer cannot execute lease RPCs'
);
select ok(
  not has_table_privilege('service_role', 'public.bog_checkout_recovery_leases', 'select')
  and not has_table_privilege('service_role', 'public.bog_checkout_recovery_leases', 'insert')
  and not has_table_privilege('service_role', 'public.bog_checkout_recovery_leases', 'update')
  and not has_table_privilege('service_role', 'public.bog_checkout_recovery_leases', 'delete')
  and not has_table_privilege('authenticated', 'public.bog_checkout_recovery_leases', 'select')
  and not has_table_privilege('anon', 'public.bog_checkout_recovery_leases', 'select'),
  'lease rows are inaccessible through direct table privileges'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000b35',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'm035-recovery@example.test', '',
  pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()
)
on conflict (id) do nothing;

select set_config('cityroute.bog_payment_create', 'on', true);
insert into public.payment_transactions (
  user_id, provider, payment_id, merchant_payment_id, amount, currency, status, metadata
)
values
  (
    '00000000-0000-0000-0000-000000000b35', 'bog', 'm035-bank-call-payment',
    'm035-bank-call-merchant', 99, 'GEL', 'pending',
    '{"provider":"bog","device_slots":1,"package_price":99,"checkout_phase":"bank_call","bank_call_started_at":"2026-11-10T00:00:00Z"}'
  ),
  (
    '00000000-0000-0000-0000-000000000b35', 'bog', 'm035-ready-payment',
    'm035-ready-merchant', 99, 'GEL', 'pending',
    '{"provider":"bog","device_slots":1,"package_price":99,"checkout_phase":"ready","claim_payment_id":"m035-ready-claim","bank_payment_id":"m035-ready-payment","checkout_url":"https://payment.bog.ge/order/m035"}'
  ),
  (
    '00000000-0000-0000-0000-000000000b35', 'bog', 'm035-claimed-payment',
    'm035-claimed-merchant', 99, 'GEL', 'pending',
    '{"provider":"bog","device_slots":1,"package_price":99,"checkout_phase":"claimed","claim_expires_at":"2026-11-10T00:00:00Z"}'
  );
select set_config('cityroute.bog_payment_create', 'off', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create temporary table m035_lease_test_tokens (
  name text primary key,
  token uuid not null
);
insert into m035_lease_test_tokens
select 'first', public.acquire_bog_checkout_recovery_lease('m035-bank-call-payment', 180);

select isnt(
  (select token from m035_lease_test_tokens where name = 'first'),
  null::uuid,
  'eligible bank_call claim acquires a lease'
);
select is(
  public.acquire_bog_checkout_recovery_lease('m035-bank-call-payment', 180),
  null::uuid,
  'a second acquire cannot replace an unexpired lease'
);
select throws_ok(
  $$select public.acquire_bog_checkout_recovery_lease('m035-bank-call-payment', 29)$$,
  '22023',
  'Invalid BOG recovery lease request',
  'lease duration below the allowed range is rejected'
);
select is(
  public.release_bog_checkout_recovery_lease('m035-bank-call-payment', pg_catalog.gen_random_uuid()),
  false,
  'an incorrect token cannot release a lease'
);
select is(
  public.release_bog_checkout_recovery_lease(
    'm035-bank-call-payment',
    (select token from m035_lease_test_tokens where name = 'first')
  ),
  true,
  'the matching token releases its lease'
);
select is(
  public.release_bog_checkout_recovery_lease(
    'm035-bank-call-payment',
    (select token from m035_lease_test_tokens where name = 'first')
  ),
  false,
  'a repeated release is harmless'
);

insert into m035_lease_test_tokens
select 'expired', public.acquire_bog_checkout_recovery_lease('m035-bank-call-payment', 180);
update public.bog_checkout_recovery_leases
   set lease_expires_at = pg_catalog.clock_timestamp() - interval '1 second'
 where claim_payment_id = 'm035-bank-call-payment';
insert into m035_lease_test_tokens
select 'replacement', public.acquire_bog_checkout_recovery_lease('m035-bank-call-payment', 180);

select isnt(
  (select token from m035_lease_test_tokens where name = 'replacement'),
  (select token from m035_lease_test_tokens where name = 'expired'),
  'expired lease is replaced with a fresh token'
);
select is(
  public.release_bog_checkout_recovery_lease(
    'm035-bank-call-payment',
    (select token from m035_lease_test_tokens where name = 'expired')
  ),
  false,
  'stale token cannot release the replacement lease'
);
select is(
  public.release_bog_checkout_recovery_lease(
    'm035-bank-call-payment',
    (select token from m035_lease_test_tokens where name = 'replacement')
  ),
  true,
  'replacement token can release the lease'
);
select isnt(
  public.acquire_bog_checkout_recovery_lease('m035-ready-claim', 180),
  null::uuid,
  'ready claim is eligible for a settlement-recovery lease'
);
select is(
  public.acquire_bog_checkout_recovery_lease('m035-claimed-payment', 180),
  null::uuid,
  'claimed phase is not eligible for a recovery lease'
);
select is(
  public.acquire_bog_checkout_recovery_lease('m035-missing-payment', 180),
  null::uuid,
  'unknown claim cannot acquire a lease'
);

select * from finish();
rollback;
