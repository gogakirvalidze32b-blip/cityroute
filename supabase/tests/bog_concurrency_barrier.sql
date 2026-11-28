-- Shared barrier helpers for two independent PostgreSQL sessions.
-- Uses session-level advisory locks (visible in pg_locks immediately),
-- never uncommitted row updates, so BEGIN in workers cannot deadlock the sync.
--
-- Two-phase rendezvous:
--   1) each session holds ready_<self> and waits until ready_<peer> is held
--   2) each session holds release_<self> and waits until release_<peer> is held
-- Only after both phases succeed does barrier_enter return, so both workers
-- reach the same concurrent execution point before the race body runs.

create schema if not exists bog_test_support;

create or replace function bog_test_support.barrier_namespace(p_run_id uuid, p_scenario text)
returns integer
language sql
immutable
as $fn$
  select ('x' || substr(md5(p_run_id::text || chr(1) || p_scenario), 1, 8))::bit(32)::int;
$fn$;

create or replace function bog_test_support.barrier_lock_held(
  p_namespace integer,
  p_objid integer
)
returns boolean
language sql
stable
as $fn$
  select exists (
    select 1
    from pg_catalog.pg_locks l
    where l.locktype = 'advisory'
      and l.classid = p_namespace
      and l.objid = p_objid
      and l.objsubid = 2
      and l.granted
      and l.pid is distinct from pg_catalog.pg_backend_pid()
  );
$fn$;

create or replace function bog_test_support.barrier_wait_for_peer(
  p_namespace integer,
  p_objid integer,
  p_deadline timestamptz,
  p_scenario text,
  p_actor text,
  p_phase text
)
returns void
language plpgsql
as $fn$
begin
  loop
    exit when bog_test_support.barrier_lock_held(p_namespace, p_objid);

    if pg_catalog.clock_timestamp() >= p_deadline then
      raise exception
        'Timed out waiting for peer at bog concurrency barrier (% / % / %)',
        p_scenario, p_actor, p_phase;
    end if;

    perform pg_catalog.pg_sleep(0.01);
  end loop;
end;
$fn$;

create or replace function bog_test_support.barrier_enter(
  p_run_id uuid,
  p_scenario text,
  p_actor text,
  p_timeout_seconds integer default 30
)
returns void
language plpgsql
as $fn$
declare
  v_ns integer := bog_test_support.barrier_namespace(p_run_id, p_scenario);
  v_ready_self integer;
  v_ready_peer integer;
  v_release_self integer;
  v_release_peer integer;
  v_deadline timestamptz := pg_catalog.clock_timestamp()
    + make_interval(secs => greatest(p_timeout_seconds, 1));
  v_ready_held boolean := false;
  v_release_held boolean := false;
begin
  if p_actor is distinct from 'a' and p_actor is distinct from 'b' then
    raise exception 'barrier actor must be a or b';
  end if;

  v_ready_self := case when p_actor = 'a' then 1 else 2 end;
  v_ready_peer := case when p_actor = 'a' then 2 else 1 end;
  v_release_self := case when p_actor = 'a' then 3 else 4 end;
  v_release_peer := case when p_actor = 'a' then 4 else 3 end;

  begin
    -- Phase 1: announce arrival (session-level; visible immediately in pg_locks).
    perform pg_catalog.pg_advisory_lock(v_ns, v_ready_self);
    v_ready_held := true;
    perform bog_test_support.barrier_wait_for_peer(
      v_ns, v_ready_peer, v_deadline, p_scenario, p_actor, 'ready'
    );

    -- Phase 2: both observed ready locks; rendezvous before returning to the race.
    perform pg_catalog.pg_advisory_lock(v_ns, v_release_self);
    v_release_held := true;
    perform bog_test_support.barrier_wait_for_peer(
      v_ns, v_release_peer, v_deadline, p_scenario, p_actor, 'release'
    );
  exception
    when others then
      if v_release_held then
        perform pg_catalog.pg_advisory_unlock(v_ns, v_release_self);
      end if;
      if v_ready_held then
        perform pg_catalog.pg_advisory_unlock(v_ns, v_ready_self);
      end if;
      raise;
  end;
end;
$fn$;

create or replace function bog_test_support.barrier_leave(
  p_run_id uuid,
  p_scenario text,
  p_actor text
)
returns void
language plpgsql
as $fn$
declare
  v_ns integer := bog_test_support.barrier_namespace(p_run_id, p_scenario);
  v_ready_self integer := case when p_actor = 'a' then 1 else 2 end;
  v_release_self integer := case when p_actor = 'a' then 3 else 4 end;
begin
  perform pg_catalog.pg_advisory_unlock(v_ns, v_release_self);
  perform pg_catalog.pg_advisory_unlock(v_ns, v_ready_self);
end;
$fn$;
