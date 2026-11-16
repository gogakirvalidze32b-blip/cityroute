begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(19);

create function pg_temp.confirm_bog(p_user uuid, p_payment text, p_merchant text, p_amount numeric, p_slots integer)
returns void language plpgsql as $confirm$
declare
  v_result jsonb;
  v_amount text := case p_amount when 99 then '99.00' when 179 then '179.00' else p_amount::text end;
begin
  insert into public.payment_transactions (
    user_id, provider, payment_id, merchant_payment_id, amount, currency, status, metadata
  ) values (
    p_user, 'bog', p_payment, p_merchant, p_amount, 'GEL', 'pending',
    pg_catalog.jsonb_build_object('provider', 'bog', 'device_slots', p_slots, 'package_price', p_amount)
  );
  perform pg_catalog.set_config('request.jwt.claim.role', 'cityroute_bog_confirmer', true);
  perform pg_catalog.set_config('request.jwt.claims', '{"role":"cityroute_bog_confirmer"}', true);
  v_result := public.update_bog_payment_status(
    p_payment, 'success', p_payment || '-bank',
    pg_catalog.jsonb_build_object(
      'bank_status', 'completed', 'bank_amount', v_amount,
      'bank_currency', 'GEL', 'bank_external_order_id', p_merchant
    )
  );
  perform pg_catalog.set_config('request.jwt.claim.role', '', true);
  perform pg_catalog.set_config('request.jwt.claims', '{}', true);
  if v_result->>'status' is distinct from 'success' or v_result->>'success' is distinct from 'true' then
    raise exception 'BOG activation failed for %: %', p_payment, v_result;
  end if;
end
$confirm$;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000861',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'activity-heartbeat-test@example.test', '',
  pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()
)
on conflict (id) do nothing;

select pg_temp.confirm_bog('00000000-0000-0000-0000-000000000861', 'activity-heartbeat-179', 'merchant-activity-heartbeat-179', 179, 2);

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
values
  ('00000000-0000-0000-0000-000000000861', '00000000-0000-0000-0000-000000000861', pg_catalog.now() - interval '3 minutes', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000862', '00000000-0000-0000-0000-000000000861', pg_catalog.now() - interval '2 minutes', pg_catalog.now(), null),
  ('00000000-0000-0000-0000-000000000863', '00000000-0000-0000-0000-000000000861', pg_catalog.now() - interval '1 minute', pg_catalog.now(), null);

select is(
  public.current_device_session_limit('00000000-0000-0000-0000-000000000861'),
  2,
  '179 GEL retains the two-device limit'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000861","session_id":"00000000-0000-0000-0000-000000000861","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"heartbeat-device-a"}', true);
select is(public.activate_current_session()->>'status', 'active', 'first device activates');
select is(public.has_current_active_session(), true, 'active device retains its slot');
select is(public.activate_current_session()->>'status', 'active', 're-activation keeps an active device in its slot');

reset role;
set local role postgres;
update public.profile_active_sessions
set last_activity_at = pg_catalog.now() - interval '29 minutes'
where profile_id = '00000000-0000-0000-0000-000000000861'
  and session_id = '00000000-0000-0000-0000-000000000861';

insert into public.profile_active_sessions (
  profile_id, session_id, session_created_at, activated_at, updated_at,
  last_activity_at, device_fingerprint
)
values (
  '00000000-0000-0000-0000-000000000861',
  '00000000-0000-0000-0000-000000000862',
  pg_catalog.now() - interval '2 minutes',
  pg_catalog.now() - interval '2 minutes',
  pg_catalog.now(),
  pg_catalog.now() - interval '25 minutes',
  'heartbeat-device-b'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000861","session_id":"00000000-0000-0000-0000-000000000861","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"heartbeat-device-a"}', true);
select is(public.heartbeat_current_session()->>'status', 'active', 'heartbeat accepts a recently active current device');
select is(public.has_current_active_session(), true, 'heartbeat keeps the current device eligible');
reset role;
set local role postgres;
select ok(
  (select last_activity_at > pg_catalog.now() - interval '1 minute'
   from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000861'
     and session_id = '00000000-0000-0000-0000-000000000861'),
  'heartbeat updates the current device activity timestamp'
);
select is(
  (select last_activity_at
   from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000861'
     and session_id = '00000000-0000-0000-0000-000000000862'),
  pg_catalog.now() - interval '25 minutes',
  'heartbeat does not change the other device activity timestamp'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000861","session_id":"00000000-0000-0000-0000-000000000863","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"heartbeat-device-c"}', true);
select is(public.activate_current_session()->>'status', 'blocked', 'third currently active device is blocked');
reset role;
set local role postgres;
select is(
  (select count(*)::integer
   from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000861'),
  2,
  'blocked third device leaves both active slots unchanged'
);

update public.profile_active_sessions
set last_activity_at = pg_catalog.now() - interval '31 minutes'
where profile_id = '00000000-0000-0000-0000-000000000861'
  and session_id = '00000000-0000-0000-0000-000000000861';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000861","session_id":"00000000-0000-0000-0000-000000000861","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"heartbeat-device-a"}', true);
select is(public.has_current_active_session(), false, 'device idle over thirty minutes no longer retains an active slot');
select is(public.heartbeat_current_session()->>'status', 'inactive', 'heartbeat cannot renew an expired activity window');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000861","session_id":"00000000-0000-0000-0000-000000000863","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"heartbeat-device-c"}', true);
select is(public.activate_current_session()->>'status', 'active', 'inactive slot can be reclaimed by another device');
reset role;
set local role postgres;
select is(
  (select count(*)::integer
   from auth.sessions
   where id = '00000000-0000-0000-0000-000000000861'),
  1,
  'releasing an idle slot does not delete its Auth session'
);
select is(
  (select count(*)::integer
   from public.profile_revoked_sessions
   where profile_id = '00000000-0000-0000-0000-000000000861'
     and session_id = '00000000-0000-0000-0000-000000000861'),
  0,
  'releasing an idle slot does not revoke its session'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000861","session_id":"00000000-0000-0000-0000-000000000863","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"heartbeat-device-c"}', true);
select is(public.deactivate_current_session()->>'status', 'deactivated', 'logout deactivates the current device');
reset role;
set local role postgres;
select is(
  (select count(*)::integer
   from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000861'
     and session_id = '00000000-0000-0000-0000-000000000862'),
  1,
  'logout preserves the other device registry row'
);
select is(
  (select count(*)::integer
   from public.profile_revoked_sessions
   where profile_id = '00000000-0000-0000-0000-000000000861'
     and session_id = '00000000-0000-0000-0000-000000000862'),
  0,
  'logout does not revoke the other device session'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000861","session_id":"00000000-0000-0000-0000-000000000862","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-cityroute-device-fingerprint":"heartbeat-device-b"}', true);
select is(public.has_current_active_session(), true, 'other active device retains access after logout');

select * from finish();
rollback;
