alter table public.payment_transactions
  add column if not exists idempotency_key uuid;

alter table public.profiles
  add column if not exists subscription_payment_id text;

do $$
declare
  status_attnum smallint;
begin
  select attnum
  into status_attnum
  from pg_attribute
  where attrelid = 'public.payment_transactions'::regclass
    and attname = 'status'
    and not attisdropped;

  if status_attnum is null then
    raise exception 'payment_transactions.status is missing; review the prerequisite schema';
  end if;

  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.payment_transactions'::regclass
      and conname = 'payment_transactions_status_check'
      and (
        contype <> 'c'
        or cardinality(conkey) is distinct from 1
        or conkey[1] is distinct from status_attnum
      )
  ) then
    raise exception
      'Constraint payment_transactions_status_check is not a single-column status CHECK; review it before applying migration 012';
  end if;
end;
$$;

alter table public.payment_transactions
  drop constraint if exists payment_transactions_status_check;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.payment_transactions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  ) then
    raise exception
      'Additional payment status CHECK constraints exist; review them before applying migration 012';
  end if;

  if exists (
    select 1
    from public.payment_transactions
    where status not in (
      'pending',
      'processing',
      'success',
      'failed',
      'cancelled',
      'refunded',
      'refunded_partially'
    )
  ) then
    raise exception
      'Unknown payment status values exist; review them before applying migration 012';
  end if;
end;
$$;

alter table public.payment_transactions
  add constraint payment_transactions_status_check
  check (status in (
    'pending',
    'processing',
    'success',
    'failed',
    'cancelled',
    'refunded',
    'refunded_partially'
  ));

do $$
begin
  if exists (
    select 1
    from public.payment_transactions
    where provider = 'bog'
      and idempotency_key is not null
    group by user_id, idempotency_key
    having count(*) > 1
  ) then
    raise exception
      'Duplicate BOG user/idempotency keys exist; resolve them before applying migration 012';
  end if;

  if exists (
    select 1
    from public.payment_transactions
    where provider = 'bog'
      and merchant_payment_id is not null
    group by merchant_payment_id
    having count(*) > 1
  ) then
    raise exception
      'Duplicate BOG merchant payment IDs exist; resolve them before applying migration 012';
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from pg_class
    where relnamespace = 'public'::regnamespace
      and relkind in ('i', 'I')
      and relname in (
        'payment_transactions_user_bog_idempotency_key',
        'payment_transactions_bog_merchant_payment_id'
      )
  ) then
    raise exception
      'A BOG payment index name already exists; verify its definition before applying migration 012';
  end if;
end;
$$;

create unique index payment_transactions_user_bog_idempotency_key
  on public.payment_transactions(user_id, idempotency_key)
  where provider = 'bog' and idempotency_key is not null;

create unique index payment_transactions_bog_merchant_payment_id
  on public.payment_transactions(merchant_payment_id)
  where provider = 'bog' and merchant_payment_id is not null;

create or replace function public.create_bog_payment_transaction(
  p_payment_id text,
  p_merchant_payment_id text,
  p_idempotency_key uuid,
  p_amount numeric,
  p_currency text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_transaction_id uuid;
  v_payment_id text;
  v_merchant_payment_id text;
  v_amount numeric;
  v_currency text;
  v_metadata jsonb;
  v_device_slots integer;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_payment_id is null or p_payment_id = ''
    or p_merchant_payment_id is null or p_merchant_payment_id = ''
    or p_idempotency_key is null
  then
    raise exception 'Payment identifiers are required';
  end if;

  if p_currency is distinct from 'GEL' then
    raise exception 'Only GEL payments are supported';
  end if;

  if coalesce(p_metadata->>'device_slots', '') not in ('1', '2') then
    raise exception 'Invalid device slot count';
  end if;

  v_device_slots := (p_metadata->>'device_slots')::integer;
  if (v_device_slots = 1 and p_amount <> 99)
    or (v_device_slots = 2 and p_amount <> 179)
  then
    raise exception 'Payment amount does not match the selected package';
  end if;

  insert into public.payment_transactions (
    user_id,
    provider,
    payment_id,
    merchant_payment_id,
    idempotency_key,
    amount,
    currency,
    status,
    metadata
  )
  values (
    uid,
    'bog',
    p_payment_id,
    p_merchant_payment_id,
    p_idempotency_key,
    p_amount,
    p_currency,
    'pending',
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict do nothing
  returning id into v_transaction_id;

  if v_transaction_id is not null then
    return v_transaction_id;
  end if;

  select id, payment_id, merchant_payment_id, amount, currency, metadata
  into v_transaction_id, v_payment_id, v_merchant_payment_id, v_amount, v_currency, v_metadata
  from public.payment_transactions
  where user_id = uid
    and provider = 'bog'
    and idempotency_key = p_idempotency_key
  for update;

  if not found
    or v_payment_id is distinct from p_payment_id
    or v_merchant_payment_id is distinct from p_merchant_payment_id
    or v_amount is distinct from p_amount
    or v_currency is distinct from p_currency
    or v_metadata->>'device_slots' is distinct from p_metadata->>'device_slots'
  then
    raise exception 'Payment idempotency key conflicts with another order';
  end if;

  return v_transaction_id;
end;
$$;

revoke execute on function public.create_bog_payment_transaction(text, text, uuid, numeric, text, jsonb)
  from public, anon;
grant execute on function public.create_bog_payment_transaction(text, text, uuid, numeric, text, jsonb)
  to authenticated;

create or replace function public.update_payment_status(
  p_provider text,
  p_payment_id text,
  p_status text,
  p_transaction_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_amount numeric;
  v_currency text;
  v_current_status text;
  v_transaction_metadata jsonb;
  v_merchant_payment_id text;
  v_device_slots integer;
  v_bank_amount numeric;
  v_refund_amount numeric;
  v_bank_status text;
  v_expected_status text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Only the service role can update payment status';
  end if;

  if p_provider is distinct from 'bog' then
    raise exception 'Only Bank of Georgia payments can update Premium';
  end if;

  if p_status is null or p_status not in (
    'pending',
    'processing',
    'success',
    'failed',
    'cancelled',
    'refunded',
    'refunded_partially'
  ) then
    raise exception 'Invalid payment status';
  end if;

  select user_id, amount, currency, status, coalesce(metadata, '{}'::jsonb), merchant_payment_id
  into v_user_id, v_amount, v_currency, v_current_status, v_transaction_metadata, v_merchant_payment_id
  from public.payment_transactions
  where provider = p_provider and payment_id = p_payment_id
  for update;

  if not found then
    raise exception 'Payment transaction not found';
  end if;

  v_bank_status := p_metadata->>'bank_status';
  if v_bank_status is null
    or p_metadata->>'bank_external_order_id' is distinct from v_merchant_payment_id
    or p_metadata->>'bank_currency' is distinct from v_currency
    or coalesce(p_metadata->>'bank_amount', '') !~ '^[0-9]+(\.[0-9]+)?$'
  then
    raise exception 'Bank receipt does not match the payment transaction';
  end if;

  v_bank_amount := (p_metadata->>'bank_amount')::numeric;
  if v_bank_amount <> v_amount then
    raise exception 'Bank receipt amount does not match the payment transaction';
  end if;

  if v_bank_status in ('refunded', 'refunded_partially') then
    if coalesce(p_metadata->>'bank_refund_amount', '') !~ '^[0-9]+(\.[0-9]+)?$' then
      raise exception 'Bank refund amount is missing or invalid';
    end if;

    v_refund_amount := (p_metadata->>'bank_refund_amount')::numeric;
    if (v_bank_status = 'refunded' and v_refund_amount <> v_amount)
      or (
        v_bank_status = 'refunded_partially'
        and (v_refund_amount <= 0 or v_refund_amount >= v_amount)
      )
    then
      raise exception 'Bank refund amount does not match the refund status';
    end if;
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
    else 'processing'
  end;

  if p_status is distinct from v_expected_status then
    raise exception 'Payment status does not match the verified bank receipt';
  end if;

  if v_current_status = p_status
    or v_current_status = 'refunded'
    or (v_current_status = 'refunded_partially' and p_status <> 'refunded')
    or (
      v_current_status = 'success'
      and p_status not in ('refunded', 'refunded_partially')
    )
    or (
      v_current_status in ('failed', 'cancelled')
      and p_status in ('pending', 'processing', 'failed', 'cancelled')
    )
  then
    return jsonb_build_object(
      'success', true,
      'status', v_current_status,
      'subscription_activated', v_current_status in ('success', 'refunded_partially'),
      'duplicate_or_stale', true
    );
  end if;

  if p_status in ('success', 'refunded_partially') then
    if v_currency <> 'GEL'
      or v_amount not in (99, 179)
    then
      raise exception 'Bank amount or currency is not valid for Premium';
    end if;

    v_device_slots := case
      when v_transaction_metadata->>'device_slots' in ('1', '2')
        then (v_transaction_metadata->>'device_slots')::integer
      else null
    end;

    if (v_device_slots = 1 and v_amount <> 99)
      or (v_device_slots = 2 and v_amount <> 179)
      or v_device_slots is null
    then
      raise exception 'Bank amount does not match the selected package';
    end if;
  end if;

  update public.payment_transactions
  set status = p_status,
      transaction_id = coalesce(p_transaction_id, transaction_id),
      metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
      paid_at = case
        when p_status in ('success', 'refunded_partially') then coalesce(paid_at, now())
        else paid_at
      end
  where provider = p_provider and payment_id = p_payment_id;

  if p_status = 'success'
  then
    update public.profiles
    set subscription_status = 'active',
        subscription_plan = 'premium',
        device_slots = v_device_slots,
        subscription_payment_id = p_payment_id,
        subscription_expires_at = case
          when subscription_status = 'active'
            and subscription_expires_at > now()
            then subscription_expires_at + interval '30 days'
          else now() + interval '30 days'
        end,
        updated_at = now()
    where id = v_user_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'status', p_status,
    'subscription_activated', p_status in ('success', 'refunded_partially'),
    'duplicate_or_stale', false
  );
end;
$$;

revoke execute on function public.update_payment_status(text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_payment_status(text, text, text, text, jsonb)
  to service_role;
