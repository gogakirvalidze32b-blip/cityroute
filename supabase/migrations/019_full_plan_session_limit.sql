begin;

create or replace function public.current_device_session_limit(p_profile_id uuid)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce((
    select case
      when exists (
        select 1
        from public.device_session_limit_overrides o
        where o.profile_id = p.id
          and o.session_limit = 2
          and o.revoked_at is null
      )
      then 2
      when p.subscription_status = 'active'
        and p.subscription_plan in ('full', 'premium')
        and p.device_slots = 2
        and (p.subscription_expires_at is null or p.subscription_expires_at > pg_catalog.now())
        and exists (
          select 1
          from public.payment_transactions t
          where t.user_id = p.id
            and t.provider = 'bog'
            and t.payment_id = p.subscription_payment_id
            and t.status = 'success'
            and t.amount = 179
            and t.currency = 'GEL'
            and t.paid_at is not null
            and t.metadata->>'device_slots' = '2'
            and t.metadata->>'bank_status' = 'completed'
            and t.metadata->>'bank_currency' = 'GEL'
            and t.metadata->>'bank_external_order_id' = t.merchant_payment_id
            and case
              when coalesce(t.metadata->>'bank_amount', '') ~ '^[0-9]+(\.[0-9]+)?$'
                then (t.metadata->>'bank_amount')::numeric = 179
              else false
            end
        )
      then 2
      else 1
    end
    from public.profiles p
    where p.id = p_profile_id
  ), 0);
$$;

revoke all on function public.current_device_session_limit(uuid) from public, anon, authenticated;

commit;
