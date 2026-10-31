begin;

create or replace function public.deactivate_current_session()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  uid uuid := auth.uid();
  current_session_id uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  revoked_count integer := 0;
begin
  if uid is null or current_session_id is null then
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
    and active.session_id = current_session_id
  on conflict (profile_id, session_id) do nothing;

  delete from public.profile_active_sessions
  where profile_id = uid
    and session_id = current_session_id;

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
