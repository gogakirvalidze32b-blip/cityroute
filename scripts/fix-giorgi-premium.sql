-- ============================================
-- 👑 FIX: giorgi.zuroshvili105@gmail.com
-- ============================================
-- Device Unlock + Premium Access

-- 1. Give Premium + Unlock Device
UPDATE profiles
SET 
  subscription_plan = 'premium',
  subscription_status = 'active',
  subscription_expires_at = '2099-12-31 23:59:59+00',
  device_fingerprint = NULL,
  device_bound_at = NULL,
  updated_at = NOW()
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'giorgi.zuroshvili105@gmail.com'
);

-- 2. Verify
SELECT 
  u.email,
  p.subscription_plan,
  p.subscription_status,
  p.subscription_expires_at,
  p.device_fingerprint,
  CASE 
    WHEN p.device_fingerprint IS NULL THEN '✅ UNLOCKED - No Device Binding'
    ELSE '🔒 LOCKED to: ' || LEFT(p.device_fingerprint, 30)
  END as device_status,
  CASE 
    WHEN p.subscription_plan = 'premium' THEN '👑 Premium - All Features'
    WHEN p.subscription_status = 'trial' THEN '🧪 Trial'
    ELSE '📋 ' || COALESCE(p.subscription_plan, 'none')
  END as access_level
FROM auth.users u
LEFT JOIN profiles p ON p.id = u.id
WHERE u.email = 'giorgi.zuroshvili105@gmail.com';
