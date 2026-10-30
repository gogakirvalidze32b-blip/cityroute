begin;

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.support_admins') is null
     or to_regclass('public.profile_active_sessions') is null
     or to_regclass('public.profile_revoked_sessions') is null
     or to_regprocedure('public.is_support_admin()') is null
     or to_regprocedure('public.current_device_session_limit(uuid)') is null
     or to_regprocedure('public.activate_current_session()') is null
  then
    raise exception 'Migration 015 must be applied before session-limit overrides';
  end if;

  if to_regclass('public.device_session_limit_overrides') is not null then
    raise exception 'Session-limit override objects already exist; do not rerun this migration';
  end if;
end;
$$;

create table public.device_session_limit_overrides (
  id bigint generated always as identity primary key,
  profile_id uuid not null,
  session_limit integer not null default 2 check (session_limit = 2),
  granted_by uuid not null references auth.users (id),
  granted_at timestamptz not null default pg_catalog.now(),
  grant_reason text not null,
  revoked_by uuid references auth.users (id),
  revoked_at timestamptz,
  revoke_reason text,
  constraint device_session_limit_overrides_revoke_time_check
    check (revoked_at is null or revoked_at >= granted_at),
  constraint device_session_limit_overrides_grant_reason_check
    check (pg_catalog.length(pg_catalog.btrim(grant_reason)) between 5 and 500),
  constraint device_session_limit_overrides_revoke_pair_check
    check ((revoked_by is null) = (revoked_at is null)),
  constraint device_session_limit_overrides_revoke_reason_check
    check (
      revoke_reason is null
      or pg_catalog.length(pg_catalog.btrim(revoke_reason)) between 5 and 500
    )
);

create unique index device_session_limit_overrides_one_active_per_profile_idx
  on public.device_session_limit_overrides (profile_id)
  where revoked_at is null;

comment on table public.device_session_limit_overrides is
  'Audited, non-expiring admin override allowing a profile at most two active auth sessions until manually revoked. Profile IDs are retained if the profile is deleted. Does not represent or modify a payment.';

alter table public.device_session_limit_overrides enable row level security;
revoke all on public.device_session_limit_overrides from public, anon, authenticated;

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
        and p.subscription_plan = 'premium'
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

create function public.grant_device_session_limit_override(
  p_profile_id uuid,
  p_reason text
)
returns table (override_id bigint, granted_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null or not public.is_support_admin() then
    raise exception 'Only an active support admin may grant session overrides'
      using errcode = '42501';
  end if;

  if p_profile_id is null
     or p_reason is null
     or pg_catalog.length(pg_catalog.btrim(p_reason)) not between 5 and 500
  then
    raise exception 'Provide a target profile and reason (5-500 characters)'
      using errcode = '22023';
  end if;

  perform 1
  from public.profiles p
  where p.id = p_profile_id
  for update;

  if not found then
    raise exception 'Target profile does not exist'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.device_session_limit_overrides o
    where o.profile_id = p_profile_id
      and o.revoked_at is null
  ) then
    raise exception 'An active session override already exists; revoke it before granting another'
      using errcode = '23505';
  end if;

  return query
  insert into public.device_session_limit_overrides (
    profile_id, granted_by, grant_reason
  )
  values (
    p_profile_id, actor_id, pg_catalog.btrim(p_reason)
  )
  returning id, device_session_limit_overrides.granted_at;
end;
$$;

revoke all on function public.grant_device_session_limit_override(uuid, text)
  from public, anon;
grant execute on function public.grant_device_session_limit_override(uuid, text)
  to authenticated;

create function public.revoke_device_session_limit_override(
  p_override_id bigint,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null or not public.is_support_admin() then
    raise exception 'Only an active support admin may revoke session overrides'
      using errcode = '42501';
  end if;

  if p_override_id is null
     or p_reason is null
     or pg_catalog.length(pg_catalog.btrim(p_reason)) not between 5 and 500
  then
    raise exception 'Provide an override ID and a reason (5-500 characters)'
      using errcode = '22023';
  end if;

  update public.device_session_limit_overrides o
  set revoked_by = actor_id,
      revoked_at = pg_catalog.now(),
      revoke_reason = pg_catalog.btrim(p_reason)
  where o.id = p_override_id
    and o.revoked_at is null;

  if not found then
    raise exception 'Active session override not found'
      using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.revoke_device_session_limit_override(bigint, text)
  from public, anon;
grant execute on function public.revoke_device_session_limit_override(bigint, text)
  to authenticated;

commit;
