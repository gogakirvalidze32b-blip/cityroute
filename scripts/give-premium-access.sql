-- ============================================
-- 👑 GIVE PREMIUM ACCESS
-- ============================================
-- ამ SQL-ს გამოიყენე რომ ნებისმიერ user-ს მისცე Premium წვდომა


-- ===== SINGLE USER =====
-- ერთი user-ისთვის (email-ით)

UPDATE profiles
SET 
  subscription_plan = 'premium',
  subscription_status = 'active',
  subscription_expires_at = '2099-12-31 23:59:59+00',
  updated_at = NOW()
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'user@example.com'  -- ← შეცვალე email
);


-- ===== MULTIPLE USERS =====
-- მრავალი user-ისთვის ერთი SQL-ით

UPDATE profiles
SET 
  subscription_plan = 'premium',
  subscription_status = 'active',
  subscription_expires_at = '2099-12-31 23:59:59+00',
  updated_at = NOW()
WHERE id IN (
  SELECT id FROM auth.users WHERE email IN (
    'user1@example.com',
    'user2@example.com',
    'user3@example.com'
    -- დაამატე რამდენიც გინდა...
  )
);


-- ===== VERIFY PREMIUM USERS =====
-- შემოწმება: ვისთვის აქვს Premium

SELECT 
  u.email,
  u.created_at as registered_at,
  p.subscription_plan,
  p.subscription_status,
  p.subscription_expires_at,
  p.device_fingerprint,
  CASE 
    WHEN p.subscription_plan = 'premium' THEN '👑 Premium'
    WHEN p.subscription_plan = 'full' THEN '🎯 Full'
    WHEN p.subscription_plan = 'nav' THEN '🗺️ Nav'
    WHEN p.subscription_plan = 'panel' THEN '📋 Panel'
    ELSE '❌ None'
  END as plan_emoji,
  CASE 
    WHEN p.subscription_plan = 'premium' THEN '✅ Unlimited Devices'
    WHEN p.device_fingerprint IS NULL THEN '⚠️ Not Bound'
    ELSE '🔒 Device: ' || LEFT(p.device_fingerprint, 20) || '...'
  END as device_status
FROM auth.users u
JOIN profiles p ON p.id = u.id
WHERE p.subscription_plan IS NOT NULL
ORDER BY 
  CASE p.subscription_plan
    WHEN 'premium' THEN 1
    WHEN 'full' THEN 2
    WHEN 'nav' THEN 3
    WHEN 'panel' THEN 4
    ELSE 5
  END,
  u.email;


-- ===== SEARCH USER BY EMAIL =====
-- user-ის პოვნა email-ით

SELECT 
  u.id,
  u.email,
  u.created_at,
  p.full_name,
  p.subscription_plan,
  p.subscription_status,
  p.subscription_expires_at
FROM auth.users u
LEFT JOIN profiles p ON p.id = u.id
WHERE u.email ILIKE '%search@%'  -- ← ჩაწერე email-ის ნაწილი
ORDER BY u.created_at DESC;


-- ===== ALL USERS (ADMIN VIEW) =====
-- ყველა user და მათი subscription

SELECT 
  u.email,
  p.full_name,
  p.subscription_plan,
  p.subscription_status,
  CASE 
    WHEN p.subscription_expires_at > NOW() THEN '✅ Active'
    WHEN p.subscription_expires_at IS NULL THEN '⚠️ No Expiry Set'
    ELSE '❌ Expired'
  END as access_status,
  p.subscription_expires_at,
  u.created_at as registered
FROM auth.users u
LEFT JOIN profiles p ON p.id = u.id
ORDER BY u.created_at DESC
LIMIT 50;


-- ===== QUICK COMMANDS =====

-- 1️⃣ Premium ერთ user-ს:
-- UPDATE profiles SET subscription_plan='premium', subscription_status='active', subscription_expires_at='2099-12-31' WHERE id=(SELECT id FROM auth.users WHERE email='USER@EMAIL.COM');

-- 2️⃣ Premium-ის გაუქმება:
-- UPDATE profiles SET subscription_plan='panel', subscription_status='trial', subscription_expires_at=NOW() + INTERVAL '7 days' WHERE id=(SELECT id FROM auth.users WHERE email='USER@EMAIL.COM');

-- 3️⃣ Expiration-ის გაგრძელება (+30 დღე):
-- UPDATE profiles SET subscription_expires_at = subscription_expires_at + INTERVAL '30 days' WHERE id=(SELECT id FROM auth.users WHERE email='USER@EMAIL.COM');

-- 4️⃣ Device binding-ის გაუქმება:
-- UPDATE profiles SET device_fingerprint=NULL, device_bound_at=NULL WHERE id=(SELECT id FROM auth.users WHERE email='USER@EMAIL.COM');


-- ===== STATISTICS =====
-- სტატისტიკა: რამდენი user რომელ plan-ზეა

SELECT 
  COALESCE(subscription_plan, 'none') as plan,
  COUNT(*) as users,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) as percentage
FROM profiles
GROUP BY subscription_plan
ORDER BY users DESC;
