-- Subscription plan tiers: nav | panel | full
-- Run in Supabase SQL Editor after 001_initial.sql

alter table public.profiles
  add column if not exists subscription_plan text
    check (subscription_plan is null or subscription_plan in ('nav', 'panel', 'full'));

-- Existing accounts keep full access without re-selection
update public.profiles
set subscription_plan = 'full'
where subscription_plan is null;

-- New signups must choose a plan on first login
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    full_name,
    trial_started_at,
    subscription_status,
    subscription_expires_at,
    subscription_plan
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    now(),
    'trial',
    now() + interval '24 hours',
    null
  );
  return new;
end;
$$;

create or replace function public.select_subscription_plan(chosen text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if chosen is null or chosen not in ('nav', 'panel', 'full') then
    raise exception 'Invalid plan';
  end if;

  update public.profiles
  set subscription_plan = chosen,
      updated_at = now()
  where id = uid;

  return jsonb_build_object('status', 'ok', 'plan', chosen);
end;
$$;

grant execute on function public.select_subscription_plan(text) to authenticated;
