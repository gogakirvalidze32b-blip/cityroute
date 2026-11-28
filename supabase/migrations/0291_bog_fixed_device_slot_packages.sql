begin;

do $preflight$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.payment_transactions') is null
     or to_regprocedure('public.set_updated_at()') is null
     or to_regprocedure('public.current_device_session_limit(uuid)') is null
     or to_regprocedure('public.current_verified_premium_device_slots(uuid)') is null
     or to_regprocedure('public.update_bog_payment_status(text, text, text, jsonb)') is null
  then
    raise exception 'The existing verified BOG and device-session functions are required';
  end if;

  if to_regclass('public.device_slot_packages') is not null then
    raise exception 'public.device_slot_packages already exists; inspect it before this migration';
  end if;
end
$preflight$;

create table public.device_slot_packages (
  subscription_plan text not null,
  device_slots integer not null,
  price_amount integer not null,
  currency text not null default 'GEL',
  active boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default pg_catalog.now(),
  constraint device_slot_packages_pkey
    primary key (subscription_plan, device_slots),
  constraint device_slot_packages_fixed_bog_packages_check
    check (
      subscription_plan = 'premium'
      and currency = 'GEL'
      and (
        (device_slots = 1 and price_amount = 99)
        or (device_slots = 2 and price_amount = 179)
      )
    )
);

comment on table public.device_slot_packages is
  'BOG checkout catalog limited to the existing premium 99 GEL/1-device and 179 GEL/2-device packages.';

insert into public.device_slot_packages (
  subscription_plan, device_slots, price_amount, currency, active, sort_order
)
values
  ('premium', 1, 99, 'GEL', true, 1),
  ('premium', 2, 179, 'GEL', true, 2);

create trigger device_slot_packages_updated_at
  before update on public.device_slot_packages
  for each row execute function public.set_updated_at();

alter table public.device_slot_packages enable row level security;
alter table public.device_slot_packages force row level security;
revoke all on public.device_slot_packages from public, anon, authenticated, service_role;
grant select on public.device_slot_packages to anon, authenticated, service_role;

create policy device_slot_packages_read_active
  on public.device_slot_packages
  for select
  to anon, authenticated
  using (active);

commit;
