begin;

alter table public.profiles
  alter column subscription_expires_at
  set default (now() + interval '12 hours');

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
    now() + interval '12 hours',
    null
  );
  return new;
end;
$$;

commit;
