-- Premium subscription for gogakirvalidze@gmail.com
-- Run this in Supabase SQL Editor

-- Find user ID
SELECT id, email, subscription_plan, subscription_status, subscription_expires_at
FROM auth.users
WHERE email = 'gogakirvalidze@gmail.com';

-- Activate Premium (lifetime subscription)
UPDATE profiles
SET 
  subscription_plan = 'premium',
  subscription_status = 'active',
  subscription_expires_at = '2099-12-31 23:59:59+00',  -- Lifetime (until 2099)
  updated_at = NOW()
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'gogakirvalidze@gmail.com'
);

-- Verify the change
SELECT 
  p.id,
  u.email,
  p.subscription_plan,
  p.subscription_status,
  p.subscription_expires_at,
  p.full_name
FROM profiles p
JOIN auth.users u ON p.id = u.id
WHERE u.email = 'gogakirvalidze@gmail.com';
