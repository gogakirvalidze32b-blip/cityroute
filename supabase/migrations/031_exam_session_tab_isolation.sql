-- Forward migration. Does not edit 028, 029, or the review-only 030 file.
-- A browser tab is an exam-session owner, not a device. Device capacity stays
-- one slot per active authenticated device, shared by every tab on that device.
-- Tab leases remain owned by supabase/operations/030_edge_only_exam_sessions.sql.

begin;

do $preflight$
begin
  if to_regclass('public.exam_sessions') is null
     or to_regprocedure('public.current_exam_device_is_active()') is null
     or to_regprocedure('public.current_device_session_limit(uuid)') is null
     or to_regprocedure('public.device_session_activity_is_recent(timestamptz)') is null
     or to_regprocedure('public.device_session_presence_is_recent(timestamptz)') is null
  then
    raise exception 'Migrations 027 and 028 are required before exam tab isolation';
  end if;
end
$preflight$;

create index if not exists exam_sessions_user_device_tab_status_idx
  on public.exam_sessions(user_id, device_id, tab_id, status, updated_at desc);

create or replace function public.current_exam_tab_id()
returns text
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select nullif(
    pg_catalog.btrim(coalesce(
      nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb
        ->> 'x-cityroute-exam-tab',
      ''
    )),
    ''
  );
$$;

revoke all on function public.current_exam_tab_id()
  from public, anon, authenticated, service_role;
grant execute on function public.current_exam_tab_id() to current_user;

create or replace function public.assert_current_exam_device_slot()
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  uid uuid := auth.uid();
  current_session_id uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  device_id text := nullif(
    pg_catalog.btrim(coalesce(
      nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb
        ->> 'x-cityroute-device-fingerprint',
      ''
    )),
    ''
  );
  slot_number bigint;
  slot_limit integer;
begin
  if uid is null or current_session_id is null
     or device_id is null or pg_catalog.length(device_id) not between 8 and 256
  then
    raise exception 'Active device session required';
  end if;

  -- Eligible rows are authenticated devices. Browser tabs do not create rows here.
  with eligible_devices as (
    select active.session_id,
           pg_catalog.row_number() over (
             order by active.activated_at, active.session_created_at, active.session_id
           ) as slot_number
    from public.profile_active_sessions active
    join auth.sessions auth_session
      on auth_session.id = active.session_id
     and auth_session.user_id = active.profile_id
    where active.profile_id = uid
      and active.device_fingerprint is not null
      and public.device_session_activity_is_recent(active.last_activity_at)
      and public.device_session_presence_is_recent(active.last_seen_at)
      and (auth_session.not_after is null or auth_session.not_after > pg_catalog.now())
      and not exists (
        select 1
        from public.profile_revoked_sessions revoked
        where revoked.profile_id = active.profile_id
          and revoked.session_id = active.session_id
      )
  )
  select eligible.slot_number, public.current_device_session_limit(uid)
    into slot_number, slot_limit
  from eligible_devices eligible
  join public.profile_active_sessions active
    on active.session_id = eligible.session_id
   and active.profile_id = uid
   and active.device_fingerprint = device_id
  where eligible.session_id = current_session_id;

  if slot_number is null then
    raise exception 'Active device session required';
  end if;
  if slot_number > slot_limit then
    raise exception 'device_slot_limit_exceeded' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.assert_current_exam_device_slot()
  from public, anon, authenticated, service_role;
grant execute on function public.assert_current_exam_device_slot() to current_user;

create or replace function public.create_exam_session(
  p_route_slug text,
  p_device_id text,
  p_tab_id text default null,
  p_progress jsonb default '{}'::jsonb,
  p_errors jsonb default '{}'::jsonb,
  p_elapsed_ms bigint default 0,
  p_started_at timestamptz default null,
  p_migration_key text default null,
  p_status text default 'active'
)
returns public.exam_sessions
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  uid uuid := auth.uid();
  header_device_id text;
  header_tab_id text;
  started_at_value timestamptz;
  created_row public.exam_sessions;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;

  perform public.assert_current_exam_device_slot();
  header_device_id := nullif(
    pg_catalog.btrim(coalesce(
      nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb
        ->> 'x-cityroute-device-fingerprint',
      ''
    )),
    ''
  );
  header_tab_id := public.current_exam_tab_id();

  if header_device_id is null
     or header_device_id <> pg_catalog.btrim(coalesce(p_device_id, ''))
     or pg_catalog.length(header_device_id) not between 8 and 256
  then
    raise exception 'Device identity mismatch';
  end if;
  if header_tab_id is null
     or pg_catalog.length(header_tab_id) not between 8 and 256
     or header_tab_id is distinct from nullif(pg_catalog.btrim(coalesce(p_tab_id, '')), '')
  then
    raise exception 'Exam tab identity is required' using errcode = '22023';
  end if;

  if not public.current_exam_device_is_active() then
    raise exception 'Active device session required';
  end if;

  if p_route_slug is null or pg_catalog.btrim(p_route_slug) = '' then
    raise exception 'Route slug is required';
  end if;
  if p_elapsed_ms is null or p_elapsed_ms < 0 then
    raise exception 'Elapsed time is invalid';
  end if;
  if p_status not in ('active', 'paused') then
    raise exception 'New sessions must be active or paused';
  end if;
  if p_progress is null or pg_catalog.jsonb_typeof(p_progress) <> 'object'
     or p_errors is null or pg_catalog.jsonb_typeof(p_errors) <> 'object'
  then
    raise exception 'Progress and errors must be JSON objects';
  end if;

  started_at_value := coalesce(p_started_at, pg_catalog.now());
  if started_at_value > pg_catalog.now() then
    raise exception 'Started time cannot be in the future';
  end if;

  if nullif(pg_catalog.btrim(coalesce(p_migration_key, '')), '') is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        uid::text || ':' || header_device_id || ':' || pg_catalog.btrim(p_migration_key),
        0
      )
    );
  end if;

  insert into public.exam_sessions (
    user_id, device_id, tab_id, route_slug, status, started_at,
    progress, errors, elapsed_ms, migration_key
  )
  values (
    uid, header_device_id, header_tab_id, pg_catalog.btrim(p_route_slug), p_status,
    started_at_value, p_progress, p_errors, p_elapsed_ms,
    nullif(pg_catalog.btrim(coalesce(p_migration_key, '')), '')
  )
  returning * into created_row;
  return created_row;
exception
  when unique_violation then
    if p_migration_key is not null then
      select existing_session.*
        into created_row
      from public.exam_sessions existing_session
      where existing_session.user_id = uid
        and existing_session.device_id = header_device_id
        and existing_session.tab_id = header_tab_id
        and existing_session.migration_key = pg_catalog.btrim(p_migration_key);
      if found then
        return created_row;
      end if;
      if exists (
        select 1
        from public.exam_sessions existing_session
        where existing_session.user_id = uid
          and existing_session.device_id = header_device_id
          and existing_session.migration_key = pg_catalog.btrim(p_migration_key)
          and existing_session.tab_id is distinct from header_tab_id
      ) then
        raise exception 'exam_session_idempotency_owner_mismatch' using errcode = '42501';
      end if;
    end if;
    raise;
end;
$$;

revoke all on function public.create_exam_session(text, text, text, jsonb, jsonb, bigint, timestamptz, text, text)
  from public, anon, service_role;
grant execute on function public.create_exam_session(text, text, text, jsonb, jsonb, bigint, timestamptz, text, text)
  to authenticated;

create or replace function public.get_exam_session(p_session_id uuid)
returns public.exam_sessions
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  uid uuid := auth.uid();
  header_device_id text;
  header_tab_id text;
  found_row public.exam_sessions;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;
  perform public.assert_current_exam_device_slot();
  if not public.current_exam_device_is_active() then
    raise exception 'Active device session required';
  end if;
  header_device_id := nullif(
    pg_catalog.btrim(coalesce(
      nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb
        ->> 'x-cityroute-device-fingerprint',
      ''
    )),
    ''
  );
  header_tab_id := public.current_exam_tab_id();
  if header_tab_id is null or pg_catalog.length(header_tab_id) not between 8 and 256 then
    raise exception 'Exam tab identity is required' using errcode = '22023';
  end if;

  select exam_session.*
    into found_row
  from public.exam_sessions exam_session
  where exam_session.session_id = p_session_id
    and exam_session.user_id = uid
    and exam_session.device_id = header_device_id
    and exam_session.tab_id = header_tab_id;
  return found_row;
end;
$$;

revoke all on function public.get_exam_session(uuid) from public, anon, service_role;
grant execute on function public.get_exam_session(uuid) to authenticated;

create or replace function public.list_active_exam_sessions()
returns setof public.exam_sessions
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  uid uuid := auth.uid();
  header_device_id text;
  header_tab_id text;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;
  perform public.assert_current_exam_device_slot();
  if not public.current_exam_device_is_active() then
    raise exception 'Active device session required';
  end if;
  header_device_id := nullif(
    pg_catalog.btrim(coalesce(
      nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb
        ->> 'x-cityroute-device-fingerprint',
      ''
    )),
    ''
  );
  header_tab_id := public.current_exam_tab_id();
  if header_tab_id is null or pg_catalog.length(header_tab_id) not between 8 and 256 then
    raise exception 'Exam tab identity is required' using errcode = '22023';
  end if;

  return query
  select exam_session.*
  from public.exam_sessions exam_session
  where exam_session.user_id = uid
    and exam_session.device_id = header_device_id
    and exam_session.tab_id = header_tab_id
    and exam_session.status in ('active', 'paused')
  order by exam_session.updated_at desc;
end;
$$;

revoke all on function public.list_active_exam_sessions() from public, anon, service_role;
grant execute on function public.list_active_exam_sessions() to authenticated;

create or replace function public.update_exam_session(
  p_session_id uuid,
  p_expected_version bigint,
  p_status text,
  p_progress jsonb,
  p_errors jsonb,
  p_elapsed_ms bigint
)
returns public.exam_sessions
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  uid uuid := auth.uid();
  header_device_id text;
  header_tab_id text;
  updated_row public.exam_sessions;
  current_version bigint;
  current_status text;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;
  perform public.assert_current_exam_device_slot();
  header_device_id := nullif(
    pg_catalog.btrim(coalesce(
      nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb
        ->> 'x-cityroute-device-fingerprint',
      ''
    )),
    ''
  );
  header_tab_id := public.current_exam_tab_id();
  if header_tab_id is null or pg_catalog.length(header_tab_id) not between 8 and 256 then
    raise exception 'Exam tab identity is required' using errcode = '22023';
  end if;
  if header_device_id is null or not public.current_exam_device_is_active() then
    raise exception 'Active device session required';
  end if;

  select exam_session.version, exam_session.status
    into current_version, current_status
  from public.exam_sessions exam_session
  where exam_session.session_id = p_session_id
    and exam_session.user_id = uid
    and exam_session.device_id = header_device_id
    and exam_session.tab_id = header_tab_id
  for update;

  if not found then
    raise exception 'Exam session not found or device mismatch';
  end if;
  if current_status in ('completed', 'abandoned') then
    raise exception 'Terminal exam sessions cannot be updated';
  end if;
  if current_version <> p_expected_version then
    raise exception using
      errcode = '40001',
      message = 'Exam session version conflict',
      detail = pg_catalog.jsonb_build_object(
        'session_id', p_session_id,
        'expected_version', p_expected_version,
        'current_version', current_version,
        'http_status', 409
      )::text;
  end if;
  if p_status not in ('active', 'paused') then
    raise exception 'Active updates must remain active or paused';
  end if;
  if p_progress is null or pg_catalog.jsonb_typeof(p_progress) <> 'object'
     or p_errors is null or pg_catalog.jsonb_typeof(p_errors) <> 'object'
     or p_elapsed_ms is null or p_elapsed_ms < 0
  then
    raise exception 'Invalid exam update';
  end if;

  update public.exam_sessions exam_session
  set status = p_status,
      progress = p_progress,
      errors = p_errors,
      elapsed_ms = p_elapsed_ms,
      version = exam_session.version + 1,
      updated_at = pg_catalog.now()
  where exam_session.session_id = p_session_id
    and exam_session.version = p_expected_version
    and exam_session.user_id = uid
    and exam_session.device_id = header_device_id
    and exam_session.tab_id = header_tab_id
    and exam_session.status in ('active', 'paused')
  returning * into updated_row;

  if not found then
    raise exception using errcode = '40001', message = 'Exam session update conflict';
  end if;
  return updated_row;
end;
$$;

revoke all on function public.update_exam_session(uuid, bigint, text, jsonb, jsonb, bigint)
  from public, anon, service_role;
grant execute on function public.update_exam_session(uuid, bigint, text, jsonb, jsonb, bigint)
  to authenticated;

create or replace function public.finish_exam_session(
  p_session_id uuid,
  p_expected_version bigint,
  p_progress jsonb,
  p_errors jsonb,
  p_elapsed_ms bigint,
  p_summary jsonb
)
returns public.exam_sessions
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  uid uuid := auth.uid();
  header_device_id text;
  header_tab_id text;
  finished_row public.exam_sessions;
  current_version bigint;
  current_status text;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;
  perform public.assert_current_exam_device_slot();
  header_device_id := nullif(
    pg_catalog.btrim(coalesce(
      nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb
        ->> 'x-cityroute-device-fingerprint',
      ''
    )),
    ''
  );
  header_tab_id := public.current_exam_tab_id();
  if header_tab_id is null or pg_catalog.length(header_tab_id) not between 8 and 256 then
    raise exception 'Exam tab identity is required' using errcode = '22023';
  end if;
  if header_device_id is null or not public.current_exam_device_is_active() then
    raise exception 'Active device session required';
  end if;

  select exam_session.version, exam_session.status
    into current_version, current_status
  from public.exam_sessions exam_session
  where exam_session.session_id = p_session_id
    and exam_session.user_id = uid
    and exam_session.device_id = header_device_id
    and exam_session.tab_id = header_tab_id
  for update;

  if not found then
    raise exception 'Exam session not found or device mismatch';
  end if;
  if current_status = 'completed' then
    raise exception 'Completed exam sessions cannot be finished again';
  end if;
  if current_status = 'abandoned' then
    raise exception 'Abandoned exam sessions cannot be finished';
  end if;
  if current_version <> p_expected_version then
    raise exception using
      errcode = '40001',
      message = 'Exam session version conflict',
      detail = pg_catalog.jsonb_build_object(
        'session_id', p_session_id,
        'expected_version', p_expected_version,
        'current_version', current_version,
        'http_status', 409
      )::text;
  end if;
  if p_progress is null or pg_catalog.jsonb_typeof(p_progress) <> 'object'
     or p_errors is null or pg_catalog.jsonb_typeof(p_errors) <> 'object'
     or p_summary is null or pg_catalog.jsonb_typeof(p_summary) <> 'object'
     or p_elapsed_ms is null or p_elapsed_ms < 0
  then
    raise exception 'Invalid completed exam state';
  end if;

  update public.exam_sessions exam_session
  set status = 'completed',
      progress = p_progress,
      errors = p_errors,
      elapsed_ms = p_elapsed_ms,
      summary = p_summary,
      finished_at = pg_catalog.now(),
      version = exam_session.version + 1,
      updated_at = pg_catalog.now()
  where exam_session.session_id = p_session_id
    and exam_session.version = p_expected_version
    and exam_session.user_id = uid
    and exam_session.device_id = header_device_id
    and exam_session.tab_id = header_tab_id
    and exam_session.status in ('active', 'paused')
  returning * into finished_row;

  if not found then
    raise exception using errcode = '40001', message = 'Exam session finish conflict';
  end if;
  return finished_row;
end;
$$;

revoke all on function public.finish_exam_session(uuid, bigint, jsonb, jsonb, bigint, jsonb)
  from public, anon, service_role;
grant execute on function public.finish_exam_session(uuid, bigint, jsonb, jsonb, bigint, jsonb)
  to authenticated;

create or replace function public.abandon_exam_session(p_session_id uuid, p_expected_version bigint)
returns public.exam_sessions
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  uid uuid := auth.uid();
  header_device_id text;
  header_tab_id text;
  abandoned_row public.exam_sessions;
  current_status text;
  current_version bigint;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;
  perform public.assert_current_exam_device_slot();
  header_device_id := nullif(
    pg_catalog.btrim(coalesce(
      nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb
        ->> 'x-cityroute-device-fingerprint',
      ''
    )),
    ''
  );
  header_tab_id := public.current_exam_tab_id();
  if header_tab_id is null or pg_catalog.length(header_tab_id) not between 8 and 256 then
    raise exception 'Exam tab identity is required' using errcode = '22023';
  end if;
  if header_device_id is null or not public.current_exam_device_is_active() then
    raise exception 'Active device session required';
  end if;

  select exam_session.status, exam_session.version
    into current_status, current_version
  from public.exam_sessions exam_session
  where exam_session.session_id = p_session_id
    and exam_session.user_id = uid
    and exam_session.device_id = header_device_id
    and exam_session.tab_id = header_tab_id
  for update;

  if not found then
    raise exception 'Exam session not found or device mismatch';
  end if;
  if current_status = 'completed' then
    raise exception 'Completed exam sessions cannot be abandoned';
  end if;
  if current_status = 'abandoned' then
    select exam_session.* into abandoned_row
    from public.exam_sessions exam_session
    where exam_session.session_id = p_session_id
      and exam_session.tab_id = header_tab_id;
    return abandoned_row;
  end if;
  if current_version <> p_expected_version then
    raise exception using
      errcode = '40001',
      message = 'Exam session version conflict',
      detail = pg_catalog.jsonb_build_object(
        'session_id', p_session_id,
        'expected_version', p_expected_version,
        'current_version', current_version,
        'http_status', 409
      )::text;
  end if;

  update public.exam_sessions exam_session
  set status = 'abandoned',
      version = exam_session.version + 1,
      updated_at = pg_catalog.now()
  where exam_session.session_id = p_session_id
    and exam_session.user_id = uid
    and exam_session.device_id = header_device_id
    and exam_session.tab_id = header_tab_id
    and exam_session.version = p_expected_version
    and exam_session.status in ('active', 'paused')
  returning * into abandoned_row;

  if not found then
    raise exception using errcode = '40001', message = 'Exam session abandon conflict';
  end if;
  return abandoned_row;
end;
$$;

revoke all on function public.abandon_exam_session(uuid, bigint) from public, anon, service_role;
grant execute on function public.abandon_exam_session(uuid, bigint) to authenticated;

commit;
