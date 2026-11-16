begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(7);

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
  '00000000-0000-0000-0000-000000000981',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'plan-check-024@example.test', '',
  pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()
)
on conflict (id) do nothing;

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = any(c.conkey)
    where c.conrelid = 'public.profiles'::regclass
      and c.conname = 'profiles_subscription_plan_check'
      and c.contype = 'c'
      and a.attname = 'subscription_plan'
      and cardinality(c.conkey) = 1
  ),
  'the named CHECK applies only to subscription_plan'
);

select lives_ok(
  $$update public.profiles set subscription_plan = 'nav'
    where id = '00000000-0000-0000-0000-000000000981'$$,
  'nav plan is accepted'
);
select lives_ok(
  $$update public.profiles set subscription_plan = 'panel'
    where id = '00000000-0000-0000-0000-000000000981'$$,
  'panel plan is accepted'
);
select lives_ok(
  $$update public.profiles set subscription_plan = 'full'
    where id = '00000000-0000-0000-0000-000000000981'$$,
  'full plan is accepted'
);
select lives_ok(
  $$update public.profiles set subscription_plan = 'premium'
    where id = '00000000-0000-0000-0000-000000000981'$$,
  'premium plan is accepted'
);

select pg_temp.confirm_bog('00000000-0000-0000-0000-000000000981', 'preserve-plan-check-024', 'merchant-preserve-plan-check-024', 179, 2);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'subscription_status', subscription_status,
      'device_slots', device_slots,
      'subscription_payment_id', subscription_payment_id
    )
    from public.profiles
    where id = '00000000-0000-0000-0000-000000000981'
  ),
  pg_catalog.jsonb_build_object(
    'subscription_status', 'active',
    'device_slots', 2,
    'subscription_payment_id', 'preserve-plan-check-024'
  ),
  'activation keeps status, device slots, and payment reference'
);
select ok(
  (
    select subscription_expires_at > pg_catalog.now() + interval '20 days'
    from public.profiles
    where id = '00000000-0000-0000-0000-000000000981'
  ),
  'confirmed activation writes an expiry at least 20 days ahead'
);

select * from finish();
rollback;
