-- Keep profile subscription data writable only through trusted RPCs.
-- Preserve established legacy plan labels until their feature mapping is explicitly migrated.
do $$
declare
  constraint_name text;
  constraint_columns smallint[];
  subscription_plan_attnum smallint;
begin
  select attnum
  into subscription_plan_attnum
  from pg_attribute
  where attrelid = 'public.profiles'::regclass
    and attname = 'subscription_plan'
    and not attisdropped;

  for constraint_name, constraint_columns in
    select conname, conkey
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'c'
      and subscription_plan_attnum = any(conkey)
  loop
    if cardinality(constraint_columns) <> 1 then
      raise exception
        'A CHECK constraint involving subscription_plan also references other columns; review it before applying migration 011';
    end if;

    execute format('alter table public.profiles drop constraint %I', constraint_name);
  end loop;
end;
$$;

do $$
begin
 if exists (
   select 1
   from public.profiles
   where subscription_plan is not null
     and subscription_plan not in ('premium', 'nav', 'panel', 'full')
 ) then
   raise exception
     'Unknown subscription_plan values exist; review them before applying migration 011';
 end if;
end;
$$;

alter table public.profiles
 add constraint profiles_subscription_plan_check
 check (subscription_plan is null or subscription_plan in ('premium', 'nav', 'panel', 'full'));

drop policy if exists "profiles_update_own" on public.profiles;
revoke update on public.profiles from anon, authenticated;

create or replace function public.select_subscription_package(p_device_slots integer)
returns jsonb
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

  if p_device_slots is null or p_device_slots not in (1, 2) then
    raise exception 'Invalid device slot count';
  end if;

  update public.profiles
  set subscription_plan = 'premium',
      device_slots = p_device_slots,
      updated_at = now()
  where id = uid
    and subscription_status = 'trial'
    and subscription_expires_at > now();

  if not found then
    raise exception 'An active trial is required to select the free trial package';
  end if;

  return jsonb_build_object('status', 'ok', 'device_slots', p_device_slots);
end;
$$;

revoke execute on function public.select_subscription_package(integer) from public, anon;
grant execute on function public.select_subscription_package(integer) to authenticated;

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
  v_transaction_metadata jsonb;
  v_device_slots integer;
begin
  if p_provider is distinct from 'bog' then
    raise exception 'Only Bank of Georgia payments can activate Premium';
  end if;

  if p_status is null or p_status not in ('pending', 'processing', 'success', 'failed', 'cancelled', 'refunded') then
    raise exception 'Invalid payment status';
  end if;

  select user_id, amount, status, coalesce(metadata, '{}'::jsonb)
  into v_user_id, v_amount, v_current_status, v_transaction_metadata
  from public.payment_transactions
  where provider = p_provider and payment_id = p_payment_id
  for update;

  if not found then
    raise exception 'Payment transaction not found';
  end if;

  update public.payment_transactions
  set status = p_status,
      transaction_id = coalesce(p_transaction_id, transaction_id),
      metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
      paid_at = case when p_status = 'success' then now() else paid_at end
  where provider = p_provider and payment_id = p_payment_id;

  if p_status = 'success' and v_current_status <> 'success' then
    v_device_slots := case
      when v_transaction_metadata->>'device_slots' in ('1', '2')
        then (v_transaction_metadata->>'device_slots')::integer
      when v_amount in (179, 189) then 2
      else 1
    end;

    update public.profiles
    set subscription_status = 'active',
        subscription_plan = 'premium',
        device_slots = v_device_slots,
        subscription_expires_at = now() + interval '30 days',
        updated_at = now()
    where id = v_user_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'status', p_status,
    'subscription_activated', p_status = 'success'
  );
end;
$$;

revoke execute on function public.update_payment_status(text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_payment_status(text, text, text, text, jsonb) to service_role;
