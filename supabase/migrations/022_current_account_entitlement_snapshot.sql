begin;

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.payment_transactions') is null
     or to_regprocedure('public.current_device_session_limit(uuid)') is null
     or to_regprocedure('public.current_verified_premium_device_slots(uuid)') is null
     or to_regprocedure('public.has_active_access(uuid)') is null
  then
    raise exception 'Migrations 020 and 021 are required before migration 022';
  end if;
end;
$$;

create or replace function public.get_current_account_entitlement()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  uid uuid := auth.uid();
  current_profile public.profiles%rowtype;
  current_payment public.payment_transactions%rowtype;
  verified_slots integer;
  entitlement_source text;
begin
  if uid is null then
    return pg_catalog.jsonb_build_object('status', 'unauthenticated');
  end if;

  select *
  into current_profile
  from public.profiles
  where id = uid;

  if not found then
    return pg_catalog.jsonb_build_object('status', 'profile_missing');
  end if;

  if current_profile.subscription_payment_id is not null then
    select *
    into current_payment
    from public.payment_transactions
    where user_id = uid
      and payment_id = current_profile.subscription_payment_id;
  end if;

  verified_slots := public.current_verified_premium_device_slots(uid);

  entitlement_source := case
    when current_profile.subscription_status = 'trial'
      and current_profile.subscription_expires_at > pg_catalog.now()
      then 'trial'
    when current_profile.subscription_status = 'active'
      and (current_profile.subscription_expires_at is null
        or current_profile.subscription_expires_at > pg_catalog.now())
      and verified_slots > 0
      then 'paid'
    when current_profile.subscription_status = 'active'
      and current_profile.subscription_payment_id is null
      and (current_profile.subscription_expires_at is null
        or current_profile.subscription_expires_at > pg_catalog.now())
      then 'legacy'
    else 'inactive'
  end;

  return pg_catalog.jsonb_build_object(
    'status', 'ok',
    'entitlement', entitlement_source,
    'payment_status', current_payment.status,
    'payment_amount', current_payment.amount,
    'payment_currency', current_payment.currency,
    'device_limit', public.current_device_session_limit(uid),
    'access_active', public.has_active_access(uid)
  );
end;
$$;

revoke all on function public.get_current_account_entitlement()
  from public, anon;
grant execute on function public.get_current_account_entitlement()
  to authenticated;

commit;
