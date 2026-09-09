-- Activate premium for gogakirvalidze@gmail.com
-- Run in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/tuylbbdhvfcobxynwtnt/sql

update public.profiles p
set
  subscription_status = 'active',
  subscription_expires_at = now() + interval '10 years',
  device_fingerprint = null,
  device_bound_at = null,
  updated_at = now()
from auth.users u
where p.id = u.id
  and lower(u.email) = lower('gogakirvalidze@gmail.com');

-- Verify
select
  u.email,
  p.subscription_status,
  p.subscription_expires_at,
  p.device_fingerprint,
  public.has_active_access(p.id) as has_access
from auth.users u
join public.profiles p on p.id = u.id
where lower(u.email) = lower('gogakirvalidze@gmail.com');
