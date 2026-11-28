begin;

do $preflight$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.payment_transactions') is null
     or to_regclass('public.profile_active_sessions') is null
     or to_regclass('public.profile_revoked_sessions') is null
     or to_regclass('public.device_slot_packages') is null
     or to_regprocedure('public.current_device_session_limit(uuid)') is null
     or to_regprocedure('public.update_bog_payment_status(text, text, text, jsonb)') is null
     or to_regprocedure('public.update_payment_status(text, text, text, text, jsonb)') is null
     or to_regprocedure('public.activate_current_session()') is null
     or to_regprocedure('public.deactivate_current_session()') is null
  then
    raise exception 'Migrations 020, 023, 026, 027, and 0291 are required before migration 032';
  end if;

  if not exists (
    select 1
    from public.device_slot_packages package
    where package.subscription_plan = 'premium'
      and package.device_slots = 1
      and package.price_amount = 99
      and package.currency = 'GEL'
      and package.active
  ) or not exists (
    select 1
    from public.device_slot_packages package
    where package.subscription_plan = 'premium'
      and package.device_slots = 2
      and package.price_amount = 179
      and package.currency = 'GEL'
      and package.active
  ) then
    raise exception 'The active fixed BOG package catalog from migration 0291 is required';
  end if;
end
$preflight$;

create or replace function public.bog_fixed_device_package_matches(
  p_device_slots integer,
  p_amount numeric,
  p_package_price text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $package$
  select p_device_slots is not null
     and p_amount is not null
     and exists (
       select 1
       from public.device_slot_packages package
       where package.subscription_plan = 'premium'
         and package.device_slots = p_device_slots
         and package.price_amount = p_amount
         and package.currency = 'GEL'
         and package.active
         and (
           p_package_price is null
           or case
             when p_package_price ~ '^[1-9][0-9]*$'
               then p_package_price = package.price_amount::text
             else false
           end
         )
     );
$package$;

revoke all on function public.bog_fixed_device_package_matches(integer, numeric, text)
  from public, anon, authenticated, service_role;

create or replace function public.confirmed_bog_activation_matches(
  p_profile_id uuid,
  p_payment_id text,
  p_device_slots integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $matches$
declare
  v_match boolean := false;
begin
  select exists (
    select 1
    from public.payment_transactions payment
    where payment.provider = 'bog'
      and payment.payment_id = p_payment_id
      and payment.user_id = p_profile_id
      and payment.status = 'success'
      and payment.currency = 'GEL'
      and payment.paid_at is not null
      and case
        when payment.metadata->>'device_slots' ~ '^[1-9][0-9]{0,2}$'
          then (payment.metadata->>'device_slots')::integer = p_device_slots
        else false
      end
      and public.bog_fixed_device_package_matches(
        p_device_slots,
        payment.amount,
        payment.metadata->>'package_price'
      )
  )
  into v_match;
  return v_match;
end;
$matches$;

revoke all on function public.confirmed_bog_activation_matches(uuid, text, integer)
  from public, anon, authenticated, service_role;

do $grant_activation_match$
begin
  execute format(
    'grant execute on function public.confirmed_bog_activation_matches(uuid, text, integer) to %I',
    current_user
  );
end
$grant_activation_match$;

create or replace function public.protect_trial_lifecycle()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_bog_activation_owner boolean := false;
  v_tbc_activation_owner boolean := false;
  v_confirmed_bog_activation boolean := false;
  v_confirmed_tbc_activation boolean := false;
  v_confirmed_activation boolean := false;
  v_expiry_changed boolean := false;
  v_leaving_trial boolean := false;
  v_became_active boolean := false;
  v_became_premium boolean := false;
begin
  if tg_op = 'INSERT' then
    if new.subscription_status is distinct from 'trial'
       or new.subscription_plan is not null
       or new.subscription_payment_id is not null
       or new.device_slots is distinct from 1
    then
      raise exception 'a profile can be created only as a trial'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.trial_started_at is distinct from old.trial_started_at then
    raise exception 'trial_started_at cannot be changed'
      using errcode = '42501';
  end if;

  if old.subscription_status is distinct from 'trial'
     and new.subscription_status = 'trial'
  then
    raise exception 'trial cannot be restarted'
      using errcode = '42501';
  end if;

  v_expiry_changed := new.subscription_expires_at is distinct from old.subscription_expires_at;
  v_leaving_trial := old.subscription_status = 'trial'
    and new.subscription_status is distinct from 'trial';
  v_became_active := new.subscription_status = 'active'
    and old.subscription_status is distinct from 'active';
  v_became_premium := new.subscription_status = 'active'
    and new.subscription_plan = 'premium'
    and old.subscription_plan is distinct from 'premium';

  if v_expiry_changed
     or v_leaving_trial
     or v_became_active
     or v_became_premium
     or new.device_slots is distinct from old.device_slots
     or new.subscription_payment_id is distinct from old.subscription_payment_id
  then
    select exists (
      select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'update_bog_payment_status'
        and pg_catalog.pg_get_function_identity_arguments(p.oid)
          = 'p_payment_id text, p_status text, p_transaction_id text, p_metadata jsonb'
        and p.prosecdef
        and pg_catalog.pg_get_userbyid(p.proowner) = current_user
    )
    into v_bog_activation_owner;

    v_confirmed_bog_activation := false;
    if pg_catalog.current_setting('cityroute.premium_activation', true) is not distinct from 'on'
       and v_bog_activation_owner
       and new.subscription_status is not distinct from 'active'
       and new.subscription_plan is not distinct from 'premium'
    then
      v_confirmed_bog_activation := public.confirmed_bog_activation_matches(
        new.id,
        new.subscription_payment_id,
        new.device_slots
      );
    end if;

    select exists (
      select 1
      from pg_catalog.pg_proc p
      where p.oid = 'public.update_payment_status(text, text, text, text, jsonb)'::regprocedure
        and p.prosecdef
        and pg_catalog.pg_get_userbyid(p.proowner) = current_user
    )
    into v_tbc_activation_owner;

    if v_tbc_activation_owner
       and new.subscription_status is not distinct from 'active'
       and new.subscription_plan is not distinct from 'premium'
       and new.subscription_expires_at is not distinct from
           pg_catalog.transaction_timestamp() + interval '30 days'
       and new.device_slots is not distinct from old.device_slots
       and new.subscription_payment_id is not distinct from old.subscription_payment_id
    then
      select exists (
        select 1
        from public.payment_transactions payment
        where payment.user_id = new.id
          and payment.provider = 'tbc'
          and payment.status = 'success'
          and payment.paid_at = pg_catalog.transaction_timestamp()
          and payment.updated_at = pg_catalog.transaction_timestamp()
      )
      into v_confirmed_tbc_activation;
    end if;

    v_confirmed_activation := v_confirmed_bog_activation
      or v_confirmed_tbc_activation;

    if v_expiry_changed and not v_confirmed_activation then
      raise exception 'subscription expiry can change only during confirmed premium activation'
        using errcode = '42501';
    end if;

    if (v_leaving_trial or v_became_active or v_became_premium)
       and not (v_confirmed_activation and v_expiry_changed)
    then
      raise exception 'premium activation requires a confirmed BOG payment'
        using errcode = '42501';
    end if;

    if (new.device_slots is distinct from old.device_slots
        or new.subscription_payment_id is distinct from old.subscription_payment_id)
       and not v_confirmed_activation
    then
      raise exception 'device slots and payment reference can change only during confirmed premium activation'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.protect_trial_lifecycle()
  from public, anon, authenticated, service_role;

drop trigger if exists profiles_protect_trial_lifecycle on public.profiles;
create trigger profiles_protect_trial_lifecycle
  before update on public.profiles
  for each row execute function public.protect_trial_lifecycle();

drop trigger if exists profiles_protect_trial_birth on public.profiles;
create trigger profiles_protect_trial_birth
  before insert on public.profiles
  for each row execute function public.protect_trial_lifecycle();

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
  v_bank_amount numeric;
  v_refund_amount numeric;
  v_previous_refund_amount numeric;
  v_bank_status text;
  v_expected_status text;
  v_limit_before integer;
  v_limit_after integer;
  v_profile_updated boolean;
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
    perform pg_catalog.set_config('cityroute.bog_payment_write', 'on', true);
    update public.payment_transactions
       set transaction_id = coalesce(p_transaction_id, transaction_id),
           metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
           updated_at = pg_catalog.now()
     where provider = 'bog' and payment_id = p_payment_id;
    perform pg_catalog.set_config('cityroute.bog_payment_write', 'off', true);
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
    if not public.bog_fixed_device_package_matches(
      v_device_slots,
      v_amount,
      v_metadata->>'package_price'
    ) then
      raise exception 'BOG amount and device package must match an active fixed package';
    end if;
  end if;

  perform pg_catalog.set_config('cityroute.bog_payment_write', 'on', true);
  update public.payment_transactions
     set status = p_status,
         transaction_id = coalesce(p_transaction_id, transaction_id),
         metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
         paid_at = case when p_status = 'success' then coalesce(paid_at, pg_catalog.now()) else paid_at end,
         updated_at = pg_catalog.now()
   where provider = 'bog' and payment_id = p_payment_id;
  perform pg_catalog.set_config('cityroute.bog_payment_write', 'off', true);

  if p_status = 'success' then
    perform 1
    from public.profiles profile
    where profile.id = v_user_id
    for update;

    if not found then
      raise exception 'Profile for BOG payment owner was not found';
    end if;

    v_limit_before := public.current_device_session_limit(v_user_id);

    perform pg_catalog.set_config('cityroute.premium_activation', 'on', true);
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
    v_profile_updated := found;
    perform pg_catalog.set_config('cityroute.premium_activation', 'off', true);

    if not v_profile_updated then
      raise exception 'Profile for BOG payment owner was not found';
    end if;

    v_limit_after := public.current_device_session_limit(v_user_id);
    if v_limit_after < v_limit_before then
      with ranked_sessions as (
        select active.session_id,
               pg_catalog.row_number() over (
                 order by active.activated_at, active.session_created_at, active.session_id
               ) as slot_number
        from public.profile_active_sessions active
        join auth.sessions s
          on s.id = active.session_id
         and s.user_id = active.profile_id
        where active.profile_id = v_user_id
          and active.device_fingerprint is not null
          and (s.not_after is null or s.not_after > pg_catalog.now())
          and not exists (
            select 1
            from public.profile_revoked_sessions revoked
            where revoked.profile_id = active.profile_id
              and revoked.session_id = active.session_id
          )
      ),
      removed as (
        insert into public.profile_revoked_sessions (profile_id, session_id)
        select v_user_id, ranked_sessions.session_id
        from ranked_sessions
        where ranked_sessions.slot_number > v_limit_after
        on conflict (profile_id, session_id) do nothing
        returning session_id
      )
      delete from public.profile_active_sessions active
      where active.profile_id = v_user_id
        and active.session_id in (select removed.session_id from removed);
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
