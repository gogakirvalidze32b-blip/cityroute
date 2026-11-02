begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(1);

select ok(
  not (
    select a.attnotnull
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.profiles'::regclass
      and a.attname = 'subscription_expires_at'
      and not a.attisdropped
  ),
  'subscription_expires_at supports non-expiring subscriptions'
);

select * from finish();
rollback;
