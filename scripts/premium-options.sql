-- ============================================
-- Premium Activation Options
-- ============================================

-- ===== OPTION 1: Premium + Unlimited Devices (რეკომენდირებული შენთვის) =====
-- Premium ყველა მოწყობილობაზე, device binding-ის გარეშე

UPDATE profiles
SET 
  subscription_plan = 'premium',
  subscription_status = 'active',
  subscription_expires_at = '2099-12-31 23:59:59+00',
  device_fingerprint = NULL,        -- ← გაუქმდება device binding
  device_bound_at = NULL,           -- ← ნებისმიერ მოწყობილობას გამოიყენებს
  updated_at = NOW()
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'gogakirvalidze@gmail.com'
);


-- ===== OPTION 2: Premium + Single Device Only =====
-- Premium მხოლოდ ერთ მოწყობილობაზე (device binding ჩართული)
-- ეს ავტომატურად დაიბაინდება პირველ მოწყობილობაზე რომელზეც შევა

UPDATE profiles
SET 
  subscription_plan = 'premium',
  subscription_status = 'active',
  subscription_expires_at = '2099-12-31 23:59:59+00',
  -- device_fingerprint დარჩება და ახალი device დაიბაინდება პირველ login-ზე
  updated_at = NOW()
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'gogakirvalidze@gmail.com'
);


-- ===== ჩემი რეკომენდაცია: OPTION 1 (Unlimited) =====
-- რატომ? რომ:
-- - შენ თვითონ ხარ developer/owner
-- - სჭირდება testing ბევრ მოწყობილობაზე
-- - არ გინდა device lock-ის თავის ტკივილი


-- ===== Verify Current Status =====
SELECT 
  u.email,
  p.subscription_plan,
  p.subscription_status,
  p.subscription_expires_at,
  p.device_fingerprint,
  p.device_bound_at,
  CASE 
    WHEN p.device_fingerprint IS NULL THEN '✅ Unlimited Devices'
    ELSE '⚠️ Single Device Only'
  END as device_policy
FROM profiles p
JOIN auth.users u ON p.id = u.id
WHERE u.email = 'gogakirvalidze@gmail.com';


-- ===== Reset Device Binding (თუ გჭირდება მოგვიანებით) =====
-- გამოიყენე თუ უკვე დაბაინდებული device-ის გაუქმება გინდა
/*
UPDATE profiles
SET 
  device_fingerprint = NULL,
  device_bound_at = NULL
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'gogakirvalidze@gmail.com'
);
*/
