begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.device_slot_packages'::regclass),
  'the package catalog has enabled and forced row-level security'
);
select is(
  (select count(*) from public.device_slot_packages),
  2::bigint,
  'the catalog contains only the two fixed BOG packages'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.device_slot_packages'::regclass
      and constraint_row.conname = 'device_slot_packages_fixed_bog_packages_check'
      and constraint_row.contype = 'c'
      and constraint_row.convalidated
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%subscription_plan = ''premium''%'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%currency = ''GEL''%'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%device_slots = 1%'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%price_amount = 99%'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%device_slots = 2%'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%price_amount = 179%'
  ),
  'the validated database CHECK constraint names only the two fixed package mappings'
);
select ok(
  exists (
    select 1
    from public.device_slot_packages
    where subscription_plan = 'premium'
      and device_slots = 1
      and price_amount = 99
      and currency = 'GEL'
      and active
  )
  and exists (
    select 1
    from public.device_slot_packages
    where subscription_plan = 'premium'
      and device_slots = 2
      and price_amount = 179
      and currency = 'GEL'
      and active
  ),
  'the active packages remain 99 GEL/one device and 179 GEL/two devices'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'device_slot_packages'
      and policyname = 'device_slot_packages_read_active'
      and cmd = 'SELECT'
      and roles @> array['anon', 'authenticated']
      and qual = 'active'
  ),
  'anon and authenticated can select active catalog entries only'
);
select ok(
  has_table_privilege('anon', 'public.device_slot_packages', 'select')
  and has_table_privilege('authenticated', 'public.device_slot_packages', 'select')
  and has_table_privilege('service_role', 'public.device_slot_packages', 'select')
  and not has_table_privilege('anon', 'public.device_slot_packages', 'insert,update,delete')
  and not has_table_privilege('authenticated', 'public.device_slot_packages', 'insert,update,delete')
  and not has_table_privilege('service_role', 'public.device_slot_packages', 'insert,update,delete'),
  'application roles have read-only catalog grants'
);
select ok(
  not exists (
    select 1
    from pg_catalog.pg_class relation
    cross join lateral pg_catalog.aclexplode(
      coalesce(relation.relacl, pg_catalog.acldefault('r'::"char", relation.relowner))
    ) privilege
    where relation.oid = 'public.device_slot_packages'::regclass
      and privilege.grantee = 0
      and privilege.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  ),
  'PUBLIC has no package-catalog write privileges'
);
select throws_ok(
  $$insert into public.device_slot_packages
      (subscription_plan, device_slots, price_amount, currency, active)
    values ('premium', 3, 299, 'GEL', true)$$,
  '23514',
  'new row for relation "device_slot_packages" violates check constraint "device_slot_packages_fixed_bog_packages_check"',
  'the database rejects packages outside the fixed BOG catalog'
);
select throws_ok(
  $$update public.device_slot_packages
    set price_amount = 100
    where subscription_plan = 'premium'
      and device_slots = 1$$,
  '23514',
  'new row for relation "device_slot_packages" violates check constraint "device_slot_packages_fixed_bog_packages_check"',
  'the database rejects updates that change a fixed package price'
);

set local role anon;
select is(
  (select count(*) from public.device_slot_packages),
  2::bigint,
  'anon can read the active package catalog'
);
reset role;
set local role authenticated;
select is(
  (select count(*) from public.device_slot_packages),
  2::bigint,
  'authenticated users can read the active package catalog'
);

reset role;
select * from finish();
rollback;
