-- ============================================
-- UNLOCK: Premium ყველა მოწყობილობაზე
-- ============================================

-- გაუქმდება device binding და Premium იმუშავებს ყველგან

UPDATE profiles
SET 
  subscription_plan = 'premium',
  subscription_status = 'active',
  subscription_expires_at = '2099-12-31 23:59:59+00',
  device_fingerprint = NULL,        -- ← წაიშლება device lock
  device_bound_at = NULL,           -- ← არ იბაინდება მოწყობილობაზე
  updated_at = NOW()
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'gogakirvalidze@gmail.com'
);

-- Verify
SELECT 
  u.email,
  p.subscription_plan,
  p.subscription_status,
  p.device_fingerprint,
  CASE 
    WHEN p.device_fingerprint IS NULL THEN '✅ UNLOCKED - ყველა მოწყობილობა'
    ELSE '❌ LOCKED - ' || p.device_fingerprint
  END as status
FROM profiles p
JOIN auth.users u ON p.id = u.id
WHERE u.email = 'gogakirvalidze@gmail.com';
