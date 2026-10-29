begin;

do $$
begin
  if exists (
    select 1
    from public.profiles
    where nullif(btrim(device_fingerprint), '') is not null
      and length(btrim(device_fingerprint)) > 256
  ) then
    raise exception 'A legacy device fingerprint exceeds the supported length; inspect profiles before migrating';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in ('cities', 'routes', 'pins')
      and cmd in ('SELECT', 'ALL')
      and (tablename, policyname) not in (
        ('cities', 'cities_read_subscribed'),
        ('routes', 'routes_read_subscribed'),
        ('pins', 'pins_read_subscribed')
      )
  ) then
    raise exception 'Unexpected SELECT policy exists for protected route data; inspect policies before migrating';
  end if;
end;
$$;

create table if not exists public.profile_devices (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  fingerprint text not null,
  first_bound_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (profile_id, fingerprint)
);

alter table public.profile_devices enable row level security;
revoke all on table public.profile_devices from public, anon, authenticated;
alter table public.profiles enable row level security;
alter table public.cities enable row level security;
alter table public.routes enable row level security;
alter table public.pins enable row level security;

insert into public.profile_devices (profile_id, fingerprint, first_bound_at, last_seen_at)
select id, btrim(device_fingerprint), coalesce(device_bound_at, now()), now()
from public.profiles
where nullif(btrim(device_fingerprint), '') is not null
on conflict (profile_id, fingerprint) do nothing;

do $$
begin
  if exists (
    select 1
    from public.profiles p
    where nullif(btrim(p.device_fingerprint), '') is not null
      and not exists (
        select 1
        from public.profile_devices d
        where d.profile_id = p.id
          and d.fingerprint = btrim(p.device_fingerprint)
      )
  ) then
    raise exception 'A legacy device binding was not copied to profile_devices; migration aborted';
  end if;
end;
$$;

create or replace function public.bind_device(fp text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  uid uuid := auth.uid();
  account_status text;
  account_plan text;
  expires_at timestamptz;
  slot_count integer;
  legacy_fp text;
  legacy_bound_at timestamptz;
  device_limit integer;
  registered_count integer;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if fp is null or length(btrim(fp)) < 8 or length(btrim(fp)) > 256 then
    raise exception 'Invalid device fingerprint';
  end if;

  select subscription_status, subscription_plan, subscription_expires_at,
         device_slots, device_fingerprint, device_bound_at
  into account_status, account_plan, expires_at, slot_count, legacy_fp, legacy_bound_at
  from public.profiles
  where id = uid
  for update;

  if not found then
    return jsonb_build_object(
      'status', 'blocked',
      'message', 'ანგარიშის ინფორმაცია ვერ მოიძებნა'
    );
  end if;

  if account_status = 'trial' and (expires_at is null or expires_at > now()) then
    device_limit := 1;
  elsif account_status = 'active' and (expires_at is null or expires_at > now()) then
    device_limit := case
      when account_plan = 'premium' then least(greatest(coalesce(slot_count, 1), 1), 2)
      else 1
    end;
  else
    return jsonb_build_object(
      'status', 'blocked',
      'message', 'წვდომის ვადა ამოიწურა'
    );
  end if;

  if nullif(btrim(legacy_fp), '') is not null then
    insert into public.profile_devices (profile_id, fingerprint, first_bound_at, last_seen_at)
    values (uid, btrim(legacy_fp), coalesce(legacy_bound_at, now()), now())
    on conflict (profile_id, fingerprint) do nothing;
  end if;

  select count(*) into registered_count
  from public.profile_devices
  where profile_id = uid;

  if exists (
    select 1
    from public.profile_devices
    where profile_id = uid and fingerprint = btrim(fp)
  ) then
    if registered_count > device_limit and not exists (
      select 1
      from (
        select fingerprint,
               row_number() over (order by first_bound_at, fingerprint) as slot_number
        from public.profile_devices
        where profile_id = uid
      ) ranked_devices
      where ranked_devices.fingerprint = btrim(fp)
        and ranked_devices.slot_number <= device_limit
    ) then
      return jsonb_build_object(
        'status', 'blocked',
        'message', format('ამ ანგარიშზე დაშვებულია მაქსიმუმ %s მოწყობილობა', device_limit),
        'registered_devices', registered_count,
        'max_devices', device_limit
      );
    end if;

    update public.profile_devices
    set last_seen_at = now()
    where profile_id = uid and fingerprint = btrim(fp);

    return jsonb_build_object(
      'status', 'ok',
      'fingerprint', btrim(fp),
      'registered_devices', registered_count,
      'max_devices', device_limit
    );
  end if;

  if registered_count >= device_limit then
    return jsonb_build_object(
      'status', 'blocked',
      'message', format('ამ ანგარიშზე დაშვებულია მაქსიმუმ %s მოწყობილობა', device_limit),
      'registered_devices', registered_count,
      'max_devices', device_limit
    );
  end if;

  insert into public.profile_devices (profile_id, fingerprint)
  values (uid, btrim(fp));

  if nullif(btrim(legacy_fp), '') is null then
    update public.profiles
    set device_fingerprint = btrim(fp),
        device_bound_at = now()
    where id = uid;
  end if;

  return jsonb_build_object(
    'status', 'bound',
    'fingerprint', btrim(fp),
    'registered_devices', registered_count + 1,
    'max_devices', device_limit
  );
end;
$$;

revoke all on function public.bind_device(text) from public, anon;
grant execute on function public.bind_device(text) to authenticated;

create or replace function public.has_current_device_access()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
  with request_device as (
    select coalesce(
      nullif(current_setting('request.headers', true), '')::jsonb
        ->> 'x-cityroute-device-fingerprint',
      ''
    ) as fingerprint
  ),
  eligible_devices as (
    select d.fingerprint,
           row_number() over (order by d.first_bound_at, d.fingerprint) as slot_number,
           p.subscription_status,
           p.subscription_plan,
           p.subscription_expires_at,
           p.device_slots
    from public.profiles p
    join public.profile_devices d on d.profile_id = p.id
    where p.id = auth.uid()
  )
  select exists (
    select 1
    from eligible_devices d
    cross join request_device r
    where d.fingerprint = r.fingerprint
      and (
        (d.subscription_status = 'trial'
          and d.subscription_expires_at > pg_catalog.now()
          and d.slot_number = 1)
        or (
          d.subscription_status = 'active'
          and (d.subscription_expires_at is null
            or d.subscription_expires_at > pg_catalog.now())
          and d.slot_number <= case
            when d.subscription_plan = 'premium'
              then least(greatest(coalesce(d.device_slots, 1), 1), 2)
            else 1
          end
        )
      )
  );
$$;

revoke all on function public.has_current_device_access() from public, anon;
grant execute on function public.has_current_device_access() to authenticated;

drop policy if exists "cities_read_subscribed" on public.cities;
create policy "cities_read_subscribed"
  on public.cities for select
  using (public.has_active_access(auth.uid()) and public.has_current_device_access());

drop policy if exists "routes_read_subscribed" on public.routes;
create policy "routes_read_subscribed"
  on public.routes for select
  using (public.has_active_access(auth.uid()) and public.has_current_device_access());

drop policy if exists "pins_read_subscribed" on public.pins;
create policy "pins_read_subscribed"
  on public.pins for select
  using (public.has_active_access(auth.uid()) and public.has_current_device_access());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

revoke update on table public.profiles from public, anon, authenticated;
do $$
declare
  profile_column record;
begin
  for profile_column in
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
  loop
    execute format(
      'revoke update (%I) on table public.profiles from public, anon, authenticated',
      profile_column.column_name
    );
  end loop;
end;
$$;
grant update (full_name) on table public.profiles to authenticated;

commit;
