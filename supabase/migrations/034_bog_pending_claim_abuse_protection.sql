begin;

do $preflight$
begin
  if to_regprocedure('public.protect_trial_lifecycle()') is null
     or to_regprocedure('public.create_bog_pending_payment(uuid,text,text,uuid,numeric,integer,jsonb)') is null
     or to_regprocedure('public.bog_fixed_device_package_matches(integer,numeric,text)') is null
     or to_regprocedure('public.confirmed_bog_activation_matches(uuid,text,integer)') is null
     or to_regprocedure('public.update_payment_status(text,text,text,text,jsonb)') is null
     or to_regclass('public.payment_transactions') is null
     or to_regclass('public.device_slot_packages') is null
  then
    raise exception 'Migrations 0291, 032, and 033 must be applied before migration 034';
  end if;
end
$preflight$;

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

create or replace function public.create_bog_pending_payment(
  p_user_id uuid,
  p_payment_id text,
  p_merchant_payment_id text,
  p_idempotency_key uuid,
  p_amount numeric,
  p_device_slots integer,
  p_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_catalog_price integer;
  v_previous_create_setting text;
  v_phase text;
  v_existing public.payment_transactions%rowtype;
  v_active_claims integer;
  v_max_active_claims constant integer := 3;
begin
  if auth.role() is distinct from 'authenticated'
     or auth.uid() is distinct from p_user_id
  then
    raise exception 'Authenticated checkout user does not match pending BOG payment owner'
      using errcode = '42501';
  end if;

  if p_user_id is null
     or p_payment_id is null
     or p_payment_id = ''
     or p_merchant_payment_id is null
     or p_idempotency_key is null
     or p_amount is null
     or p_device_slots is null
     or pg_catalog.jsonb_typeof(p_metadata) is distinct from 'object'
     or p_metadata->>'provider' is distinct from 'bog'
     or p_metadata->>'device_slots' is distinct from p_device_slots::text
     or p_metadata->>'package_price' is distinct from p_amount::text
  then
    raise exception 'Invalid pending BOG payment identity or package'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_metadata) metadata_key
    where metadata_key not in (
      'provider', 'device_slots', 'package_price', 'checkout_phase',
      'claim_expires_at', 'client_request_ids', 'bank_call_started_at',
      'checkout_url', 'claim_payment_id', 'bank_payment_id'
    )
  ) then
    raise exception 'Pending BOG payment contains unsupported checkout metadata'
      using errcode = '22023';
  end if;

  select package.price_amount
    into v_catalog_price
    from public.device_slot_packages package
   where package.subscription_plan = 'premium'
     and package.device_slots = p_device_slots
     and package.currency = 'GEL'
     and package.active;

  if not found or p_amount <> v_catalog_price then
    raise exception 'Pending BOG payment does not match an active package'
      using errcode = '22023';
  end if;

  if p_merchant_payment_id is distinct from 'cr-' || p_idempotency_key then
    raise exception 'Pending BOG merchant ID does not match its idempotency key'
      using errcode = '22023';
  end if;

  v_phase := p_metadata->>'checkout_phase';
  if v_phase = 'claimed' then
    if p_payment_id is distinct from 'unissued:' || p_idempotency_key
       or p_metadata ?| array['checkout_url', 'claim_payment_id', 'bank_payment_id']
       or p_metadata ? 'bank_call_started_at'
       or p_metadata->>'claim_expires_at' is null
    then
      raise exception 'Invalid initial BOG checkout claim'
        using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(p_metadata->'client_request_ids') is distinct from 'array'
       or pg_catalog.jsonb_array_length(p_metadata->'client_request_ids') < 1
       or (p_metadata->>'claim_expires_at')::timestamptz <= pg_catalog.statement_timestamp()
       or (p_metadata->>'claim_expires_at')::timestamptz
         > pg_catalog.statement_timestamp() + interval '1 minute'
    then
      raise exception 'Invalid initial BOG checkout claim'
        using errcode = '22023';
    end if;
    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_metadata->'client_request_ids') request_id(value)
      where pg_catalog.jsonb_typeof(request_id.value) is distinct from 'string'
         or request_id.value #>> '{}' = ''
    ) then
      raise exception 'Initial BOG client request IDs must be non-empty strings'
        using errcode = '22023';
    end if;
  elsif v_phase is null then
    if p_payment_id like 'unissued:%'
       or coalesce(p_metadata->>'checkout_url', '') !~ '^https://payment[.]bog[.]ge(/|$)'
       or p_metadata ?| array['claim_payment_id', 'bank_payment_id']
       or p_metadata ?| array['claim_expires_at', 'bank_call_started_at', 'client_request_ids']
    then
      raise exception 'Invalid completed BOG checkout row'
        using errcode = '22023';
    end if;
  else
    raise exception 'Unsupported initial BOG checkout phase'
      using errcode = '22023';
  end if;

  if p_metadata ?| array[
    'bank_status', 'bank_amount', 'bank_refund_amount', 'bank_currency',
    'bank_external_order_id', 'verified_at'
  ] then
    raise exception 'Pending BOG payment cannot contain bank receipt metadata'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bog_pending:' || p_user_id::text, 0)
  );

  select transaction.*
    into v_existing
    from public.payment_transactions transaction
   where transaction.provider = 'bog'
     and transaction.user_id = p_user_id
     and transaction.idempotency_key = p_idempotency_key
   for update;

  if found then
    if v_existing.status not in ('pending', 'processing')
       or v_existing.payment_id is distinct from p_payment_id
       or v_existing.merchant_payment_id is distinct from p_merchant_payment_id
       or v_existing.amount is distinct from p_amount
       or v_existing.currency is distinct from 'GEL'
       or v_existing.metadata->>'device_slots' is distinct from p_device_slots::text
       or v_existing.metadata->>'package_price' is distinct from p_amount::text
    then
      raise exception 'BOG idempotency key is already bound to another payment attempt'
        using errcode = '23505';
    end if;
    return;
  end if;

  select pg_catalog.count(*)
    into v_active_claims
    from public.payment_transactions transaction
   where transaction.provider = 'bog'
     and transaction.user_id = p_user_id
     and transaction.status in ('pending', 'processing')
     and (
       transaction.status = 'processing'
       or transaction.metadata->>'checkout_phase' is distinct from 'claimed'
       or coalesce(
         (transaction.metadata->>'claim_expires_at')::timestamptz,
         'infinity'::timestamptz
       ) > pg_catalog.statement_timestamp()
     );

  if v_active_claims >= v_max_active_claims then
    raise exception 'Too many active BOG checkout attempts'
      using errcode = 'P0001';
  end if;

  v_previous_create_setting :=
    pg_catalog.current_setting('cityroute.bog_payment_create', true);
  perform pg_catalog.set_config('cityroute.bog_payment_create', 'on', true);
  insert into public.payment_transactions (
    user_id, provider, payment_id, merchant_payment_id, idempotency_key,
    amount, currency, status, metadata
  )
  values (
    p_user_id, 'bog', p_payment_id, p_merchant_payment_id, p_idempotency_key,
    p_amount, 'GEL', 'pending', p_metadata
  );
  perform pg_catalog.set_config(
    'cityroute.bog_payment_create',
    coalesce(v_previous_create_setting, 'off'),
    true
  );
end;
$$;

revoke all on function public.protect_trial_lifecycle()
  from public, anon, authenticated, service_role;
revoke all on function public.create_bog_pending_payment(uuid, text, text, uuid, numeric, integer, jsonb)
  from public, anon, authenticated, service_role, cityroute_bog_confirmer;
grant execute on function public.create_bog_pending_payment(uuid, text, text, uuid, numeric, integer, jsonb)
  to authenticated;

comment on function public.create_bog_pending_payment(uuid, text, text, uuid, numeric, integer, jsonb) is
  'Creates only an authenticated user-owned pending claim; serializes per user and caps active claims at three.';

commit;
