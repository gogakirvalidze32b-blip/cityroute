begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(13);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000931',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'device-logout-023@example.test', '',
  pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()
)
on conflict (id) do nothing;

insert into public.profiles (
  id, subscription_status, subscription_plan, subscription_expires_at,
  device_slots, subscription_payment_id
)
values (
  '00000000-0000-0000-0000-000000000931',
  'active', 'premium', pg_catalog.now() + interval '30 days',
  2, null
)
on conflict (id) do update
set subscription_status = excluded.subscription_status,
    subscription_plan = excluded.subscription_plan,
    subscription_expires_at = excluded.subscription_expires_at,
    device_slots = excluded.device_slots,
    subscription_payment_id = excluded.subscription_payment_id;

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
values
  (
    '00000000-0000-0000-0000-000000000941',
    '00000000-0000-0000-0000-000000000931',
    pg_catalog.now() - interval '2 minutes', pg_catalog.now(), null
  ),
  (
    '00000000-0000-0000-0000-000000000942',
    '00000000-0000-0000-0000-000000000931',
    pg_catalog.now() - interval '1 minute', pg_catalog.now(), null
  );

insert into public.profile_active_sessions (
  profile_id, session_id, session_created_at, activated_at, updated_at, device_fingerprint
)
values
  (
    '00000000-0000-0000-0000-000000000931',
    '00000000-0000-0000-0000-000000000941',
    pg_catalog.now() - interval '2 minutes', pg_catalog.now() - interval '2 minutes',
    pg_catalog.now(), 'device-logout-023-a'
  ),
  (
    '00000000-0000-0000-0000-000000000931',
    '00000000-0000-0000-0000-000000000942',
    pg_catalog.now() - interval '1 minute', pg_catalog.now() - interval '1 minute',
    pg_catalog.now(), 'device-logout-023-b'
  );

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000931","session_id":"00000000-0000-0000-0000-000000000941","role":"authenticated"}',
  true
);
select is(
  public.deactivate_current_session()->>'status',
  'deactivated',
  'logout deactivates the current device session'
);
reset role;
set local role postgres;
select is(
  (
    select count(*)::integer
    from public.profile_active_sessions
    where profile_id = '00000000-0000-0000-0000-000000000931'
  ),
  1,
  'the other device session remains registered'
);
select is(
  (
    select count(*)::integer
    from public.profile_revoked_sessions
    where profile_id = '00000000-0000-0000-0000-000000000931'
      and session_id = '00000000-0000-0000-0000-000000000941'
  ),
  1,
  'logout revokes the current device session'
);
select is(
  (
    select count(*)::integer
    from public.profile_revoked_sessions
    where profile_id = '00000000-0000-0000-0000-000000000931'
      and session_id = '00000000-0000-0000-0000-000000000942'
  ),
  0,
  'logout does not revoke the other device session'
);
set local role authenticated;
select is(public.has_current_active_session(), false, 'logged-out device loses access');

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000931","session_id":"00000000-0000-0000-0000-000000000942","role":"authenticated"}',
  true
);
select is(public.has_current_active_session(), true, 'the other device remains active');
select is(
  public.deactivate_current_session()->>'status',
  'deactivated',
  'the other device can later log out independently'
);
select is(public.has_current_active_session(), false, 'the second device loses access only after its own logout');

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
values
  (
    '00000000-0000-0000-0000-000000000943',
    '00000000-0000-0000-0000-000000000931',
    pg_catalog.now() - interval '2 minutes', pg_catalog.now(), null
  ),
  (
    '00000000-0000-0000-0000-000000000944',
    '00000000-0000-0000-0000-000000000931',
    pg_catalog.now() - interval '1 minute', pg_catalog.now(), null
  );

insert into public.profile_active_sessions (
  profile_id, session_id, session_created_at, activated_at, updated_at, device_fingerprint
)
values
  (
    '00000000-0000-0000-0000-000000000931',
    '00000000-0000-0000-0000-000000000943',
    pg_catalog.now() - interval '2 minutes', pg_catalog.now() - interval '2 minutes',
    pg_catalog.now(), 'device-logout-023-a-reverse'
  ),
  (
    '00000000-0000-0000-0000-000000000931',
    '00000000-0000-0000-0000-000000000944',
    pg_catalog.now() - interval '1 minute', pg_catalog.now() - interval '1 minute',
    pg_catalog.now(), 'device-logout-023-b-reverse'
  );

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000931","session_id":"00000000-0000-0000-0000-000000000944","role":"authenticated"}',
  true
);
select is(
  public.deactivate_current_session()->>'status',
  'deactivated',
  'Device B can log out independently while Device A is active'
);
select is(public.has_current_active_session(), false, 'Device B loses access after its logout');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000931","session_id":"00000000-0000-0000-0000-000000000943","role":"authenticated"}',
  true
);
select is(public.has_current_active_session(), true, 'Device B logout leaves Device A active');
reset role;
set local role postgres;
select is(
  (
    select count(*)::integer
    from public.profile_active_sessions
    where profile_id = '00000000-0000-0000-0000-000000000931'
      and session_id = '00000000-0000-0000-0000-000000000943'
  ),
  1,
  'Device B logout preserves Device A active-session row'
);
select is(
  (
    select count(*)::integer
    from public.profile_revoked_sessions
    where profile_id = '00000000-0000-0000-0000-000000000931'
      and session_id in (
        '00000000-0000-0000-0000-000000000943',
        '00000000-0000-0000-0000-000000000944'
      )
  ),
  1,
  'Device B logout revokes only Device B'
);

reset role;
select * from finish();
rollback;
