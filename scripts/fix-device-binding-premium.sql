-- ============================================
-- FIX: Device Binding - Premium-ს გამოაკლოს
-- ============================================

-- Update bind_device function to SKIP device check for Premium users

create or replace function public.bind_device(fp text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  current_fp text;
  user_plan text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if fp is null or length(trim(fp)) < 8 then
    raise exception 'Invalid device fingerprint';
  end if;

  -- Get current fingerprint AND subscription plan
  select device_fingerprint, subscription_plan
  into current_fp, user_plan
  from public.profiles
  where id = uid
  for update;

  -- ✅ SKIP device binding for Premium users
  if user_plan = 'premium' then
    return jsonb_build_object('status', 'ok', 'fingerprint', 'premium-unlimited');
  end if;

  -- ✅ For free/nav/panel: continue with device binding
  if current_fp is null then
    update public.profiles
    set device_fingerprint = fp,
        device_bound_at = now()
    where id = uid;
    return jsonb_build_object('status', 'bound', 'fingerprint', fp);
  end if;

  if current_fp = fp then
    return jsonb_build_object('status', 'ok', 'fingerprint', fp);
  end if;

  return jsonb_build_object('status', 'blocked', 'message', 'ეს ანგარიში სხვა მანქანაზეა მიბმული');
end;
$$;


-- ============================================
-- Verify it works
-- ============================================

-- Check current status
SELECT 
  u.email,
  p.subscription_plan,
  p.device_fingerprint,
  CASE 
    WHEN p.subscription_plan = 'premium' THEN '✅ Premium - No Device Lock'
    WHEN p.device_fingerprint IS NULL THEN '⚠️ Free - Not Bound Yet'
    ELSE '❌ Free - Device Locked'
  END as binding_status
FROM profiles p
JOIN auth.users u ON p.id = u.id
WHERE u.email = 'gogakirvalidze@gmail.com';
