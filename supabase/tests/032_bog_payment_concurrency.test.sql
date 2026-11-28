-- Isolated two-connection BOG race. Not executed.
-- Creates one random user and two random pending payments, commits them,
-- sends both calls before reading either result, then deletes only those rows.

create extension if not exists dblink with schema extensions;
create extension if not exists pgtap with schema extensions;

create temp table race_ids (
  user_id uuid primary key,
  payment_99 text not null,
  payment_179 text not null,
  merchant_99 text not null,
  merchant_179 text not null
);

insert into race_ids
select pg_catalog.gen_random_uuid(),
       'm032-race-99-' || replace(pg_catalog.gen_random_uuid()::text, '-', ''),
       'm032-race-179-' || replace(pg_catalog.gen_random_uuid()::text, '-', ''),
       'm032-mer-99-' || replace(pg_catalog.gen_random_uuid()::text, '-', ''),
       'm032-mer-179-' || replace(pg_catalog.gen_random_uuid()::text, '-', '');

create temp table race_capture (
  conn text primary key,
  sent integer,
  was_busy integer,
  payment_result text,
  extra_rows integer,
  error_message text
);

begin;
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select user_id,
       '00000000-0000-0000-0000-000000000000',
       'authenticated',
       'authenticated',
       'm032-race-' || user_id::text || '@example.test',
       '',
       pg_catalog.now(), '{}'::jsonb, '{}'::jsonb, pg_catalog.now(), pg_catalog.now()
from race_ids;

insert into public.payment_transactions (
  user_id, provider, payment_id, merchant_payment_id, amount, currency, status, metadata
)
select user_id, 'bog', payment_99, merchant_99, 99, 'GEL', 'pending',
       '{"provider":"bog","device_slots":1,"package_price":99}'::jsonb
from race_ids
union all
select user_id, 'bog', payment_179, merchant_179, 179, 'GEL', 'pending',
       '{"provider":"bog","device_slots":2,"package_price":179}'::jsonb
from race_ids;
commit;

create function pg_temp.race_sql(p_payment text, p_merchant text, p_amount text)
returns text
language sql
as $race_sql$
  select pg_catalog.format($q$
    select public.update_bog_payment_status(
      %L, 'success', 'race-bank',
      pg_catalog.jsonb_build_object(
        'bank_status', 'completed',
        'bank_amount', %L,
        'bank_currency', 'GEL',
        'bank_external_order_id', %L
      )
    )::text
    from (
      select pg_catalog.pg_sleep(2)
      from (
        select pg_catalog.set_config('request.jwt.claim.role', 'cityroute_bog_confirmer', true),
               pg_catalog.set_config('request.jwt.claims', '{"role":"cityroute_bog_confirmer"}', true)
      ) configured
    ) waited
  $q$, p_payment, p_amount, p_merchant)
$race_sql$;

create function pg_temp.drain_race(p_conn text)
returns void
language plpgsql
as $drain$
declare
  v_row text;
  v_result text;
  v_extra integer := 0;
  v_seen boolean := false;
begin
  loop
    v_row := null;
    select r.payment_result
      into v_row
    from extensions.dblink_get_result(p_conn) as r(payment_result text);
    exit when not found;
    if v_seen then
      v_extra := v_extra + 1;
    else
      v_result := v_row;
      v_seen := true;
    end if;
  end loop;
  update race_capture
     set payment_result = v_result,
         extra_rows = v_extra
   where conn = p_conn;
exception when others then
  update race_capture
     set error_message = sqlerrm
   where conn = p_conn;
  begin
    update race_capture
       set error_message = error_message || ' | ' || extensions.dblink_error_message(p_conn)
     where conn = p_conn;
  exception when others then
    null;
  end;
end
$drain$;

do $race$
declare
  v_pay99 text;
  v_pay179 text;
  v_mer99 text;
  v_mer179 text;
  v_ok text;
  v_sent integer;
  v_busy_a integer;
  v_busy_b integer;
  v_error text;
begin
  select payment_99, payment_179, merchant_99, merchant_179
    into v_pay99, v_pay179, v_mer99, v_mer179
  from race_ids;

  begin
    v_ok := extensions.dblink_connect('race_a', 'dbname=' || current_database());
    if v_ok is distinct from 'OK' then
      insert into race_capture (conn, error_message)
      values ('race_a', 'connect returned ' || coalesce(v_ok, 'null'));
    end if;
  exception when others then
    insert into race_capture (conn, error_message) values ('race_a', sqlerrm);
  end;

  begin
    v_ok := extensions.dblink_connect('race_b', 'dbname=' || current_database());
    if v_ok is distinct from 'OK' then
      insert into race_capture (conn, error_message)
      values ('race_b', 'connect returned ' || coalesce(v_ok, 'null'));
    end if;
  exception when others then
    insert into race_capture (conn, error_message) values ('race_b', sqlerrm);
  end;

  if not exists (select 1 from race_capture where conn = 'race_a') then
    begin
      v_sent := extensions.dblink_send_query('race_a', pg_temp.race_sql(v_pay99, v_mer99, '99.00'));
      insert into race_capture (conn, sent) values ('race_a', v_sent);
    exception when others then
      v_error := sqlerrm;
      begin
        v_error := v_error || ' | ' || extensions.dblink_error_message('race_a');
      exception when others then
        null;
      end;
      insert into race_capture (conn, error_message) values ('race_a', v_error);
    end;
  end if;

  if not exists (select 1 from race_capture where conn = 'race_b') then
    begin
      v_sent := extensions.dblink_send_query('race_b', pg_temp.race_sql(v_pay179, v_mer179, '179.00'));
      insert into race_capture (conn, sent) values ('race_b', v_sent);
    exception when others then
      v_error := sqlerrm;
      begin
        v_error := v_error || ' | ' || extensions.dblink_error_message('race_b');
      exception when others then
        null;
      end;
      insert into race_capture (conn, error_message) values ('race_b', v_error);
    end;
  end if;

  if exists (select 1 from race_capture where conn = 'race_a' and sent = 1)
     and exists (select 1 from race_capture where conn = 'race_b' and sent = 1) then
    v_busy_a := extensions.dblink_is_busy('race_a');
    v_busy_b := extensions.dblink_is_busy('race_b');
    update race_capture set was_busy = v_busy_a where conn = 'race_a';
    update race_capture set was_busy = v_busy_b where conn = 'race_b';
  end if;

  if exists (
    select 1 from race_capture
    where conn = 'race_a' and sent = 1 and error_message is null
  ) then
    perform pg_temp.drain_race('race_a');
  end if;
  if exists (
    select 1 from race_capture
    where conn = 'race_b' and sent = 1 and error_message is null
  ) then
    perform pg_temp.drain_race('race_b');
  end if;

  begin
    perform extensions.dblink_disconnect('race_a');
  exception when others then
    null;
  end;
  begin
    perform extensions.dblink_disconnect('race_b');
  exception when others then
    null;
  end;
end
$race$;

begin;
select plan(16);

select is((select sent from race_capture where conn = 'race_a'), 1, '99 GEL query was sent');
select is((select sent from race_capture where conn = 'race_b'), 1, '179 GEL query was sent');
select is((select was_busy from race_capture where conn = 'race_a'), 1, '99 GEL call was still running after both queries were sent');
select is((select was_busy from race_capture where conn = 'race_b'), 1, '179 GEL call was still running after both queries were sent');
select is((select error_message from race_capture where conn = 'race_a'), null, '99 GEL call raised no error');
select is((select error_message from race_capture where conn = 'race_b'), null, '179 GEL call raised no error');
select is(
  coalesce((select case when error_message is null then payment_result::jsonb->>'success' end from race_capture where conn = 'race_a'), 'missing'),
  'true',
  '99 GEL call returns success'
);
select is(
  coalesce((select case when error_message is null then payment_result::jsonb->>'status' end from race_capture where conn = 'race_a'), 'missing'),
  'success',
  '99 GEL call records success'
);
select is(coalesce((select extra_rows from race_capture where conn = 'race_a'), -1), 0, '99 GEL connection has no unread result');
select is(
  coalesce((select case when error_message is null then payment_result::jsonb->>'success' end from race_capture where conn = 'race_b'), 'missing'),
  'true',
  '179 GEL call returns success'
);
select is(
  coalesce((select case when error_message is null then payment_result::jsonb->>'status' end from race_capture where conn = 'race_b'), 'missing'),
  'success',
  '179 GEL call records success'
);
select is(coalesce((select extra_rows from race_capture where conn = 'race_b'), -1), 0, '179 GEL connection has no unread result');
select is(
  (select count(*)::integer
   from public.payment_transactions t
   join race_ids i on t.user_id = i.user_id
    and t.payment_id in (i.payment_99, i.payment_179)
   where t.status = 'success'),
  2,
  'both generated payments are success'
);
select is(
  (select p.device_slots from public.profiles p join race_ids i on p.id = i.user_id),
  (select (t.metadata->>'device_slots')::integer
   from public.profiles p
   join race_ids i on p.id = i.user_id
   join public.payment_transactions t
     on t.user_id = p.id and t.payment_id = p.subscription_payment_id),
  'profile slots match the winning generated payment'
);
select is(
  (select p.subscription_payment_id in (i.payment_99, i.payment_179)
   from public.profiles p
   join race_ids i on p.id = i.user_id),
  true,
  'profile points at one of the two generated payments'
);
select is(
  (select p.subscription_status || ':' || p.subscription_plan
   from public.profiles p
   join race_ids i on p.id = i.user_id),
  'active:premium',
  'generated profile finished active premium'
);

select extensions.dblink_exec(
  'dbname=' || current_database(),
  pg_catalog.format(
    $cleanup$
      delete from public.profile_revoked_sessions where profile_id = %L::uuid;
      delete from public.profile_active_sessions where profile_id = %L::uuid;
      delete from public.payment_transactions
      where user_id = %L::uuid and payment_id in (%L, %L);
      delete from public.profiles where id = %L::uuid;
      delete from auth.users where id = %L::uuid;
    $cleanup$,
    (select user_id from race_ids),
    (select user_id from race_ids),
    (select user_id from race_ids),
    (select payment_99 from race_ids),
    (select payment_179 from race_ids),
    (select user_id from race_ids),
    (select user_id from race_ids)
  )
);

select * from finish();
rollback;
