begin;

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.payment_transactions') is null
     or to_regclass('public.device_session_limit_overrides') is null
     or to_regprocedure('public.current_verified_premium_device_slots(uuid)') is null
     or not exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'profiles'
         and column_name = 'subscription_payment_id'
     )
  then
    raise exception 'Migration 020 and payment-linked profile fields are required before migration 021';
  end if;
end;
$$;

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
      when public.current_verified_premium_device_slots(p.id) = 2
      then 2
      when p.subscription_status = 'active'
        and p.subscription_payment_id is null
        and p.device_slots = 2
        and (p.subscription_expires_at is null or p.subscription_expires_at > pg_catalog.now())
      then 2
      else 1
    end
    from public.profiles p
    where p.id = p_profile_id
  ), 0);
$$;

revoke all on function public.current_device_session_limit(uuid)
  from public, anon, authenticated;

create or replace function public.has_active_access(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select uid = auth.uid()
    and public.has_current_active_session()
    and exists (
      select 1
      from public.profiles p
      where p.id = uid
        and (
          (
            p.subscription_status = 'trial'
            and p.subscription_expires_at > pg_catalog.now()
          )
          or (
            p.subscription_status = 'active'
            and (p.subscription_expires_at is null or p.subscription_expires_at > pg_catalog.now())
            and (
              p.subscription_payment_id is null
              or public.current_verified_premium_device_slots(p.id) > 0
            )
          )
        )
    );
$$;

revoke all on function public.has_active_access(uuid) from public, anon;
grant execute on function public.has_active_access(uuid) to authenticated;

commit;
