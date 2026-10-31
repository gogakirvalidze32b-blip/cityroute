begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(6);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000981',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'plan-check-024@example.test', '',
  pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()
)
on conflict (id) do nothing;

update public.profiles
set subscription_status = 'active',
    subscription_plan = 'premium',
    subscription_expires_at = '2030-01-01 00:00:00+00',
    device_slots = 2,
    subscription_payment_id = 'preserve-plan-check-024'
where id = '00000000-0000-0000-0000-000000000981';

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = any(c.conkey)
    where c.conrelid = 'public.profiles'::regclass
      and c.conname = 'profiles_subscription_plan_check'
      and c.contype = 'c'
      and a.attname = 'subscription_plan'
      and cardinality(c.conkey) = 1
  ),
  'the named CHECK applies only to subscription_plan'
);

select lives_ok(
  $$update public.profiles set subscription_plan = 'nav'
    where id = '00000000-0000-0000-0000-000000000981'$$,
  'nav plan is accepted'
);
select lives_ok(
  $$update public.profiles set subscription_plan = 'panel'
    where id = '00000000-0000-0000-0000-000000000981'$$,
  'panel plan is accepted'
);
select lives_ok(
  $$update public.profiles set subscription_plan = 'full'
    where id = '00000000-0000-0000-0000-000000000981'$$,
  'full plan is accepted'
);
select lives_ok(
  $$update public.profiles set subscription_plan = 'premium'
    where id = '00000000-0000-0000-0000-000000000981'$$,
  'premium plan is accepted'
);

select is(
  (
    select jsonb_build_object(
      'subscription_status', subscription_status,
      'subscription_expires_at', subscription_expires_at,
      'device_slots', device_slots,
      'subscription_payment_id', subscription_payment_id
    )
    from public.profiles
    where id = '00000000-0000-0000-0000-000000000981'
  ),
  jsonb_build_object(
    'subscription_status', 'active',
    'subscription_expires_at', '2030-01-01 00:00:00+00'::timestamptz,
    'device_slots', 2,
    'subscription_payment_id', 'preserve-plan-check-024'
  ),
  'plan selection does not alter status, expiry, payment reference, or device slots'
);

select * from finish();
rollback;
