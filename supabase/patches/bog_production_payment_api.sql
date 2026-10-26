begin;

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'public.profiles is missing; review the target database';
  end if;

  if to_regclass('public.payment_transactions') is not null then
    raise exception
      'public.payment_transactions already exists; inspect its schema and preserve the existing TBC RPC before applying any patch';
  end if;

  if to_regprocedure(
    'public.update_bog_payment_status(text,text,text,jsonb)'
  ) is not null then
    raise exception
      'public.update_bog_payment_status already exists; inspect its definition and grants before applying any patch';
  end if;

  if to_regprocedure('public.set_updated_at()') is null then
    raise exception
      'public.set_updated_at() is missing; review the base schema before applying this patch';
  end if;

  if exists (
    select required.column_name
    from (values
      ('subscription_status'),
      ('subscription_plan'),
      ('subscription_expires_at'),
      ('device_slots'),
      ('updated_at')
    ) as required(column_name)
    where not exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'profiles'
        and c.column_name = required.column_name
    )
  ) then
    raise exception
      'Required public.profiles columns are missing; review migrations 003, 008, and 011 before applying this patch';
  end if;
end;
$$;

alter table public.profiles
  add column if not exists subscription_payment_id text;

create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('tbc', 'bog')),
  payment_id text not null,
  merchant_payment_id text,
  transaction_id text,
  amount numeric(10, 2) not null check (amount > 0),
  currency text not null default 'GEL'
    check (currency in ('GEL', 'USD', 'EUR')),
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
  idempotency_key uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint payment_transactions_provider_payment_id_key
    unique (provider, payment_id)
);

create trigger payment_transactions_updated_at
  before update on public.payment_transactions
  for each row execute function public.set_updated_at();

create index idx_payment_transactions_user_created
  on public.payment_transactions (user_id, created_at desc);

create index idx_payment_transactions_status
  on public.payment_transactions (status);

create unique index payment_transactions_user_bog_idempotency_key
  on public.payment_transactions (user_id, idempotency_key)
  where provider = 'bog' and idempotency_key is not null;

create unique index payment_transactions_bog_merchant_payment_id
  on public.payment_transactions (merchant_payment_id)
  where provider = 'bog' and merchant_payment_id is not null;

alter table public.payment_transactions enable row level security;

revoke all on public.payment_transactions from public, anon, authenticated;
grant select on public.payment_transactions to authenticated;
grant select, insert, update on public.payment_transactions to service_role;

create policy payment_transactions_select_own
  on public.payment_transactions
  for select
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.update_bog_payment_status(
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
  v_user_id uuid;
  v_amount numeric;
  v_currency text;
  v_current_status text;
  v_transaction_metadata jsonb;
  v_merchant_payment_id text;
  v_device_slots integer;
  v_bank_amount numeric;
  v_refund_amount numeric;
  v_previous_refund_amount numeric;
  v_bank_status text;
  v_expected_status text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Only the service role can update BOG payment status';
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
    raise exception 'Invalid BOG payment status';
  end if;

  select user_id, amount, currency, status,
         coalesce(metadata, '{}'::jsonb), merchant_payment_id
    into v_user_id, v_amount, v_currency, v_current_status,
         v_transaction_metadata, v_merchant_payment_id
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

  if v_expected_status is null then
    raise exception 'Unsupported BOG bank status';
  end if;

  if p_status is distinct from v_expected_status then
    raise exception 'Payment status does not match the verified BOG receipt';
  end if;

  if v_bank_status in ('refunded', 'refunded_partially') then
    if coalesce(p_metadata->>'bank_refund_amount', '')
       !~ '^[0-9]+(\.[0-9]+)?$'
    then
      raise exception 'BOG refund amount is missing or invalid';
    end if;

    v_refund_amount := (p_metadata->>'bank_refund_amount')::numeric;

    if (v_bank_status = 'refunded' and v_refund_amount <> v_amount)
       or (
         v_bank_status = 'refunded_partially'
         and (v_refund_amount <= 0 or v_refund_amount >= v_amount)
       )
    then
      raise exception 'BOG refund amount does not match the refund status';
    end if;
  end if;

  if v_current_status = p_status
     and p_status <> 'refunded_partially'
  then
    return pg_catalog.jsonb_build_object(
      'success', true,
      'status', v_current_status,
      'duplicate_or_stale', true
    );
  end if;

  if v_current_status = 'refunded_partially'
     and p_status = 'refunded_partially'
  then
    if coalesce(v_transaction_metadata->>'bank_refund_amount', '')
       !~ '^[0-9]+(\.[0-9]+)?$'
    then
      raise exception 'Stored partial refund amount is missing or invalid';
    end if;

    v_previous_refund_amount :=
      (v_transaction_metadata->>'bank_refund_amount')::numeric;

    if v_refund_amount < v_previous_refund_amount then
      raise exception 'Cumulative partial refund amount cannot decrease';
    end if;

    if v_refund_amount = v_previous_refund_amount then
      return pg_catalog.jsonb_build_object(
        'success', true,
        'status', v_current_status,
        'duplicate_or_stale', true
      );
    end if;

    update public.payment_transactions
       set transaction_id = coalesce(p_transaction_id, transaction_id),
           metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
           updated_at = now()
     where provider = 'bog' and payment_id = p_payment_id;

    return pg_catalog.jsonb_build_object(
      'success', true,
      'status', p_status,
      'duplicate_or_stale', false
    );
  end if;

  if not (
    (v_current_status = 'pending'
      and p_status in ('processing', 'success', 'failed', 'cancelled'))
    or
    (v_current_status = 'processing'
      and p_status in ('success', 'failed', 'cancelled'))
    or
    (v_current_status = 'success'
      and p_status in ('refunded', 'refunded_partially'))
    or
    (v_current_status = 'refunded_partially'
      and p_status = 'refunded')
  ) then
    raise exception 'Invalid BOG status transition: % -> %',
      v_current_status, p_status;
  end if;

  if p_status = 'success' then
    if v_currency <> 'GEL' or v_amount not in (99, 179) then
      raise exception 'BOG amount or currency is not valid for Premium';
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
      raise exception 'BOG amount does not match the selected package';
    end if;
  end if;

  update public.payment_transactions
     set status = p_status,
         transaction_id = coalesce(p_transaction_id, transaction_id),
         metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
         paid_at = case
           when p_status = 'success' then coalesce(paid_at, now())
           else paid_at
         end,
         updated_at = now()
   where provider = 'bog' and payment_id = p_payment_id;

  if p_status = 'success' then
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
