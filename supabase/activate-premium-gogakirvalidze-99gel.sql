-- Activate Premium Subscription for gogakirvalidze@gmail.com
-- New Premium Plan: 99 GEL/month
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/tuylbbdhvfcobxynwtnt/sql

-- Update user profile to Premium (99 GEL plan)
UPDATE profiles
SET 
  subscription_status = 'active',
  subscription_plan = 'premium',
  subscription_expires_at = now() + interval '30 days',
  device_fingerprint = null,
  device_bound_at = null,
  updated_at = now()
WHERE id IN (
  SELECT id FROM auth.users WHERE email = 'gogakirvalidze@gmail.com'
);

-- Verify the update
SELECT 
  u.email,
  p.subscription_status,
  p.subscription_plan,
  p.subscription_expires_at,
  p.trial_started_at,
  p.created_at,
  p.updated_at
FROM profiles p
JOIN auth.users u ON u.id = p.id
WHERE u.email = 'gogakirvalidze@gmail.com';

-- Expected result:
-- email: gogakirvalidze@gmail.com
-- subscription_status: active
-- subscription_plan: premium
-- subscription_expires_at: (30 days from now)
-- ✅ Premium 99 GEL/month activated!
