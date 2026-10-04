-- ============================================
-- 🔄 REORDER ROUTES
-- ============================================
-- მარშრუტი 2 → მარშრუტი 3
-- მარშრუტი 3 → წაშლა
-- მარშრუტი 4 → მარშრუტი 2
-- მარშრუტი 5 → "C და D კატეგორია" (არა "მარშრუტი 5")

-- ===== BACKUP: Before changes =====
-- Check current state
SELECT 
  slug,
  name_ka,
  license_category,
  sort_order,
  official_label
FROM public.routes
WHERE slug LIKE 'route-%'
ORDER BY sort_order;


-- ===== 1. Update Route Names & Sort Order =====

-- Route 2 → Route 3 (name_ka: მარშრუტი 3)
UPDATE public.routes
SET 
  name_ka = 'მარშრუტი 3',
  sort_order = 3
WHERE slug = 'route-2';

-- Route 4 → Route 2 (name_ka: მარშრუტი 2)
UPDATE public.routes
SET 
  name_ka = 'მარშრუტი 2',
  sort_order = 2
WHERE slug = 'route-4';

-- Route 5 → "C და D კატეგორია" + Update license_category
UPDATE public.routes
SET 
  name_ka = 'C და D კატეგორია',
  license_category = 'C,D',
  sort_order = 5
WHERE slug = 'route-5';


-- ===== 2. Delete Route 3 =====
-- First delete pins, then route
DELETE FROM public.pins
WHERE route_id = (SELECT id FROM public.routes WHERE slug = 'route-3');

DELETE FROM public.routes
WHERE slug = 'route-3';


-- ===== 3. Verify Changes =====
SELECT 
  slug,
  name_ka,
  license_category,
  sort_order,
  official_label,
  CASE 
    WHEN license_category = 'B' THEN '🚗 B'
    WHEN license_category = 'C' THEN '🚛 C'
    WHEN license_category = 'C,D' THEN '🚛 C + 🚌 D'
    ELSE '⚠️ None'
  END as category_display
FROM public.routes
WHERE slug LIKE 'route-%'
ORDER BY sort_order;


-- ===== 4. Count Pins Per Route =====
SELECT 
  r.slug,
  r.name_ka,
  r.sort_order,
  COUNT(p.id) as pin_count
FROM public.routes r
LEFT JOIN public.pins p ON p.route_id = r.id
WHERE r.slug LIKE 'route-%'
GROUP BY r.slug, r.name_ka, r.sort_order
ORDER BY r.sort_order;


-- ===== SUMMARY =====
-- After these changes:
-- route-1: მარშრუტი 1 (B კატეგორია) - sort_order: 1
-- route-2: მარშრუტი 3 (B კატეგორია) - sort_order: 3  ← was Route 2
-- route-3: DELETED ❌
-- route-4: მარშრუტი 2 (B კატეგორია) - sort_order: 2  ← was Route 4
-- route-5: C და D კატეგორია (C,D) - sort_order: 5
