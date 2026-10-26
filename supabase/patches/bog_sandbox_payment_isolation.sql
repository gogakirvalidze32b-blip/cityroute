begin;

create table if not exists public.bog_sandbox_payment_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  payment_id text not null unique,
  merchant_payment_id text not null unique,
  idempotency_key uuid not null,
  amount numeric(10, 2) not null check (amount in (99, 179)),
  currency text not null check (currency = 'GEL'),
  status text not null default 'pending'
    check (status in (
      'pending',
      'processing',
      'success',
      'failed',
      'cancelled',
      'refunded',
      'refunded_partially'
    )),
  transaction_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  unique (user_id, idempotency_key)
);

create index if not exists bog_sandbox_payment_transactions_user_created_idx
  on public.bog_sandbox_payment_transactions(user_id, created_at desc);

create or replace function public.set_bog_sandbox_payment_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists bog_sandbox_payment_transactions_updated_at
  on public.bog_sandbox_payment_transactions;
create trigger bog_sandbox_payment_transactions_updated_at
  before update on public.bog_sandbox_payment_transactions
  for each row execute function public.set_bog_sandbox_payment_updated_at();

revoke execute on function public.set_bog_sandbox_payment_updated_at()
  from public, anon, authenticated;
grant execute on function public.set_bog_sandbox_payment_updated_at()
  to service_role;

alter table public.bog_sandbox_payment_transactions enable row level security;
revoke all on public.bog_sandbox_payment_transactions from anon, authenticated;
revoke all on public.bog_sandbox_payment_transactions from public;
grant select, insert, update on public.bog_sandbox_payment_transactions to service_role;

create or replace function public.create_bog_sandbox_payment_transaction(
  p_user_id uuid,
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
set search_path = pg_catalog
as $$
declare
  uid uuid := p_user_id;
  transaction_id uuid;
  existing record;
  slots integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Only the service role can create Sandbox payment transactions';
  end if;
  if uid is null then
    raise exception 'Sandbox payment user is required';
  end if;
  if p_payment_id is null or btrim(p_payment_id) = ''
    or p_merchant_payment_id is null or btrim(p_merchant_payment_id) = ''
    or p_idempotency_key is null
  then
    raise exception 'Payment identifiers are required';
  end if;
  if p_amount is null then
    raise exception 'Payment amount is required';
  end if;
  if p_currency is distinct from 'GEL' then
    raise exception 'Only GEL Sandbox payments are supported';
  end if;

  if coalesce(p_metadata->>'device_slots', '') not in ('1', '2') then
    raise exception 'Invalid device slot count';
  end if;
  slots := (p_metadata->>'device_slots')::integer;
  if (slots = 1 and p_amount <> 99) or (slots = 2 and p_amount <> 179) then
    raise exception 'Sandbox amount does not match the selected package';
  end if;

  insert into public.bog_sandbox_payment_transactions (
    user_id,
    payment_id,
    merchant_payment_id,
    idempotency_key,
    amount,
    currency,
    metadata
  )
  values (
    uid,
    p_payment_id,
    p_merchant_payment_id,
    p_idempotency_key,
    p_amount,
    p_currency,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict do nothing
  returning id into transaction_id;

  if transaction_id is not null then
    return transaction_id;
  end if;

  select *
  into existing
  from public.bog_sandbox_payment_transactions
  where user_id = uid and idempotency_key = p_idempotency_key
  for update;

  if not found then
    raise exception 'Sandbox payment ID, merchant ID, or idempotency key already exists';
  end if;
  if existing.payment_id is distinct from p_payment_id
    or existing.merchant_payment_id is distinct from p_merchant_payment_id
    or existing.amount is distinct from p_amount
    or existing.currency is distinct from p_currency
    or existing.metadata->>'device_slots' is distinct from p_metadata->>'device_slots'
  then
    raise exception 'Sandbox payment ID, merchant ID, or idempotency key conflicts with another order';
  end if;

  return existing.id;
end;
$$;

drop function if exists public.create_bog_sandbox_payment_transaction(text, text, uuid, numeric, text, jsonb);
revoke execute on function public.create_bog_sandbox_payment_transaction(uuid, text, text, uuid, numeric, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_bog_sandbox_payment_transaction(uuid, text, text, uuid, numeric, text, jsonb)
  to service_role;

create or replace function public.update_bog_sandbox_payment_status(
  p_payment_id text,
  p_status text,
  p_transaction_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_amount numeric;
  v_currency text;
  v_current_status text;
  v_merchant_payment_id text;
  v_bank_status text;
  v_expected_status text;
  v_bank_amount numeric;
  v_refund_amount numeric;
  v_previous_refund_amount numeric;
  v_metadata jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Only the service role can update Sandbox payment status';
  end if;
  if p_status is null or p_status not in (
    'pending', 'processing', 'success', 'failed', 'cancelled', 'refunded', 'refunded_partially'
  ) then
    raise exception 'Invalid Sandbox payment status';
  end if;

  select amount, currency, status, merchant_payment_id, metadata
  into v_amount, v_currency, v_current_status, v_merchant_payment_id, v_metadata
  from public.bog_sandbox_payment_transactions
  where payment_id = p_payment_id
  for update;
  if not found then
    raise exception 'Sandbox payment transaction not found';
  end if;

  v_bank_status := p_metadata->>'bank_status';
  if v_bank_status is null
    or p_metadata->>'bank_external_order_id' is distinct from v_merchant_payment_id
    or p_metadata->>'bank_currency' is distinct from v_currency
    or coalesce(p_metadata->>'bank_amount', '') !~ '^[0-9]+(\.[0-9]+)?$'
  then
    raise exception 'Verified Sandbox receipt fields are missing or invalid';
  end if;
  v_bank_amount := (p_metadata->>'bank_amount')::numeric;
  if v_bank_amount <> v_amount then
    raise exception 'Sandbox receipt amount does not match the stored transaction';
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
  if v_expected_status is null then
    raise exception 'Unsupported BOG Sandbox bank status';
  end if;
  if p_status is distinct from v_expected_status then
    raise exception 'Sandbox payment status does not match the verified bank receipt';
  end if;

  if v_bank_status in ('refunded', 'refunded_partially') then
    if coalesce(p_metadata->>'bank_refund_amount', '') !~ '^[0-9]+(\.[0-9]+)?$' then
      raise exception 'Verified Sandbox refund amount is missing or invalid';
    end if;
    v_refund_amount := (p_metadata->>'bank_refund_amount')::numeric;
    if (v_bank_status = 'refunded' and v_refund_amount <> v_amount)
      or (
        v_bank_status = 'refunded_partially'
        and (v_refund_amount <= 0 or v_refund_amount >= v_amount)
      )
    then
      raise exception 'Sandbox refund amount does not match the bank status';
    end if;
  end if;

  if v_current_status = 'refunded_partially' and p_status = 'refunded_partially' then
    if coalesce(v_metadata->>'bank_refund_amount', '') !~ '^[0-9]+(\.[0-9]+)?$' then
      raise exception 'Stored Sandbox partial refund amount is missing or invalid';
    end if;
    v_previous_refund_amount := (v_metadata->>'bank_refund_amount')::numeric;
    if v_refund_amount < v_previous_refund_amount then
      raise exception 'Sandbox partial refund amount cannot move backwards';
    end if;

    update public.bog_sandbox_payment_transactions
    set transaction_id = coalesce(p_transaction_id, transaction_id),
        metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
        paid_at = coalesce(paid_at, now())
    where payment_id = p_payment_id;

    return jsonb_build_object(
      'success', true,
      'status', p_status,
      'duplicate_or_stale', v_refund_amount = v_previous_refund_amount,
      'sandbox', true
    );
  end if;

  if v_current_status = p_status then
    return jsonb_build_object(
      'success', true,
      'status', v_current_status,
      'duplicate_or_stale', true,
      'sandbox', true
    );
  end if;

  if not (
    (v_current_status = 'pending' and p_status in (
      'processing', 'success', 'failed', 'cancelled', 'refunded', 'refunded_partially'
    ))
    or (v_current_status = 'processing' and p_status in (
      'success', 'failed', 'cancelled', 'refunded', 'refunded_partially'
    ))
    or (v_current_status = 'success' and p_status in ('refunded', 'refunded_partially'))
    or (v_current_status = 'refunded_partially' and p_status = 'refunded')
  ) then
    raise exception 'Invalid Sandbox payment status transition: % -> %', v_current_status, p_status;
  end if;

  update public.bog_sandbox_payment_transactions
  set status = p_status,
      transaction_id = coalesce(p_transaction_id, transaction_id),
      metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
      paid_at = case
        when p_status in ('success', 'refunded_partially') then coalesce(paid_at, now())
        else paid_at
      end
  where payment_id = p_payment_id;

  return jsonb_build_object(
    'success', true,
    'status', p_status,
    'duplicate_or_stale', false,
    'sandbox', true,
    'subscription_activated', false
  );
end;
$$;

revoke execute on function public.update_bog_sandbox_payment_status(text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_bog_sandbox_payment_status(text, text, text, jsonb)
  to service_role;

commit;
