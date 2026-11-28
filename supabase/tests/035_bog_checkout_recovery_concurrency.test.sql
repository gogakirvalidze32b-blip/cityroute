begin;
set local role postgres;

do $preflight$
begin
  if pg_catalog.current_database() not in ('postgres', 'cityroute_bog_test')
     or pg_catalog.current_setting('port') = '54322'
     or pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
  then
    raise exception 'Recovery concurrency test requires an isolated PostgreSQL 17 test database';
  end if;
  if to_regclass('public.payment_transactions') is null
     or to_regclass('public.bog_checkout_recovery_leases') is null
     or to_regprocedure('public.acquire_bog_checkout_recovery_lease(text,integer)') is null
     or to_regclass('bog_test_support.runs') is null
     or to_regclass('bog_test_support.concurrent_results') is null
  then
    raise exception 'Run the hosted BOG concurrency harness after migrations 033, 034, and 035';
  end if;
end
$preflight$;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(5);

select is(
  (select count(distinct backend_pid)
     from bog_test_support.concurrent_results
    where run_id = :'run_id'::uuid
      and scenario = 'recovery_lease'
      and outcome in ('acquired', 'already_leased')),
  2::bigint,
  'competing lease calls ran in two distinct PostgreSQL sessions'
);
select is(
  (select count(*)
     from bog_test_support.concurrent_results
    where run_id = :'run_id'::uuid
      and scenario = 'recovery_lease'
      and outcome = 'acquired'),
  1::bigint,
  'exactly one independent service request acquires the claim lease'
);
select is(
  (select count(*)
     from bog_test_support.concurrent_results
    where run_id = :'run_id'::uuid
      and scenario = 'recovery_lease'
      and outcome = 'already_leased'),
  1::bigint,
  'the competing service request cannot replace the active lease'
);
select is(
  (select count(*)
     from public.bog_checkout_recovery_leases lease
     join bog_test_support.runs run
       on run.payment_035 = lease.claim_payment_id
    where run.run_id = :'run_id'::uuid),
  1::bigint,
  'exactly one lease row exists for the contested claim'
);
select is(
  (select count(*)
     from bog_test_support.concurrent_results
    where run_id = :'run_id'::uuid
      and scenario = 'recovery_lease'
      and outcome not in ('acquired', 'already_leased')),
  0::bigint,
  'both independent sessions completed without unexpected outcomes'
);

select * from finish();
rollback;
