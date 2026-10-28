begin;

do $$
declare
  plan_attnum smallint;
  status_attnum smallint;
  plan_constraint text;
  constraint_columns smallint[];
begin
  if to_regclass('public.payment_transactions') is null then
    raise exception 'public.payment_transactions is missing; apply its existing migration first';
  end if;
  if to_regclass('public.profiles') is null then
    raise exception 'public.profiles is missing; apply the base schema first';
  end if;

  if exists (
    select required.column_name
    from (values
      ('user_id'), ('provider'), ('payment_id'), ('merchant_payment_id'),
      ('transaction_id'), ('amount'), ('currency'), ('status'), ('metadata'),
      ('created_at'), ('updated_at'), ('paid_at')
    ) as required(column_name)
    where not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'payment_transactions'
        and c.column_name = required.column_name
    )
  ) then
    raise exception 'payment_transactions is missing required columns; inspect the existing schema';
  end if;

  if exists (
    select required.column_name
    from (values
      ('subscription_plan'), ('subscription_status'), ('subscription_expires_at'),
      ('device_slots'), ('updated_at')
    ) as required(column_name)
    where not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'profiles'
        and c.column_name = required.column_name
    )
  ) then
    raise exception 'profiles is missing required Premium columns; inspect migrations 003 and 008';
  end if;

  select attnum into plan_attnum
  from pg_attribute
  where attrelid = 'public.profiles'::regclass
    and attname = 'subscription_plan'
    and not attisdropped;

  for plan_constraint, constraint_columns in
    select conname, conkey
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'c'
      and plan_attnum = any(conkey)
  loop
    if plan_constraint <> 'profiles_subscription_plan_check'
       or cardinality(constraint_columns) <> 1
    then
      raise exception 'An unexpected subscription_plan CHECK exists; inspect it before applying this migration';
    end if;
  end loop;

  if exists (
    select 1 from public.profiles
    where subscription_plan is not null
      and subscription_plan not in ('nav', 'panel', 'full', 'premium')
  ) then
    raise exception 'Unknown subscription_plan values exist; inspect profiles before applying this migration';
  end if;

  select attnum into status_attnum
  from pg_attribute
  where attrelid = 'public.payment_transactions'::regclass
    and attname = 'status'
    and not attisdropped;

  if status_attnum is null then
    raise exception 'payment_transactions.status is missing';
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.payment_transactions'::regclass
      and contype = 'c'
      and status_attnum = any(conkey)
      and (
        conname <> 'payment_transactions_status_check'
        or cardinality(conkey) <> 1
      )
  ) then
    raise exception 'An unexpected payment status CHECK exists; inspect it before applying this migration';
  end if;

  if exists (
    select 1 from public.payment_transactions
    where status not in (
      'pending', 'processing', 'success', 'failed', 'cancelled',
      'refunded', 'refunded_partially'
    )
  ) then
    raise exception 'Unknown payment status values exist; inspect payment_transactions before applying this migration';
  end if;

  if exists (
    select 1 from public.payment_transactions
    where provider = 'bog' and merchant_payment_id is not null
    group by merchant_payment_id having count(*) > 1
  ) then
    raise exception 'Duplicate BOG merchant payment IDs exist; resolve them before applying this migration';
  end if;

  if to_regclass('public.payment_transactions_user_bog_idempotency_key') is not null
     or to_regclass('public.payment_transactions_bog_merchant_payment_id') is not null
  then
    raise exception 'A BOG idempotency index name already exists; inspect its definition before applying this migration';
  end if;
end;
$$;

alter table public.profiles
  drop constraint if exists profiles_subscription_plan_check;

alter table public.profiles
  add constraint profiles_subscription_plan_check
  check (subscription_plan is null or subscription_plan in ('nav', 'panel', 'full', 'premium'));

alter table public.profiles
  add column if not exists subscription_payment_id text;

alter table public.payment_transactions
  add column if not exists idempotency_key uuid;

alter table public.payment_transactions
  drop constraint if exists payment_transactions_status_check;

alter table public.payment_transactions
  add constraint payment_transactions_status_check
  check (status in (
    'pending', 'processing', 'success', 'failed', 'cancelled',
    'refunded', 'refunded_partially'
  ));

create unique index payment_transactions_user_bog_idempotency_key
  on public.payment_transactions (user_id, idempotency_key)
  where provider = 'bog' and idempotency_key is not null;

create unique index payment_transactions_bog_merchant_payment_id
  on public.payment_transactions (merchant_payment_id)
  where provider = 'bog' and merchant_payment_id is not null;

create or replace function public.select_subscription_plan(chosen text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if chosen is null or chosen not in ('nav', 'panel', 'full', 'premium') then
    raise exception 'Invalid plan';
  end if;

  update public.profiles
  set subscription_plan = chosen,
      updated_at = pg_catalog.now()
  where id = uid;

  if not found then
    raise exception 'Profile not found';
  end if;

  return pg_catalog.jsonb_build_object('status', 'ok', 'plan', chosen);
end;
$$;

revoke execute on function public.select_subscription_plan(text) from public, anon;
grant execute on function public.select_subscription_plan(text) to authenticated;

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
    if v_currency <> 'GEL' or v_amount not in (99, 179) then
      raise exception 'BOG amount or currency is not valid for Premium';
    end if;
    v_device_slots := case
      when v_metadata->>'device_slots' in ('1', '2') then (v_metadata->>'device_slots')::integer
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
