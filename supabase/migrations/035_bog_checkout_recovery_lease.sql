begin;

do $preflight$
begin
  if to_regclass('public.payment_transactions') is null
     or to_regprocedure('public.create_bog_pending_payment(uuid,text,text,uuid,numeric,integer,jsonb)') is null
     or to_regprocedure('public.update_bog_payment_status(text,text,text,jsonb)') is null
  then
    raise exception 'Migrations 033 and 034 must be applied before migration 035';
  end if;
end
$preflight$;

create table public.bog_checkout_recovery_leases (
  claim_payment_id text primary key,
  lease_token uuid not null,
  lease_expires_at timestamptz not null,
  updated_at timestamptz not null default pg_catalog.now()
);

alter table public.bog_checkout_recovery_leases enable row level security;
revoke all on public.bog_checkout_recovery_leases from public, anon, authenticated, service_role;

create or replace function public.acquire_bog_checkout_recovery_lease(
  p_claim_payment_id text,
  p_lease_seconds integer default 180
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_lease_token uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Only the payment service can acquire BOG recovery leases'
      using errcode = '42501';
  end if;

  if p_claim_payment_id is null
     or p_claim_payment_id = ''
     or p_lease_seconds is null
     or p_lease_seconds not between 30 and 300
  then
    raise exception 'Invalid BOG recovery lease request'
      using errcode = '22023';
  end if;

  delete from public.bog_checkout_recovery_leases
   where lease_expires_at <= pg_catalog.clock_timestamp();

  perform 1
    from public.payment_transactions payment
   where payment.provider = 'bog'
     and payment.status in ('pending', 'processing')
     and (
       payment.payment_id = p_claim_payment_id
       or payment.metadata->>'claim_payment_id' = p_claim_payment_id
     )
     and payment.metadata->>'checkout_phase' in ('bank_call', 'ready')
   for update;

  if not found then
    return null;
  end if;

  insert into public.bog_checkout_recovery_leases (
    claim_payment_id, lease_token, lease_expires_at, updated_at
  )
  values (
    p_claim_payment_id,
    pg_catalog.gen_random_uuid(),
    pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds),
    pg_catalog.clock_timestamp()
  )
  on conflict (claim_payment_id) do update
     set lease_token = excluded.lease_token,
         lease_expires_at = excluded.lease_expires_at,
         updated_at = excluded.updated_at
   where public.bog_checkout_recovery_leases.lease_expires_at <= pg_catalog.clock_timestamp()
  returning lease_token into v_lease_token;

  return v_lease_token;
end;
$$;

create or replace function public.release_bog_checkout_recovery_lease(
  p_claim_payment_id text,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_deleted boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Only the payment service can release BOG recovery leases'
      using errcode = '42501';
  end if;

  if p_claim_payment_id is null or p_claim_payment_id = '' or p_lease_token is null then
    raise exception 'Invalid BOG recovery lease release request'
      using errcode = '22023';
  end if;

  delete from public.bog_checkout_recovery_leases
   where claim_payment_id = p_claim_payment_id
     and lease_token = p_lease_token;
  v_deleted := found;
  return v_deleted;
end;
$$;

revoke all on function public.acquire_bog_checkout_recovery_lease(text, integer)
  from public, anon, authenticated, cityroute_bog_confirmer;
revoke all on function public.release_bog_checkout_recovery_lease(text, uuid)
  from public, anon, authenticated, cityroute_bog_confirmer;
grant execute on function public.acquire_bog_checkout_recovery_lease(text, integer)
  to service_role;
grant execute on function public.release_bog_checkout_recovery_lease(text, uuid)
  to service_role;

comment on table public.bog_checkout_recovery_leases is
  'Short-lived, service-only distributed leases serialize BOG recovery and ready-claim settlement retries.';

commit;
