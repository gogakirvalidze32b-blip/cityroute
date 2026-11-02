#!/usr/bin/env bash
# CI check for migration 027 on a database that already has 026 + 027 applied:
#   1. the rollback restores the 026 functions, bodies and grants and removes everything 027 added;
#   2. migration 027 upgrades existing registry rows with a 5-minute presence grace
#      (last_seen_at = now()), keeps the 30-minute idle rule, and deletes nothing.
# Test data is isolated to one throw-away user and removed on exit. The database ends with 027 applied.
set -euo pipefail

DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROLLBACK="$ROOT/supabase/rollbacks/027_device_session_presence.rollback.sql"
MIGRATION="$ROOT/supabase/migrations/027_device_session_presence.sql"
M026="$ROOT/supabase/migrations/026_device_session_activity_heartbeat.sql"
UID_T="00000000-0000-0000-0000-000000000861"
S_A="00000000-0000-0000-0000-0000000861a1"
S_B="00000000-0000-0000-0000-0000000861b1"
S_C="00000000-0000-0000-0000-0000000861c1"
PSQL=(psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -t -A)

fail() { echo "FAIL: $*" >&2; exit 1; }
q() { "${PSQL[@]}" -c "$1"; }
expect() { # expect <description> <expected> <actual>
  if [ "$2" != "$3" ]; then fail "$1 (expected '$2', got '$3')"; fi
  echo "ok - $1"
}

cleanup() {
  "${PSQL[@]}" <<SQL >/dev/null 2>&1 || true
drop schema if exists rb_check cascade;
delete from public.profile_active_sessions where profile_id = '$UID_T';
delete from public.profile_revoked_sessions where profile_id = '$UID_T';
delete from auth.sessions where user_id = '$UID_T';
delete from public.profiles where id = '$UID_T';
delete from auth.users where id = '$UID_T';
SQL
  rm -rf "${TMP:-}"
}
trap cleanup EXIT
cleanup
TMP="$(mktemp -d)"

ACL_SQL="select string_agg(x, ';' order by x) from (
  select p.proname || '|' || (case when a.grantee = 0 then 'public' else a.grantee::regrole::text end) || '|' || a.privilege_type as x
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace,
  lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where n.nspname = 'public'
    and p.pronargs = 0
    and p.proname in ('activate_current_session', 'has_current_active_session', 'heartbeat_current_session')
) s;"

BODY_SQL() {
  echo "select string_agg(p.proname || '|' || md5(p.prosrc) || '|' || p.prosecdef || '|' || p.provolatile || '|' || coalesce(p.proconfig::text, '') || '|' || p.prorettype::regtype::text, ';' order by p.proname)
        from pg_proc p where p.pronamespace = '$1'::regnamespace and p.pronargs = 0
          and p.proname in ('activate_current_session', 'has_current_active_session', 'heartbeat_current_session');"
}

# ---------- 1. rollback ----------
expect "027 is applied before the rollback" "t" "$(q "select to_regprocedure('public.presence_current_session()') is not null")"
ACL_BEFORE="$(q "$ACL_SQL")"

"${PSQL[@]}" -f "$ROLLBACK" >/dev/null

expect "rollback removes the 027-only functions" "0" "$(q "select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('presence_current_session', 'touch_current_session_presence', 'device_session_presence_is_recent', 'activate_current_session_before_presence')")"
expect "rollback removes last_seen_at" "0" "$(q "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'profile_active_sessions' and column_name = 'last_seen_at'")"
expect "026 inner function still exists" "t" "$(q "select to_regprocedure('public.activate_current_session_before_activity()') is not null")"
expect "rollback keeps the grants of the three client RPCs" "$ACL_BEFORE" "$(q "$ACL_SQL")"
expect "authenticated can call the restored RPCs, anon cannot" "t|f" "$(q "select (has_function_privilege('authenticated', 'public.activate_current_session()', 'execute')
    and has_function_privilege('authenticated', 'public.has_current_active_session()', 'execute')
    and has_function_privilege('authenticated', 'public.heartbeat_current_session()', 'execute'))::text || '|' ||
    (has_function_privilege('anon', 'public.activate_current_session()', 'execute')
    or has_function_privilege('anon', 'public.has_current_active_session()', 'execute')
    or has_function_privilege('anon', 'public.heartbeat_current_session()', 'execute'))::text" | sed 's/true/t/g; s/false/f/g')"
expect "026 inner function is not callable by clients" "f" "$(q "select (has_function_privilege('authenticated', 'public.activate_current_session_before_activity()', 'execute')
    or has_function_privilege('anon', 'public.activate_current_session_before_activity()', 'execute'))")"

# Build copies of the three 026 definitions in a scratch schema and compare their catalog bodies.
python3 - "$M026" > "$TMP/026_copies.sql" <<'PY'
import re, sys
src = open(sys.argv[1], encoding='utf-8').read().replace('\r\n', '\n')
print('create schema rb_check;')
for name in ('has_current_active_session', 'heartbeat_current_session', 'activate_current_session'):
    m = re.search(r'create or replace function public\.' + name + r'\(\).*?\n\$\$;', src, re.S)
    if not m:
        sys.exit('missing ' + name + ' in migration 026')
    print(m.group(0).replace('public.' + name + '()', 'rb_check.' + name + '()', 1))
PY
"${PSQL[@]}" -f "$TMP/026_copies.sql" >/dev/null
expect "rolled-back function bodies equal the migration 026 definitions" "$(q "$(BODY_SQL rb_check)")" "$(q "$(BODY_SQL public)")"
q "drop schema rb_check cascade" >/dev/null

# ---------- 2. upgrade with existing rows (database is now in the 026 state) ----------
"${PSQL[@]}" <<SQL
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('$UID_T', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'upgrade-027@example.test', '', now(), '{}', '{}', now(), now());
update public.profiles
set subscription_status = 'active', subscription_plan = 'full',
    subscription_expires_at = now() + interval '30 days', device_slots = 2,
    subscription_payment_id = null
where id = '$UID_T';
insert into auth.sessions (id, user_id, created_at, updated_at, not_after) values
  ('$S_A', '$UID_T', now() - interval '60 minutes', now(), null),
  ('$S_B', '$UID_T', now() - interval '59 minutes', now(), null),
  ('$S_C', '$UID_T', now() - interval '58 minutes', now(), null);
insert into public.profile_active_sessions
  (profile_id, session_id, session_created_at, activated_at, updated_at, device_fingerprint, last_activity_at)
values
  ('$UID_T', '$S_A', now() - interval '60 minutes', now() - interval '50 minutes', now(), 'upgrade-device-a', now() - interval '10 minutes'),
  ('$UID_T', '$S_B', now() - interval '59 minutes', now() - interval '49 minutes', now(), 'upgrade-device-b', now() - interval '25 minutes'),
  ('$UID_T', '$S_C', now() - interval '58 minutes', now() - interval '48 minutes', now(), 'upgrade-device-c', now() - interval '40 minutes');
SQL

AUTH_BEFORE="$(q "select count(*) from auth.sessions where user_id = '$UID_T'")"
REVOKED_BEFORE="$(q "select count(*) from public.profile_revoked_sessions where profile_id = '$UID_T'")"

"${PSQL[@]}" -f "$MIGRATION" >/dev/null

active_as() { # active_as <session id> <fingerprint> -> t/f from has_current_active_session()
  "${PSQL[@]}" <<SQL | tail -n 1
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$UID_T","session_id":"$1","role":"authenticated"}', true);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"$2"}', true);
select public.has_current_active_session();
commit;
SQL
}

expect "existing rows are kept" "3" "$(q "select count(*) from public.profile_active_sessions where profile_id = '$UID_T'")"
expect "every existing row gets a fresh presence timestamp (5-minute grace)" "3" "$(q "select count(*) from public.profile_active_sessions where profile_id = '$UID_T' and last_seen_at > now() - interval '2 minutes' and last_seen_at > last_activity_at")"
expect "the grace is not copied from last_activity_at" "t" "$(q "select last_seen_at > last_activity_at + interval '5 minutes' from public.profile_active_sessions where session_id = '$S_A'")"
expect "device A keeps its slot right after migration" "t" "$(active_as "$S_A" upgrade-device-a)"
expect "device B keeps its slot right after migration" "t" "$(active_as "$S_B" upgrade-device-b)"
expect "the 30-minute idle rule still applies to old rows" "f" "$(active_as "$S_C" upgrade-device-c)"

q "update public.profile_active_sessions set last_seen_at = now() - interval '6 minutes' where session_id = '$S_A'" >/dev/null
expect "the 5-minute presence rule applies to migrated rows" "f" "$(active_as "$S_A" upgrade-device-a)"
expect "a migrated row with fresh presence is unaffected" "t" "$(active_as "$S_B" upgrade-device-b)"

expect "registry rows are not deleted by the migration" "3" "$(q "select count(*) from public.profile_active_sessions where profile_id = '$UID_T'")"
expect "Auth sessions are untouched" "$AUTH_BEFORE" "$(q "select count(*) from auth.sessions where user_id = '$UID_T'")"
expect "revoked history is untouched" "$REVOKED_BEFORE" "$(q "select count(*) from public.profile_revoked_sessions where profile_id = '$UID_T'")"
expect "the grants of the client RPCs match the pre-rollback state" "$ACL_BEFORE" "$(q "$ACL_SQL")"
expect "027 is applied again at the end" "t" "$(q "select to_regprocedure('public.presence_current_session()') is not null")"

echo "Migration 027 rollback and upgrade checks passed"
