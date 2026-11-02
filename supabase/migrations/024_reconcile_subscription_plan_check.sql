begin;

do $$
declare
  profile_relation oid := to_regclass('public.profiles');
  plan_attnum smallint;
  plan_type oid;
begin
  if profile_relation is null then
    raise exception 'public.profiles is missing; apply the base schema before migration 024';
  end if;

  select a.attnum, a.atttypid
    into plan_attnum, plan_type
  from pg_catalog.pg_attribute a
  where a.attrelid = profile_relation
    and a.attname = 'subscription_plan'
    and not a.attisdropped;

  if plan_attnum is null or plan_type <> 'text'::regtype then
    raise exception 'profiles.subscription_plan must exist as text before migration 024';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = profile_relation
      and c.contype = 'c'
      and plan_attnum = any(c.conkey)
      and (
        c.conname <> 'profiles_subscription_plan_check'
        or cardinality(c.conkey) <> 1
      )
  ) then
    raise exception 'An unexpected CHECK constraint references subscription_plan; inspect it before migration 024';
  end if;

  if exists (
    select 1
    from public.profiles p
    where p.subscription_plan is not null
      and p.subscription_plan not in ('nav', 'panel', 'full', 'premium')
  ) then
    raise exception 'Unsupported subscription_plan values exist; inspect profiles before migration 024';
  end if;
end;
$$;

alter table public.profiles
  drop constraint if exists profiles_subscription_plan_check;

alter table public.profiles
  add constraint profiles_subscription_plan_check
  check (
    subscription_plan is null
    or subscription_plan in ('nav', 'panel', 'full', 'premium')
  );

commit;
