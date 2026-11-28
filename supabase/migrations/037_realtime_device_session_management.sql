begin;

do $$
begin
  if to_regclass('public.profile_active_sessions') is null
     or to_regclass('public.profile_revoked_sessions') is null
     or to_regprocedure('public.device_session_activity_is_recent(timestamptz)') is null
     or to_regprocedure('public.device_session_presence_is_recent(timestamptz)') is null
     or to_regprocedure('public.is_support_admin()') is null
  then
    raise exception 'Migrations 015, 026, 027, and Support Admin are required';
  end if;
end;
$$;

create table public.device_session_revocation_audit (
  id bigint generated always as identity primary key,
  profile_id uuid not null,
  session_id uuid not null,
  revoked_by uuid not null references auth.users (id),
  revoked_at timestamptz not null default pg_catalog.now(),
  reason text not null,
  constraint device_session_revocation_audit_reason_check
    check (pg_catalog.length(pg_catalog.btrim(reason)) between 5 and 500),
  constraint device_session_revocation_audit_once_per_session
    unique (profile_id, session_id)
);

alter table public.device_session_revocation_audit enable row level security;
revoke all on public.device_session_revocation_audit from public, anon, authenticated;

grant select on public.profile_revoked_sessions to authenticated;
drop policy if exists profile_revoked_sessions_select_own on public.profile_revoked_sessions;
create policy profile_revoked_sessions_select_own
  on public.profile_revoked_sessions
  for select
  to authenticated
  using (profile_id = (select auth.uid()));

do $$
begin
  if pg_catalog.to_regclass('pg_catalog.pg_publication') is not null
     and exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'profile_revoked_sessions'
     )
  then
    execute 'alter publication supabase_realtime add table public.profile_revoked_sessions';
  end if;
end;
$$;

create or replace function public.admin_list_device_sessions(p_profile_id uuid)
returns table (
  session_id uuid,
  session_created_at timestamptz,
  activated_at timestamptz,
  last_activity_at timestamptz,
  last_seen_at timestamptz,
  status text,
  revoked_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.is_support_admin() then
    raise exception 'Only an active support admin may inspect device sessions'
      using errcode = '42501';
  end if;
  if p_profile_id is null then
    raise exception 'A target profile is required'
      using errcode = '22023';
  end if;

  return query
  select active.session_id,
         active.session_created_at,
         active.activated_at,
         active.last_activity_at,
         active.last_seen_at,
         case
           when revoked.session_id is not null then 'revoked'
           when auth_session.id is null
             or (auth_session.not_after is not null and auth_session.not_after <= pg_catalog.now())
             then 'invalid'
           when active.device_fingerprint is not null
             and public.device_session_activity_is_recent(active.last_activity_at)
             and public.device_session_presence_is_recent(active.last_seen_at)
             then 'active'
           else 'stale'
         end,
         revoked.revoked_at
  from public.profile_active_sessions active
  left join public.profile_revoked_sessions revoked
    on revoked.profile_id = active.profile_id
   and revoked.session_id = active.session_id
  left join auth.sessions auth_session
    on auth_session.id = active.session_id
   and auth_session.user_id = active.profile_id
  where active.profile_id = p_profile_id
  order by active.activated_at, active.session_id;
end;
$$;

revoke all on function public.admin_list_device_sessions(uuid)
  from public, anon, service_role;
grant execute on function public.admin_list_device_sessions(uuid)
  to authenticated;

create or replace function public.admin_revoke_device_session(
  p_profile_id uuid,
  p_session_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  actor_id uuid := auth.uid();
  revoked_count integer := 0;
  inserted_count integer := 0;
begin
  if actor_id is null or not public.is_support_admin() then
    raise exception 'Only an active support admin may revoke device sessions'
      using errcode = '42501';
  end if;
  if p_profile_id is null
     or p_session_id is null
     or p_reason is null
     or pg_catalog.length(pg_catalog.btrim(p_reason)) not between 5 and 500
  then
    raise exception 'Provide a target profile, session, and reason (5-500 characters)'
      using errcode = '22023';
  end if;

  perform 1
  from public.profiles profile
  where profile.id = p_profile_id
  for update;
  if not found then
    raise exception 'Target profile does not exist'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.profile_revoked_sessions revoked
    where revoked.profile_id = p_profile_id
      and revoked.session_id = p_session_id
  ) then
    delete from public.profile_active_sessions active
    where active.profile_id = p_profile_id
      and active.session_id = p_session_id;
    return pg_catalog.jsonb_build_object(
      'status', 'revoked',
      'deactivated_sessions', 0
    );
  end if;

  insert into public.profile_revoked_sessions (profile_id, session_id)
  select active.profile_id, active.session_id
  from public.profile_active_sessions active
  where active.profile_id = p_profile_id
    and active.session_id = p_session_id
  on conflict (profile_id, session_id) do nothing;
  get diagnostics inserted_count = row_count;

  if inserted_count = 0 then
    return pg_catalog.jsonb_build_object(
      'status', 'inactive',
      'deactivated_sessions', 0
    );
  end if;

  insert into public.device_session_revocation_audit (
    profile_id, session_id, revoked_by, reason
  )
  values (
    p_profile_id, p_session_id, actor_id, pg_catalog.btrim(p_reason)
  );

  delete from public.profile_active_sessions active
  where active.profile_id = p_profile_id
    and active.session_id = p_session_id;
  get diagnostics revoked_count = row_count;

  if revoked_count <> 1 then
    raise exception 'Device session changed while it was being revoked'
      using errcode = '40001';
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'revoked',
    'deactivated_sessions', revoked_count
  );
end;
$$;

revoke all on function public.admin_revoke_device_session(uuid, uuid, text)
  from public, anon, service_role;
grant execute on function public.admin_revoke_device_session(uuid, uuid, text)
  to authenticated;

commit;
