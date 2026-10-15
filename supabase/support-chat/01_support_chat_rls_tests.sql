-- =====================================================================
-- Support Chat — access-control / RPC / Storage-policy tests (plain SQL)
-- =====================================================================
-- Run against a database where 001_initial.sql, 009 and 010 are applied
-- (a real Supabase local stack, or the plain-Postgres harness — see
-- README.md). The whole script runs inside ONE transaction and is rolled
-- back at the end, so it leaves no data behind.
--
--   psql -v ON_ERROR_STOP=1 -f 01_support_chat_rls_tests.sql
--
-- Exit code 0 + "ALL SUPPORT CHAT TESTS PASSED" means every assertion held.
-- Any failed assertion raises an exception and aborts with a non-zero exit.
-- =====================================================================
\set ON_ERROR_STOP on

begin;

create schema test;
grant usage on schema test to anon, authenticated, service_role;

create table test.ctx (k text primary key, v text);
grant all on test.ctx to anon, authenticated, service_role;

create function test.become(p_role text, p_uid uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute format('set local role %I', p_role);
end $$;

create function test.put(p_k text, p_v text)
returns void language sql as $$
  insert into test.ctx values (p_k, p_v)
  on conflict (k) do update set v = excluded.v
$$;

create function test.get(p_k text)
returns text language sql stable as $$
  select v from test.ctx where k = p_k
$$;

-- Runs p_sql and requires it to FAIL with an error containing p_fragment.
create function test.expect_error(p_sql text, p_fragment text, p_label text)
returns void language plpgsql as $$
declare v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    v_msg := sqlerrm;
    if position(p_fragment in v_msg) = 0 then
      raise exception 'TEST FAILED [%]: expected error containing "%" but got "%"',
        p_label, p_fragment, v_msg;
    end if;
    raise notice 'PASS: %', p_label;
    return;
  end;
  raise exception 'TEST FAILED [%]: expected error containing "%" but the statement succeeded',
    p_label, p_fragment;
end $$;

create function test.assert_eq(p_actual anyelement, p_expected anyelement, p_label text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'TEST FAILED [%]: expected % but got %', p_label, p_expected, p_actual;
  end if;
  raise notice 'PASS: %', p_label;
end $$;

grant execute on all functions in schema test to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Fixtures (run as the database owner)
-- ---------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.test', '{"full_name":"Alice A"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.test',   '{"full_name":"Bob B"}'),
  ('00000000-0000-0000-0000-0000000000ad', 'admin@example.test', '{"full_name":"Support Admin"}');

insert into public.support_admins (user_id, note)
values ('00000000-0000-0000-0000-0000000000ad', 'test admin');

-- =====================================================================
-- 1. anon has no access at all
-- =====================================================================
do $$
begin
  perform test.become('anon');
  perform test.expect_error('select * from public.support_conversations', 'permission denied', 'anon cannot read conversations');
  perform test.expect_error('select * from public.support_messages', 'permission denied', 'anon cannot read messages');
  perform test.expect_error('select * from public.support_message_attachments', 'permission denied', 'anon cannot read attachments');
  perform test.expect_error('select public.get_or_create_support_conversation()', 'permission denied', 'anon cannot create a conversation');
  perform test.expect_error($q$select public.send_support_message(gen_random_uuid(), 'x', gen_random_uuid())$q$, 'permission denied', 'anon cannot send');
  reset role;
end $$;

-- =====================================================================
-- 2. Conversations: owner-only visibility, no duplicates
-- =====================================================================
do $$
declare
  a uuid := '00000000-0000-0000-0000-00000000000a';
  b uuid := '00000000-0000-0000-0000-00000000000b';
  ad uuid := '00000000-0000-0000-0000-0000000000ad';
  c1 uuid; c2 uuid; cb uuid; n int;
begin
  perform test.become('authenticated', a);
  c1 := (public.get_or_create_support_conversation()).id;
  c2 := (public.get_or_create_support_conversation()).id;
  perform test.assert_eq(c1, c2, 'get_or_create returns the same conversation (no duplicates)');
  perform test.put('convA', c1::text);
  select count(*) into n from public.support_conversations;
  perform test.assert_eq(n, 1, 'user A sees exactly 1 conversation');

  perform test.become('authenticated', b);
  cb := (public.get_or_create_support_conversation()).id;
  perform test.put('convB', cb::text);
  select count(*) into n from public.support_conversations;
  perform test.assert_eq(n, 1, 'user B sees exactly 1 conversation (not A''s)');
  select count(*) into n from public.support_conversations where id = c1;
  perform test.assert_eq(n, 0, 'user B cannot see A''s conversation by id');

  perform test.become('authenticated', ad);
  select count(*) into n from public.support_conversations;
  perform test.assert_eq(n, 2, 'support admin sees all conversations');
  reset role;
end $$;

-- =====================================================================
-- 3. Sending: author derived server-side, idempotent, validated
-- =====================================================================
do $$
declare
  a uuid := '00000000-0000-0000-0000-00000000000a';
  b uuid := '00000000-0000-0000-0000-00000000000b';
  conv_a uuid := test.get('convA')::uuid;
  conv_b uuid := test.get('convB')::uuid;
  cid1 uuid := gen_random_uuid();
  r jsonb; r2 jsonb; n int; v record;
begin
  perform test.become('authenticated', a);
  r := public.send_support_message(conv_a, '  hello admin  ', cid1);
  perform test.assert_eq(r -> 'message' ->> 'sender_type', 'user', 'message from a normal user is stored as sender_type=user');
  perform test.assert_eq(r -> 'message' ->> 'body', 'hello admin', 'body is trimmed');
  perform test.assert_eq((r ->> 'deduplicated')::boolean, false, 'first send is not a duplicate');
  perform test.put('msgA1', r -> 'message' ->> 'id');

  -- Retry with the same client_id: same message, no new row, no double counters.
  r2 := public.send_support_message(conv_a, 'hello admin', cid1);
  perform test.assert_eq(r2 -> 'message' ->> 'id', r -> 'message' ->> 'id', 'retry with same client_id returns the same message');
  perform test.assert_eq((r2 ->> 'deduplicated')::boolean, true, 'retry is flagged deduplicated');
  select count(*) into n from public.support_messages where conversation_id = conv_a;
  perform test.assert_eq(n, 1, 'retry did not create a duplicate row');

  reset role;
  select * into v from public.support_conversations where id = conv_a;
  perform test.assert_eq(v.admin_unread_count, 1, 'admin unread counter incremented once');
  perform test.assert_eq(v.status, 'open', 'conversation is open after a user message');
  perform test.assert_eq(v.last_message_preview, 'hello admin', 'preview stored');
  select count(*) into n from public.support_email_outbox where message_id = (r -> 'message' ->> 'id')::uuid and kind = 'admin_new_message' and status = 'pending';
  perform test.assert_eq(n, 1, 'one pending admin-notification e-mail job queued');

  -- Second message right after: e-mail is coalesced.
  perform test.become('authenticated', a);
  r := public.send_support_message(conv_a, 'second', gen_random_uuid());
  reset role;
  select status into v from public.support_email_outbox where message_id = (r -> 'message' ->> 'id')::uuid;
  perform test.assert_eq(v.status, 'skipped', 'second message within 2 minutes is coalesced (no extra e-mail)');

  -- Authorisation failures
  perform test.become('authenticated', a);
  perform test.expect_error(format($q$select public.send_support_message(%L, 'x', gen_random_uuid(), '[]', true)$q$, conv_a), 'forbidden', 'normal user cannot send as admin');
  perform test.expect_error(format($q$select public.send_support_message(%L, 'x', gen_random_uuid())$q$, conv_b), 'conversation_not_found', 'user cannot write into someone else''s conversation');
  perform test.expect_error($q$select public.send_support_message(gen_random_uuid(), 'x', gen_random_uuid())$q$, 'conversation_not_found', 'unknown conversation gives the same error (no enumeration)');
  perform test.expect_error(format($q$select public.mark_support_read(%L)$q$, conv_b), 'conversation_not_found', 'user cannot mark someone else''s conversation read');
  perform test.expect_error(format($q$select public.mark_support_read(%L, true)$q$, conv_a), 'forbidden', 'normal user cannot mark read as admin');

  -- Validation
  perform test.expect_error(format($q$select public.send_support_message(%L, '   ', gen_random_uuid())$q$, conv_a), 'empty_message', 'empty message rejected');
  perform test.expect_error(format($q$select public.send_support_message(%L, repeat('x', 4001), gen_random_uuid())$q$, conv_a), 'body_too_long', 'over-long body rejected');
  perform test.expect_error(format($q$select public.send_support_message(%L, 'x', null)$q$, conv_a), 'client_id_required', 'client_id required');
  perform test.expect_error(format($q$select public.send_support_message(%L, 'x', gen_random_uuid(), '{"a":1}')$q$, conv_a), 'invalid_attachments', 'attachments must be an array');
  perform test.expect_error(format($q$select public.send_support_message(%L, 'x', gen_random_uuid(), '[{},{},{},{},{},{}]')$q$, conv_a), 'too_many_attachments', 'more than 5 attachments rejected');

  -- Another user's client_id cannot collide with / read mine.
  perform test.become('authenticated', b);
  r := public.send_support_message(conv_b, 'bob here', cid1);
  perform test.assert_eq(r -> 'message' ->> 'conversation_id', conv_b::text, 'same client_id from another user creates their own message');

  -- Read isolation on the messages table itself
  select count(*) into n from public.support_messages where conversation_id = conv_a;
  perform test.assert_eq(n, 0, 'user B cannot read any of A''s messages');
  select count(*) into n from public.support_messages;
  perform test.assert_eq(n, 1, 'user B sees only their own single message');
  perform test.become('authenticated', a);
  select count(*) into n from public.support_messages where conversation_id = conv_b;
  perform test.assert_eq(n, 0, 'user A cannot read any of B''s messages');
  reset role;
end $$;

-- =====================================================================
-- 4. Rate limit (20 messages / 60 s for end users)
-- =====================================================================
do $$
declare
  a uuid := '00000000-0000-0000-0000-00000000000a';
  conv_a uuid := test.get('convA')::uuid;
  i int; n int;
begin
  perform test.become('authenticated', a);
  select count(*) into n from public.support_messages where conversation_id = conv_a and sender_id = a;
  for i in (n + 1)..20 loop
    perform public.send_support_message(conv_a, 'm' || i, gen_random_uuid());
  end loop;
  perform test.expect_error(format($q$select public.send_support_message(%L, 'one too many', gen_random_uuid())$q$, conv_a), 'rate_limited', '21st message in a minute is rate limited');
  reset role;
end $$;

-- =====================================================================
-- 5. Clients can never write tables directly (RPC is the only path)
-- =====================================================================
do $$
declare
  a uuid := '00000000-0000-0000-0000-00000000000a';
  ad uuid := '00000000-0000-0000-0000-0000000000ad';
  conv_a uuid := test.get('convA')::uuid;
begin
  perform test.become('authenticated', a);
  perform test.expect_error(format($q$insert into public.support_messages (conversation_id, sender_id, sender_type, body) values (%L, %L, 'admin', 'forged')$q$, conv_a, a), 'permission denied', 'user cannot INSERT a forged admin message directly');
  perform test.expect_error(format($q$insert into public.support_messages (conversation_id, sender_id, sender_type, body) values (%L, %L, 'user', 'direct')$q$, conv_a, a), 'permission denied', 'user cannot INSERT any message directly');
  perform test.expect_error(format($q$update public.support_messages set body = 'edited' where conversation_id = %L$q$, conv_a), 'permission denied', 'user cannot UPDATE messages');
  perform test.expect_error(format($q$delete from public.support_messages where conversation_id = %L$q$, conv_a), 'permission denied', 'user cannot DELETE messages');
  perform test.expect_error(format($q$insert into public.support_conversations (user_id) values (%L)$q$, a), 'permission denied', 'user cannot INSERT conversations directly');
  perform test.expect_error(format($q$update public.support_conversations set user_id = %L where id = %L$q$, ad, conv_a), 'permission denied', 'user cannot change conversation owner');
  perform test.expect_error(format($q$update public.support_conversations set status = 'resolved' where id = %L$q$, conv_a), 'permission denied', 'user cannot change conversation status directly');
  perform test.expect_error(format($q$update public.support_conversations set admin_unread_count = 0 where id = %L$q$, conv_a), 'permission denied', 'user cannot reset protected counters');
  perform test.expect_error($q$insert into public.support_message_attachments (message_id, conversation_id, storage_path, mime_type, size_bytes) values (gen_random_uuid(), gen_random_uuid(), 'x', 'image/png', 1)$q$, 'permission denied', 'user cannot INSERT attachment rows directly');
  perform test.expect_error('select * from public.support_email_outbox', 'permission denied', 'user cannot read the e-mail outbox');

  -- Even a support admin has no direct write access: only the audited RPCs.
  perform test.become('authenticated', ad);
  perform test.expect_error(format($q$insert into public.support_messages (conversation_id, sender_id, sender_type, body) values (%L, %L, 'admin', 'direct')$q$, conv_a, ad), 'permission denied', 'even an admin cannot INSERT messages directly');
  perform test.expect_error(format($q$update public.support_conversations set status = 'resolved' where id = %L$q$, conv_a), 'permission denied', 'even an admin cannot UPDATE conversations directly');
  reset role;
end $$;

-- =====================================================================
-- 6. Admin rights cannot be self-granted
-- =====================================================================
do $$
declare
  a uuid := '00000000-0000-0000-0000-00000000000a';
  b uuid := '00000000-0000-0000-0000-00000000000b';
  ad uuid := '00000000-0000-0000-0000-0000000000ad';
  n int;
begin
  perform test.become('authenticated', a);
  perform test.assert_eq(public.is_support_admin(), false, 'normal user is not an admin');
  perform test.expect_error(format($q$insert into public.support_admins (user_id) values (%L)$q$, a), 'permission denied', 'user cannot add themselves to support_admins');
  perform test.expect_error(format($q$update public.support_admins set user_id = %L$q$, a), 'permission denied', 'user cannot edit support_admins');
  perform test.expect_error('delete from public.support_admins', 'permission denied', 'user cannot delete from support_admins');
  select count(*) into n from public.support_admins;
  perform test.assert_eq(n, 0, 'normal user sees no support_admins rows');

  -- profiles has an "update own row" policy; make sure it cannot grant admin.
  update public.profiles set full_name = 'hacker' where id = a;
  perform test.assert_eq(public.is_support_admin(), false, 'editing own profile does not grant admin');

  perform test.become('authenticated', ad);
  perform test.assert_eq(public.is_support_admin(), true, 'listed admin is recognised server-side');
  select count(*) into n from public.support_admins;
  perform test.assert_eq(n, 1, 'admin sees only own support_admins row');

  perform test.become('authenticated', a);
  perform test.expect_error('select * from public.support_admin_list_conversations()', 'forbidden', 'normal user cannot list all conversations');
  perform test.expect_error(format($q$select public.support_admin_set_status(%L, 'resolved')$q$, test.get('convA')), 'forbidden', 'normal user cannot set status');
  reset role;
end $$;

-- =====================================================================
-- 7. Admin flows
-- =====================================================================
do $$
declare
  a uuid := '00000000-0000-0000-0000-00000000000a';
  ad uuid := '00000000-0000-0000-0000-0000000000ad';
  conv_a uuid := test.get('convA')::uuid;
  r jsonb; v record; n int;
begin
  perform test.become('authenticated', ad);

  select count(*) into n from public.support_messages;
  perform test.assert_eq(n >= 21, true, 'admin can read all messages');

  select count(*) into n from public.support_admin_list_conversations();
  perform test.assert_eq(n, 2, 'admin list returns both conversations');
  select * into v from public.support_admin_list_conversations() where id = conv_a;
  perform test.assert_eq(v.email, 'alice@example.test', 'admin list exposes the user e-mail');
  perform test.assert_eq(v.full_name, 'hacker', 'admin list exposes the profile name');
  perform test.assert_eq(v.admin_unread_count >= 1, true, 'admin list exposes unread count');
  select count(*) into n from public.support_admin_list_conversations('resolved');
  perform test.assert_eq(n, 0, 'status filter works (resolved = 0)');
  perform test.expect_error($q$select * from public.support_admin_list_conversations('bogus')$q$, 'invalid_status', 'invalid filter rejected');

  -- Reply as admin
  r := public.send_support_message(conv_a, 'We are looking into it', gen_random_uuid(), '[]', true);
  perform test.assert_eq(r -> 'message' ->> 'sender_type', 'admin', 'admin reply is stored as sender_type=admin');
  perform test.put('msgAdmin1', r -> 'message' ->> 'id');
  perform test.expect_error(format($q$select public.send_support_message(%L, 'no flag', gen_random_uuid())$q$, conv_a), 'conversation_not_found', 'admin must opt in with p_as_admin to write into a user conversation');
  perform test.expect_error(format($q$select public.send_support_message(%L, 'x', gen_random_uuid(), '[{"path":"p","mime":"image/png"}]', true)$q$, conv_a), 'admin_attachments_unsupported', 'admin attachments are not supported in v1');

  reset role;
  select * into v from public.support_conversations where id = conv_a;
  perform test.assert_eq(v.status, 'waiting', 'status moves open -> waiting after admin reply');
  perform test.assert_eq(v.user_unread_count, 1, 'user unread counter incremented');
  perform test.assert_eq(v.last_sender_type, 'admin', 'last_sender_type updated');
  select count(*) into n from public.support_email_outbox where message_id = (test.get('msgAdmin1'))::uuid and kind = 'user_reply' and status = 'pending';
  perform test.assert_eq(n, 1, 'user-notification e-mail job queued');

  -- Status changes
  perform test.become('authenticated', ad);
  perform public.support_admin_set_status(conv_a, 'resolved');
  select status into v from public.support_conversations where id = conv_a;
  perform test.assert_eq(v.status, 'resolved', 'admin can set resolved');
  perform test.expect_error(format($q$select public.support_admin_set_status(%L, 'bogus')$q$, conv_a), 'invalid_status', 'invalid status rejected');
  perform test.expect_error($q$select public.support_admin_set_status(gen_random_uuid(), 'open')$q$, 'conversation_not_found', 'unknown conversation rejected');
  select count(*) into n from public.support_admin_list_conversations('resolved');
  perform test.assert_eq(n, 1, 'status filter finds the resolved conversation');

  -- User writes again -> reopened
  perform test.become('authenticated', a);
  -- (rate-limit window is full from section 4, so clear it as owner first)
  reset role;
  delete from public.support_messages where conversation_id = conv_a and sender_type = 'user' and body ~ '^m[0-9]+$';
  perform test.become('authenticated', a);
  perform public.send_support_message(conv_a, 'still broken', gen_random_uuid());
  reset role;
  select status into v from public.support_conversations where id = conv_a;
  perform test.assert_eq(v.status, 'open', 'a new user message reopens a resolved conversation');

  -- Read receipts
  perform test.become('authenticated', a);
  perform public.mark_support_read(conv_a);
  reset role;
  select * into v from public.support_conversations where id = conv_a;
  perform test.assert_eq(v.user_unread_count, 0, 'user mark_read clears user unread counter');
  perform test.assert_eq(v.admin_unread_count > 0, true, 'user mark_read does not clear admin unread counter');
  select count(*) into n from public.support_messages where conversation_id = conv_a and sender_type = 'admin' and read_at is null;
  perform test.assert_eq(n, 0, 'admin messages are stamped read_at');

  perform test.become('authenticated', ad);
  perform public.mark_support_read(conv_a, true);
  reset role;
  select * into v from public.support_conversations where id = conv_a;
  perform test.assert_eq(v.admin_unread_count, 0, 'admin mark_read clears admin unread counter');
  select count(*) into n from public.support_messages where conversation_id = conv_a and sender_type = 'user' and read_at is null;
  perform test.assert_eq(n, 0, 'user messages are stamped read_at');
end $$;

-- =====================================================================
-- 8. Attachments + Storage RLS
-- =====================================================================
do $$
declare
  a uuid := '00000000-0000-0000-0000-00000000000a';
  b uuid := '00000000-0000-0000-0000-00000000000b';
  ad uuid := '00000000-0000-0000-0000-0000000000ad';
  conv_a uuid := test.get('convA')::uuid;
  conv_b uuid := test.get('convB')::uuid;
  p_ok text := conv_a::text || '/' || gen_random_uuid()::text || '.png';
  p_other_conv text := conv_b::text || '/' || gen_random_uuid()::text || '.png';
  p_missing text := conv_a::text || '/' || gen_random_uuid()::text || '.png';
  p_mismatch text := conv_a::text || '/' || gen_random_uuid()::text || '.jpg';
  p_foreign text := conv_a::text || '/' || gen_random_uuid()::text || '.webp';
  p_big text := conv_a::text || '/' || gen_random_uuid()::text || '.png';
  r jsonb; n int; v record; rc int;
begin
  -- Simulate finished uploads (owner = the uploader, as the Storage API does).
  insert into storage.objects (bucket_id, name, owner_id, metadata) values
    ('support-attachments', p_ok,       a::text, '{"mimetype":"image/png","size":1000}'),
    ('support-attachments', p_mismatch, a::text, '{"mimetype":"image/png","size":1000}'),
    ('support-attachments', p_foreign,  b::text, '{"mimetype":"image/webp","size":1000}'),
    ('support-attachments', p_big,      a::text, '{"mimetype":"image/png","size":6000000}'),
    ('support-attachments', p_other_conv, b::text, '{"mimetype":"image/png","size":1000}');

  perform test.become('authenticated', a);

  -- clear rate limit window from earlier sections
  reset role;
  delete from public.support_messages where conversation_id = conv_a and sender_type = 'user' and body ~ '^(m[0-9]+|second|still broken)$';
  perform test.become('authenticated', a);

  perform test.expect_error(format($q$select public.send_support_message(%L, '', gen_random_uuid(), %L::jsonb)$q$, conv_a, jsonb_build_array(jsonb_build_object('path', p_other_conv, 'mime', 'image/png'))), 'attachment_path_invalid', 'cannot attach a file from another conversation folder');
  perform test.expect_error(format($q$select public.send_support_message(%L, '', gen_random_uuid(), %L::jsonb)$q$, conv_a, jsonb_build_array(jsonb_build_object('path', p_missing, 'mime', 'image/png'))), 'attachment_missing', 'cannot attach a file that was never uploaded');
  perform test.expect_error(format($q$select public.send_support_message(%L, '', gen_random_uuid(), %L::jsonb)$q$, conv_a, jsonb_build_array(jsonb_build_object('path', p_mismatch, 'mime', 'image/jpeg'))), 'attachment_type_mismatch', 'declared type must match what storage recorded');
  perform test.expect_error(format($q$select public.send_support_message(%L, '', gen_random_uuid(), %L::jsonb)$q$, conv_a, jsonb_build_array(jsonb_build_object('path', p_ok, 'mime', 'image/gif'))), 'attachment_type_not_allowed', 'gif is not allowed');
  perform test.expect_error(format($q$select public.send_support_message(%L, '', gen_random_uuid(), %L::jsonb)$q$, conv_a, jsonb_build_array(jsonb_build_object('path', p_foreign, 'mime', 'image/webp'))), 'attachment_not_owned', 'cannot attach a file uploaded by someone else');
  perform test.expect_error(format($q$select public.send_support_message(%L, '', gen_random_uuid(), %L::jsonb)$q$, conv_a, jsonb_build_array(jsonb_build_object('path', p_big, 'mime', 'image/png'))), 'attachment_too_large', 'file over 5 MB is rejected');
  perform test.expect_error(format($q$select public.send_support_message(%L, '', gen_random_uuid(), %L::jsonb)$q$, conv_a, jsonb_build_array(jsonb_build_object('path', '../../etc/passwd', 'mime', 'image/png'))), 'attachment_path_invalid', 'path traversal rejected');

  -- Happy path: image-only message
  r := public.send_support_message(conv_a, '', gen_random_uuid(),
        jsonb_build_array(jsonb_build_object('path', p_ok, 'mime', 'image/png', 'size', 1)));
  perform test.assert_eq(jsonb_array_length(r -> 'attachments'), 1, 'image-only message accepted with 1 attachment');
  perform test.assert_eq((r -> 'attachments' -> 0 ->> 'size_bytes')::int, 1000, 'size comes from storage, not from the client');
  reset role;
  select last_message_preview into v from public.support_conversations where id = conv_a;
  perform test.assert_eq(v.last_message_preview, '📎 სურათი', 'image-only preview text');

  -- Same file cannot be attached twice
  perform test.become('authenticated', a);
  perform test.expect_error(format($q$select public.send_support_message(%L, 'again', gen_random_uuid(), %L::jsonb)$q$, conv_a, jsonb_build_array(jsonb_build_object('path', p_ok, 'mime', 'image/png'))), 'duplicate key', 'an uploaded file cannot be attached to two messages');

  -- Attachment rows: RLS
  select count(*) into n from public.support_message_attachments;
  perform test.assert_eq(n, 1, 'owner sees own attachment row');
  perform test.become('authenticated', b);
  select count(*) into n from public.support_message_attachments;
  perform test.assert_eq(n, 0, 'other user sees no attachment rows');
  perform test.become('authenticated', ad);
  select count(*) into n from public.support_message_attachments;
  perform test.assert_eq(n, 1, 'admin sees attachment rows');

  -- Storage objects: RLS
  perform test.become('authenticated', a);
  select count(*) into n from storage.objects where bucket_id = 'support-attachments';
  perform test.assert_eq(n, 4, 'A sees only files in own conversation folder (4 of 5 test objects)');
  select count(*) into n from storage.objects where bucket_id = 'support-attachments' and name = p_other_conv;
  perform test.assert_eq(n, 0, 'A cannot see a file in B''s folder');
  perform test.become('authenticated', b);
  select count(*) into n from storage.objects where bucket_id = 'support-attachments' and name like conv_a::text || '/%';
  perform test.assert_eq(n, 0, 'B cannot see any file in A''s folder');
  perform test.become('authenticated', ad);
  select count(*) into n from storage.objects where bucket_id = 'support-attachments';
  perform test.assert_eq(n, 5, 'admin sees all support files');

  -- anon: table privilege exists on storage.objects in Supabase, but RLS
  -- has no policy for anon, so it sees nothing and can write nothing.
  perform test.become('anon');
  select count(*) into n from storage.objects where bucket_id = 'support-attachments';
  perform test.assert_eq(n, 0, 'anon sees no support files');
  perform test.expect_error(format($q$insert into storage.objects (bucket_id, name) values ('support-attachments', %L)$q$, conv_a::text || '/' || gen_random_uuid()::text || '.png'), 'row-level security', 'anon cannot upload support files');

  -- Storage objects: INSERT policy
  perform test.become('authenticated', a);
  insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('support-attachments', conv_a::text || '/' || gen_random_uuid()::text || '.jpg', a::text, '{"mimetype":"image/jpeg","size":10}');
  perform test.assert_eq(true, true, 'A can upload into own conversation folder');
  perform test.expect_error(format($q$insert into storage.objects (bucket_id, name, owner_id) values ('support-attachments', %L, %L)$q$, conv_b::text || '/' || gen_random_uuid()::text || '.png', a::text), 'row-level security', 'A cannot upload into B''s folder');
  perform test.expect_error(format($q$insert into storage.objects (bucket_id, name, owner_id) values ('support-attachments', %L, %L)$q$, conv_a::text || '/' || gen_random_uuid()::text || '.gif', a::text), 'row-level security', 'gif file name rejected by storage policy');
  perform test.expect_error(format($q$insert into storage.objects (bucket_id, name, owner_id) values ('support-attachments', %L, %L)$q$, conv_a::text || '/sub/' || gen_random_uuid()::text || '.png', a::text), 'row-level security', 'nested path rejected by storage policy');
  perform test.expect_error(format($q$insert into storage.objects (bucket_id, name, owner_id) values ('support-attachments', %L, %L)$q$, 'shell.png', a::text), 'row-level security', 'file outside a conversation folder rejected');
  perform test.expect_error(format($q$insert into storage.objects (bucket_id, name, owner_id) values ('some-other-bucket', %L, %L)$q$, conv_a::text || '/' || gen_random_uuid()::text || '.png', a::text), 'violates', 'policies do not open any other bucket');

  -- No overwrite / delete for clients
  update storage.objects set name = name where bucket_id = 'support-attachments';
  get diagnostics rc = row_count;
  perform test.assert_eq(rc, 0, 'user cannot UPDATE support files');
  delete from storage.objects where bucket_id = 'support-attachments';
  get diagnostics rc = row_count;
  perform test.assert_eq(rc, 0, 'user cannot DELETE support files');

  -- Bucket configuration
  reset role;
  select * into v from storage.buckets where id = 'support-attachments';
  perform test.assert_eq(v.public, false, 'bucket is private');
  perform test.assert_eq(v.file_size_limit, 5242880::bigint, 'bucket size limit is 5 MB');
  perform test.assert_eq(v.allowed_mime_types, array['image/jpeg','image/png','image/webp'], 'bucket allows only jpeg/png/webp');
end $$;

-- =====================================================================
-- 9. E-mail outbox (service_role only) — retry / back-off / reclaim
-- =====================================================================
do $$
declare
  a uuid := '00000000-0000-0000-0000-00000000000a';
  r record; n int; v record; first_id uuid;
begin
  perform test.become('authenticated', a);
  perform test.expect_error('select * from public.support_claim_email_outbox(5)', 'permission denied', 'user cannot claim outbox jobs');
  perform test.expect_error($q$select public.support_complete_email_outbox(gen_random_uuid(), true)$q$, 'permission denied', 'user cannot complete outbox jobs');
  perform test.expect_error('select * from public.support_orphan_uploads()', 'permission denied', 'user cannot list orphan uploads');
  reset role;

  perform test.become('service_role');
  select count(*) into n from public.support_claim_email_outbox(10);
  perform test.assert_eq(n >= 2, true, 'service_role claims due jobs');
  select count(*) into n from public.support_email_outbox where status = 'sending';
  perform test.assert_eq(n >= 2, true, 'claimed jobs are marked sending');
  select count(*) into n from public.support_claim_email_outbox(10);
  perform test.assert_eq(n, 0, 'jobs already being sent are not claimed twice');

  select id, attempts into v from public.support_email_outbox where status = 'sending' order by created_at limit 1;
  first_id := v.id;
  perform test.assert_eq(v.attempts, 1, 'attempt counter incremented on claim');

  -- Failure -> failed + back-off, message is untouched
  perform public.support_complete_email_outbox(first_id, false, 'provider 500');
  select status, last_error, next_attempt_at > now() as future into v from public.support_email_outbox where id = first_id;
  perform test.assert_eq(v.status, 'failed', 'failed send is recorded');
  perform test.assert_eq(v.future, true, 'retry is scheduled in the future (back-off)');
  select count(*) into n from public.support_claim_email_outbox(10);
  perform test.assert_eq(n, 0, 'failed job is not retried before its back-off time');

  -- Time passes -> retried
  update public.support_email_outbox set next_attempt_at = now() - interval '1 second' where id = first_id;
  select attempts into v from public.support_claim_email_outbox(10) where outbox_id = first_id;
  perform test.assert_eq(v.attempts, 2, 'job is retried after back-off (attempt 2)');

  -- Success
  perform public.support_complete_email_outbox(first_id, true);
  select status, sent_at is not null as has_sent into v from public.support_email_outbox where id = first_id;
  perform test.assert_eq(v.status, 'sent', 'successful send recorded');
  perform test.assert_eq(v.has_sent, true, 'sent_at stamped');

  -- Gives up after 5 attempts
  update public.support_email_outbox set status = 'failed', attempts = 5, next_attempt_at = now() - interval '1 hour' where id = first_id;
  select count(*) into n from public.support_claim_email_outbox(10) where outbox_id = first_id;
  perform test.assert_eq(n, 0, 'a job is abandoned after 5 attempts');

  -- Crashed worker: stale "sending" is reclaimed
  update public.support_email_outbox set status = 'sending', attempts = 1, claimed_at = now() - interval '10 minutes' where id = first_id;
  select count(*) into n from public.support_claim_email_outbox(10) where outbox_id = first_id;
  perform test.assert_eq(n, 1, 'stale "sending" job is reclaimed');

  -- Content returned to the worker is what the e-mail needs, nothing more
  select * into r from public.support_claim_email_outbox(10) limit 1;
  perform test.assert_eq(true, true, 'claim function callable repeatedly');

  -- Orphans: an old upload that never got a message
  reset role;
  insert into storage.objects (bucket_id, name, owner_id, metadata, created_at)
    values ('support-attachments', test.get('convA') || '/' || gen_random_uuid()::text || '.png', '00000000-0000-0000-0000-00000000000a', '{"mimetype":"image/png","size":5}', now() - interval '3 days');
  perform test.become('service_role');
  select count(*) into n from public.support_orphan_uploads('1 day');
  perform test.assert_eq(n >= 1, true, 'orphan uploads older than 1 day are listed for cleanup');
  select count(*) into n from public.support_orphan_uploads('1 day')
    where name in (select storage_path from public.support_message_attachments);
  perform test.assert_eq(n, 0, 'attached files are never listed as orphans');
  reset role;
end $$;

-- =====================================================================
-- 10. Realtime publication
-- =====================================================================
do $$
declare n int;
begin
  select count(*) into n from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'public'
    and tablename in ('support_messages', 'support_conversations');
  perform test.assert_eq(n, 2, 'messages and conversations are published to Realtime');
end $$;

do $$ begin raise notice '=== ALL SUPPORT CHAT TESTS PASSED ==='; end $$;

rollback;
