begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(18);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000951',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'session-preserve-legacy@example.test', '',
    pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()
  ),
  (
    '00000000-0000-0000-0000-000000000953',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'session-preserve-admin@example.test', '',
    pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()
  )
on conflict (id) do nothing;

insert into public.profiles (
  id, subscription_status, subscription_plan, subscription_expires_at,
  device_slots, subscription_payment_id
)
values (
  '00000000-0000-0000-0000-000000000951',
  'active', 'premium', pg_catalog.now() + interval '30 days', 1, null
)
on conflict (id) do update
set subscription_status = excluded.subscription_status,
    subscription_plan = excluded.subscription_plan,
    subscription_expires_at = excluded.subscription_expires_at,
    device_slots = excluded.device_slots,
    subscription_payment_id = excluded.subscription_payment_id;

insert into public.device_session_limit_overrides (
  profile_id, session_limit, granted_by, grant_reason
)
values (
  '00000000-0000-0000-0000-000000000951',
  2,
  '00000000-0000-0000-0000-000000000953',
  'Preserve the two legacy production sessions'
);

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
values
  (
    '00000000-0000-0000-0000-000000000961',
    '00000000-0000-0000-0000-000000000951',
    pg_catalog.now() - interval '2 minutes',
    pg_catalog.now(),
    null
  ),
  (
    '00000000-0000-0000-0000-000000000962',
    '00000000-0000-0000-0000-000000000951',
    pg_catalog.now() - interval '1 minute',
    pg_catalog.now(),
    null
  );

insert into public.profile_active_sessions (
  profile_id, session_id, session_created_at, activated_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000951',
    '00000000-0000-0000-0000-000000000961',
    pg_catalog.now() - interval '2 minutes',
    pg_catalog.now() - interval '2 minutes',
    pg_catalog.now()
  ),
  (
    '00000000-0000-0000-0000-000000000951',
    '00000000-0000-0000-0000-000000000962',
    pg_catalog.now() - interval '1 minute',
    pg_catalog.now() - interval '1 minute',
    pg_catalog.now()
  );

select is(
  public.current_device_session_limit('00000000-0000-0000-0000-000000000951'),
  2,
  'active Admin Override keeps the legacy profile at two device slots'
);
select is(
  (select count(*)::integer
   from public.device_session_limit_overrides
   where profile_id = '00000000-0000-0000-0000-000000000951'
     and session_limit = 2
     and revoked_at is null),
  1,
  'the synthetic Admin Override is active'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000951","session_id":"00000000-0000-0000-0000-000000000961","role":"authenticated"}',
  true
);
select set_config(
  'request.headers',
  '{"x-cityroute-device-fingerprint":"legacy-preserve-device-a"}',
  true
);
select is(
  public.has_current_active_session(),
  false,
  'a legacy NULL-fingerprint session awaits its own activation'
);
select is(
  public.activate_current_session()->>'status',
  'active',
  'the first legacy session activates'
);

reset role;
set local role postgres;
select ok(
  exists (
    select 1
    from public.profile_active_sessions active
    where active.profile_id = '00000000-0000-0000-0000-000000000951'
      and active.session_id = '00000000-0000-0000-0000-000000000962'
      and active.device_fingerprint is null
  )
  and not exists (
    select 1
    from public.profile_revoked_sessions revoked
    where revoked.profile_id = '00000000-0000-0000-0000-000000000951'
      and revoked.session_id = '00000000-0000-0000-0000-000000000962'
  ),
  'first activation preserves the second live NULL-fingerprint session'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000951","session_id":"00000000-0000-0000-0000-000000000962","role":"authenticated"}',
  true
);
select set_config(
  'request.headers',
  '{"x-cityroute-device-fingerprint":"legacy-preserve-device-b"}',
  true
);
select is(
  public.activate_current_session()->>'status',
  'active',
  'the preserved second legacy session activates independently'
);
select is(
  public.has_current_active_session(),
  true,
  'the second legacy session is active after fingerprint assignment'
);
select is(public.has_active_access('00000000-0000-0000-0000-000000000951'), true,
  'the second Legacy Premium session retains application access');

reset role;
set local role postgres;
select is(
  (select count(*)::integer
   from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000951'),
  2,
  'both legacy device sessions remain registered'
);
select is(
  (select count(*)::integer
   from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000951'
     and device_fingerprint in (
       'legacy-preserve-device-a',
       'legacy-preserve-device-b'
     )),
  2,
  'both legacy sessions receive their own distinct fingerprints'
);
select is(
  (select count(*)::integer
   from public.profile_revoked_sessions
   where profile_id = '00000000-0000-0000-0000-000000000951'
     and session_id in (
       '00000000-0000-0000-0000-000000000961',
       '00000000-0000-0000-0000-000000000962'
     )),
  0,
  'neither legacy session is revoked during activation'
);
select is(
  public.current_device_session_limit('00000000-0000-0000-0000-000000000951'),
  2,
  'the override continues to allow two slots after both activations'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000951","session_id":"00000000-0000-0000-0000-000000000961","role":"authenticated"}',
  true
);
select is(public.has_current_active_session(), true, 'the first legacy session remains active');
select is(public.has_active_access('00000000-0000-0000-0000-000000000951'), true,
  'the first Legacy Premium session retains application access');
select is(
  (public.deactivate_current_session()->>'deactivated_sessions')::integer,
  1,
  'logout deactivates only the current preserved device session'
);
select is(public.has_current_active_session(), false, 'logout removes access from the first session');

reset role;
set local role postgres;
select is(
  (select count(*)::integer
   from public.profile_active_sessions
   where profile_id = '00000000-0000-0000-0000-000000000951'),
  1,
  'logout preserves the other legacy active session row'
);
select is(
  (select count(*)::integer
   from public.profile_revoked_sessions
   where profile_id = '00000000-0000-0000-0000-000000000951'
     and session_id in (
       '00000000-0000-0000-0000-000000000961',
       '00000000-0000-0000-0000-000000000962'
     )),
  1,
  'logout records only the current legacy session as revoked'
);
select * from finish();
rollback;
