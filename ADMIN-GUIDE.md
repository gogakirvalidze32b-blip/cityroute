# 🛠️ Admin Guide - Premium Access Management

## 🚀 უმარტივესი გზა

### 👤 ერთი User-ისთვის Premium:

```sql
UPDATE profiles 
SET 
  subscription_plan='premium', 
  subscription_status='active', 
  subscription_expires_at='2099-12-31'
WHERE id=(
  SELECT id FROM auth.users WHERE email='user@example.com'
);
```

**შეცვალე:** `user@example.com` → რეალური email

---

## 📋 Step-by-Step

### 1️⃣ **Supabase Dashboard-ში შესვლა**

```
https://supabase.com/dashboard/project/tuylbbdhvfcobxynwtnt
```

### 2️⃣ **SQL Editor გახსნა**

- მარცხენა sidebar: **SQL Editor**
- New Query

### 3️⃣ **SQL-ის გაშვება**

ჩაწერე ზემოთ მოცემული SQL და:
- Ctrl+Enter
- ან "Run" ღილაკი

### 4️⃣ **შემოწმება**

```sql
SELECT u.email, p.subscription_plan
FROM auth.users u
JOIN profiles p ON p.id = u.id
WHERE u.email = 'user@example.com';
```

უნდა ჩანდეს: `subscription_plan: premium`

---

## 🎯 სხვადასხვა სცენარები

### ✅ **მრავალი User ერთდროულად**

```sql
UPDATE profiles
SET 
  subscription_plan='premium',
  subscription_status='active',
  subscription_expires_at='2099-12-31'
WHERE id IN (
  SELECT id FROM auth.users WHERE email IN (
    'user1@example.com',
    'user2@example.com',
    'user3@example.com'
  )
);
```

### 🔓 **Device Binding-ის გაუქმება**

თუ user-მა დაკარგა ტელეფონი და სხვაზე უნდა შესვლა:

```sql
UPDATE profiles
SET 
  device_fingerprint=NULL,
  device_bound_at=NULL
WHERE id=(
  SELECT id FROM auth.users WHERE email='user@example.com'
);
```

### ⏰ **Expiration-ის გაგრძელება**

```sql
-- +30 დღე
UPDATE profiles
SET subscription_expires_at = subscription_expires_at + INTERVAL '30 days'
WHERE id=(SELECT id FROM auth.users WHERE email='user@example.com');

-- +1 წელი
UPDATE profiles
SET subscription_expires_at = subscription_expires_at + INTERVAL '1 year'
WHERE id=(SELECT id FROM auth.users WHERE email='user@example.com');

-- Lifetime (2099)
UPDATE profiles
SET subscription_expires_at = '2099-12-31'
WHERE id=(SELECT id FROM auth.users WHERE email='user@example.com');
```

### ❌ **Premium-ის გაუქმება**

თუ უნდა დაბრუნება Free plan-ზე:

```sql
UPDATE profiles
SET 
  subscription_plan='panel',
  subscription_status='trial',
  subscription_expires_at=NOW() + INTERVAL '7 days'
WHERE id=(SELECT id FROM auth.users WHERE email='user@example.com');
```

---

## 🔍 საძიებო Queries

### **User-ის პოვნა Email-ით**

```sql
SELECT 
  u.id,
  u.email,
  u.created_at,
  p.subscription_plan,
  p.subscription_status
FROM auth.users u
LEFT JOIN profiles p ON p.id = u.id
WHERE u.email ILIKE '%search%'  -- ← ჩაწერე email-ის ნაწილი
ORDER BY u.created_at DESC;
```

### **ყველა Premium User**

```sql
SELECT 
  u.email,
  p.subscription_plan,
  p.subscription_expires_at,
  u.created_at
FROM auth.users u
JOIN profiles p ON p.id = u.id
WHERE p.subscription_plan = 'premium'
ORDER BY u.created_at DESC;
```

### **ყველა Active Subscription**

```sql
SELECT 
  u.email,
  p.subscription_plan,
  p.subscription_status,
  p.subscription_expires_at
FROM auth.users u
JOIN profiles p ON p.id = u.id
WHERE 
  p.subscription_status = 'active'
  AND p.subscription_expires_at > NOW()
ORDER BY p.subscription_expires_at DESC;
```

---

## 📊 სტატისტიკა

### **User-ები Plan-ების მიხედვით**

```sql
SELECT 
  COALESCE(subscription_plan, 'none') as plan,
  COUNT(*) as users,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) as percentage
FROM profiles
GROUP BY subscription_plan
ORDER BY users DESC;
```

### **ბოლო 10 რეგისტრაცია**

```sql
SELECT 
  u.email,
  u.created_at,
  p.full_name,
  p.subscription_plan
FROM auth.users u
LEFT JOIN profiles p ON p.id = u.id
ORDER BY u.created_at DESC
LIMIT 10;
```

---

## 🎁 Subscription Plans

```
premium → ყველაფერი ულიმიტოდ (unlimited devices)
full    → ყველაფერი (1 device)
nav     → მხოლოდ navigation (1 device)
panel   → მხოლოდ panel (1 device)
```

### **Features by Plan:**

```sql
SELECT * FROM subscription_plans ORDER BY id;
```

ან ხელით:

```
Premium:
  ✅ map_navigation: true
  ✅ route_audio: true
  ✅ can_switch_views: true
  ✅ error_panel: true
  ✅ unlimited_devices: true

Full:
  ✅ ყველაფერი Premium-ის გარდა unlimited_devices

Nav:
  ✅ map_navigation: true
  ✅ route_audio: true
  ❌ error_panel: false

Panel:
  ❌ map_navigation: false
  ✅ route_audio: true
  ✅ error_panel: true
```

---

## 🛡️ ბილინგი და გადახდა

თუ მომავალში Stripe/Payment გეგმავ:

1. **Webhook Setup** - Stripe-დან subscription events
2. **Update Profile** - Stripe webhook-ში profiles table-ის update
3. **Expiration Checks** - Cron job რომ expired subscription-ები გააუქმოს

მაგალითი webhook logic:

```typescript
// Stripe webhook
if (event.type === 'customer.subscription.created') {
  await supabase
    .from('profiles')
    .update({
      subscription_plan: 'premium',
      subscription_status: 'active',
      subscription_expires_at: new Date(subscription.current_period_end * 1000),
      stripe_customer_id: customer.id,
      stripe_subscription_id: subscription.id,
    })
    .eq('id', userId);
}
```

---

## 📝 Quick Reference

**File:** `scripts/give-premium-access.sql` - ყველა SQL ერთ ფაილში

**Commands:**

```bash
# 1. Premium ერთ user-ს
UPDATE profiles SET subscription_plan='premium', subscription_status='active', subscription_expires_at='2099-12-31' WHERE id=(SELECT id FROM auth.users WHERE email='USER@EMAIL.COM');

# 2. Device unlock
UPDATE profiles SET device_fingerprint=NULL WHERE id=(SELECT id FROM auth.users WHERE email='USER@EMAIL.COM');

# 3. Expiry +30 days
UPDATE profiles SET subscription_expires_at=subscription_expires_at+INTERVAL '30 days' WHERE id=(SELECT id FROM auth.users WHERE email='USER@EMAIL.COM');
```

---

## 🔐 უსაფრთხოება

1. **არ გააზიარო** Service Role Key
2. **არ დაამატო** SQL injection-prone queries
3. **ყოველთვის იყენე** parameterized queries production-ში
4. **შეამოწმე** email validation before giving premium
5. **ლოგირება** - დაამატე audit logs მომავალში (ვინ, რას, როდის)

---

## 🎯 მომავლის გეგმები

- [ ] Admin Dashboard (UI)
- [ ] Stripe Integration
- [ ] Email Notifications (welcome, renewal, expiry)
- [ ] Analytics (რამდენმა იხილა, რამდენმა გამოიყენა)
- [ ] Referral System (მეგობრის მოწვევა = bonus days)

---

**Done!** 🎉

ახლა უბრალოდ: **Supabase SQL Editor → Copy ზემოთ SQL → Run!**
