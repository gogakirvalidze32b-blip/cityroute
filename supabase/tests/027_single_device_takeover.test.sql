begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(38);

-- 99 GEL user (one device) and 179 GEL user (two devices)
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000871', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'takeover-99-test@example.test', '', pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000881', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'takeover-179-test@example.test', '', pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now())
on conflict (id) do nothing;

insert into public.profiles (
  id, subscription_status, subscription_plan, subscription_expires_at,
  device_slots, subscription_payment_id
)
values
  ('00000000-0000-0000-0000-000000000871', 'active', 'full', pg_catalog.now() + interval '30 days', 1, 'takeover-99'),
  ('00000000-0000-0000-0000-000000000881', 'active', 'full', pg_catalog.now() + interval '30 days', 2, 'takeover-179')
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
  ('00000000-0000-0000-0000-000000000871', 'bog', 'takeover-99', 'merchant-takeover-99', 99, 'GEL', 'success',
   '{"provider":"bog","device_slots":1,"bank_status":"completed","bank_amount":"99","bank_currency":"GEL","bank_external_order_id":"merchant-takeover-99"}',
   pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000881', 'bog', 'takeover-179', 'merchant-takeover-179', 179, 'GEL', 'success',
   '{"provider":"bog","device_slots":2,"bank_status":"completed","bank_amount":"179","bank_currency":"GEL","bank_external_order_id":"merchant-takeover-179"}',
   pg_catalog.now());

-- 99 GEL sessions: A1 -> B -> A2 (new logins, each newer), then X (older) vs Y (newer) for the parallel-login race
insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
values
  ('00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-000000000871', pg_catalog.now() - interval '10 minutes', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-0000000008b1', '00000000-0000-0000-0000-000000000871', pg_catalog.now() - interval '8 minutes', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-0000000008a2', '00000000-0000-0000-0000-000000000871', pg_catalog.now() - interval '6 minutes', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-0000000008c1', '00000000-0000-0000-0000-000000000871', pg_catalog.now() - interval '4 minutes', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-0000000008c2', '00000000-0000-0000-0000-000000000871', pg_catalog.now() - interval '2 minutes', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-0000000008d1', '00000000-0000-0000-0000-000000000881', pg_catalog.now() - interval '6 minutes', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-0000000008d2', '00000000-0000-0000-0000-000000000881', pg_catalog.now() - interval '4 minutes', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-0000000008d3', '00000000-0000-0000-0000-000000000881', pg_catalog.now() - interval '2 minutes', pg_catalog.now(), null);

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

-- ===== 99 GEL: A -> B =====
select is(public.current_device_session_limit('00000000-0000-0000-0000-000000000871'), 1, '99 GEL keeps the one-device limit');

select pg_temp.as_device('00000000-0000-0000-0000-000000000871', '00000000-0000-0000-0000-0000000008a1', 'takeover-device-a');
set local role authenticated;
select is(public.activate_current_session()->>'status', 'active', '99 GEL: device A activates');
select is(public.has_current_active_session(), true, '99 GEL: device A holds the slot');

select pg_temp.as_device('00000000-0000-0000-0000-000000000871', '00000000-0000-0000-0000-0000000008b1', 'takeover-device-b');
select is(public.activate_current_session()->>'status', 'active', '99 GEL: device B takes over immediately instead of being blocked');
select is(public.has_current_active_session(), true, '99 GEL: device B holds the slot');

select pg_temp.as_device('00000000-0000-0000-0000-000000000871', '00000000-0000-0000-0000-0000000008a1', 'takeover-device-a');
select is(public.has_current_active_session(), false, '99 GEL: device A is cut off without refresh or logout');
select is(public.has_active_access('00000000-0000-0000-0000-000000000871'), false, '99 GEL: cut-off device A cannot use access-protected RPCs');
select is(public.heartbeat_current_session()->>'status', 'revoked', '99 GEL: device A learns from the server that its session was revoked');
select is(public.activate_current_session()->>'status', 'blocked', '99 GEL: revoked session A cannot reactivate itself');

set local role postgres;
select is(
  (select pg_catalog.count(*)::integer from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000871'),
  1,
  '99 GEL A -> B: exactly one active registry row remains'
);
select is(
  (select session_id::text from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000871'),
  '00000000-0000-0000-0000-0000000008b1',
  '99 GEL A -> B: the remaining row is device B'
);

-- ===== 99 GEL: B -> A (fresh login on A) =====
select pg_temp.as_device('00000000-0000-0000-0000-000000000871', '00000000-0000-0000-0000-0000000008a2', 'takeover-device-a');
set local role authenticated;
select is(public.activate_current_session()->>'status', 'active', '99 GEL: device A takes the slot back');
select is(public.has_current_active_session(), true, '99 GEL: device A holds the slot again');

select pg_temp.as_device('00000000-0000-0000-0000-000000000871', '00000000-0000-0000-0000-0000000008b1', 'takeover-device-b');
select is(public.has_current_active_session(), false, '99 GEL: device B is cut off immediately');
select is(public.heartbeat_current_session()->>'status', 'revoked', '99 GEL: device B learns that its session was revoked');

set local role postgres;
select is(
  (select pg_catalog.count(*)::integer from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000871'),
  1,
  '99 GEL B -> A: exactly one active registry row remains'
);
select is(
  (select session_id::text from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000871'),
  '00000000-0000-0000-0000-0000000008a2',
  '99 GEL B -> A: the remaining row is device A'
);

-- ===== 99 GEL: parallel logins. The profile row lock serialises them; both orders leave one session. =====
select pg_temp.as_device('00000000-0000-0000-0000-000000000871', '00000000-0000-0000-0000-0000000008c2', 'takeover-device-y');
set local role authenticated;
select is(public.activate_current_session()->>'status', 'active', '99 GEL race: the newer login wins when it is serialised first');

select pg_temp.as_device('00000000-0000-0000-0000-000000000871', '00000000-0000-0000-0000-0000000008c1', 'takeover-device-x');
select is(public.activate_current_session()->>'status', 'blocked', '99 GEL race: the older login serialised second cannot evict the newer one');

set local role postgres;
select is(
  (select pg_catalog.count(*)::integer from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000871'),
  1,
  '99 GEL race: never more than one active registry row'
);
select is(
  (select session_id::text from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000871'),
  '00000000-0000-0000-0000-0000000008c2',
  '99 GEL race: the newer session keeps the slot'
);
select is(
  (select pg_catalog.count(*)::integer from auth.sessions
   where user_id = '00000000-0000-0000-0000-000000000871'),
  5,
  'takeover never deletes Auth sessions'
);
select is(
  (select pg_catalog.count(*)::integer from public.profiles
   where id = '00000000-0000-0000-0000-000000000871'
     and subscription_status = 'active' and device_slots = 1
     and subscription_payment_id = 'takeover-99'),
  1,
  'takeover does not touch subscription data'
);

-- ===== 179 GEL: A and B together, C blocked, per-device logout =====
select is(public.current_device_session_limit('00000000-0000-0000-0000-000000000881'), 2, '179 GEL keeps the two-device limit');

select pg_temp.as_device('00000000-0000-0000-0000-000000000881', '00000000-0000-0000-0000-0000000008d1', 'takeover-179-a');
set local role authenticated;
select is(public.activate_current_session()->>'status', 'active', '179 GEL: device A activates');
select pg_temp.as_device('00000000-0000-0000-0000-000000000881', '00000000-0000-0000-0000-0000000008d2', 'takeover-179-b');
select is(public.activate_current_session()->>'status', 'active', '179 GEL: device B activates alongside A');
select is(public.has_current_active_session(), true, '179 GEL: device B is active');

select pg_temp.as_device('00000000-0000-0000-0000-000000000881', '00000000-0000-0000-0000-0000000008d1', 'takeover-179-a');
select is(public.has_current_active_session(), true, '179 GEL: device A stays active after B joined');

select pg_temp.as_device('00000000-0000-0000-0000-000000000881', '00000000-0000-0000-0000-0000000008d3', 'takeover-179-c');
select is(public.activate_current_session()->>'status', 'blocked', '179 GEL: device C is blocked');
select is(public.has_current_active_session(), false, '179 GEL: blocked device C has no access');

select pg_temp.as_device('00000000-0000-0000-0000-000000000881', '00000000-0000-0000-0000-0000000008d1', 'takeover-179-a');
select is(public.has_current_active_session(), true, '179 GEL: device A is unchanged after the C attempt');
select pg_temp.as_device('00000000-0000-0000-0000-000000000881', '00000000-0000-0000-0000-0000000008d2', 'takeover-179-b');
select is(public.has_current_active_session(), true, '179 GEL: device B is unchanged after the C attempt');

set local role postgres;
select is(
  (select pg_catalog.count(*)::integer from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000881'),
  2,
  '179 GEL: registry still holds exactly devices A and B'
);
select is(
  (select pg_catalog.count(*)::integer from public.profile_revoked_sessions
   where profile_id = '00000000-0000-0000-0000-000000000881'
     and session_id in ('00000000-0000-0000-0000-0000000008d1', '00000000-0000-0000-0000-0000000008d2')),
  0,
  '179 GEL: the C attempt revokes neither A nor B'
);

-- Logout of B frees only B's slot
select pg_temp.as_device('00000000-0000-0000-0000-000000000881', '00000000-0000-0000-0000-0000000008d2', 'takeover-179-b');
set local role authenticated;
select is(public.deactivate_current_session()->>'status', 'deactivated', '179 GEL: device B logs out');
select is(public.has_current_active_session(), false, '179 GEL: logged-out device B lost its slot');
select pg_temp.as_device('00000000-0000-0000-0000-000000000881', '00000000-0000-0000-0000-0000000008d1', 'takeover-179-a');
select is(public.has_current_active_session(), true, '179 GEL: B logout does not affect device A');

select pg_temp.as_device('00000000-0000-0000-0000-000000000881', '00000000-0000-0000-0000-0000000008d3', 'takeover-179-c');
select is(public.activate_current_session()->>'status', 'active', '179 GEL: device C can use the slot freed by B');

select * from finish();
rollback;
