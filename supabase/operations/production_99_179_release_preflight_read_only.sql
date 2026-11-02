-- Read-only preflight for the proposed 99/179 GEL device-session release.
-- Confirm the selected project is Production before running this file.

select
  current_database() as database_name,
  current_setting('server_version') as postgres_version,
  pg_catalog.to_regclass('supabase_migrations.schema_migrations') is not null
    as migration_history_table_exists;

select
  object_name,
  object_exists
from (
  values
    ('public.profiles', pg_catalog.to_regclass('public.profiles') is not null),
    ('public.payment_transactions', pg_catalog.to_regclass('public.payment_transactions') is not null),
    ('public.profile_devices', pg_catalog.to_regclass('public.profile_devices') is not null),
    ('public.profile_active_sessions', pg_catalog.to_regclass('public.profile_active_sessions') is not null),
    ('public.profile_revoked_sessions', pg_catalog.to_regclass('public.profile_revoked_sessions') is not null),
    ('public.device_session_limit_overrides', pg_catalog.to_regclass('public.device_session_limit_overrides') is not null),
    ('public.has_current_active_session()', pg_catalog.to_regprocedure('public.has_current_active_session()') is not null),
    ('public.activate_current_session()', pg_catalog.to_regprocedure('public.activate_current_session()') is not null),
    ('public.deactivate_current_session()', pg_catalog.to_regprocedure('public.deactivate_current_session()') is not null),
    ('public.current_verified_premium_device_slots(uuid)', pg_catalog.to_regprocedure('public.current_verified_premium_device_slots(uuid)') is not null),
    ('public.get_current_account_entitlement()', pg_catalog.to_regprocedure('public.get_current_account_entitlement()') is not null)
) as required_objects(object_name, object_exists);

select
  table_schema,
  table_name,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where (table_schema, table_name, column_name) in (
  ('public', 'profiles', 'subscription_payment_id'),
  ('public', 'profiles', 'subscription_status'),
  ('public', 'profiles', 'subscription_plan'),
  ('public', 'profiles', 'subscription_expires_at'),
  ('public', 'profiles', 'device_slots'),
  ('public', 'payment_transactions', 'payment_id'),
  ('public', 'payment_transactions', 'amount'),
  ('public', 'payment_transactions', 'currency'),
  ('public', 'payment_transactions', 'status'),
  ('public', 'payment_transactions', 'metadata'),
  ('public', 'payment_transactions', 'paid_at'),
  ('public', 'payment_transactions', 'provider'),
  ('public', 'payment_transactions', 'merchant_payment_id'),
  ('public', 'profile_active_sessions', 'device_fingerprint'),
  ('public', 'device_session_limit_overrides', 'session_limit'),
  ('public', 'device_session_limit_overrides', 'revoked_at'),
  ('auth', 'sessions', 'not_after')
)
order by table_schema, table_name, column_name;

select
  case
    when pg_catalog.to_regprocedure('public.current_device_session_limit(uuid)') is null
      then false
    else pg_catalog.strpos(
      pg_catalog.lower(
        pg_catalog.pg_get_functiondef(
          pg_catalog.to_regprocedure('public.current_device_session_limit(uuid)')
        )
      ),
      'full'
    ) > 0
  end as migration_019_function_present,
  pg_catalog.to_regprocedure('public.current_verified_premium_device_slots(uuid)') is not null
    as migration_020_function_present,
  pg_catalog.to_regprocedure('public.get_current_account_entitlement()') is not null
    as migration_022_function_present;
