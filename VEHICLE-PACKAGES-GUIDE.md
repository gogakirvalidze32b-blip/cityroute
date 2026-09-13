# მანქანის პაკეტები - დეველოპერის გზამკვლევი

## პაკეტები და ფასები

### 1 მანქანა
- ფასი: 99 ₾/თვე
- თითო მოწყობილობა: 99 ₾
- ფასდაკლება: 0%
- რაოდენობა: 1 მოწყობილობა

### 2 მანქანა  
- ფასი: 180 ₾/თვე
- თითო მოწყობილობა: 90 ₾
- ფასდაკლება: 10%
- რაოდენობა: 2 მოწყობილობა

### 3 მანქანა
- ფასი: 250 ₾/თვე
- თითო მოწყობილობა: 83 ₾
- ფასდაკლება: 15%
- რაოდენობა: 3 მოწყობილობა

## როგორ მუშაობს

### ნაბიჯი 1: პაკეტის არჩევა
მომხმარებელი აირჩევს რამდენი მანქანა სჭირდება (1, 2, ან 3)

### ნაბიჯი 2: გადახდა
- დააჭერს "💳 გადახდა - X ₾/თვე"
- გადადის ბანკების არჩევანზე (TBC/BOG)
- აირჩევს ბანკს და გადადის გადახდის გვერდზე

### ნაბიჯი 3: Payment Webhook
როცა გადახდა დასრულდება:
```sql
-- Supabase-ში განახლდება:
UPDATE profiles 
SET 
  subscription_status = 'active',
  subscription_plan = 'premium',
  subscription_expires_at = now() + interval '30 days',
  vehicle_count = X  -- რამდენი მანქანა აირჩია
WHERE id = user_id;
```

### ნაბიჯი 4: Device Binding
ყოველი მოწყობილობის დაბმისას:
```typescript
// lib/device.ts -> bind_device RPC
// ამოწმებს: თუ user-ის vehicle_count = 3
// მაშინ მაქსიმუმ 3 მოწყობილობა შეიძლება დაუკავშირდეს
```

## Database Schema (საჭირო მიგრაცია)

```sql
-- supabase/migrations/003_vehicle_packages.sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS vehicle_count INTEGER DEFAULT 1;

-- განახლდეს bind_device function
CREATE OR REPLACE FUNCTION bind_device(fp text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _user_id uuid;
  _bound_count integer;
  _vehicle_count integer;
  _existing_fp text;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'Not authenticated');
  END IF;

  -- Get user's vehicle limit
  SELECT COALESCE(vehicle_count, 1) INTO _vehicle_count
  FROM profiles WHERE id = _user_id;

  -- Check how many devices already bound
  SELECT COUNT(DISTINCT device_fingerprint) INTO _bound_count
  FROM profiles
  WHERE id = _user_id AND device_fingerprint IS NOT NULL;

  -- Check if this device is already bound
  SELECT device_fingerprint INTO _existing_fp
  FROM profiles WHERE id = _user_id;

  -- If already bound to this device, allow
  IF _existing_fp = fp THEN
    RETURN jsonb_build_object('status', 'ok');
  END IF;

  -- Check limit
  IF _bound_count >= _vehicle_count THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'message', _vehicle_count || ' მოწყობილობის ლიმიტი გადაჭარბებულია'
    );
  END IF;

  -- Bind device
  UPDATE profiles
  SET device_fingerprint = fp, device_bound_at = now()
  WHERE id = _user_id;

  RETURN jsonb_build_object('status', 'ok');
END;
$$;
```

## Payment Webhook განახლება

```typescript
// supabase/functions/payment-webhook-bog/index.ts
// ან payment-webhook-tbc/index.ts

// როცა გადახდა წარმატებულია:
const selectedPackage = metadata.package; // '1-vehicle', '2-vehicles', '3-vehicles'
const vehicleCount = selectedPackage === '1-vehicle' ? 1 
                   : selectedPackage === '2-vehicles' ? 2 
                   : 3;

await supabase
  .from('profiles')
  .update({
    subscription_status: 'active',
    subscription_plan: 'premium',
    subscription_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    vehicle_count: vehicleCount,
  })
  .eq('id', userId);
```

## მომხმარებლის UI

### Home Page (როცა subscription active)
```
CITYROUTE

🚗🚗 2 მანქანა პაკეტი
პრემიუმ · 30 დღე · 180 ₾/თვე

[მარშრუტი 1] →
[მარშრუტი 2] →
...
```

### დამატებითი მანქანის ყიდვა (მომავალში)
Settings გვერდზე:
```
თქვენი პაკეტი: 2 მანქანა (180 ₾/თვე)

[+ დამატებითი მანქანის დამატება]
→ 3 მანქანა პაკეტზე გადასვლა (250 ₾/თვე)
```

## კოდის მაგალითები

### localStorage-ში შენახვა payment-მდე:
```typescript
localStorage.setItem('cityroute-selected-package', '2-vehicles')
localStorage.setItem('cityroute-payment-amount', '180')
```

### Payment URL-ში metadata:
```typescript
const paymentData = {
  amount: selectedPkg.price,
  currency: 'GEL',
  metadata: {
    userId: user.id,
    package: selectedPackage, // '1-vehicle', '2-vehicles', '3-vehicles'
    vehicles: selectedPkg.vehicles,
  }
}
```

### Profile-ში წაკითხვა:
```typescript
const { data: profile } = await supabase
  .from('profiles')
  .select('*, vehicle_count')
  .eq('id', userId)
  .single()

console.log(`User has ${profile.vehicle_count} vehicle slots`)
```

## ტესტირება

1. აირჩიე 2 მანქანა პაკეტი
2. გადახდა 180 ₾
3. Supabase-ში შემოწმება: `vehicle_count = 2`
4. მეორე მოწყობილობით შესვლა → წარმატებული
5. მესამე მოწყობილობით შესვლა → დაბლოკილია ❌
