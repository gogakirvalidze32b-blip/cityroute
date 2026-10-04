-- ============================================
-- ⏱️ EXPIRE TRIAL - Manually expire user's trial
-- ============================================
-- გამოიყენე როცა გინდა trial-ის ამოწურვა კონკრეტულ მომხმარებელზე
-- რომ ნახო "24 საათი ამოიწურა" გვერდი

-- ===== 1. ნახე ყველა აქტიური Trial =====
SELECT 
  u.email,
  p.subscription_status,
  p.trial_started_at,
  p.subscription_expires_at,
  CASE 
    WHEN p.subscription_expires_at > NOW() THEN '✅ Active (' || 
      EXTRACT(HOUR FROM (p.subscription_expires_at - NOW())) || ' საათი დარჩა)'
    ELSE '❌ Expired'
  END as status
FROM auth.users u
JOIN profiles p ON p.id = u.id
WHERE p.subscription_status = 'trial'
ORDER BY p.subscription_expires_at DESC;


-- ===== 2. კონკრეტული User-ის Trial-ის ამოწურვა =====
-- ⚠️ შეცვალე 'your.email@example.com' შენი ემეილით!

UPDATE profiles
SET 
  subscription_status = 'trial',
  subscription_expires_at = NOW() - INTERVAL '1 hour'  -- წარსულში (უკვე expired)
WHERE id = (
  SELECT id FROM auth.users 
  WHERE email = 'your.email@example.com'  -- ← ჩაწერე შენი ემეილი
);

-- ბეჭდვა წარმატების შემთხვევაში
SELECT 
  u.email,
  'Trial expired manually' as action,
  p.subscription_expires_at as expired_at
FROM auth.users u
JOIN profiles p ON p.id = u.id
WHERE u.email = 'your.email@example.com';  -- ← ჩაწერე შენი ემეილი


-- ===== 3. Trial-ის აღდგენა (თუ დაგჭირდა) =====
/*
UPDATE profiles
SET 
  subscription_status = 'trial',
  subscription_expires_at = NOW() + INTERVAL '24 hours',
  trial_started_at = NOW()
WHERE id = (
  SELECT id FROM auth.users 
  WHERE email = 'your.email@example.com'  -- ← ჩაწერე შენი ემეილი
);
*/


-- ===== 4. რა ნახავ აპში =====
-- თუ trial expired-ია:
--   ✅ "24 საათი ამოიწურა" გვერდი
--   ✅ პაკეტების არჩევანი (1, 2, 3 მანქანა)
--   ✅ გადახდის ღილაკი

