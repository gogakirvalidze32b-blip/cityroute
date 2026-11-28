begin;

do $preflight$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.payment_transactions') is null
     or to_regclass('public.device_session_limit_overrides') is null
     or to_regprocedure('public.set_updated_at()') is null
     or to_regprocedure('public.current_device_session_limit(uuid)') is null
     or to_regprocedure('public.current_verified_premium_device_slots(uuid)') is null
     or to_regprocedure('public.verified_device_slot_limit(uuid)') is null
     or to_regprocedure('public.grant_device_session_limit_override(uuid, text)') is null
     or to_regprocedure('public.revoke_device_session_limit_override(bigint, text)') is null
     or to_regprocedure('public.update_bog_payment_status(text, text, text, jsonb)') is null
  then
    raise exception 'Migrations 020, 021, and 022 are required before dynamic device limits';
  end if;
end
$preflight$;

create table public.device_slot_packages (
  subscription_plan text not null,
  device_slots integer not null check (device_slots between 1 and 100),
  price_amount integer not null check (price_amount > 0),
  currency text not null default 'GEL' check (currency = 'GEL'),
  active boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (subscription_plan, device_slots)
);

comment on table public.device_slot_packages is
  'Editable checkout catalog. Package device counts and prices are read at order creation; successful orders retain their transaction snapshot.';

insert into public.device_slot_packages (
  subscription_plan, device_slots, price_amount, currency, active, sort_order
)
values
  ('premium', 1, 99, 'GEL', true, 1),
  ('premium', 2, 179, 'GEL', true, 2)
on conflict (subscription_plan, device_slots) do nothing;

drop trigger if exists device_slot_packages_updated_at on public.device_slot_packages;
create trigger device_slot_packages_updated_at
  before update on public.device_slot_packages
  for each row execute function public.set_updated_at();

alter table public.device_slot_packages enable row level security;
alter table public.device_slot_packages force row level security;
revoke all on public.device_slot_packages from public, anon, authenticated;
grant select on public.device_slot_packages to anon, authenticated;
grant select on public.device_slot_packages to service_role;
create policy device_slot_packages_read_active
  on public.device_slot_packages for select
  to anon, authenticated
  using (active);

alter table public.profiles
  drop constraint if exists profiles_device_slots_check;

alter table public.profiles
  add constraint profiles_device_slots_range_check
  check (device_slots between 1 and 100);

alter table public.device_session_limit_overrides
  drop constraint if exists device_session_limit_overrides_session_limit_check;

alter table public.device_session_limit_overrides
  add constraint device_session_limit_overrides_range_check
  check (session_limit between 1 and 100);

create or replace function public.current_verified_premium_device_slots(p_profile_id uuid)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce((
    select case
      when transaction.provider = 'bog'
        and coalesce(transaction.metadata->>'device_slots', '') ~ '^[1-9][0-9]{0,2}$'
        and (transaction.metadata->>'device_slots')::integer between 1 and 100
        and (transaction.metadata->>'device_slots')::integer = profile.device_slots
      then (transaction.metadata->>'device_slots')::integer
      when transaction.provider = 'tbc'
        and case
          when coalesce(transaction.metadata->>'device_slots', '') ~ '^[1-9][0-9]{0,2}$'
          then (transaction.metadata->>'device_slots')::integer between 1 and 100
            and (transaction.metadata->>'device_slots')::integer = profile.device_slots
          else false
        end
        and case
          when coalesce(transaction.metadata->>'package_price', '') ~ '^[1-9][0-9]*$'
          then (transaction.metadata->>'package_price')::numeric = transaction.amount
          else false
        end
      then (transaction.metadata->>'device_slots')::integer
      when transaction.provider = 'tbc'
        and transaction.amount in (99, 179)
      then case when transaction.amount = 179 then 2 else 1 end
      else 0
    end
    from public.profiles profile
    join public.payment_transactions transaction
      on transaction.user_id = profile.id
     and transaction.payment_id = profile.subscription_payment_id
    where profile.id = p_profile_id
      and profile.subscription_status = 'active'
      and profile.subscription_plan in ('full', 'premium')
      and (profile.subscription_expires_at is null
        or profile.subscription_expires_at > pg_catalog.now())
      and transaction.status = 'success'
      and transaction.currency = 'GEL'
      and transaction.paid_at is not null
      and (
        (
          transaction.provider = 'bog'
          and coalesce(transaction.metadata->>'device_slots', '') ~ '^[1-9][0-9]{0,2}$'
          and (transaction.metadata->>'device_slots')::integer between 1 and 100
          and (transaction.metadata->>'device_slots')::integer = profile.device_slots
          and transaction.metadata->>'bank_status' = 'completed'
          and transaction.metadata->>'bank_currency' = 'GEL'
          and transaction.metadata->>'bank_external_order_id' = transaction.merchant_payment_id
          and coalesce(transaction.metadata->>'bank_amount', '') ~ '^[0-9]+(\.[0-9]+)?$'
          and (transaction.metadata->>'bank_amount')::numeric = transaction.amount
          and (
            transaction.metadata->>'package_price' is null
            or (
              transaction.metadata->>'package_price' ~ '^[1-9][0-9]*$'
              and (transaction.metadata->>'package_price')::numeric = transaction.amount
            )
          )
        )
        or (
          transaction.provider = 'tbc'
          and case
            when coalesce(transaction.metadata->>'device_slots', '') ~ '^[1-9][0-9]{0,2}$'
            then (transaction.metadata->>'device_slots')::integer between 1 and 100
              and (transaction.metadata->>'device_slots')::integer = profile.device_slots
            else false
          end
          and case
            when coalesce(transaction.metadata->>'package_price', '') ~ '^[1-9][0-9]*$'
            then (transaction.metadata->>'package_price')::numeric = transaction.amount
            else false
          end
        )
        or (
          transaction.provider = 'tbc'
          and transaction.amount in (99, 179)
        )
      )
    order by case when transaction.provider = 'bog' then 0 else 1 end
    limit 1
  ), 0);
$$;

revoke all on function public.current_verified_premium_device_slots(uuid)
  from public, anon, authenticated;

create or replace function public.current_device_session_limit(p_profile_id uuid)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce((
    select coalesce(
      (
        select active_override.session_limit
        from public.device_session_limit_overrides active_override
        where active_override.profile_id = profile.id
          and active_override.revoked_at is null
        limit 1
      ),
      nullif(public.current_verified_premium_device_slots(profile.id), 0),
      case
        when profile.subscription_status = 'active'
          and profile.subscription_payment_id is null
          and (profile.subscription_expires_at is null
            or profile.subscription_expires_at > pg_catalog.now())
        then profile.device_slots
        else 1
      end
    )
    from public.profiles profile
    where profile.id = p_profile_id
  ), 0);
$$;

revoke all on function public.current_device_session_limit(uuid)
  from public, anon, authenticated;

create or replace function public.verified_device_slot_limit(p_profile_id uuid)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.current_device_session_limit(p_profile_id);
$$;

revoke all on function public.verified_device_slot_limit(uuid)
  from public, anon, authenticated;

create or replace function public.grant_device_session_limit_override(
  p_profile_id uuid,
  p_reason text,
  p_session_limit integer
)
returns table (override_id bigint, granted_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null or not public.is_support_admin() then
    raise exception 'Only an active support admin may grant session overrides'
      using errcode = '42501';
  end if;

  if p_profile_id is null
     or p_reason is null
     or pg_catalog.length(pg_catalog.btrim(p_reason)) not between 5 and 500
     or p_session_limit is null
     or p_session_limit not between 1 and 100
  then
    raise exception 'Provide a target profile, reason (5-500 characters), and limit (1-100)'
      using errcode = '22023';
  end if;

  perform 1
  from public.profiles profile
  where profile.id = p_profile_id
  for update;
  if not found then
    raise exception 'Target profile does not exist'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.device_session_limit_overrides active_override
    where active_override.profile_id = p_profile_id
      and active_override.revoked_at is null
  ) then
    raise exception 'An active session override already exists; revoke it before granting another'
      using errcode = '23505';
  end if;

  return query
  insert into public.device_session_limit_overrides (
    profile_id, session_limit, granted_by, grant_reason
  )
  values (
    p_profile_id, p_session_limit, actor_id, pg_catalog.btrim(p_reason)
  )
  returning id, device_session_limit_overrides.granted_at;
end;
$$;

revoke all on function public.grant_device_session_limit_override(uuid, text, integer)
  from public, anon;
grant execute on function public.grant_device_session_limit_override(uuid, text, integer)
  to authenticated;

create or replace function public.grant_device_session_limit_override(
  p_profile_id uuid,
  p_reason text
)
returns table (override_id bigint, granted_at timestamptz)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select *
  from public.grant_device_session_limit_override(p_profile_id, p_reason, 2);
$$;

revoke all on function public.grant_device_session_limit_override(uuid, text)
  from public, anon;
grant execute on function public.grant_device_session_limit_override(uuid, text)
  to authenticated;

create or replace function public.get_device_session_limit_override(p_profile_id uuid)
returns table (
  override_id bigint,
  session_limit integer,
  granted_at timestamptz,
  grant_reason text
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.is_support_admin() then
    raise exception 'Only an active support admin may inspect session overrides'
      using errcode = '42501';
  end if;

  if p_profile_id is null then
    raise exception 'A target profile is required'
      using errcode = '22023';
  end if;

  return query
  select active_override.id, active_override.session_limit,
         active_override.granted_at, active_override.grant_reason
  from public.device_session_limit_overrides active_override
  where active_override.profile_id = p_profile_id
    and active_override.revoked_at is null;
end;
$$;

revoke all on function public.get_device_session_limit_override(uuid)
  from public, anon;
grant execute on function public.get_device_session_limit_override(uuid)
  to authenticated;

create or replace function public.update_bog_payment_status(
  p_payment_id text,
  p_status text,
  p_transaction_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid;
  v_amount numeric;
  v_currency text;
  v_current_status text;
  v_metadata jsonb;
  v_merchant_payment_id text;
  v_device_slots integer;
  v_package_price numeric;
  v_bank_amount numeric;
  v_refund_amount numeric;
  v_previous_refund_amount numeric;
  v_bank_status text;
  v_expected_status text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Only the service role can update BOG payment status';
  end if;

  if p_payment_id is null or p_payment_id = '' or p_status is null or p_status not in (
    'pending', 'processing', 'success', 'failed', 'cancelled',
    'refunded', 'refunded_partially'
  ) then
    raise exception 'Invalid BOG payment status update';
  end if;

  select user_id, amount, currency, status,
         coalesce(metadata, '{}'::jsonb), merchant_payment_id
    into v_user_id, v_amount, v_currency, v_current_status,
         v_metadata, v_merchant_payment_id
    from public.payment_transactions
   where provider = 'bog' and payment_id = p_payment_id
   for update;

  if not found then
    raise exception 'BOG payment transaction not found';
  end if;

  v_bank_status := p_metadata->>'bank_status';
  if v_bank_status is null
     or p_metadata->>'bank_external_order_id' is distinct from v_merchant_payment_id
     or p_metadata->>'bank_currency' is distinct from v_currency
     or coalesce(p_metadata->>'bank_amount', '') !~ '^[0-9]+(\.[0-9]+)?$'
  then
    raise exception 'Verified BOG receipt does not match the stored transaction';
  end if;

  v_bank_amount := (p_metadata->>'bank_amount')::numeric;
  if v_bank_amount <> v_amount then
    raise exception 'BOG receipt amount does not match the stored transaction';
  end if;

  v_expected_status := case v_bank_status
    when 'completed' then 'success'
    when 'rejected' then 'failed'
    when 'cancelled' then 'cancelled'
    when 'canceled' then 'cancelled'
    when 'refunded' then 'refunded'
    when 'refunded_partially' then 'refunded_partially'
    when 'created' then 'pending'
    when 'processing' then 'processing'
    when 'auth_requested' then 'processing'
    when 'blocked' then 'processing'
    when 'partial_completed' then 'processing'
    when 'refund_requested' then 'processing'
    else null
  end;
  if v_expected_status is null or p_status is distinct from v_expected_status then
    raise exception 'Payment status does not match the verified BOG receipt';
  end if;

  if v_bank_status in ('refunded', 'refunded_partially') then
    if coalesce(p_metadata->>'bank_refund_amount', '') !~ '^[0-9]+(\.[0-9]+)?$' then
      raise exception 'BOG refund amount is missing or invalid';
    end if;
    v_refund_amount := (p_metadata->>'bank_refund_amount')::numeric;
    if (v_bank_status = 'refunded' and v_refund_amount <> v_amount)
       or (v_bank_status = 'refunded_partially'
           and (v_refund_amount <= 0 or v_refund_amount >= v_amount))
    then
      raise exception 'BOG refund amount does not match the refund status';
    end if;
  end if;

  if v_current_status = p_status and p_status <> 'refunded_partially' then
    return pg_catalog.jsonb_build_object(
      'success', true, 'status', v_current_status, 'duplicate_or_stale', true
    );
  end if;

  if v_current_status = 'refunded_partially' and p_status = 'refunded_partially' then
    if coalesce(v_metadata->>'bank_refund_amount', '') !~ '^[0-9]+(\.[0-9]+)?$' then
      raise exception 'Stored partial refund amount is missing or invalid';
    end if;
    v_previous_refund_amount := (v_metadata->>'bank_refund_amount')::numeric;
    if v_refund_amount < v_previous_refund_amount then
      raise exception 'Cumulative partial refund amount cannot decrease';
    end if;
    if v_refund_amount = v_previous_refund_amount then
      return pg_catalog.jsonb_build_object(
        'success', true, 'status', v_current_status, 'duplicate_or_stale', true
      );
    end if;
    update public.payment_transactions
       set transaction_id = coalesce(p_transaction_id, transaction_id),
           metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
           updated_at = pg_catalog.now()
     where provider = 'bog' and payment_id = p_payment_id;
    return pg_catalog.jsonb_build_object(
      'success', true, 'status', p_status, 'duplicate_or_stale', false
    );
  end if;

  if not (
    (v_current_status = 'pending' and p_status in ('processing', 'success', 'failed', 'cancelled'))
    or (v_current_status = 'processing' and p_status in ('success', 'failed', 'cancelled'))
    or (v_current_status = 'success' and p_status in ('refunded', 'refunded_partially'))
    or (v_current_status = 'refunded_partially' and p_status = 'refunded')
  ) then
    raise exception 'Invalid BOG status transition: % -> %', v_current_status, p_status;
  end if;

  if p_status = 'success' then
    if v_currency <> 'GEL'
       or coalesce(v_metadata->>'device_slots', '') !~ '^[1-9][0-9]{0,2}$'
    then
      raise exception 'BOG amount or device package is invalid';
    end if;
    v_device_slots := (v_metadata->>'device_slots')::integer;
    if v_device_slots not between 1 and 100 then
      raise exception 'BOG device package is outside the supported range';
    end if;

    if v_metadata->>'package_price' is null then
      if (v_device_slots = 1 and v_amount <> 99)
         or (v_device_slots = 2 and v_amount <> 179)
         or v_device_slots not in (1, 2)
      then
        raise exception 'Legacy BOG amount does not match the selected package';
      end if;
    else
      if v_metadata->>'package_price' !~ '^[1-9][0-9]*$' then
        raise exception 'BOG package price snapshot is invalid';
      end if;
      v_package_price := (v_metadata->>'package_price')::numeric;
      if v_package_price <> v_amount then
        raise exception 'BOG amount does not match the selected package';
      end if;
    end if;
  end if;

  update public.payment_transactions
     set status = p_status,
         transaction_id = coalesce(p_transaction_id, transaction_id),
         metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
         paid_at = case when p_status = 'success' then coalesce(paid_at, pg_catalog.now()) else paid_at end,
         updated_at = pg_catalog.now()
   where provider = 'bog' and payment_id = p_payment_id;

  if p_status = 'success' then
    update public.profiles
       set subscription_status = 'active',
           subscription_plan = 'premium',
           device_slots = v_device_slots,
           subscription_payment_id = p_payment_id,
           subscription_expires_at = case
             when subscription_status = 'active' and subscription_expires_at > pg_catalog.now()
               then subscription_expires_at + interval '30 days'
             else pg_catalog.now() + interval '30 days'
           end,
           updated_at = pg_catalog.now()
     where id = v_user_id;
    if not found then
      raise exception 'Profile for BOG payment owner was not found';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'success', true,
    'status', p_status,
    'subscription_activated', p_status = 'success',
    'duplicate_or_stale', false
  );
end;
$$;

revoke execute on function public.update_bog_payment_status(text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_bog_payment_status(text, text, text, jsonb)
  to service_role;

commit;
