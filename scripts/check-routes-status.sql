-- ============================================
-- 🔍 Check Current Routes Status
-- ============================================

-- Check what's in database
SELECT 
  slug,
  name_ka,
  license_category,
  sort_order,
  active
FROM public.routes
WHERE slug LIKE 'route-%'
ORDER BY sort_order;

-- Check if changes were applied
-- Expected:
-- route-1: მარშრუტი 1 (B)
-- route-4: მარშრუტი 2 (B)  -- was route-4
-- route-2: მარშრუტი 3 (B)  -- was route-2
-- route-3: DELETED
-- route-5: C და D კატეგორია (C,D)
