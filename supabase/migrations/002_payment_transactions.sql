-- Payment transactions table for TBC and BOG bank integrations
-- Run in Supabase SQL Editor after 001_initial.sql

-- Add subscription_plan column to profiles if not exists
alter table public.profiles 
add column if not exists subscription_plan text
  check (subscription_plan in ('premium'));

-- Payment transactions table
create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  
  -- Payment provider (TBC or BOG)
  provider text not null check (provider in ('tbc', 'bog')),
  
  -- External payment IDs
  payment_id text not null, -- TBC payId or BOG order_id
  merchant_payment_id text, -- Internal reference
  transaction_id text, -- Bank transaction ID after success
  
  -- Payment details
  amount numeric(10, 2) not null,
  currency text not null default 'GEL' check (currency in ('GEL', 'USD', 'EUR')),
  
  -- Status tracking
  status text not null default 'pending' 
    check (status in ('pending', 'processing', 'success', 'failed', 'cancelled', 'refunded')),
  
  -- Timestamps
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  
  -- Metadata
  metadata jsonb default '{}'::jsonb,
  
  -- Indexes
  unique (provider, payment_id)
);

-- Indexes for payment_transactions
create index if not exists idx_payment_transactions_user_id 
  on public.payment_transactions(user_id);

create index if not exists idx_payment_transactions_status 
  on public.payment_transactions(status);

create index if not exists idx_payment_transactions_created_at 
  on public.payment_transactions(created_at desc);

create index if not exists idx_payment_transactions_provider_payment_id 
  on public.payment_transactions(provider, payment_id);

-- Updated_at trigger for payment_transactions
drop trigger if exists payment_transactions_updated_at on public.payment_transactions;
create trigger payment_transactions_updated_at
  before update on public.payment_transactions
  for each row execute function public.set_updated_at();

-- RPC: Record payment initialization
create or replace function public.create_payment_transaction(
  p_provider text,
  p_payment_id text,
  p_merchant_payment_id text,
  p_amount numeric,
  p_currency text default 'GEL',
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  transaction_id uuid;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.payment_transactions (
    user_id,
    provider,
    payment_id,
    merchant_payment_id,
    amount,
    currency,
    status,
    metadata
  )
  values (
    uid,
    p_provider,
    p_payment_id,
    p_merchant_payment_id,
    p_amount,
    p_currency,
    'pending',
    p_metadata
  )
  returning id into transaction_id;

  return transaction_id;
end;
$$;

-- RPC: Update payment status and activate subscription on success
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
  v_current_status text;
begin
  -- Get transaction details
  select user_id, amount, status
  into v_user_id, v_amount, v_current_status
  from public.payment_transactions
  where provider = p_provider and payment_id = p_payment_id
  for update;

  if not found then
    raise exception 'Payment transaction not found';
  end if;

  -- Update transaction status
  update public.payment_transactions
  set 
    status = p_status,
    transaction_id = coalesce(p_transaction_id, transaction_id),
    metadata = metadata || p_metadata,
    paid_at = case when p_status = 'success' then now() else paid_at end
  where provider = p_provider and payment_id = p_payment_id;

  -- If payment successful, activate premium subscription
  if p_status = 'success' and v_current_status != 'success' then
    update public.profiles
    set
      subscription_status = 'active',
      subscription_plan = 'premium',
      subscription_expires_at = now() + interval '30 days',
      updated_at = now()
    where id = v_user_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'status', p_status,
    'subscription_activated', (p_status = 'success')
  );
end;
$$;

-- RPC: Get user payment history
create or replace function public.get_user_payment_history()
returns setof public.payment_transactions
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.payment_transactions
  where user_id = auth.uid()
  order by created_at desc;
$$;

-- RPC: Select subscription plan (updated to use new plan system)
create or replace function public.select_subscription_plan(chosen text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if chosen != 'premium' then
    raise exception 'Invalid subscription plan';
  end if;

  update public.profiles
  set subscription_plan = chosen,
      updated_at = now()
  where id = uid;
end;
$$;

-- Grant permissions
grant usage on schema public to anon, authenticated;
grant select on public.payment_transactions to authenticated;
grant execute on function public.create_payment_transaction to authenticated;
grant execute on function public.update_payment_status to service_role;
grant execute on function public.get_user_payment_history to authenticated;
grant execute on function public.select_subscription_plan to authenticated;

-- Comments
comment on table public.payment_transactions is 'Stores all payment transactions from TBC and BOG banks';
comment on function public.create_payment_transaction is 'Creates a new payment transaction record';
comment on function public.update_payment_status is 'Updates payment status and activates subscription on success (service_role only)';
comment on function public.get_user_payment_history is 'Returns authenticated user payment history';
