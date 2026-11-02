begin;

do $$
declare
  expires_at_type oid;
begin
  if to_regclass('public.profiles') is null then
    raise exception 'public.profiles is missing; apply the base schema before migration 025';
  end if;

  select a.atttypid
  into expires_at_type
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.profiles'::regclass
    and a.attname = 'subscription_expires_at'
    and not a.attisdropped;

  if expires_at_type is null or expires_at_type <> 'timestamptz'::regtype then
    raise exception 'profiles.subscription_expires_at must exist as timestamptz before migration 025';
  end if;
end;
$$;

alter table public.profiles
  alter column subscription_expires_at drop not null;

commit;
