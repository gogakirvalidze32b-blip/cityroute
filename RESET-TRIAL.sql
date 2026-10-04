-- გაუშვი ეს SQL Supabase-ში რომ trial ამოიწუროს და პაკეტების არჩევანი ნახო

-- 1. ნახე რა მდგომარეობაშია ანგარიში
SELECT 
  id,
  email,
  full_name,
  subscription_status,
  subscription_expires_at,
  subscription_plan,
  trial_started_at
FROM auth.users
JOIN profiles ON auth.users.id = profiles.id
WHERE email = 'gogakirvalidze@gmail.com';

-- 2. Trial-ის ამოწურვა (subscription expired)
UPDATE profiles
SET 
  subscription_status = 'expired',
  subscription_expires_at = now() - interval '1 hour'
WHERE id IN (
  SELECT id FROM auth.users WHERE email = 'gogakirvalidze@gmail.com'
);

-- 3. შემოწმება რომ გაუქმდა
SELECT 
  email,
  subscription_status,
  subscription_expires_at,
  subscription_plan
FROM auth.users
JOIN profiles ON auth.users.id = profiles.id
WHERE email = 'gogakirvalidze@gmail.com';

-- Expected Result:
-- subscription_status = 'expired'
-- subscription_expires_at = past date
-- ახლა როცა app-ში შეხვალ, დაინახავ პაკეტების არჩევანს!
