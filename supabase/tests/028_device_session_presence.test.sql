begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(63);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000901', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'presence-179-test@example.test', '', pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000902', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'presence-99-test@example.test', '', pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now())
on conflict (id) do nothing;

insert into public.profiles (
  id, subscription_status, subscription_plan, subscription_expires_at,
  device_slots, subscription_payment_id
)
values
  ('00000000-0000-0000-0000-000000000901', 'active', 'full', pg_catalog.now() + interval '30 days', 2, 'presence-179'),
  ('00000000-0000-0000-0000-000000000902', 'active', 'full', pg_catalog.now() + interval '30 days', 1, 'presence-99')
on conflict (id) do update
set subscription_status = excluded.subscription_status,
    subscription_plan = excluded.subscription_plan,
    subscription_expires_at = excluded.subscription_expires_at,
    device_slots = excluded.device_slots,
    subscription_payment_id = excluded.subscription_payment_id;

insert into public.payment_transactions (
  user_id, provider, payment_id, merchant_payment_id, amount, currency,
  status, metadata, paid_at
)
values
  ('00000000-0000-0000-0000-000000000901', 'bog', 'presence-179', 'merchant-presence-179', 179, 'GEL', 'success',
   '{"provider":"bog","device_slots":2,"bank_status":"completed","bank_amount":"179","bank_currency":"GEL","bank_external_order_id":"merchant-presence-179"}',
   pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000902', 'bog', 'presence-99', 'merchant-presence-99', 99, 'GEL', 'success',
   '{"provider":"bog","device_slots":1,"bank_status":"completed","bank_amount":"99","bank_currency":"GEL","bank_external_order_id":"merchant-presence-99"}',
   pg_catalog.now());

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
values
  ('00000000-0000-0000-0000-0000000009a1', '00000000-0000-0000-0000-000000000901', pg_catalog.now() - interval '12 minutes', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-0000000009b1', '00000000-0000-0000-0000-000000000901', pg_catalog.now() - interval '10 minutes', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-0000000009c1', '00000000-0000-0000-0000-000000000901', pg_catalog.now() - interval '8 minutes', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-0000000009d1', '00000000-0000-0000-0000-000000000902', pg_catalog.now() - interval '12 minutes', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-0000000009d2', '00000000-0000-0000-0000-000000000902', pg_catalog.now() - interval '10 minutes', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-0000000009d3', '00000000-0000-0000-0000-000000000902', pg_catalog.now() - interval '8 minutes', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-0000000009d4', '00000000-0000-0000-0000-000000000902', pg_catalog.now() - interval '6 minutes', pg_catalog.now(), null);

create function pg_temp.as_device(p_uid text, p_session text, p_fingerprint text)
returns void
language sql
as $$
  select set_config(
           'request.jwt.claims',
           pg_catalog.format('{"sub":"%s","session_id":"%s","role":"authenticated"}', p_uid, p_session),
           true),
         set_config(
           'request.headers',
           pg_catalog.format('{"x-cityroute-device-fingerprint":"%s"}', p_fingerprint),
           true);
$$;

-- ===== 179 GEL: A + B active, C blocked =====
select is(public.current_device_session_limit('00000000-0000-0000-0000-000000000901'), 2, '179 GEL keeps the two-device limit');

select pg_temp.as_device('00000000-0000-0000-0000-000000000901', '00000000-0000-0000-0000-0000000009a1', 'presence-device-a');
set local role authenticated;
select is(public.activate_current_session()->>'status', 'active', '179 GEL: device A activates');
select pg_temp.as_device('00000000-0000-0000-0000-000000000901', '00000000-0000-0000-0000-0000000009b1', 'presence-device-b');
select is(public.activate_current_session()->>'status', 'active', '179 GEL: device B activates');
select pg_temp.as_device('00000000-0000-0000-0000-000000000901', '00000000-0000-0000-0000-0000000009c1', 'presence-device-c');
select is(public.activate_current_session()->>'status', 'blocked', '179 GEL: third device C is blocked');

select pg_temp.as_device('00000000-0000-0000-0000-000000000901', '00000000-0000-0000-0000-0000000009a1', 'presence-device-a');
select is(public.has_current_active_session(), true, '179 GEL: A keeps its slot after C was blocked');
select pg_temp.as_device('00000000-0000-0000-0000-000000000901', '00000000-0000-0000-0000-0000000009b1', 'presence-device-b');
select is(public.has_current_active_session(), true, '179 GEL: B keeps its slot after C was blocked');
select is(public.activate_current_session()->>'status', 'active', '179 GEL: a refresh of B (re-activation) keeps its slot');

set local role postgres;
select is(
  (select pg_catalog.count(*)::integer from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000901'),
  2,
  '179 GEL: exactly two registry rows after A, B and the blocked C'
);
select is(
  (select pg_catalog.count(*)::integer from public.profile_revoked_sessions
   where profile_id = '00000000-0000-0000-0000-000000000901'),
  0,
  '179 GEL: the blocked third device revoked nobody'
);

-- ===== presence ping basics =====
select pg_temp.as_device('00000000-0000-0000-0000-000000000901', '00000000-0000-0000-0000-0000000009a1', 'presence-device-a');
set local role authenticated;
select is(public.presence_current_session()->>'status', 'active', 'presence ping of an active device reports active');

-- A closes its tab: no ping for more than the 5-minute presence window
set local role postgres;
update public.profile_active_sessions
set last_seen_at = pg_catalog.now() - interval '6 minutes'
where profile_id = '00000000-0000-0000-0000-000000000901'
  and session_id = '00000000-0000-0000-0000-0000000009a1';

set local role authenticated;
select is(public.has_current_active_session(), false, 'a device without presence no longer counts as active');
select is(public.presence_current_session()->>'status', 'active', 'a still-open device revives its slot with a presence ping while nobody took it');
select is(public.has_current_active_session(), true, 'the revived device holds its slot again');

-- presence never extends the inactivity window and only the exact device row is touched
set local role postgres;
update public.profile_active_sessions
set last_seen_at = pg_catalog.now() - interval '6 minutes',
    last_activity_at = pg_catalog.now() - interval '29 minutes'
where profile_id = '00000000-0000-0000-0000-000000000901'
  and session_id = '00000000-0000-0000-0000-0000000009b1';

select pg_temp.as_device('00000000-0000-0000-0000-000000000901', '00000000-0000-0000-0000-0000000009b1', 'a-different-fingerprint');
set local role authenticated;
select public.presence_current_session();
set local role postgres;
select ok(
  (select last_seen_at < pg_catalog.now() - interval '5 minutes'
   from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000901'
     and session_id = '00000000-0000-0000-0000-0000000009b1'),
  'a ping from another fingerprint does not refresh the row'
);

select pg_temp.as_device('00000000-0000-0000-0000-000000000901', '00000000-0000-0000-0000-0000000009b1', 'presence-device-b');
set local role authenticated;
select is(public.presence_current_session()->>'status', 'active', 'presence ping of the right device and session refreshes it');
set local role postgres;
select ok(
  (select last_activity_at < pg_catalog.now() - interval '28 minutes'
   from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000901'
     and session_id = '00000000-0000-0000-0000-0000000009b1'),
  'presence ping does not extend the 30-minute inactivity window'
);

-- ===== A closes, C takes the freed slot; B and history untouched =====
update public.profile_active_sessions
set last_activity_at = pg_catalog.now(),
    last_seen_at = pg_catalog.now()
where profile_id = '00000000-0000-0000-0000-000000000901'
  and session_id = '00000000-0000-0000-0000-0000000009b1';
update public.profile_active_sessions
set last_seen_at = pg_catalog.now() - interval '4 minutes'
where profile_id = '00000000-0000-0000-0000-000000000901'
  and session_id = '00000000-0000-0000-0000-0000000009b1';
update public.profile_active_sessions
set last_seen_at = pg_catalog.now() - interval '6 minutes'
where profile_id = '00000000-0000-0000-0000-000000000901'
  and session_id = '00000000-0000-0000-0000-0000000009a1';
-- B stays within the presence window (4 minutes old), only A is stale.

select pg_temp.as_device('00000000-0000-0000-0000-000000000901', '00000000-0000-0000-0000-0000000009c1', 'presence-device-c');
set local role authenticated;
select is(public.activate_current_session()->>'status', 'active', '179 GEL: C is admitted once the closed device A is stale');

set local role postgres;
select is(
  (select pg_catalog.count(*)::integer from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000901'),
  2,
  '179 GEL: exactly two registry rows after the stale row was released'
);
select is(
  (select pg_catalog.count(*)::integer from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000901'
     and session_id = '00000000-0000-0000-0000-0000000009a1'),
  0,
  '179 GEL: only the stale device row was released'
);
select is(
  (select pg_catalog.count(*)::integer from auth.sessions
   where user_id = '00000000-0000-0000-0000-000000000901'),
  3,
  'cleanup does not delete any Auth session'
);
select is(
  (select pg_catalog.count(*)::integer from public.profile_revoked_sessions
   where profile_id = '00000000-0000-0000-0000-000000000901'),
  0,
  'cleanup does not add to or remove from the revoked history'
);

select pg_temp.as_device('00000000-0000-0000-0000-000000000901', '00000000-0000-0000-0000-0000000009b1', 'presence-device-b');
set local role authenticated;
select is(public.has_current_active_session(), true, '179 GEL: B stays active while C joins');
select pg_temp.as_device('00000000-0000-0000-0000-000000000901', '00000000-0000-0000-0000-0000000009c1', 'presence-device-c');
select is(public.has_current_active_session(), true, '179 GEL: C is active');
select pg_temp.as_device('00000000-0000-0000-0000-000000000901', '00000000-0000-0000-0000-0000000009a1', 'presence-device-a');
select is(public.presence_current_session()->>'status', 'inactive', 'the closed device A is inactive but not revoked');
select is(public.has_active_access('00000000-0000-0000-0000-000000000901'), false, 'the released device A cannot use access-protected RPCs');

-- ===== an idle (31 minutes) row cannot be revived by presence =====
set local role postgres;
update public.profile_active_sessions
set last_activity_at = pg_catalog.now() - interval '31 minutes',
    last_seen_at = pg_catalog.now()
where profile_id = '00000000-0000-0000-0000-000000000901'
  and session_id = '00000000-0000-0000-0000-0000000009c1';
select pg_temp.as_device('00000000-0000-0000-0000-000000000901', '00000000-0000-0000-0000-0000000009c1', 'presence-device-c');
set local role authenticated;
select is(public.presence_current_session()->>'status', 'inactive', 'presence cannot keep a device that was idle for more than 30 minutes');

-- ===== 99 GEL: A -> B -> A takeover is unchanged =====
select pg_temp.as_device('00000000-0000-0000-0000-000000000902', '00000000-0000-0000-0000-0000000009d1', 'presence-99-a');
select is(public.current_device_session_limit('00000000-0000-0000-0000-000000000902'), 1, '99 GEL keeps the one-device limit');
select is(public.activate_current_session()->>'status', 'active', '99 GEL: device A activates');
select pg_temp.as_device('00000000-0000-0000-0000-000000000902', '00000000-0000-0000-0000-0000000009d2', 'presence-99-b');
select is(public.activate_current_session()->>'status', 'active', '99 GEL: device B takes over');
select pg_temp.as_device('00000000-0000-0000-0000-000000000902', '00000000-0000-0000-0000-0000000009d1', 'presence-99-a');
select is(public.presence_current_session()->>'status', 'revoked', '99 GEL: A learns about the takeover through its presence ping');
select pg_temp.as_device('00000000-0000-0000-0000-000000000902', '00000000-0000-0000-0000-0000000009d3', 'presence-99-a');
select is(public.activate_current_session()->>'status', 'active', '99 GEL: A signs in again and takes over');
select pg_temp.as_device('00000000-0000-0000-0000-000000000902', '00000000-0000-0000-0000-0000000009d2', 'presence-99-b');
select is(public.presence_current_session()->>'status', 'revoked', '99 GEL: B is cut off by A');

-- a stale one-device session is released by the next login without touching revoked history
set local role postgres;
update public.profile_active_sessions
set last_seen_at = pg_catalog.now() - interval '6 minutes'
where profile_id = '00000000-0000-0000-0000-000000000902'
  and session_id = '00000000-0000-0000-0000-0000000009d3';
select pg_temp.as_device('00000000-0000-0000-0000-000000000902', '00000000-0000-0000-0000-0000000009d4', 'presence-99-c');
set local role authenticated;
select is(public.activate_current_session()->>'status', 'active', '99 GEL: a new device is never blocked by a stale slot');
set local role postgres;
select is(
  (select pg_catalog.count(*)::integer from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000902'),
  1,
  '99 GEL: exactly one active registry row remains'
);
select is(
  (select pg_catalog.count(*)::integer from public.profile_revoked_sessions
   where profile_id = '00000000-0000-0000-0000-000000000902'),
  2,
  '99 GEL: the stale-row cleanup left the revoked history unchanged'
);

-- a different account's pings never touch this account's rows
select ok(
  (select last_seen_at < pg_catalog.now() - interval '3 minutes'
   from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000901'
     and session_id = '00000000-0000-0000-0000-0000000009b1'),
  'pings of other accounts never refresh this account''s rows'
);


-- ===== heartbeat scope, privileges, unauthenticated and expired Auth sessions =====
-- Legacy two-device account (no payment id, device_slots = 2).
set local role postgres;
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000903', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'presence-legacy-test@example.test', '', pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now())
on conflict (id) do nothing;

insert into public.profiles (
  id, subscription_status, subscription_plan, subscription_expires_at,
  device_slots, subscription_payment_id
)
values
  ('00000000-0000-0000-0000-000000000903', 'active', 'full', pg_catalog.now() + interval '30 days', 2, null)
on conflict (id) do update
set subscription_status = excluded.subscription_status,
    subscription_plan = excluded.subscription_plan,
    subscription_expires_at = excluded.subscription_expires_at,
    device_slots = excluded.device_slots,
    subscription_payment_id = excluded.subscription_payment_id;

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
values
  ('00000000-0000-0000-0000-0000000009e1', '00000000-0000-0000-0000-000000000903', pg_catalog.now() - interval '20 minutes', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-0000000009e2', '00000000-0000-0000-0000-000000000903', pg_catalog.now() - interval '19 minutes', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-0000000009e3', '00000000-0000-0000-0000-000000000903', pg_catalog.now() - interval '18 minutes', pg_catalog.now(), pg_catalog.now() - interval '1 minute');

select is(public.current_device_session_limit('00000000-0000-0000-0000-000000000903'), 2, 'legacy two-device account keeps the two-device limit');

select pg_temp.as_device('00000000-0000-0000-0000-000000000903', '00000000-0000-0000-0000-0000000009e1', 'presence-device-e1');
set local role authenticated;
select is(public.activate_current_session()->>'status', 'active', 'heartbeat scope: device e1 activates');
select pg_temp.as_device('00000000-0000-0000-0000-000000000903', '00000000-0000-0000-0000-0000000009e2', 'presence-device-e2');
select is(public.activate_current_session()->>'status', 'active', 'heartbeat scope: device e2 activates');

set local role postgres;
update public.profile_active_sessions
set last_activity_at = pg_catalog.now() - interval '10 minutes',
    last_seen_at = pg_catalog.now() - interval '1 minute'
where profile_id = '00000000-0000-0000-0000-000000000903';

select pg_temp.as_device('00000000-0000-0000-0000-000000000903', '00000000-0000-0000-0000-0000000009e1', 'presence-device-e1');
set local role authenticated;
select is(public.heartbeat_current_session()->>'status', 'active', 'heartbeat of e1 reports active');
set local role postgres;
select ok(
  (select last_activity_at = pg_catalog.now()
   from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000903' and session_id = '00000000-0000-0000-0000-0000000009e1'),
  'heartbeat refreshes the activity of the current session'
);
select ok(
  (select last_activity_at < pg_catalog.now() - interval '9 minutes'
          and last_seen_at < pg_catalog.now() - interval '30 seconds'
   from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000903' and session_id = '00000000-0000-0000-0000-0000000009e2'),
  'heartbeat of e1 does not touch the other session of the same account'
);

-- anon can reach none of the client RPCs; authenticated can reach all of them
select is(has_function_privilege('anon', 'public.presence_current_session()', 'execute'), false, 'anon cannot execute presence_current_session');
select is(has_function_privilege('anon', 'public.heartbeat_current_session()', 'execute'), false, 'anon cannot execute heartbeat_current_session');
select is(has_function_privilege('anon', 'public.has_current_active_session()', 'execute'), false, 'anon cannot execute has_current_active_session');
select is(has_function_privilege('anon', 'public.activate_current_session()', 'execute'), false, 'anon cannot execute activate_current_session');
select ok(
  (select bool_and(has_function_privilege('authenticated', f, 'execute'))
   from unnest(array[
     'public.presence_current_session()',
     'public.heartbeat_current_session()',
     'public.has_current_active_session()',
     'public.activate_current_session()'
   ]) as f),
  'authenticated can execute the four client RPCs'
);

-- internal helpers and the inner activation function are not reachable by clients
select is(
  has_function_privilege('authenticated', 'public.touch_current_session_presence()', 'execute')
    or has_function_privilege('anon', 'public.touch_current_session_presence()', 'execute'),
  false,
  'clients cannot execute touch_current_session_presence'
);
select is(
  has_function_privilege('authenticated', 'public.device_session_presence_is_recent(timestamptz)', 'execute')
    or has_function_privilege('anon', 'public.device_session_presence_is_recent(timestamptz)', 'execute'),
  false,
  'clients cannot execute device_session_presence_is_recent'
);
select is(
  has_function_privilege('authenticated', 'public.activate_current_session_before_presence()', 'execute')
    or has_function_privilege('anon', 'public.activate_current_session_before_presence()', 'execute'),
  false,
  'clients cannot execute the inner activate_current_session_before_presence'
);
select is(
  has_function_privilege('authenticated', 'public.activate_current_session_before_activity()', 'execute')
    or has_function_privilege('anon', 'public.activate_current_session_before_activity()', 'execute'),
  false,
  'clients cannot execute the original inner activation function'
);

set local role authenticated;
select throws_ok(
  $$select public.activate_current_session_before_presence()$$,
  '42501',
  null,
  'a direct call of the inner activate function is rejected'
);
select throws_ok(
  $$select public.touch_current_session_presence()$$,
  '42501',
  null,
  'a direct call of the presence helper is rejected'
);

-- unauthenticated caller (no JWT subject / session id)
set local role postgres;
select set_config('request.jwt.claims', '{}', true), set_config('request.headers', '{}', true);
set local role authenticated;
select is(public.presence_current_session()->>'status', 'inactive', 'unauthenticated: presence reports inactive');
select is(public.heartbeat_current_session()->>'status', 'inactive', 'unauthenticated: heartbeat reports inactive');
select is(public.has_current_active_session(), false, 'unauthenticated: no active session');
select is(public.activate_current_session()->>'status', 'blocked', 'unauthenticated: activation is blocked');

-- expired Auth session is never refreshed or treated as active
set local role postgres;
insert into public.profile_active_sessions (
  profile_id, session_id, session_created_at, activated_at, updated_at,
  device_fingerprint, last_activity_at, last_seen_at
)
values (
  '00000000-0000-0000-0000-000000000903', '00000000-0000-0000-0000-0000000009e3', pg_catalog.now() - interval '18 minutes', pg_catalog.now(), pg_catalog.now(),
  'presence-device-e3', pg_catalog.now(), pg_catalog.now() - interval '2 minutes'
);
select pg_temp.as_device('00000000-0000-0000-0000-000000000903', '00000000-0000-0000-0000-0000000009e3', 'presence-device-e3');
set local role authenticated;
select is(public.presence_current_session()->>'status', 'inactive', 'expired Auth session: presence reports inactive');
select is(public.has_current_active_session(), false, 'expired Auth session: no active session');
select is(public.heartbeat_current_session()->>'status', 'inactive', 'expired Auth session: heartbeat reports inactive');
set local role postgres;
select ok(
  (select last_seen_at < pg_catalog.now() - interval '90 seconds'
   from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000903' and session_id = '00000000-0000-0000-0000-0000000009e3'),
  'expired Auth session: presence is not refreshed'
);

-- schema contract used by the migration backfill and by new rows
select col_not_null('public', 'profile_active_sessions', 'last_seen_at', 'last_seen_at is NOT NULL');
select col_has_default('public', 'profile_active_sessions', 'last_seen_at', 'last_seen_at defaults to now()');

select * from finish();
rollback;
