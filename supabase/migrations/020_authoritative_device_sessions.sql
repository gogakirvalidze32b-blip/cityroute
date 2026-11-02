begin;

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.payment_transactions') is null
     or to_regclass('public.profile_active_sessions') is null
     or to_regclass('public.profile_revoked_sessions') is null
     or to_regclass('public.device_session_limit_overrides') is null
     or to_regprocedure('public.has_current_active_session()') is null
     or not exists (
       select 1
       from information_schema.columns
       where table_schema = 'auth'
         and table_name = 'sessions'
         and column_name = 'not_after'
         and data_type = 'timestamp with time zone'
     )
  then
    raise exception 'Migrations 015, 017, and 018 plus auth.sessions.not_after are required before migration 020';
  end if;
end;
$$;

do $$
begin
  if pg_catalog.strpos(
    pg_catalog.lower(
      pg_catalog.pg_get_functiondef('public.current_device_session_limit(uuid)'::regprocedure)
    ),
    'full'
  ) = 0 then
    raise exception 'Migration 019 must be applied before migration 020';
  end if;
end;
$$;

create or replace function public.current_verified_premium_device_slots(p_profile_id uuid)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce((
    select case when t.amount = 179 then 2 else 1 end
    from public.profiles p
    join public.payment_transactions t
      on t.user_id = p.id
     and t.payment_id = p.subscription_payment_id
    where p.id = p_profile_id
      and p.subscription_status = 'active'
      and p.subscription_plan in ('full', 'premium')
      and (p.subscription_expires_at is null or p.subscription_expires_at > pg_catalog.now())
      and t.amount in (99, 179)
      and t.status = 'success'
      and t.currency = 'GEL'
      and t.paid_at is not null
      and (
        (
          t.provider = 'bog'
          and t.metadata->>'device_slots' = case when t.amount = 179 then '2' else '1' end
          and t.metadata->>'bank_status' = 'completed'
          and t.metadata->>'bank_currency' = 'GEL'
          and t.metadata->>'bank_external_order_id' = t.merchant_payment_id
          and case
            when coalesce(t.metadata->>'bank_amount', '') ~ '^[0-9]+(\.[0-9]+)?$'
              then (t.metadata->>'bank_amount')::numeric = t.amount
            else false
          end
        )
        or t.provider = 'tbc'
      )
    order by case when t.provider = 'bog' then 0 else 1 end
    limit 1
  ), 0);
$$;

revoke all on function public.current_verified_premium_device_slots(uuid)
  from public, anon, authenticated;

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
            and p.subscription_payment_id is null
            and (p.subscription_expires_at is null or p.subscription_expires_at > pg_catalog.now())
          )
          or public.current_verified_premium_device_slots(p.id) > 0
        )
    );
$$;

revoke all on function public.has_active_access(uuid) from public, anon;
grant execute on function public.has_active_access(uuid) to authenticated;

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

  delete from public.profile_active_sessions active
  where active.profile_id = uid
    and exists (
      select 1
      from public.profile_revoked_sessions revoked
      where revoked.profile_id = active.profile_id
        and revoked.session_id = active.session_id
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
      'device_limit', session_limit,
      'access_active', public.has_active_access(uid)
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
    'device_limit', session_limit,
    'access_active', public.has_active_access(uid)
  );
end;
$$;

revoke all on function public.activate_current_session() from public, anon;
grant execute on function public.activate_current_session() to authenticated;

create or replace function public.deactivate_current_session()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  uid uuid := auth.uid();
  revoked_count integer := 0;
begin
  if uid is null then
    return pg_catalog.jsonb_build_object(
      'status', 'inactive',
      'deactivated_sessions', 0
    );
  end if;

  perform 1
  from public.profiles p
  where p.id = uid
  for update;

  if not found then
    return pg_catalog.jsonb_build_object(
      'status', 'inactive',
      'deactivated_sessions', 0
    );
  end if;

  insert into public.profile_revoked_sessions (profile_id, session_id)
  select active.profile_id, active.session_id
  from public.profile_active_sessions active
  where active.profile_id = uid
  on conflict (profile_id, session_id) do nothing;

  delete from public.profile_active_sessions
  where profile_id = uid;

  get diagnostics revoked_count = row_count;

  if revoked_count = 0 then
    return pg_catalog.jsonb_build_object(
      'status', 'inactive',
      'deactivated_sessions', 0
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'deactivated',
    'deactivated_sessions', revoked_count
  );
end;
$$;

revoke all on function public.deactivate_current_session() from public, anon;
grant execute on function public.deactivate_current_session() to authenticated;

commit;
