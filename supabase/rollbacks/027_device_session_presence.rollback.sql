-- Manual rollback of migration 027 (device session presence). Not a migration: keep it out of
-- supabase/migrations and run it only deliberately. It restores the migration 026 functions and grants.
--
-- Side effects:
--   * profile_active_sessions.last_seen_at is dropped (presence timestamps are lost).
--   * Registry rows already released by 027 cleanup are not restored; those devices simply re-activate.
--   * auth.sessions, profile_revoked_sessions, subscription and payment tables are never touched.
--   * A client that calls presence_current_session must have the heartbeat fallback (PGRST202).
begin;

do $$
begin
  if to_regprocedure('public.presence_current_session()') is null
     or to_regprocedure('public.activate_current_session_before_presence()') is null
     or to_regprocedure('public.activate_current_session_before_activity()') is null
     or to_regprocedure('public.device_session_activity_is_recent(timestamptz)') is null
  then
    raise exception 'Migration 027 is not applied; nothing to roll back';
  end if;
end;
$$;

-- Drop the 027 wrapper and give the 026 wrapper back its original name and grants.
drop function public.activate_current_session();

alter function public.activate_current_session_before_presence()
  rename to activate_current_session;

revoke all on function public.activate_current_session() from public, anon;
grant execute on function public.activate_current_session() to authenticated, service_role;

-- Migration 026 definitions of has_current_active_session and heartbeat_current_session.
create or replace function public.has_current_active_session()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  with caller as (
    select auth.uid() as user_id,
           nullif(auth.jwt() ->> 'session_id', '')::uuid as session_id
  ),
  eligible_sessions as (
    select active.session_id,
           pg_catalog.row_number() over (
             order by active.activated_at, active.session_created_at, active.session_id
           ) as slot_number
    from public.profile_active_sessions active
    join caller c on c.user_id = active.profile_id
    join auth.sessions s
      on s.id = active.session_id
     and s.user_id = active.profile_id
    where active.device_fingerprint is not null
      and public.device_session_activity_is_recent(active.last_activity_at)
      and (s.not_after is null or s.not_after > pg_catalog.now())
      and not exists (
        select 1
        from public.profile_revoked_sessions revoked
        where revoked.profile_id = active.profile_id
          and revoked.session_id = active.session_id
      )
  )
  select exists (
    select 1
    from caller c
    join eligible_sessions active on active.session_id = c.session_id
    where active.slot_number <= public.current_device_session_limit(c.user_id)
  );
$$;

revoke all on function public.has_current_active_session() from public, anon;
grant execute on function public.has_current_active_session() to authenticated;

create or replace function public.heartbeat_current_session()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  uid uuid := auth.uid();
  current_session_id uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  current_fingerprint text;
  updated_count integer;
begin
  if uid is null or current_session_id is null then
    return pg_catalog.jsonb_build_object('status', 'inactive');
  end if;

  current_fingerprint := nullif(
    pg_catalog.btrim(coalesce(
      nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb
        ->> 'x-cityroute-device-fingerprint',
      ''
    )),
    ''
  );

  if current_fingerprint is null
     or pg_catalog.length(current_fingerprint) not between 8 and 256
  then
    return pg_catalog.jsonb_build_object('status', 'inactive');
  end if;

  if exists (
    select 1
    from public.profile_revoked_sessions revoked
    where revoked.profile_id = uid
      and revoked.session_id = current_session_id
  ) then
    return pg_catalog.jsonb_build_object('status', 'revoked');
  end if;

  if not public.has_current_active_session() then
    return pg_catalog.jsonb_build_object('status', 'inactive');
  end if;

  update public.profile_active_sessions active
  set last_activity_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  from auth.sessions s
  where active.profile_id = uid
    and active.session_id = current_session_id
    and active.device_fingerprint = current_fingerprint
    and s.id = active.session_id
    and s.user_id = active.profile_id
    and (s.not_after is null or s.not_after > pg_catalog.now())
    and public.device_session_activity_is_recent(active.last_activity_at)
    and not exists (
      select 1
      from public.profile_revoked_sessions revoked
      where revoked.profile_id = active.profile_id
        and revoked.session_id = active.session_id
    );

  get diagnostics updated_count = row_count;

  if updated_count = 1 then
    return pg_catalog.jsonb_build_object('status', 'active');
  end if;

  return pg_catalog.jsonb_build_object('status', 'inactive');
end;
$$;

revoke all on function public.heartbeat_current_session() from public, anon;
grant execute on function public.heartbeat_current_session() to authenticated;

-- Remove everything that only exists in 027.
drop function public.presence_current_session();
drop function public.touch_current_session_presence();
drop function public.device_session_presence_is_recent(timestamptz);

alter table public.profile_active_sessions
  drop column last_seen_at;

commit;
