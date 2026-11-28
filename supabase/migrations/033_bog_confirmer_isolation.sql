begin;

do $preflight$
begin
  if to_regprocedure('public.update_bog_payment_status(text, text, text, jsonb)') is null
     or to_regprocedure('public.protect_trial_lifecycle()') is null
     or to_regclass('public.payment_transactions') is null
     or to_regclass('public.payment_transactions_bog_merchant_payment_id') is null
     or to_regclass('public.payment_transactions_user_bog_idempotency_key') is null
     or to_regclass('public.device_slot_packages') is null
  then
    raise exception 'Migrations 011, 0291, and 032 must be applied before migration 033';
  end if;
end
$preflight$;

do $create_confirmer$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'cityroute_bog_confirmer') then
    create role cityroute_bog_confirmer nologin;
  end if;
end
$create_confirmer$;

comment on role cityroute_bog_confirmer is
  'JWT-only role that may call update_bog_payment_status after the Vercel BOG handler verified a live bank receipt. Not granted to service_role.';

-- PostgreSQL role membership is granted to named roles; PUBLIC is not a role
-- membership target. The confirmer's allowed membership is granted below.
do $grant_confirmer_switch$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticator') then
    execute 'grant cityroute_bog_confirmer to authenticator';
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'postgres') then
    execute 'grant cityroute_bog_confirmer to postgres';
  end if;
end
$grant_confirmer_switch$;

revoke cityroute_bog_confirmer from service_role;

create or replace function public.protect_bog_payment_settlement()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_confirmer_owner boolean := false;
  v_write_allowed boolean := false;
  v_old_meta jsonb;
  v_new_meta jsonb;
  v_key text;
  v_old_phase text;
  v_new_phase text;
  v_checkout_payment_id_handoff boolean := false;
  v_handoff_already_done boolean := false;
  v_checkout_insert_owner boolean := false;
  v_checkout_insert_allowed boolean := false;
  v_old_request_ids jsonb;
  v_new_request_ids jsonb;
  v_old_request_count integer;
  v_new_request_count integer;
  v_request_index integer;
begin
  -- GUC alone is not enough: any SQL session can set_config().
  -- Settlement writes are allowed only when the SECURITY DEFINER owner of
  -- update_bog_payment_status is the current DB role AND the GUC is on.
  select exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'update_bog_payment_status'
      and pg_catalog.pg_get_function_identity_arguments(p.oid)
        = 'p_payment_id text, p_status text, p_transaction_id text, p_metadata jsonb'
      and pg_catalog.pg_get_userbyid(p.proowner) = current_user
  )
  into v_confirmer_owner;

  v_write_allowed := v_confirmer_owner
    and pg_catalog.current_setting('cityroute.bog_payment_write', true)
      is not distinct from 'on';

  select exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure(
      'public.create_bog_pending_payment(uuid,text,text,uuid,numeric,integer,jsonb)'
    )
      and pg_catalog.pg_get_userbyid(p.proowner) = current_user
  )
  into v_checkout_insert_owner;

  v_checkout_insert_allowed := v_checkout_insert_owner
    and pg_catalog.current_setting('cityroute.bog_payment_create', true)
      is not distinct from 'on';

  if tg_op = 'INSERT' then
    if new.provider is not distinct from 'bog'
       and (
         new.status is distinct from 'pending'
         or not v_checkout_insert_allowed
       )
    then
      raise exception 'BOG payment rows may be inserted only through the BOG checkout claim function'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if old.provider is distinct from 'bog' and new.provider is distinct from 'bog' then
    return new;
  end if;

  v_old_meta := coalesce(old.metadata, '{}'::jsonb);
  v_new_meta := coalesce(new.metadata, '{}'::jsonb);
  v_old_phase := v_old_meta->>'checkout_phase';
  v_new_phase := v_new_meta->>'checkout_phase';
  v_old_request_ids := coalesce(v_old_meta->'client_request_ids', '[]'::jsonb);
  v_new_request_ids := coalesce(v_new_meta->'client_request_ids', '[]'::jsonb);
  v_handoff_already_done :=
    v_old_phase is not distinct from 'ready'
    or v_old_meta ? 'claim_payment_id'
    or v_old_meta ? 'bank_payment_id';

  -- Pending identity fields must stay fixed so service_role cannot retarget a
  -- real BOG receipt onto another user/amount/package before verification.
  if not v_write_allowed
     and (
       new.user_id is distinct from old.user_id
       or new.amount is distinct from old.amount
       or new.currency is distinct from old.currency
       or new.merchant_payment_id is distinct from old.merchant_payment_id
       or new.provider is distinct from old.provider
       or new.idempotency_key is distinct from old.idempotency_key
       or (v_new_meta->>'device_slots') is distinct from (v_old_meta->>'device_slots')
       or (v_new_meta->>'package_price') is distinct from (v_old_meta->>'package_price')
       or (v_new_meta->>'provider') is distinct from (v_old_meta->>'provider')
     )
  then
    raise exception 'BOG payment identity fields are immutable outside the confirmer write path'
      using errcode = '42501';
  end if;

  -- One-time payment_id handoff: pending bank_call -> ready only.
  -- claim_payment_id must equal the pre-handoff payment_id;
  -- bank_payment_id must equal the post-handoff payment_id.
  if not v_write_allowed then
    v_checkout_payment_id_handoff :=
      new.payment_id is distinct from old.payment_id
      and not v_handoff_already_done
      and old.status is not distinct from 'pending'
      and new.status is not distinct from 'pending'
      and v_old_phase is not distinct from 'bank_call'
      and v_new_phase is not distinct from 'ready'
      and v_new_meta->>'claim_payment_id' is not distinct from old.payment_id
      and v_new_meta->>'bank_payment_id' is not distinct from new.payment_id
      and new.payment_id is not null
      and new.payment_id <> '';

    if new.payment_id is distinct from old.payment_id and not v_checkout_payment_id_handoff then
      raise exception 'BOG payment_id can change only during checkout bank_call to ready handoff'
        using errcode = '42501';
    end if;

    if v_handoff_already_done
       and (
         new.payment_id is distinct from old.payment_id
         or v_new_phase is distinct from v_old_phase
         or (v_new_meta->>'claim_payment_id') is distinct from (v_old_meta->>'claim_payment_id')
         or (v_new_meta->>'bank_payment_id') is distinct from (v_old_meta->>'bank_payment_id')
         or (v_new_meta->>'checkout_url') is distinct from (v_old_meta->>'checkout_url')
       )
    then
      raise exception 'BOG checkout handoff fields are immutable after ready'
        using errcode = '42501';
    end if;

    if (v_new_meta->>'claim_expires_at') is distinct from (v_old_meta->>'claim_expires_at')
         and not (
           old.status = 'pending'
           and new.status = 'pending'
           and v_old_phase = 'claimed'
           and v_new_phase = 'claimed'
           and new.payment_id is not distinct from old.payment_id
           and (v_old_meta->>'claim_expires_at') is not null
           and (v_old_meta->>'claim_expires_at')::timestamptz <= pg_catalog.statement_timestamp()
           and (v_new_meta->>'claim_expires_at')::timestamptz > pg_catalog.statement_timestamp()
           and (v_new_meta->>'claim_expires_at')::timestamptz
             <= pg_catalog.statement_timestamp() + interval '1 minute'
         )
    then
        raise exception 'BOG claim expiry may be renewed only for an expired pending claim'
          using errcode = '42501';
    end if;

    if (v_new_meta->>'bank_call_started_at') is distinct from (v_old_meta->>'bank_call_started_at')
         and not (
           old.status = 'pending'
           and new.status = 'pending'
           and v_old_phase = 'claimed'
           and v_new_phase = 'bank_call'
           and (v_old_meta->>'bank_call_started_at') is null
           and (v_new_meta->>'bank_call_started_at') is not null
           and (v_new_meta->>'bank_call_started_at')::timestamptz
             between pg_catalog.statement_timestamp() - interval '1 minute'
                 and pg_catalog.statement_timestamp() + interval '5 seconds'
         )
    then
        raise exception 'BOG bank call timestamp may be set only when a pending claim enters bank_call'
          using errcode = '42501';
    end if;

    if (v_new_meta->>'checkout_url') is distinct from (v_old_meta->>'checkout_url')
         and not v_checkout_payment_id_handoff
    then
        raise exception 'BOG checkout URL may change only during the bank_call to ready handoff'
          using errcode = '42501';
    end if;

    if v_new_request_ids is distinct from v_old_request_ids then
        if old.status not in ('pending', 'processing')
           or new.status not in ('pending', 'processing')
           or pg_catalog.jsonb_typeof(v_old_request_ids) is distinct from 'array'
           or pg_catalog.jsonb_typeof(v_new_request_ids) is distinct from 'array'
        then
          raise exception 'BOG client request IDs may be appended only while checkout is open'
            using errcode = '42501';
        end if;

        v_old_request_count := pg_catalog.jsonb_array_length(v_old_request_ids);
        v_new_request_count := pg_catalog.jsonb_array_length(v_new_request_ids);
        if v_new_request_count <= v_old_request_count then
          raise exception 'BOG client request IDs are append-only'
            using errcode = '42501';
        end if;

        for v_request_index in 0..v_old_request_count - 1
        loop
          if (v_new_request_ids->v_request_index)
            is distinct from (v_old_request_ids->v_request_index)
          then
            raise exception 'BOG client request IDs are append-only'
              using errcode = '42501';
          end if;
        end loop;

        if exists (
          select 1
          from pg_catalog.jsonb_array_elements(v_new_request_ids) request_id(value)
          where pg_catalog.jsonb_typeof(request_id.value) is distinct from 'string'
            or request_id.value #>> '{}' = ''
        )
        then
          raise exception 'BOG client request IDs must be non-empty strings'
            using errcode = '42501';
        end if;
    end if;

    if not v_checkout_payment_id_handoff
         and (
         (v_new_meta->>'claim_payment_id') is distinct from (v_old_meta->>'claim_payment_id')
         or (v_new_meta->>'bank_payment_id') is distinct from (v_old_meta->>'bank_payment_id')
         or (v_new_phase is distinct from v_old_phase
             and not (
               (v_old_phase is not distinct from 'claimed' and v_new_phase is not distinct from 'bank_call')
             ))
       )
    then
      raise exception 'BOG checkout handoff metadata can change only during the bank_call to ready handoff'
        using errcode = '42501';
    end if;
  end if;

  if new.status is distinct from old.status and not v_write_allowed then
    raise exception 'BOG payment status can change only through the confirmer write path'
      using errcode = '42501';
  end if;

  -- Column-level settlement markers (metadata bank_* are covered by the key loop).
  if not v_write_allowed
     and (
       new.paid_at is distinct from old.paid_at
       or new.transaction_id is distinct from old.transaction_id
     )
  then
    raise exception 'BOG bank receipt fields can change only through the confirmer write path'
      using errcode = '42501';
  end if;

  -- Outside the confirmer write path, only checkout orchestration keys may change.
  -- bank_* and any other settlement/identity metadata keys are rejected here.
  if not v_write_allowed then
    for v_key in
      select distinct key_name
      from (
        select pg_catalog.jsonb_object_keys(v_old_meta) as key_name
        union
        select pg_catalog.jsonb_object_keys(v_new_meta) as key_name
      ) keys
    loop
      if (v_new_meta->v_key) is distinct from (v_old_meta->v_key)
         and v_key not in (
           'checkout_phase',
           'claim_expires_at',
           'bank_call_started_at',
           'client_request_ids',
           'checkout_url',
           'claim_payment_id',
           'bank_payment_id'
         )
      then
        raise exception 'BOG checkout metadata key % cannot change outside the confirmer write path', v_key
          using errcode = '42501';
      end if;
    end loop;
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

revoke all on function public.protect_bog_payment_settlement()
  from public, anon, authenticated, service_role;
revoke all on function public.create_bog_pending_payment(uuid, text, text, uuid, numeric, integer, jsonb)
  from public, anon, authenticated, service_role, cityroute_bog_confirmer;
grant execute on function public.create_bog_pending_payment(uuid, text, text, uuid, numeric, integer, jsonb)
  to authenticated;

drop trigger if exists payment_transactions_protect_bog_settlement
  on public.payment_transactions;
create trigger payment_transactions_protect_bog_settlement
  before insert or update on public.payment_transactions
  for each row execute function public.protect_bog_payment_settlement();

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
  v_limit_before integer;
  v_limit_after integer;
  v_profile_updated boolean;
begin
  if auth.role() is distinct from 'cityroute_bog_confirmer' then
    raise exception 'Only the BOG confirmer role can update BOG payment status'
      using errcode = '42501';
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
  from public, anon, authenticated, service_role;
grant execute on function public.update_bog_payment_status(text, text, text, jsonb)
  to cityroute_bog_confirmer;

revoke all on table public.payment_transactions from public, anon;
revoke insert, update, delete on table public.payment_transactions from authenticated;
grant select on table public.payment_transactions to authenticated;
revoke all on table public.payment_transactions from service_role;
grant select, update on table public.payment_transactions to service_role;

commit;
