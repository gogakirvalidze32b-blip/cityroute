-- ============================================
-- 🐛 DEBUG: User Trial Issue
-- ============================================
-- ახალმა user-მა რეგისტრაცია გაიარა მაგრამ device blocked დაუწერა

-- ===== 1. ყველა User-ის სტატუსი =====
SELECT 
  u.email,
  u.created_at as registered,
  p.subscription_status,
  p.subscription_plan,
  p.subscription_expires_at,
  p.trial_started_at,
  p.device_fingerprint,
  p.device_bound_at,
  CASE 
    WHEN p.subscription_expires_at > NOW() THEN '✅ Active'
    WHEN p.subscription_expires_at IS NULL THEN '⚠️ No Expiry'
    ELSE '❌ Expired'
  END as access_status,
  CASE 
    WHEN p.subscription_plan = 'premium' THEN '👑 Premium - No Device Lock'
    WHEN p.device_fingerprint IS NULL THEN '🆓 Free - Not Bound Yet'
    ELSE '🔒 Bound to: ' || LEFT(p.device_fingerprint, 20)
  END as device_status
FROM auth.users u
LEFT JOIN profiles p ON p.id = u.id
ORDER BY u.created_at DESC
LIMIT 20;


-- ===== 2. Device Binding Conflicts =====
-- შევამოწმოთ რამდენ user-ს აქვს იგივე device_fingerprint
SELECT 
  p.device_fingerprint,
  COUNT(*) as user_count,
  STRING_AGG(u.email, ', ') as emails
FROM profiles p
JOIN auth.users u ON u.id = p.id
WHERE p.device_fingerprint IS NOT NULL
GROUP BY p.device_fingerprint
HAVING COUNT(*) > 1
ORDER BY user_count DESC;


-- ===== 3. ბოლო რეგისტრაცია (პრობლემური user) =====
SELECT 
  u.id,
  u.email,
  u.created_at,
  u.email_confirmed_at,
  p.subscription_status,
  p.subscription_plan,
  p.subscription_expires_at,
  p.trial_started_at,
  p.device_fingerprint,
  p.device_bound_at,
  AGE(NOW(), u.created_at) as time_since_registration
FROM auth.users u
LEFT JOIN profiles p ON p.id = u.id
ORDER BY u.created_at DESC
LIMIT 1;


-- ===== 4. Trial Expiry Check =====
-- ვისსაც trial expired აქვს
SELECT 
  u.email,
  p.subscription_status,
  p.trial_started_at,
  p.subscription_expires_at,
  AGE(NOW(), p.subscription_expires_at) as expired_ago
FROM auth.users u
JOIN profiles p ON p.id = u.id
WHERE 
  p.subscription_status = 'trial'
  AND p.subscription_expires_at < NOW()
ORDER BY p.subscription_expires_at DESC;


-- ===== FIX: Reset Device Binding for New User =====
-- თუ ახალი user-ისთვის device binding გავაუქმება გინდა:
/*
UPDATE profiles
SET 
  device_fingerprint = NULL,
  device_bound_at = NULL
WHERE id = (
  SELECT id FROM auth.users 
  WHERE email = 'NEW_USER_EMAIL@example.com'  -- ← შეცვალე email
);
*/


-- ===== FIX: Extend Trial Period =====
-- თუ trial-ის გაგრძელება გინდა:
/*
UPDATE profiles
SET 
  subscription_status = 'trial',
  subscription_expires_at = NOW() + INTERVAL '12 hours',
  trial_started_at = NOW()
WHERE id = (
  SELECT id FROM auth.users 
  WHERE email = 'NEW_USER_EMAIL@example.com'  -- ← შეცვალე email
);
*/


-- ===== FIX: Give Premium (if needed) =====
/*
UPDATE profiles
SET 
  subscription_plan = 'premium',
  subscription_status = 'active',
  subscription_expires_at = '2099-12-31',
  device_fingerprint = NULL,
  device_bound_at = NULL
WHERE id = (
  SELECT id FROM auth.users 
  WHERE email = 'NEW_USER_EMAIL@example.com'
);
*/
