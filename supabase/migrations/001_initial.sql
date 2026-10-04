-- CityRoute initial schema
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/tuylbbdhvfcobxynwtnt/sql

-- Extensions
create extension if not exists "pgcrypto";

-- Profiles (extends auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  trial_started_at timestamptz not null default now(),
  subscription_status text not null default 'trial'
    check (subscription_status in ('trial', 'active', 'expired', 'cancelled')),
  subscription_expires_at timestamptz not null default (now() + interval '24 hours'),
  device_fingerprint text,
  device_bound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Cities
create table if not exists public.cities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name_ka text not null,
  name_en text not null,
  center_lat double precision not null,
  center_lng double precision not null,
  zoom int not null default 14,
  active boolean not null default true,
  sort_order int not null default 0
);

-- Routes
create table if not exists public.routes (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.cities (id) on delete cascade,
  slug text not null,
  name_ka text not null,
  official_label text,
  polyline jsonb not null default '[]'::jsonb,
  sort_order int not null default 0,
  active boolean not null default true,
  unique (city_id, slug)
);

-- Pins
create table if not exists public.pins (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.routes (id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  radius_m double precision not null default 25,
  trigger_distance_m double precision not null default 45,
  instruction_ka text not null default '',
  audio_url text,
  sort_order int not null default 0,
  active boolean not null default true
);

-- Updated_at trigger
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- New user → 24h trial
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
    subscription_expires_at
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    now(),
    'trial',
    now() + interval '24 hours'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Access check
create or replace function public.has_active_access(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = uid
      and (
        (p.subscription_status = 'active'
          and (p.subscription_expires_at is null or p.subscription_expires_at > now()))
        or (p.subscription_status = 'trial' and p.subscription_expires_at > now())
      )
  );
$$;

-- Bind device (1 account = 1 car)
create or replace function public.bind_device(fp text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  current_fp text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if fp is null or length(trim(fp)) < 8 then
    raise exception 'Invalid device fingerprint';
  end if;

  select device_fingerprint into current_fp
  from public.profiles
  where id = uid
  for update;

  if current_fp is null then
    update public.profiles
    set device_fingerprint = fp,
        device_bound_at = now()
    where id = uid;
    return jsonb_build_object('status', 'bound', 'fingerprint', fp);
  end if;

  if current_fp = fp then
    return jsonb_build_object('status', 'ok', 'fingerprint', fp);
  end if;

  return jsonb_build_object('status', 'blocked', 'message', 'ეს ანგარიში სხვა მანქანაზეა მიბმული');
end;
$$;

-- RLS
alter table public.profiles enable row level security;
alter table public.cities enable row level security;
alter table public.routes enable row level security;
alter table public.pins enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "cities_read_subscribed" on public.cities;
create policy "cities_read_subscribed"
  on public.cities for select
  using (public.has_active_access(auth.uid()));

drop policy if exists "routes_read_subscribed" on public.routes;
create policy "routes_read_subscribed"
  on public.routes for select
  using (public.has_active_access(auth.uid()));

drop policy if exists "pins_read_subscribed" on public.pins;
create policy "pins_read_subscribed"
  on public.pins for select
  using (public.has_active_access(auth.uid()));

-- Seed Telavi
insert into public.cities (slug, name_ka, name_en, center_lat, center_lng, zoom, sort_order)
values ('telavi', 'თელავი', 'Telavi', 41.9167, 45.475, 14, 1)
on conflict (slug) do nothing;

-- Routes seed (coordinates approximate — fine-tune on map later)
with telavi as (select id from public.cities where slug = 'telavi')
insert into public.routes (city_id, slug, name_ka, official_label, sort_order, polyline)
select telavi.id, v.slug, v.name_ka, v.official_label, v.sort_order, v.polyline::jsonb
from telavi,
(values
  ('route-1', 'მარშრუტი 1', null, 1, '[[41.9194,45.4728],[41.9198,45.4745],[41.9185,45.4768],[41.9172,45.4785],[41.9160,45.4810],[41.9155,45.4845],[41.9165,45.4870],[41.9180,45.4855],[41.9190,45.4820],[41.9188,45.4780],[41.9175,45.4755],[41.9168,45.4735],[41.9194,45.4728]]'),
  ('route-2', 'მარშრუტი 2', null, 2, '[[41.9194,45.4728],[41.9205,45.4740],[41.9218,45.4770],[41.9225,45.4810],[41.9210,45.4840],[41.9185,45.4855],[41.9165,45.4840],[41.9158,45.4800],[41.9168,45.4765],[41.9178,45.4740],[41.9194,45.4728]]'),
  ('route-3', 'მარშრუტი 3', null, 3, '[[41.9194,45.4728],[41.9200,45.4710],[41.9195,45.4690],[41.9180,45.4685],[41.9165,45.4700],[41.9155,45.4730],[41.9160,45.4765],[41.9175,45.4790],[41.9190,45.4815],[41.9205,45.4835],[41.9215,45.4810],[41.9205,45.4775],[41.9194,45.4728]]'),
  ('route-4', 'მარშრუტი 4', null, 4, '[[41.9194,45.4728],[41.9188,45.4715],[41.9175,45.4705],[41.9168,45.4720],[41.9170,45.4750],[41.9180,45.4785],[41.9195,45.4820],[41.9208,45.4850],[41.9215,45.4825],[41.9200,45.4780],[41.9194,45.4728]]'),
  ('route-5', 'მარშრუტი 5', null, 5, '[[41.9194,45.4728],[41.9208,45.4735],[41.9220,45.4755],[41.9225,45.4785],[41.9215,45.4815],[41.9195,45.4820],[41.9178,45.4805],[41.9170,45.4775],[41.9175,45.4745],[41.9194,45.4728]]')
) as v(slug, name_ka, official_label, sort_order, polyline)
on conflict (city_id, slug) do update
  set name_ka = excluded.name_ka,
      official_label = excluded.official_label,
      polyline = excluded.polyline;

-- Placeholder pins for route 1 (add more via admin later)
with r as (select id from public.routes where slug = 'route-1')
insert into public.pins (route_id, lat, lng, instruction_ka, sort_order, trigger_distance_m)
select r.id, v.lat, v.lng, v.instruction_ka, v.sort_order, 45
from r,
(values
  (41.9194, 45.4728, 'დაწყება — მომსახურების სააგენტო', 1),
  (41.9185, 45.4768, 'მარჯვნივ შეუხვი', 2),
  (41.9160, 45.4810, 'გააგრძელე პირდაპირ', 3),
  (41.9190, 45.4820, 'მარცხნივ შეუხვი', 4),
  (41.9194, 45.4728, 'დასრულება — დაბრუნდი სააგენტოზე', 5)
) as v(lat, lng, instruction_ka, sort_order)
where not exists (select 1 from public.pins p where p.route_id = r.id limit 1);

-- Grants
grant usage on schema public to anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.cities, public.routes, public.pins to authenticated;
grant execute on function public.bind_device(text) to authenticated;
grant execute on function public.has_active_access(uuid) to authenticated;
