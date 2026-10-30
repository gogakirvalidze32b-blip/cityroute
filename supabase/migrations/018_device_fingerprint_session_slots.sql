begin;

do $$
begin
  if to_regclass('public.profile_active_sessions') is null
     or to_regclass('public.profile_revoked_sessions') is null
     or to_regclass('public.device_session_limit_overrides') is null
     or to_regprocedure('public.current_device_session_limit(uuid)') is null
     or not exists (
       select 1
       from information_schema.columns
       where table_schema = 'auth'
         and table_name = 'sessions'
         and column_name = 'not_after'
         and data_type = 'timestamp with time zone'
     )
  then
    raise exception 'Migrations 015 and 017 plus auth.sessions.not_after are required before migration 018';
  end if;
end;
$$;

alter table public.profile_active_sessions
  add column if not exists device_fingerprint text;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.profile_active_sessions'::regclass
      and conname = 'profile_active_sessions_fingerprint_length_check'
  ) then
    alter table public.profile_active_sessions
      add constraint profile_active_sessions_fingerprint_length_check
      check (
        device_fingerprint is null
        or pg_catalog.length(pg_catalog.btrim(device_fingerprint)) between 8 and 256
      );
  end if;
end;
$$;

create unique index if not exists profile_active_sessions_device_fingerprint_idx
  on public.profile_active_sessions (profile_id, device_fingerprint)
  where device_fingerprint is not null;

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

create or replace function public.activate_current_session()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  uid uuid := auth.uid();
  current_session_id uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  current_session_created_at timestamptz;
  current_fingerprint text;
  session_limit integer;
  active_session_count integer;
begin
  if uid is null or current_session_id is null then
    return pg_catalog.jsonb_build_object(
      'status', 'blocked',
      'message', 'ვერ მოხერხდა აქტიური სესიის დადგენა. ხელახლა შედით.'
    );
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
    return pg_catalog.jsonb_build_object(
      'status', 'blocked',
      'message', 'მოწყობილობის იდენტიფიკაცია ვერ მოხერხდა. განაახლეთ გვერდი და სცადეთ ხელახლა.'
    );
  end if;

  select s.created_at
  into current_session_created_at
  from auth.sessions s
  where s.id = current_session_id
    and s.user_id = uid
    and (s.not_after is null or s.not_after > pg_catalog.now());

  if not found then
    return pg_catalog.jsonb_build_object(
      'status', 'blocked',
      'message', 'სესია აღარ არის მოქმედი. ხელახლა შედით.'
    );
  end if;

  perform 1
  from public.profiles p
  where p.id = uid
  for update;

  if not found then
    return pg_catalog.jsonb_build_object(
      'status', 'blocked',
      'message', 'ანგარიშის ინფორმაცია ვერ მოიძებნა'
    );
  end if;

  if exists (
    select 1
    from public.profile_revoked_sessions revoked
    where revoked.profile_id = uid
      and revoked.session_id = current_session_id
  ) then
    return pg_catalog.jsonb_build_object(
      'status', 'blocked',
      'message', 'ეს სესია გასულია. ხელახლა შედით.'
    );
  end if;

  session_limit := public.current_device_session_limit(uid);

  if exists (
    select 1
    from public.profile_active_sessions active
    join auth.sessions s
      on s.id = active.session_id
     and s.user_id = active.profile_id
    where active.profile_id = uid
      and active.device_fingerprint = current_fingerprint
      and active.session_id <> current_session_id
      and s.created_at > current_session_created_at
      and (s.not_after is null or s.not_after > pg_catalog.now())
      and not exists (
        select 1
        from public.profile_revoked_sessions revoked
        where revoked.profile_id = active.profile_id
          and revoked.session_id = active.session_id
      )
  ) then
    return pg_catalog.jsonb_build_object(
      'status', 'blocked',
      'message', 'ამ მოწყობილობაზე უფრო ახალი სესია უკვე აქტიურია. ხელახლა შედით.'
    );
  end if;

  delete from public.profile_active_sessions active
  where active.profile_id = uid
    and not exists (
      select 1
      from auth.sessions s
      where s.id = active.session_id
        and s.user_id = active.profile_id
        and (s.not_after is null or s.not_after > pg_catalog.now())
    );

  insert into public.profile_revoked_sessions (profile_id, session_id)
  select active.profile_id, active.session_id
  from public.profile_active_sessions active
  where active.profile_id = uid
    and active.device_fingerprint = current_fingerprint
    and active.session_id <> current_session_id
  on conflict (profile_id, session_id) do nothing;

  delete from public.profile_active_sessions active
  where active.profile_id = uid
    and active.device_fingerprint = current_fingerprint
    and active.session_id <> current_session_id;

  update public.profile_active_sessions active
  set device_fingerprint = current_fingerprint,
      updated_at = pg_catalog.now()
  where active.profile_id = uid
    and active.session_id = current_session_id;

  insert into public.profile_revoked_sessions (profile_id, session_id)
  select active.profile_id, active.session_id
  from public.profile_active_sessions active
  where active.profile_id = uid
    and active.device_fingerprint is null
    and active.session_id <> current_session_id
  on conflict (profile_id, session_id) do nothing;

  delete from public.profile_active_sessions active
  where active.profile_id = uid
    and active.device_fingerprint is null;

  with ranked_sessions as (
    select active.session_id,
           pg_catalog.row_number() over (
             order by active.activated_at, active.session_created_at, active.session_id
           ) as slot_number
    from public.profile_active_sessions active
    join auth.sessions s
      on s.id = active.session_id
     and s.user_id = active.profile_id
    where active.profile_id = uid
      and active.device_fingerprint is not null
      and (s.not_after is null or s.not_after > pg_catalog.now())
      and not exists (
        select 1
        from public.profile_revoked_sessions revoked
        where revoked.profile_id = active.profile_id
          and revoked.session_id = active.session_id
      )
  )
  insert into public.profile_revoked_sessions (profile_id, session_id)
  select uid, ranked.session_id
  from ranked_sessions ranked
  where ranked.slot_number > session_limit
  on conflict (profile_id, session_id) do nothing;

  delete from public.profile_active_sessions active
  where active.profile_id = uid
    and exists (
      select 1
      from public.profile_revoked_sessions revoked
      where revoked.profile_id = active.profile_id
        and revoked.session_id = active.session_id
    );

  if exists (
    select 1
    from public.profile_revoked_sessions revoked
    where revoked.profile_id = uid
      and revoked.session_id = current_session_id
  ) then
    return pg_catalog.jsonb_build_object(
      'status', 'blocked',
      'message', 'ეს სესია გასულია. ხელახლა შედით.'
    );
  end if;

  if exists (
    select 1
    from public.profile_active_sessions active
    where active.profile_id = uid
      and active.session_id = current_session_id
  ) then
    return pg_catalog.jsonb_build_object(
      'status', 'active',
      'device_limit', session_limit
    );
  end if;

  select count(*)::integer
  into active_session_count
  from public.profile_active_sessions active
  join auth.sessions s
    on s.id = active.session_id
   and s.user_id = active.profile_id
  where active.profile_id = uid
    and active.device_fingerprint is not null
    and (s.not_after is null or s.not_after > pg_catalog.now())
    and not exists (
      select 1
      from public.profile_revoked_sessions revoked
      where revoked.profile_id = active.profile_id
        and revoked.session_id = active.session_id
    );

  if session_limit = 1 and active_session_count > 0 then
    if exists (
      select 1
      from public.profile_active_sessions active
      join auth.sessions s
        on s.id = active.session_id
       and s.user_id = active.profile_id
      where active.profile_id = uid
        and (s.not_after is null or s.not_after > pg_catalog.now())
        and s.created_at > current_session_created_at
        and not exists (
          select 1
          from public.profile_revoked_sessions revoked
          where revoked.profile_id = active.profile_id
            and revoked.session_id = active.session_id
        )
    ) then
      return pg_catalog.jsonb_build_object(
        'status', 'blocked',
        'message', 'ამ ანგარიშზე უფრო ახალი სესია უკვე აქტიურია. ხელახლა შედით.'
      );
    end if;

    insert into public.profile_revoked_sessions (profile_id, session_id)
    select active.profile_id, active.session_id
    from public.profile_active_sessions active
    where active.profile_id = uid
      and active.device_fingerprint is not null
    on conflict (profile_id, session_id) do nothing;

    delete from public.profile_active_sessions active
    where active.profile_id = uid;

    active_session_count := 0;
  end if;

  if active_session_count >= session_limit then
    return pg_catalog.jsonb_build_object(
      'status', 'blocked',
      'message', pg_catalog.format(
        'ამ ანგარიშზე ერთდროულად მაქსიმუმ %s მოწყობილობა შეიძლება იყოს აქტიური. გამოდით სხვა მოწყობილობიდან და სცადეთ ხელახლა.',
        session_limit
      )
    );
  end if;

  insert into public.profile_active_sessions (
    profile_id,
    session_id,
    session_created_at,
    activated_at,
    updated_at,
    device_fingerprint
  )
  values (
    uid,
    current_session_id,
    current_session_created_at,
    pg_catalog.now(),
    pg_catalog.now(),
    current_fingerprint
  );

  return pg_catalog.jsonb_build_object(
    'status', 'active',
    'device_limit', session_limit
  );
end;
$$;

revoke all on function public.activate_current_session() from public, anon;
grant execute on function public.activate_current_session() to authenticated;

commit;
