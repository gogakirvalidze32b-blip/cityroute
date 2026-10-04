# 👑 Premium Subscription Activation

## 🎯 გააქტიურება: gogakirvalidze@gmail.com

### Method 1: Supabase SQL Editor (უმარტივესი)

1. **გადადი Supabase Dashboard:**
   ```
   https://supabase.com/dashboard/project/tuylbbdhvfcobxynwtnt
   ```

2. **გახსენი SQL Editor** (მარცხენა sidebar)

3. **დააკოპირე და გაუშვი ეს SQL:**

```sql
-- Activate Premium for gogakirvalidze@gmail.com
UPDATE profiles
SET 
  subscription_plan = 'premium',
  subscription_status = 'active',
  subscription_expires_at = '2099-12-31 23:59:59+00',
  updated_at = NOW()
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'gogakirvalidze@gmail.com'
);

-- Verify
SELECT 
  u.email,
  p.subscription_plan,
  p.subscription_status,
  p.subscription_expires_at
FROM profiles p
JOIN auth.users u ON p.id = u.id
WHERE u.email = 'gogakirvalidze@gmail.com';
```

4. **Run** (Ctrl+Enter ან "Run" ღილაკი)

---

### Method 2: Node Script

თუ programmatically გინდა:

```bash
# 1. დაამატე Service Role Key .env-ში:
# SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# 2. გაუშვი script:
node scripts/activate-premium.mjs gogakirvalidze@gmail.com
```

**Service Role Key-ის მოძებნა:**
1. Supabase Dashboard → Project Settings
2. API tab
3. "service_role" key (secret!) - Copy

---

## ✅ რას აკეთებს:

```json
{
  "email": "gogakirvalidze@gmail.com",
  "subscription_plan": "premium",
  "subscription_status": "active",
  "subscription_expires_at": "2099-12-31T23:59:59Z"
}
```

### Premium Features:
- ✅ **Route Audio** - ხმოვანი ინსტრუქციები
- ✅ **Map Navigation** - რუკაზე ნავიგაცია
- ✅ **Error Panel** - შეცდომების tracking
- ✅ **Can Switch Views** - map/panel გადართვა
- ✅ **No Expiration** - expires 2099 (ფაქტობრივად lifetime)

---

## 🧪 შემოწმება:

### 1. **ბრაუზერში:**
- გამოდი აპიდან (Logout)
- ხელახლა შედი: `gogakirvalidze@gmail.com`
- უნდა ჩანდეს ყველა feature ✅

### 2. **Supabase-ში:**
```sql
SELECT 
  u.email,
  p.subscription_plan,
  p.subscription_status,
  p.subscription_expires_at,
  CASE 
    WHEN p.subscription_expires_at > NOW() THEN 'Active ✅'
    ELSE 'Expired ❌'
  END as status
FROM profiles p
JOIN auth.users u ON p.id = u.id
WHERE u.email = 'gogakirvalidze@gmail.com';
```

---

## 📝 სხვა User-ებისთვის:

თუ სხვა email-ებზეც გინდა premium:

```sql
-- Replace email
UPDATE profiles
SET 
  subscription_plan = 'premium',
  subscription_status = 'active',
  subscription_expires_at = '2099-12-31 23:59:59+00'
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'other@example.com'
);
```

ან script-ით:
```bash
node scripts/activate-premium.mjs other@example.com
```

---

## 🔒 Device Binding

თუ device binding გაუქმება გინდა (unlimited devices):

```sql
UPDATE profiles
SET 
  device_fingerprint = NULL,
  device_bound_at = NULL
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'gogakirvalidze@gmail.com'
);
```

---

## ⏰ Expiration Extension

თუ expiration-ის გაგრძელება გინდა:

```sql
-- +1 year
UPDATE profiles
SET subscription_expires_at = subscription_expires_at + INTERVAL '1 year'
WHERE id = (SELECT id FROM auth.users WHERE email = 'gogakirvalidze@gmail.com');

-- +30 days
UPDATE profiles
SET subscription_expires_at = subscription_expires_at + INTERVAL '30 days'
WHERE id = (SELECT id FROM auth.users WHERE email = 'gogakirvalidze@gmail.com');

-- Lifetime (2099)
UPDATE profiles
SET subscription_expires_at = '2099-12-31 23:59:59+00'
WHERE id = (SELECT id FROM auth.users WHERE email = 'gogakirvalidze@gmail.com');
```

---

## 🎯 უმარტივესი გზა:

1. გადადი: https://supabase.com/dashboard/project/tuylbbdhvfcobxynwtnt/editor
2. SQL Editor-ში ჩაწერე:
   ```sql
   UPDATE profiles SET subscription_plan='premium', subscription_status='active', subscription_expires_at='2099-12-31' WHERE id=(SELECT id FROM auth.users WHERE email='gogakirvalidze@gmail.com');
   ```
3. Run!
4. Logout/Login აპში → Premium ✅

---

**Done!** 🎉
