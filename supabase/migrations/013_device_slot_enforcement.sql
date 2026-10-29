begin;

do $$
begin
  if to_regclass('public.payment_transactions') is null
     or not exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'profiles'
         and column_name = 'subscription_payment_id'
     )
  then
    raise exception 'The BOG payment schema is missing; apply its migration before device enforcement';
  end if;

  if exists (
    select 1
    from public.profiles
    where nullif(btrim(device_fingerprint), '') is not null
      and length(btrim(device_fingerprint)) > 256
  ) then
    raise exception 'A legacy device fingerprint exceeds the supported length; inspect profiles before migrating';
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

create or replace function public.verified_device_slot_limit(p_profile_id uuid)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case when exists (
    select 1
    from public.profiles p
    join public.payment_transactions t
      on t.user_id = p.id
     and t.payment_id = p.subscription_payment_id
    where p.id = p_profile_id
      and t.provider = 'bog'
      and t.status = 'success'
      and t.currency = 'GEL'
      and t.amount = 179
      and t.metadata->>'provider' = 'bog'
      and t.metadata->>'device_slots' = '2'
  ) then 2 else 1 end;
$$;

revoke all on function public.verified_device_slot_limit(uuid) from public, anon, authenticated;

alter table public.profile_devices enable row level security;
revoke all on table public.profile_devices from public, anon, authenticated;

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
  expires_at timestamptz;
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

  select subscription_status, subscription_expires_at,
         device_fingerprint, device_bound_at
  into account_status, expires_at, legacy_fp, legacy_bound_at
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
    device_limit := public.verified_device_slot_limit(uid);
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
           p.subscription_expires_at,
           p.id as profile_id
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
          and (d.subscription_expires_at is null
            or d.subscription_expires_at > pg_catalog.now())
          and d.slot_number = 1)
        or (
          d.subscription_status = 'active'
          and (d.subscription_expires_at is null
            or d.subscription_expires_at > pg_catalog.now())
          and d.slot_number <= public.verified_device_slot_limit(d.profile_id)
        )
      )
  );
$$;

revoke all on function public.has_current_device_access() from public, anon;
grant execute on function public.has_current_device_access() to authenticated;

commit;
