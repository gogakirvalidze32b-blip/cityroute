begin;

do $preflight$
declare
  required_column record;
  active_sessions_oid oid := to_regclass('public.profile_active_sessions');
  revoked_sessions_oid oid := to_regclass('public.profile_revoked_sessions');
  active_session_check oid := to_regprocedure('public.has_current_active_session()');
  current_limit_check oid := to_regprocedure('public.current_device_session_limit(uuid)');
  activity_check oid := to_regprocedure('public.device_session_activity_is_recent(timestamptz)');
  presence_check oid := to_regprocedure('public.device_session_presence_is_recent(timestamptz)');
  updated_at_check oid := to_regprocedure('public.set_updated_at()');
  uuid_generator_check oid := to_regprocedure('pg_catalog.gen_random_uuid()');
  helper_owner oid;
  limit_owner oid;
  helper_definition text;
begin
  if to_regclass('auth.users') is null
     or to_regclass('auth.sessions') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.payment_transactions') is null
     or to_regclass('public.device_session_limit_overrides') is null
     or active_sessions_oid is null
     or revoked_sessions_oid is null
  then
    raise exception 'Supabase Auth and the 015/020 device-session tables are required before migration 028';
  end if;

  if to_regrole('anon') is null
     or to_regrole('authenticated') is null
     or to_regrole('service_role') is null
  then
    raise exception 'Supabase anon, authenticated, and service_role roles are required before migration 028';
  end if;

  if to_regprocedure('auth.uid()') is null
     or to_regprocedure('auth.jwt()') is null
     or not exists (
       select 1
       from pg_catalog.pg_proc auth_uid
       where auth_uid.oid = to_regprocedure('auth.uid()')
         and auth_uid.prorettype = 'uuid'::regtype
     )
     or not exists (
       select 1
       from pg_catalog.pg_proc auth_jwt
       where auth_jwt.oid = to_regprocedure('auth.jwt()')
         and auth_jwt.prorettype = 'jsonb'::regtype
     )
     or not has_function_privilege('authenticated', to_regprocedure('auth.uid()'), 'EXECUTE')
     or not has_function_privilege('authenticated', to_regprocedure('auth.jwt()'), 'EXECUTE')
  then
    raise exception 'Supabase auth.uid() and auth.jwt() with authenticated EXECUTE grants are required';
  end if;

  for required_column in
    select expected.schema_name, expected.table_name, expected.column_name,
           expected.data_type, expected.is_nullable
    from (values
      ('auth', 'users', 'id', 'uuid', 'NO'),
      ('auth', 'sessions', 'id', 'uuid', 'NO'),
      ('auth', 'sessions', 'user_id', 'uuid', 'NO'),
      ('auth', 'sessions', 'not_after', 'timestamp with time zone', 'YES'),
      ('public', 'profiles', 'id', 'uuid', 'NO'),
      ('public', 'profile_active_sessions', 'profile_id', 'uuid', 'NO'),
      ('public', 'profile_active_sessions', 'session_id', 'uuid', 'NO'),
      ('public', 'profile_active_sessions', 'session_created_at', 'timestamp with time zone', 'NO'),
      ('public', 'profile_active_sessions', 'activated_at', 'timestamp with time zone', 'NO'),
      ('public', 'profile_active_sessions', 'device_fingerprint', 'text', 'YES'),
      ('public', 'profile_active_sessions', 'last_activity_at', 'timestamp with time zone', 'NO'),
      ('public', 'profile_active_sessions', 'last_seen_at', 'timestamp with time zone', 'NO'),
      ('public', 'profile_revoked_sessions', 'profile_id', 'uuid', 'NO'),
      ('public', 'profile_revoked_sessions', 'session_id', 'uuid', 'NO')
    ) as expected(schema_name, table_name, column_name, data_type, is_nullable)
  loop
    if not exists (
      select 1
      from information_schema.columns column_info
      where column_info.table_schema = required_column.schema_name
        and column_info.table_name = required_column.table_name
        and column_info.column_name = required_column.column_name
        and column_info.data_type = required_column.data_type
        and column_info.is_nullable = required_column.is_nullable
    ) then
      raise exception 'Required column %.%.% is missing or has an incompatible type/nullability',
        required_column.schema_name, required_column.table_name, required_column.column_name;
    end if;
  end loop;

  if not exists (
       select 1
       from pg_catalog.pg_constraint constraint_info
       where constraint_info.conrelid = 'auth.users'::regclass
         and constraint_info.contype = 'p'
         and pg_catalog.pg_get_constraintdef(constraint_info.oid) = 'PRIMARY KEY (id)'
     )
     or not exists (
       select 1
       from pg_catalog.pg_constraint constraint_info
       where constraint_info.conrelid = 'auth.sessions'::regclass
         and constraint_info.contype = 'p'
         and pg_catalog.pg_get_constraintdef(constraint_info.oid) = 'PRIMARY KEY (id)'
     )
     or not exists (
       select 1
       from pg_catalog.pg_constraint constraint_info
       where constraint_info.conrelid = active_sessions_oid
         and constraint_info.contype = 'p'
         and pg_catalog.pg_get_constraintdef(constraint_info.oid)
           = 'PRIMARY KEY (profile_id, session_id)'
     )
     or not exists (
       select 1
       from pg_catalog.pg_constraint constraint_info
       join pg_catalog.pg_attribute profile_id
         on profile_id.attrelid = active_sessions_oid
        and profile_id.attname = 'profile_id'
        and not profile_id.attisdropped
       join pg_catalog.pg_attribute profile_key
         on profile_key.attrelid = 'public.profiles'::regclass
        and profile_key.attname = 'id'
        and not profile_key.attisdropped
       where constraint_info.conrelid = active_sessions_oid
         and constraint_info.confrelid = 'public.profiles'::regclass
         and constraint_info.contype = 'f'
         and constraint_info.convalidated
         and constraint_info.conkey = array[profile_id.attnum]
         and constraint_info.confkey = array[profile_key.attnum]
     )
     or not exists (
       select 1
       from pg_catalog.pg_constraint constraint_info
       join pg_catalog.pg_attribute profile_id
         on profile_id.attrelid = revoked_sessions_oid
        and profile_id.attname = 'profile_id'
        and not profile_id.attisdropped
       join pg_catalog.pg_attribute profile_key
         on profile_key.attrelid = 'public.profiles'::regclass
        and profile_key.attname = 'id'
        and not profile_key.attisdropped
       where constraint_info.conrelid = revoked_sessions_oid
         and constraint_info.confrelid = 'public.profiles'::regclass
         and constraint_info.contype = 'f'
         and constraint_info.convalidated
         and constraint_info.conkey = array[profile_id.attnum]
         and constraint_info.confkey = array[profile_key.attnum]
     )
     or not exists (
       select 1
       from pg_catalog.pg_constraint constraint_info
       where constraint_info.conrelid = revoked_sessions_oid
         and constraint_info.contype = 'p'
         and pg_catalog.pg_get_constraintdef(constraint_info.oid)
           = 'PRIMARY KEY (profile_id, session_id)'
     )
     or not exists (
       select 1
       from pg_catalog.pg_index index_info
       join pg_catalog.pg_class index_class on index_class.oid = index_info.indexrelid
       where index_info.indrelid = active_sessions_oid
         and index_info.indisunique
         and index_info.indisvalid
         and index_info.indisready
         and index_class.relname = 'profile_active_sessions_device_fingerprint_idx'
         and pg_catalog.pg_get_indexdef(index_info.indexrelid)
           like '%(profile_id, device_fingerprint)%'
         and pg_catalog.pg_get_expr(index_info.indpred, index_info.indrelid)
           like '%device_fingerprint IS NOT NULL%'
     )
     or not exists (
       select 1
       from pg_catalog.pg_index index_info
       join pg_catalog.pg_class index_class on index_class.oid = index_info.indexrelid
       where index_info.indrelid = active_sessions_oid
         and index_info.indisvalid
         and index_info.indisready
         and index_class.relname = 'profile_active_sessions_order_idx'
         and pg_catalog.pg_get_indexdef(index_info.indexrelid)
           like '%(profile_id, activated_at, session_id)%'
     )
  then
    raise exception 'The 015/018 device-session primary keys and indexes are required before migration 028';
  end if;

  if (
       select count(*)
       from pg_catalog.pg_class relation
       where relation.oid = any(array[
         'public.profiles'::regclass::oid,
         'public.payment_transactions'::regclass::oid,
         'public.device_session_limit_overrides'::regclass::oid,
         active_sessions_oid,
         revoked_sessions_oid
       ])
         and relation.relrowsecurity
     ) <> 5
  then
    raise exception 'RLS must already be enabled on profiles, payment, override, and device-session tables';
  end if;

  if has_table_privilege('anon', active_sessions_oid, 'SELECT, INSERT, UPDATE, DELETE')
     or has_table_privilege('authenticated', active_sessions_oid, 'SELECT, INSERT, UPDATE, DELETE')
     or has_table_privilege('anon', revoked_sessions_oid, 'SELECT, INSERT, UPDATE, DELETE')
     or has_table_privilege('authenticated', revoked_sessions_oid, 'SELECT, INSERT, UPDATE, DELETE')
  then
    raise exception 'Direct anon/authenticated access to device-session registry tables must remain revoked';
  end if;

  if not has_schema_privilege(current_user, 'public', 'USAGE, CREATE')
     or not has_schema_privilege(current_user, 'auth', 'USAGE')
     or not has_table_privilege(current_user, 'auth.users', 'REFERENCES')
     or not has_table_privilege(current_user, 'auth.sessions', 'SELECT')
     or not has_table_privilege(current_user, active_sessions_oid, 'SELECT')
     or not has_table_privilege(current_user, revoked_sessions_oid, 'SELECT')
     or not has_table_privilege(current_user, 'public.profiles', 'SELECT')
     or not has_table_privilege(current_user, 'public.payment_transactions', 'SELECT')
     or not has_table_privilege(current_user, 'public.device_session_limit_overrides', 'SELECT')
  then
    raise exception 'The migration role lacks required Supabase Auth/device-schema privileges';
  end if;

  if uuid_generator_check is null
     or not exists (
       select 1
       from pg_catalog.pg_proc uuid_generator
       where uuid_generator.oid = uuid_generator_check
         and uuid_generator.prorettype = 'uuid'::regtype
     )
     or not has_function_privilege(current_user, uuid_generator_check, 'EXECUTE')
  then
    raise exception 'pg_catalog.gen_random_uuid() returning uuid is required by exam_sessions';
  end if;

  if updated_at_check is null
     or not exists (
       select 1
       from pg_catalog.pg_proc updated_at
       where updated_at.oid = updated_at_check
         and updated_at.prorettype = 'trigger'::regtype
     )
     or not has_function_privilege(current_user, updated_at_check, 'EXECUTE')
  then
    raise exception 'public.set_updated_at() must exist, return trigger, and be executable by the migration role';
  end if;

  if active_session_check is null
     or current_limit_check is null
     or activity_check is null
     or presence_check is null
     or not exists (
       select 1
       from pg_catalog.pg_proc helper
       where helper.oid = active_session_check
         and helper.prorettype = 'boolean'::regtype
         and helper.prosecdef
         and exists (
           select 1 from unnest(helper.proconfig) setting
           where setting like 'search_path=%'
         )
     )
     or not exists (
       select 1
       from pg_catalog.pg_proc helper
       where helper.oid = current_limit_check
         and helper.prorettype = 'integer'::regtype
         and helper.prosecdef
         and exists (
           select 1 from unnest(helper.proconfig) setting
           where setting like 'search_path=%'
         )
     )
     or not exists (
       select 1
       from pg_catalog.pg_proc helper
       where helper.oid = activity_check
         and helper.prorettype = 'boolean'::regtype
         and helper.prosecdef
         and exists (
           select 1 from unnest(helper.proconfig) setting
           where setting like 'search_path=%'
         )
     )
     or not exists (
       select 1
       from pg_catalog.pg_proc helper
       where helper.oid = presence_check
         and helper.prorettype = 'boolean'::regtype
         and helper.prosecdef
         and exists (
           select 1 from unnest(helper.proconfig) setting
           where setting like 'search_path=%'
         )
     )
     or not has_function_privilege('authenticated', active_session_check, 'EXECUTE')
     or has_function_privilege('anon', active_session_check, 'EXECUTE')
  then
    raise exception 'The 020/026/027 device-session helpers have missing signatures, grants, or SECURITY DEFINER protection';
  end if;

  select helper.proowner, pg_catalog.pg_get_functiondef(helper.oid)
    into helper_owner, helper_definition
  from pg_catalog.pg_proc helper
  where helper.oid = active_session_check;

  select helper.proowner
    into limit_owner
  from pg_catalog.pg_proc helper
  where helper.oid = current_limit_check;

  if pg_catalog.strpos(helper_definition, 'current_device_session_limit') = 0
     or pg_catalog.strpos(helper_definition, 'device_session_activity_is_recent') = 0
     or pg_catalog.strpos(helper_definition, 'device_session_presence_is_recent') = 0
  then
    raise exception 'has_current_active_session() does not enforce the 020/026/027 device-session checks';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_roles helper_role
    where helper_role.oid = helper_owner
      and (
        helper_role.rolsuper
        or helper_role.rolbypassrls
        or not exists (
          select 1
          from pg_catalog.pg_class relation
          where relation.oid in (
            active_sessions_oid,
            revoked_sessions_oid,
            'auth.sessions'::regclass::oid
          )
            and relation.relrowsecurity
            and (
              relation.relowner <> helper_owner
              or relation.relforcerowsecurity
            )
        )
      )
  ) then
    raise exception 'has_current_active_session() owner must bypass RLS or own both device-session tables';
  end if;

  if not has_table_privilege(helper_owner, 'auth.sessions', 'SELECT')
     or not has_table_privilege(helper_owner, active_sessions_oid, 'SELECT')
     or not has_table_privilege(helper_owner, revoked_sessions_oid, 'SELECT')
  then
    raise exception 'has_current_active_session() owner lacks required Auth/device-session SELECT privileges';
  end if;

  if not has_function_privilege(helper_owner, 'auth.uid()'::regprocedure, 'EXECUTE')
     or not has_function_privilege(helper_owner, 'auth.jwt()'::regprocedure, 'EXECUTE')
     or not has_function_privilege(helper_owner, current_limit_check, 'EXECUTE')
     or not has_function_privilege(helper_owner, activity_check, 'EXECUTE')
     or not has_function_privilege(helper_owner, presence_check, 'EXECUTE')
  then
    raise exception 'has_current_active_session() owner lacks required Auth/device-helper EXECUTE privileges';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_roles helper_role
    where helper_role.oid = limit_owner
      and (
        helper_role.rolsuper
        or helper_role.rolbypassrls
        or not exists (
          select 1
          from pg_catalog.pg_class relation
          where relation.oid in (
            'public.profiles'::regclass::oid,
            'public.payment_transactions'::regclass::oid,
            'public.device_session_limit_overrides'::regclass::oid
          )
            and relation.relrowsecurity
            and (
              relation.relowner <> limit_owner
              or relation.relforcerowsecurity
            )
        )
      )
  ) then
    raise exception 'current_device_session_limit() owner cannot read its RLS-protected entitlement tables';
  end if;

  if not has_table_privilege(limit_owner, 'public.profiles', 'SELECT')
     or not has_table_privilege(limit_owner, 'public.payment_transactions', 'SELECT')
     or not has_table_privilege(limit_owner, 'public.device_session_limit_overrides', 'SELECT')
  then
    raise exception 'current_device_session_limit() owner lacks required entitlement-table SELECT privileges';
  end if;

  if to_regclass('public.exam_sessions') is not null then
    raise exception 'Migration 028 independent exam sessions has already been applied';
  end if;
end;
$preflight$;

create table public.exam_sessions (
  session_id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  tab_id text,
  route_slug text not null,
  status text not null default 'active'
    check (status in ('active', 'paused', 'completed', 'abandoned')),
  started_at timestamptz not null default pg_catalog.now(),
  finished_at timestamptz,
  version bigint not null default 1 check (version >= 1),
  progress jsonb not null default '{}'::jsonb,
  errors jsonb not null default '{}'::jsonb,
  elapsed_ms bigint not null default 0 check (elapsed_ms >= 0),
  summary jsonb,
  migration_key text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint exam_sessions_finished_consistency check (
    (status = 'completed' and finished_at is not null and summary is not null)
    or
    (status <> 'completed' and finished_at is null and summary is null)
  ),
  constraint exam_sessions_device_id_length check (
    pg_catalog.length(pg_catalog.btrim(device_id)) between 8 and 256
  ),
  constraint exam_sessions_tab_id_length check (
    tab_id is null or pg_catalog.length(pg_catalog.btrim(tab_id)) between 8 and 256
  )
);

create unique index exam_sessions_user_device_migration_key_idx
  on public.exam_sessions(user_id, device_id, migration_key)
  where migration_key is not null;

create index exam_sessions_user_status_updated_idx
  on public.exam_sessions(user_id, status, updated_at desc);

create index exam_sessions_user_device_status_idx
  on public.exam_sessions(user_id, device_id, status);

create index exam_sessions_route_idx
  on public.exam_sessions(route_slug);

drop trigger if exists exam_sessions_updated_at on public.exam_sessions;
create trigger exam_sessions_updated_at
  before update on public.exam_sessions
  for each row execute function public.set_updated_at();

alter table public.exam_sessions enable row level security;
alter table public.exam_sessions force row level security;

create policy exam_sessions_select_own
  on public.exam_sessions for select
  using (
    (select auth.uid()) = user_id
    and device_id = nullif(
      pg_catalog.btrim(coalesce(
        nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb
          ->> 'x-cityroute-device-fingerprint',
        ''
      )),
      ''
    )
  );

create policy exam_sessions_insert_own
  on public.exam_sessions for insert
  with check (
    (select auth.uid()) = user_id
    and device_id = nullif(
      pg_catalog.btrim(coalesce(
        nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb
          ->> 'x-cityroute-device-fingerprint',
        ''
      )),
      ''
    )
  );

create policy exam_sessions_update_own
  on public.exam_sessions for update
  using (
    (select auth.uid()) = user_id
    and device_id = nullif(
      pg_catalog.btrim(coalesce(
        nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb
          ->> 'x-cityroute-device-fingerprint',
        ''
      )),
      ''
    )
  )
  with check (
    (select auth.uid()) = user_id
    and device_id = nullif(
      pg_catalog.btrim(coalesce(
        nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb
          ->> 'x-cityroute-device-fingerprint',
        ''
      )),
      ''
    )
  );

create policy exam_sessions_delete_own
  on public.exam_sessions for delete
  using (
    (select auth.uid()) = user_id
    and device_id = nullif(
      pg_catalog.btrim(coalesce(
        nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb
          ->> 'x-cityroute-device-fingerprint',
        ''
      )),
      ''
    )
  );

revoke all on public.exam_sessions from public, anon, authenticated, service_role;

create or replace function public.current_exam_device_is_active()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  with caller as (
    select auth.uid() as user_id,
           nullif(auth.jwt() ->> 'session_id', '')::uuid as session_id,
           nullif(
             pg_catalog.btrim(coalesce(
               nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb
                 ->> 'x-cityroute-device-fingerprint',
               ''
             )),
             ''
           ) as device_id
  ),
  owned_device as (
    select active.session_id
    from public.profile_active_sessions active
    join caller c on c.user_id = active.profile_id
    join auth.sessions s
      on s.id = active.session_id
     and s.user_id = active.profile_id
    where active.session_id = c.session_id
      and active.device_fingerprint = c.device_id
      and c.device_id is not null
      and pg_catalog.length(c.device_id) between 8 and 256
      and (s.not_after is null or s.not_after > pg_catalog.now())
      and not exists (
        select 1
        from public.profile_revoked_sessions revoked
        where revoked.profile_id = active.profile_id
          and revoked.session_id = active.session_id
      )
  )
  select exists (select 1 from owned_device)
     and public.has_current_active_session();
$$;

revoke all on function public.current_exam_device_is_active()
  from public, anon, service_role;
grant execute on function public.current_exam_device_is_active()
  to authenticated;

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
  started_at_value timestamptz;
  created_row public.exam_sessions;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;

  header_device_id := nullif(
    pg_catalog.btrim(coalesce(
      nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb
        ->> 'x-cityroute-device-fingerprint',
      ''
    )),
    ''
  );

  if header_device_id is null
     or header_device_id <> pg_catalog.btrim(coalesce(p_device_id, ''))
     or pg_catalog.length(header_device_id) not between 8 and 256
  then
    raise exception 'Device identity mismatch';
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

  insert into public.exam_sessions (
    user_id,
    device_id,
    tab_id,
    route_slug,
    status,
    started_at,
    progress,
    errors,
    elapsed_ms,
    migration_key
  )
  values (
    uid,
    header_device_id,
    nullif(pg_catalog.btrim(coalesce(p_tab_id, '')), ''),
    pg_catalog.btrim(p_route_slug),
    p_status,
    started_at_value,
    p_progress,
    p_errors,
    p_elapsed_ms,
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
        and existing_session.migration_key = pg_catalog.btrim(p_migration_key);
      if found then
        return created_row;
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
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select exam_session.*
  from public.exam_sessions exam_session
  where exam_session.session_id = p_session_id
    and exam_session.user_id = auth.uid()
    and public.current_exam_device_is_active()
    and exam_session.device_id = nullif(
      pg_catalog.btrim(coalesce(
        nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb
          ->> 'x-cityroute-device-fingerprint',
        ''
      )),
      ''
    )
  limit 1;
$$;

revoke all on function public.get_exam_session(uuid) from public, anon, service_role;
grant execute on function public.get_exam_session(uuid) to authenticated;

create or replace function public.list_active_exam_sessions()
returns setof public.exam_sessions
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select exam_session.*
  from public.exam_sessions exam_session
  where exam_session.user_id = auth.uid()
    and exam_session.status in ('active', 'paused')
    and public.current_exam_device_is_active()
    and exam_session.device_id = nullif(
      pg_catalog.btrim(coalesce(
        nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb
          ->> 'x-cityroute-device-fingerprint',
        ''
      )),
      ''
    )
  order by exam_session.updated_at desc;
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
  updated_row public.exam_sessions;
  current_version bigint;
  current_status text;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;

  header_device_id := nullif(
    pg_catalog.btrim(coalesce(
      nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb
        ->> 'x-cityroute-device-fingerprint',
      ''
    )),
    ''
  );

  if header_device_id is null or not public.current_exam_device_is_active() then
    raise exception 'Active device session required';
  end if;

  select exam_session.version, exam_session.status
    into current_version, current_status
  from public.exam_sessions exam_session
  where exam_session.session_id = p_session_id
    and exam_session.user_id = uid
    and exam_session.device_id = header_device_id
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
  finished_row public.exam_sessions;
  current_version bigint;
  current_status text;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;

  header_device_id := nullif(
    pg_catalog.btrim(coalesce(
      nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb
        ->> 'x-cityroute-device-fingerprint',
      ''
    )),
    ''
  );

  if header_device_id is null or not public.current_exam_device_is_active() then
    raise exception 'Active device session required';
  end if;

  select exam_session.version, exam_session.status
    into current_version, current_status
  from public.exam_sessions exam_session
  where exam_session.session_id = p_session_id
    and exam_session.user_id = uid
    and exam_session.device_id = header_device_id
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
  abandoned_row public.exam_sessions;
  current_status text;
  current_version bigint;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;

  header_device_id := nullif(
    pg_catalog.btrim(coalesce(
      nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb
        ->> 'x-cityroute-device-fingerprint',
      ''
    )),
    ''
  );

  if header_device_id is null or not public.current_exam_device_is_active() then
    raise exception 'Active device session required';
  end if;

  select exam_session.status, exam_session.version
    into current_status, current_version
  from public.exam_sessions exam_session
  where exam_session.session_id = p_session_id
    and exam_session.user_id = uid
    and exam_session.device_id = header_device_id
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
    where exam_session.session_id = p_session_id;
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
    and exam_session.version = p_expected_version
    and exam_session.status in ('active', 'paused')
  returning * into abandoned_row;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'Exam session abandon conflict',
      detail = pg_catalog.jsonb_build_object(
        'session_id', p_session_id,
        'expected_version', p_expected_version,
        'http_status', 409
      )::text;
  end if;

  return abandoned_row;
end;
$$;

revoke all on function public.abandon_exam_session(uuid, bigint) from public, anon, service_role;
grant execute on function public.abandon_exam_session(uuid, bigint) to authenticated;

commit;
