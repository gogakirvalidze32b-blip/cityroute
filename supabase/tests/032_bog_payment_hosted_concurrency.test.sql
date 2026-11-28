begin;
set local role postgres;

do $preflight$
begin
  if pg_catalog.current_database() <> 'postgres'
     or pg_catalog.current_setting('port') = '54322'
     or pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
  then
    raise exception 'Hosted settlement concurrency test requires the isolated PostgreSQL 17 Supabase test project';
  end if;
  if to_regclass('public.payment_transactions') is null
     or to_regprocedure('public.update_bog_payment_status(text,text,text,jsonb)') is null
     or to_regclass('bog_test_support.runs') is null
     or to_regclass('bog_test_support.concurrent_results') is null
     or to_regclass('bog_test_support.premium_activation_events') is null
     or to_regprocedure('bog_test_support.record_premium_activation()') is null
  then
    raise exception 'Run the hosted BOG concurrency harness after migrations 029 and 032-035';
  end if;
end
$preflight$;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(15);

-- Both workers must race the same payment ID on two independent backends.
select is(
  (select count(distinct backend_pid)
     from bog_test_support.concurrent_results
    where run_id = :'run_id'::uuid
      and scenario = 'settlement'
      and backend_pid is not null),
  2::bigint,
  'settlement race used two distinct PostgreSQL sessions'
);
select is(
  (select count(*)
     from bog_test_support.concurrent_results
    where run_id = :'run_id'::uuid
      and scenario = 'settlement'
      and outcome = 'success'),
  2::bigint,
  'both independent settlement requests completed without unexpected errors'
);
select is(
  (select count(*)
     from bog_test_support.concurrent_results
    where run_id = :'run_id'::uuid
      and scenario = 'settlement'
      and detail::jsonb->>'success' = 'true'),
  2::bigint,
  'both settlement RPCs returned success (winner or idempotent duplicate)'
);
select is(
  (select count(*)
     from bog_test_support.concurrent_results
    where run_id = :'run_id'::uuid
      and scenario = 'settlement'
      and outcome not in ('success')),
  0::bigint,
  'neither settlement session reported an unexpected result'
);

select is(
  (select status
     from public.payment_transactions payment
     join bog_test_support.runs run on run.user_032 = payment.user_id
    where run.run_id = :'run_id'::uuid
      and payment.payment_id = run.payment_032_99),
  'success',
  'the shared 99 GEL payment settled exactly once to success'
);
select is(
  (select count(*)
     from public.payment_transactions payment
     join bog_test_support.runs run on run.user_032 = payment.user_id
    where run.run_id = :'run_id'::uuid
      and payment.payment_id = run.payment_032_99
      and payment.status = 'success'),
  1::bigint,
  'only one success row exists for the raced payment ID'
);
select is(
  (select metadata->>'bank_status'
     from public.payment_transactions payment
     join bog_test_support.runs run on run.user_032 = payment.user_id
    where run.run_id = :'run_id'::uuid
      and payment.payment_id = run.payment_032_99),
  'completed',
  'the shared payment bank receipt was recorded'
);
select is(
  (select amount::text || ' ' || currency
     from public.payment_transactions payment
     join bog_test_support.runs run on run.user_032 = payment.user_id
    where run.run_id = :'run_id'::uuid
      and payment.payment_id = run.payment_032_99),
  '99 GEL',
  'the raced settlement kept the shared 99 GEL amount and currency'
);

-- Control fixture: unused second package must not be settled by this race.
select is(
  (select status
     from public.payment_transactions payment
     join bog_test_support.runs run on run.user_032 = payment.user_id
    where run.run_id = :'run_id'::uuid
      and payment.payment_id = run.payment_032_179),
  'pending',
  'the unused 179 GEL fixture was not settled by the shared-payment race'
);

select is(
  (select profile.subscription_status || ':' || coalesce(profile.subscription_plan, '')
     from public.profiles profile
     join bog_test_support.runs run on run.user_032 = profile.id
    where run.run_id = :'run_id'::uuid),
  'active:premium',
  'profile is Premium after the shared settlement race'
);
select is(
  (select profile.subscription_payment_id
     from public.profiles profile
     join bog_test_support.runs run on run.user_032 = profile.id
    where run.run_id = :'run_id'::uuid),
  (select run.payment_032_99
     from bog_test_support.runs run
    where run.run_id = :'run_id'::uuid),
  'Premium references the single raced payment, not a second settlement'
);
select is(
  (select profile.device_slots
     from public.profiles profile
     join bog_test_support.runs run on run.user_032 = profile.id
    where run.run_id = :'run_id'::uuid),
  1,
  'Premium device slots match the single 99 GEL package once'
);
select ok(
  (select profile.subscription_expires_at is not null
      and profile.subscription_expires_at > pg_catalog.now() + interval '29 days'
      and profile.subscription_expires_at < pg_catalog.now() + interval '31 days'
     from public.profiles profile
     join bog_test_support.runs run on run.user_032 = profile.id
    where run.run_id = :'run_id'::uuid),
  'Premium expiry was set once for a normal 30-day window'
);
select is(
  (select count(*)
     from public.profiles profile
     join bog_test_support.runs run on run.user_032 = profile.id
    where run.run_id = :'run_id'::uuid
      and profile.subscription_status = 'active'
      and profile.subscription_plan = 'premium'),
  1::bigint,
  'Premium activation did not create a second active Premium profile row'
);

-- Test-only observer: non-premium -> active/premium under cityroute.premium_activation.
select is(
  (select count(*)
     from bog_test_support.premium_activation_events event
     join bog_test_support.runs run on run.run_id = event.run_id
    where event.run_id = :'run_id'::uuid
      and event.profile_id = run.user_032
      and event.kind = 'transition'
      and event.new_payment_id = run.payment_032_99),
  1::bigint,
  'Premium activation transition for the raced user happened exactly once'
);

select * from finish();
rollback;
