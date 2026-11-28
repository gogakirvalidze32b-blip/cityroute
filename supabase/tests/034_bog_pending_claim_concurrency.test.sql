begin;
set local role postgres;

do $preflight$
begin
  if pg_catalog.current_database() not in ('postgres', 'cityroute_bog_test')
     or pg_catalog.current_setting('port') = '54322'
     or pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
  then
    raise exception 'Pending-claim test requires an isolated PostgreSQL 17 test database';
  end if;
  if to_regclass('public.payment_transactions') is null
     or to_regprocedure('public.create_bog_pending_payment(uuid,text,text,uuid,numeric,integer,jsonb)') is null
     or to_regclass('bog_test_support.runs') is null
     or to_regclass('bog_test_support.concurrent_results') is null
  then
    raise exception 'Run the hosted BOG concurrency harness after migrations 029, 032, 033, and 034';
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
      and scenario = 'pending_claim'
      and outcome in ('created', 'limit_rejected')),
  2::bigint,
  'competing claim calls ran in two distinct PostgreSQL sessions'
);
select is(
  (select count(*)
     from bog_test_support.concurrent_results
    where run_id = :'run_id'::uuid
      and scenario = 'pending_claim'
      and outcome = 'created'),
  1::bigint,
  'exactly one independent authenticated request creates the final allowed claim'
);
select is(
  (select count(*)
     from bog_test_support.concurrent_results
    where run_id = :'run_id'::uuid
      and scenario = 'pending_claim'
      and outcome = 'limit_rejected'),
  1::bigint,
  'the competing request is rejected by the per-user active-claim limit'
);
select is(
  (select count(*)
     from public.payment_transactions payment
     join bog_test_support.runs run on run.user_034 = payment.user_id
    where run.run_id = :'run_id'::uuid
      and payment.provider = 'bog'
      and payment.status in ('pending', 'processing')),
  3::bigint,
  'concurrent requests cannot exceed three active claims for the user'
);
select is(
  (select count(*)
     from bog_test_support.concurrent_results
    where run_id = :'run_id'::uuid
      and scenario = 'pending_claim'
      and outcome not in ('created', 'limit_rejected')),
  0::bigint,
  'both independent sessions completed without unexpected outcomes'
);

select * from finish();
rollback;
