begin;

alter table public.profile_active_sessions
  add column last_activity_at timestamptz;

update public.profile_active_sessions
set last_activity_at = pg_catalog.now() - interval '31 minutes'
where last_activity_at is null;

alter table public.profile_active_sessions
  alter column last_activity_at set default pg_catalog.now(),
  alter column last_activity_at set not null;

create or replace function public.device_session_activity_is_recent(p_last_activity_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select p_last_activity_at > pg_catalog.now() - interval '30 minutes';
$$;

revoke all on function public.device_session_activity_is_recent(timestamptz)
  from public, anon, authenticated;

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

alter function public.activate_current_session()
  rename to activate_current_session_before_activity;

revoke all on function public.activate_current_session_before_activity()
  from public, anon, authenticated, service_role;

create or replace function public.activate_current_session()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  uid uuid := auth.uid();
  current_session_id uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  if uid is not null then
    perform 1
    from public.profiles p
    where p.id = uid
    for update;

    if found then
      delete from public.profile_active_sessions active
      where active.profile_id = uid
        and not public.device_session_activity_is_recent(active.last_activity_at);

      update public.profile_active_sessions active
      set last_activity_at = pg_catalog.now(),
          updated_at = pg_catalog.now()
      where active.profile_id = uid
        and active.session_id = current_session_id
        and public.device_session_activity_is_recent(active.last_activity_at);
    end if;
  end if;

  return public.activate_current_session_before_activity();
end;
$$;

revoke all on function public.activate_current_session() from public, anon;
grant execute on function public.activate_current_session() to authenticated;

commit;
