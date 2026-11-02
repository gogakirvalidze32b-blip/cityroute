#!/usr/bin/env bash
# Real concurrency check for device activation: parallel logins must never leave
# more active sessions than the plan allows (99 GEL = 1, 179 GEL = 2).
set -euo pipefail

DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
USER_99="00000000-0000-0000-0000-000000000891"
USER_179="00000000-0000-0000-0000-000000000892"
PSQL=(psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -t -A)

cleanup() {
  "${PSQL[@]}" <<SQL || true
delete from public.profile_active_sessions where profile_id in ('$USER_99', '$USER_179');
delete from public.profile_revoked_sessions where profile_id in ('$USER_99', '$USER_179');
delete from public.payment_transactions where user_id in ('$USER_99', '$USER_179');
delete from auth.sessions where user_id in ('$USER_99', '$USER_179');
delete from public.profiles where id in ('$USER_99', '$USER_179');
delete from auth.users where id in ('$USER_99', '$USER_179');
SQL
}
trap cleanup EXIT
cleanup

session_id() {
  printf '00000000-0000-0000-0000-00000009%s%02d' "$1" "$2"
}

seed_user() {
  local uid="$1" amount="$2" slots="$3" tag="$4" sessions="$5"
  "${PSQL[@]}" <<SQL
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('$uid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'race-$tag@example.test', '', now(), '{}', '{}', now(), now());
-- The on_auth_user_created trigger already created this profile; configure it for the plan.
update public.profiles
set subscription_status = 'active',
    subscription_plan = 'full',
    subscription_expires_at = now() + interval '30 days',
    device_slots = $slots,
    subscription_payment_id = 'race-$tag'
where id = '$uid';
insert into public.payment_transactions (user_id, provider, payment_id, merchant_payment_id, amount,
  currency, status, metadata, paid_at)
values ('$uid', 'bog', 'race-$tag', 'merchant-race-$tag', $amount, 'GEL', 'success',
  '{"provider":"bog","device_slots":$slots,"bank_status":"completed","bank_amount":"$amount","bank_currency":"GEL","bank_external_order_id":"merchant-race-$tag"}',
  now());
insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
select ('00000000-0000-0000-0000-00000009$tag' || lpad(n::text, 2, '0'))::uuid,
       '$uid', now() - (($sessions - n) * interval '1 minute'), now(), null
from generate_series(1, $sessions) n;
SQL
}

activate() {
  local uid="$1" sid="$2" fingerprint="$3"
  "${PSQL[@]}" <<SQL >/dev/null
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$uid","session_id":"$sid","role":"authenticated"}', true);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"$fingerprint"}', true);
select public.activate_current_session();
commit;
SQL
}

run_race() {
  local uid="$1" tag="$2" logins="$3" expected="$4"
  for round in 1 2 3 4 5; do
    "${PSQL[@]}" -c "delete from public.profile_active_sessions where profile_id = '$uid'; delete from public.profile_revoked_sessions where profile_id = '$uid';"
    pids=()
    for n in $(seq 1 "$logins"); do
      activate "$uid" "$(session_id "$tag" "$n")" "race-device-$tag-$n" &
      pids+=($!)
    done
    for pid in "${pids[@]}"; do wait "$pid"; done

    actual=$("${PSQL[@]}" -c "select count(*) from public.profile_active_sessions where profile_id = '$uid';")
    echo "round $round: $logins parallel logins for $uid -> $actual active (expected $expected)"
    if [ "$actual" != "$expected" ]; then
      echo "Parallel logins left $actual active sessions, expected $expected" >&2
      exit 1
    fi
  done

  remaining=$("${PSQL[@]}" -c "select count(*) from auth.sessions where user_id = '$uid';")
  if [ "$remaining" != "$logins" ]; then
    echo "Auth sessions were deleted: $remaining of $logins remain" >&2
    exit 1
  fi
}

seed_user "$USER_99" 99 1 11 6
seed_user "$USER_179" 179 2 12 6

# 99 GEL: six parallel logins leave exactly one session.
run_race "$USER_99" 11 6 1
# 179 GEL: six parallel logins leave exactly two sessions.
run_race "$USER_179" 12 6 2
echo "Parallel login races passed"
