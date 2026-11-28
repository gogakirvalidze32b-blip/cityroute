-- 038: Driving-school (ავტოსკოლა) packages — fully isolated from individual Premium.
--
-- Isolation contract (verified by src/lib/driving-school-migration.test.ts):
--   * Does NOT alter, insert into, or replace anything used by the individual
--     1-car 99 GEL / 2-car 179 GEL packages: public.profiles,
--     public.device_slot_packages, public.payment_transactions,
--     public.device_session_limit_overrides, current_device_session_limit,
--     current_verified_premium_device_slots, create_bog_pending_payment,
--     update_bog_payment_status, has_active_access, select_subscription_plan.
--   * Only creates new driving_school_* tables and new driving_school RPCs.
--   * A school license does not grant route access yet; wiring it into access
--     checks (and Android device binding) is a later, separately reviewed step.
--
-- Apply: Preview Supabase project first (SQL editor or `supabase db push`),
-- never directly on Production without a separate review.

begin;

do $preflight$
begin
  if to_regprocedure('public.set_updated_at()') is null
     or to_regprocedure('public.is_support_admin()') is null
     or to_regprocedure('public.has_current_active_session()') is null
  then
    raise exception 'set_updated_at, is_support_admin and has_current_active_session are required';
  end if;

  -- F1: every driving_school table below uses FORCE ROW LEVEL SECURITY and has
  -- no write policies; all writes happen inside SECURITY DEFINER functions owned
  -- by the role running this migration. That role must bypass RLS (as checked
  -- for the helper owners in migration 028), otherwise every write RPC would
  -- silently be denied. Stop here with a clear error instead.
  if not exists (
    select 1
    from pg_catalog.pg_roles migration_role
    where migration_role.rolname = current_user
      and (migration_role.rolsuper or migration_role.rolbypassrls)
  ) then
    raise exception 'Migration 038 must run as a role with SUPERUSER or BYPASSRLS (current role: %); driving_school SECURITY DEFINER functions cannot write FORCE RLS tables otherwise', current_user;
  end if;

  if to_regclass('public.driving_schools') is not null
     or to_regclass('public.driving_school_packages') is not null
     or to_regclass('public.driving_school_licenses') is not null
     or to_regclass('public.driving_school_cars') is not null
  then
    raise exception 'driving_school tables already exist; inspect them before this migration';
  end if;
end
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. Schools: one owner account per school, one school per owner account.
-- ---------------------------------------------------------------------------
create table public.driving_schools (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 160),
  contact_name text not null check (char_length(btrim(contact_name)) between 2 and 120),
  contact_phone text not null check (contact_phone ~ '^\+?[0-9 ()-]{6,24}$'),
  contact_email text not null check (contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(contact_email) <= 254),
  address text not null check (char_length(btrim(address)) between 4 and 300),
  city text not null default 'თელავი' check (char_length(btrim(city)) between 2 and 80),
  registration_code text check (registration_code is null or registration_code ~ '^[0-9A-Za-z-]{5,20}$'),
  verification_info text not null default '' check (char_length(verification_info) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  submitted_at timestamptz not null default pg_catalog.now(),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint driving_schools_owner_unique unique (owner_id),
  constraint driving_schools_review_consistency check (
    (status = 'pending' and reviewed_at is null)
    or (status in ('approved', 'rejected') and reviewed_at is not null)
  )
);

comment on table public.driving_schools is
  'Driving-school applications (Pending/Approved/Rejected). Isolated from individual Premium profiles.';

create trigger driving_schools_updated_at
  before update on public.driving_schools
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. School package catalog (5 / 10 cars). Price NULL = "to be determined":
--    such a package is visible but never purchasable.
-- ---------------------------------------------------------------------------
create table public.driving_school_packages (
  car_count integer primary key check (car_count in (5, 10)),
  price_amount integer check (price_amount is null or price_amount between 1 and 100000),
  currency text not null default 'GEL' check (currency = 'GEL'),
  duration_days integer not null default 30 check (duration_days between 1 and 366),
  active boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default pg_catalog.now()
);

comment on table public.driving_school_packages is
  'Driving-school 5/10-car catalog. Separate from device_slot_packages (individual 99/179 GEL).';

insert into public.driving_school_packages (car_count, price_amount, currency, duration_days, active, sort_order)
values
  (5, null, 'GEL', 30, true, 1),
  (10, null, 'GEL', 30, true, 2);

create trigger driving_school_packages_updated_at
  before update on public.driving_school_packages
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. School licenses: strict car count, expiry, at most one active per school.
-- ---------------------------------------------------------------------------
create table public.driving_school_licenses (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.driving_schools (id) on delete cascade,
  car_count integer not null check (car_count in (5, 10)),
  status text not null default 'active' check (status in ('active', 'replaced', 'revoked')),
  source text not null check (source in ('admin', 'bog')),
  price_amount integer check (price_amount is null or price_amount >= 1),
  -- Reserved for a future dedicated school BOG flow; never shared with
  -- payment_transactions rows of individual packages.
  bog_payment_id text unique,
  starts_at timestamptz not null default pg_catalog.now(),
  expires_at timestamptz not null,
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint driving_school_licenses_period check (expires_at > starts_at),
  constraint driving_school_licenses_bog_payment check (source <> 'bog' or bog_payment_id is not null)
);

create unique index driving_school_licenses_one_active
  on public.driving_school_licenses (school_id)
  where status = 'active';

create trigger driving_school_licenses_updated_at
  before update on public.driving_school_licenses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Cars: one row per licensed car slot. Ready for Android device binding:
--    android_device_id is unique among active cars, so one device can never
--    hold two car licenses and one car license maps to one device at a time.
--    The owner can disable a car or release its device to replace it.
-- ---------------------------------------------------------------------------
create table public.driving_school_cars (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.driving_schools (id) on delete cascade,
  slot_number integer not null check (slot_number between 1 and 10),
  label text not null default '' check (char_length(label) <= 60),
  status text not null default 'active' check (status in ('active', 'disabled')),
  android_device_id text check (android_device_id is null or char_length(android_device_id) between 8 and 200),
  device_bound_at timestamptz,
  device_last_seen_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint driving_school_cars_slot_unique unique (school_id, slot_number),
  constraint driving_school_cars_device_consistency check (
    (android_device_id is null and device_bound_at is null)
    or (android_device_id is not null and device_bound_at is not null and status = 'active')
  )
);

create unique index driving_school_cars_one_device
  on public.driving_school_cars (android_device_id)
  where android_device_id is not null and status = 'active';

create trigger driving_school_cars_updated_at
  before update on public.driving_school_cars
  for each row execute function public.set_updated_at();

-- Active license helper (internal).
create or replace function public.driving_school_active_car_limit(p_school_id uuid)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce((
    select license.car_count
    from public.driving_school_licenses license
    join public.driving_schools school on school.id = license.school_id
    where license.school_id = p_school_id
      and license.status = 'active'
      and license.expires_at > pg_catalog.now()
      and school.status = 'approved'
    limit 1
  ), 0);
$$;

revoke all on function public.driving_school_active_car_limit(uuid)
  from public, anon, authenticated;

-- Strict car limit, enforced in the database even if an RPC is bypassed.
create or replace function public.enforce_driving_school_car_limit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_limit integer;
  v_active integer;
begin
  if new.status <> 'active' then
    return new;
  end if;

  -- F2: an UPDATE that keeps an already-active car active in the same slot and
  -- school adds no car (e.g. release_device, which only clears the device).
  -- It must work even after the license expired or was revoked. Inserts,
  -- disabled -> active and slot/school changes are still fully checked below.
  if tg_op = 'UPDATE'
     and old.status = 'active'
     and new.slot_number = old.slot_number
     and new.school_id = old.school_id
  then
    return new;
  end if;

  v_limit := public.driving_school_active_car_limit(new.school_id);
  if new.slot_number > v_limit then
    raise exception 'Car slot % exceeds the active driving-school license (% cars)', new.slot_number, v_limit
      using errcode = 'check_violation';
  end if;

  select count(*) into v_active
  from public.driving_school_cars car
  where car.school_id = new.school_id
    and car.status = 'active'
    and car.id <> new.id;

  if v_active + 1 > v_limit then
    raise exception 'Driving-school license allows only % active cars', v_limit
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_driving_school_car_limit()
  from public, anon, authenticated;

create trigger driving_school_cars_limit
  before insert or update of status, slot_number, school_id on public.driving_school_cars
  for each row execute function public.enforce_driving_school_car_limit();

-- ---------------------------------------------------------------------------
-- 5. Row level security: owners read their own rows; all writes go through RPCs.
-- ---------------------------------------------------------------------------
alter table public.driving_schools enable row level security;
alter table public.driving_schools force row level security;
alter table public.driving_school_packages enable row level security;
alter table public.driving_school_packages force row level security;
alter table public.driving_school_licenses enable row level security;
alter table public.driving_school_licenses force row level security;
alter table public.driving_school_cars enable row level security;
alter table public.driving_school_cars force row level security;

revoke all on public.driving_schools, public.driving_school_packages,
  public.driving_school_licenses, public.driving_school_cars
  from public, anon, authenticated;

grant select on public.driving_school_packages to anon, authenticated;
grant select on public.driving_schools, public.driving_school_licenses, public.driving_school_cars
  to authenticated;

create policy driving_school_packages_read_active
  on public.driving_school_packages for select to anon, authenticated
  using (active);

create policy driving_schools_read_own
  on public.driving_schools for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_support_admin()));

create policy driving_school_licenses_read_own
  on public.driving_school_licenses for select to authenticated
  using (
    exists (
      select 1 from public.driving_schools school
      where school.id = driving_school_licenses.school_id
        and school.owner_id = (select auth.uid())
    )
    or (select public.is_support_admin())
  );

create policy driving_school_cars_read_own
  on public.driving_school_cars for select to authenticated
  using (
    exists (
      select 1 from public.driving_schools school
      where school.id = driving_school_cars.school_id
        and school.owner_id = (select auth.uid())
    )
    or (select public.is_support_admin())
  );

-- ---------------------------------------------------------------------------
-- 6. RPCs
-- ---------------------------------------------------------------------------

-- Submit or resubmit an application. Approved schools cannot be edited here
-- (changes after approval go through support), so an approval can never be
-- silently kept for different details.
create or replace function public.submit_driving_school_application(
  p_name text,
  p_contact_name text,
  p_contact_phone text,
  p_contact_email text,
  p_address text,
  p_city text,
  p_registration_code text,
  p_verification_info text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_existing public.driving_schools%rowtype;
  v_id uuid;
begin
  if v_uid is null or not public.has_current_active_session() then
    raise exception 'Sign in again to submit a driving-school application' using errcode = '42501';
  end if;

  select * into v_existing from public.driving_schools where owner_id = v_uid for update;

  if found and v_existing.status = 'approved' then
    raise exception 'Approved driving-school details can only be changed through support'
      using errcode = '42501';
  end if;

  if found then
    update public.driving_schools set
      name = btrim(p_name),
      contact_name = btrim(p_contact_name),
      contact_phone = btrim(p_contact_phone),
      contact_email = lower(btrim(p_contact_email)),
      address = btrim(p_address),
      city = coalesce(nullif(btrim(p_city), ''), 'თელავი'),
      registration_code = nullif(btrim(coalesce(p_registration_code, '')), ''),
      verification_info = btrim(coalesce(p_verification_info, '')),
      status = 'pending',
      review_note = null,
      reviewed_by = null,
      reviewed_at = null,
      submitted_at = pg_catalog.now()
    where id = v_existing.id
    returning id into v_id;
  else
    insert into public.driving_schools (
      owner_id, name, contact_name, contact_phone, contact_email,
      address, city, registration_code, verification_info
    ) values (
      v_uid, btrim(p_name), btrim(p_contact_name), btrim(p_contact_phone),
      lower(btrim(p_contact_email)), btrim(p_address),
      coalesce(nullif(btrim(p_city), ''), 'თელავი'),
      nullif(btrim(coalesce(p_registration_code, '')), ''),
      btrim(coalesce(p_verification_info, ''))
    )
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.submit_driving_school_application(text, text, text, text, text, text, text, text)
  from public, anon;
grant execute on function public.submit_driving_school_application(text, text, text, text, text, text, text, text)
  to authenticated;

-- Admin review (support admins only).
create or replace function public.admin_review_driving_school(
  p_school_id uuid,
  p_decision text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_support_admin() then
    raise exception 'Only support admins can review driving schools' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected' using errcode = '22023';
  end if;

  update public.driving_schools set
    status = p_decision,
    review_note = nullif(btrim(coalesce(p_note, '')), ''),
    reviewed_by = auth.uid(),
    reviewed_at = pg_catalog.now()
  where id = p_school_id;

  if not found then
    raise exception 'Driving school not found' using errcode = 'P0002';
  end if;

  -- A rejected school loses any active license and its cars stop counting.
  if p_decision = 'rejected' then
    update public.driving_school_licenses
      set status = 'revoked'
      where school_id = p_school_id and status = 'active';
  end if;
end;
$$;

revoke all on function public.admin_review_driving_school(uuid, text, text) from public, anon;
grant execute on function public.admin_review_driving_school(uuid, text, text) to authenticated;

-- Manual license grant (support admins) until a dedicated school payment flow exists.
create or replace function public.admin_grant_driving_school_license(
  p_school_id uuid,
  p_car_count integer,
  p_duration_days integer default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_package public.driving_school_packages%rowtype;
  v_status text;
  v_id uuid;
begin
  if not public.is_support_admin() then
    raise exception 'Only support admins can grant driving-school licenses' using errcode = '42501';
  end if;

  select status into v_status from public.driving_schools where id = p_school_id for update;
  if v_status is distinct from 'approved' then
    raise exception 'Only approved driving schools can receive a license' using errcode = '42501';
  end if;

  select * into v_package from public.driving_school_packages where car_count = p_car_count;
  if not found then
    raise exception 'Unknown driving-school package' using errcode = '22023';
  end if;

  update public.driving_school_licenses
    set status = 'replaced'
    where school_id = p_school_id and status = 'active';

  insert into public.driving_school_licenses (
    school_id, car_count, status, source, price_amount, starts_at, expires_at, granted_by
  ) values (
    p_school_id, p_car_count, 'active', 'admin', v_package.price_amount, pg_catalog.now(),
    pg_catalog.now() + make_interval(days => coalesce(p_duration_days, v_package.duration_days)),
    auth.uid()
  )
  returning id into v_id;

  -- Downgrade 10 -> 5: cars above the new limit are disabled, never deleted.
  update public.driving_school_cars set
    status = 'disabled', android_device_id = null, device_bound_at = null
  where school_id = p_school_id and slot_number > p_car_count and status = 'active';

  return v_id;
end;
$$;

revoke all on function public.admin_grant_driving_school_license(uuid, integer, integer) from public, anon;
grant execute on function public.admin_grant_driving_school_license(uuid, integer, integer) to authenticated;

-- Can the signed-in owner buy this package now? (approved + priced + active)
create or replace function public.driving_school_package_purchasable(p_car_count integer)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.driving_schools school
    join public.driving_school_packages package on package.car_count = p_car_count
    where school.owner_id = auth.uid()
      and school.status = 'approved'
      and package.active
      and package.price_amount is not null
  );
$$;

revoke all on function public.driving_school_package_purchasable(integer) from public, anon;
grant execute on function public.driving_school_package_purchasable(integer) to authenticated;

-- Owner: name/create a car in a licensed slot.
create or replace function public.owner_upsert_driving_school_car(
  p_slot_number integer,
  p_label text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_school_id uuid;
  v_id uuid;
begin
  if auth.uid() is null or not public.has_current_active_session() then
    raise exception 'Sign in again' using errcode = '42501';
  end if;
  select id into v_school_id from public.driving_schools
    where owner_id = auth.uid() and status = 'approved';
  if v_school_id is null then
    raise exception 'Only an approved driving-school owner can manage cars' using errcode = '42501';
  end if;

  insert into public.driving_school_cars (school_id, slot_number, label)
  values (v_school_id, p_slot_number, btrim(coalesce(p_label, '')))
  on conflict (school_id, slot_number)
    do update set label = excluded.label
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.owner_upsert_driving_school_car(integer, text) from public, anon;
grant execute on function public.owner_upsert_driving_school_car(integer, text) to authenticated;

-- Owner: disable/re-enable a car, or release its device so it can be replaced.
create or replace function public.owner_set_driving_school_car_status(
  p_car_id uuid,
  p_action text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not public.has_current_active_session() then
    raise exception 'Sign in again' using errcode = '42501';
  end if;
  if p_action not in ('disable', 'enable', 'release_device') then
    raise exception 'Unknown car action' using errcode = '22023';
  end if;

  if p_action = 'release_device' then
    -- F2: releasing a device only removes access, so the owner may do it with an
    -- expired/revoked license or a no-longer-approved school. The status column
    -- is not touched, so the car limit is unaffected.
    update public.driving_school_cars car set
      android_device_id = null,
      device_bound_at = null,
      device_last_seen_at = null
    from public.driving_schools school
    where car.id = p_car_id
      and school.id = car.school_id
      and school.owner_id = auth.uid();
  else
    update public.driving_school_cars car set
      status = case p_action when 'disable' then 'disabled' else 'active' end,
      android_device_id = null,
      device_bound_at = null,
      device_last_seen_at = case when p_action = 'enable' then car.device_last_seen_at else null end
    from public.driving_schools school
    where car.id = p_car_id
      and school.id = car.school_id
      and school.owner_id = auth.uid()
      and school.status = 'approved';
  end if;

  if not found then
    raise exception 'Car not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.owner_set_driving_school_car_status(uuid, text) from public, anon;
grant execute on function public.owner_set_driving_school_car_status(uuid, text) to authenticated;

-- F1 postflight: verify the real owner of every SECURITY DEFINER function
-- created above can bypass RLS (the owner may differ from current_user if a
-- default owner / event trigger reassigns it). Aborts the whole transaction.
do $postflight$
declare
  v_function text;
begin
  select definer.oid::regprocedure::text into v_function
  from pg_catalog.pg_proc definer
  join pg_catalog.pg_namespace namespace on namespace.oid = definer.pronamespace
  join pg_catalog.pg_roles owner_role on owner_role.oid = definer.proowner
  where namespace.nspname = 'public'
    and definer.prosecdef
    and definer.proname in (
      'driving_school_active_car_limit',
      'enforce_driving_school_car_limit',
      'submit_driving_school_application',
      'admin_review_driving_school',
      'admin_grant_driving_school_license',
      'driving_school_package_purchasable',
      'owner_upsert_driving_school_car',
      'owner_set_driving_school_car_status'
    )
    and not (owner_role.rolsuper or owner_role.rolbypassrls)
  limit 1;

  if v_function is not null then
    raise exception 'Owner of % must have SUPERUSER or BYPASSRLS to write FORCE RLS driving_school tables', v_function;
  end if;
end
$postflight$;

commit;
