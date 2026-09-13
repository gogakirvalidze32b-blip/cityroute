-- ============================================
-- 🚗 Add License Category to Routes
-- ============================================
-- Route 1-4: B კატეგორია (მსუბუქი ავტომობილი)
-- Route 5: C კატეგორია (სატვირთო ავტომობილი)

-- ===== 1. Add category column if not exists =====
ALTER TABLE public.routes 
ADD COLUMN IF NOT EXISTS license_category TEXT;

-- Add comment
COMMENT ON COLUMN public.routes.license_category IS 'Driving license category: B (car), C (truck), D (bus), etc.';


-- ===== 2. Update Routes with Categories =====

-- Route 1-4: B Category (Car)
UPDATE public.routes
SET license_category = 'B'
WHERE slug IN ('route-1', 'route-2', 'route-3', 'route-4');

-- Route 5: C Category (Truck)
UPDATE public.routes
SET license_category = 'C'
WHERE slug = 'route-5';


-- ===== 3. Verify =====
SELECT 
  r.slug,
  r.name_ka,
  r.license_category,
  c.name_ka as city,
  CASE 
    WHEN r.license_category = 'B' THEN '🚗 მსუბუქი ავტომობილი'
    WHEN r.license_category = 'C' THEN '🚛 სატვირთო'
    WHEN r.license_category = 'D' THEN '🚌 ავტობუსი'
    ELSE '⚠️ No Category'
  END as category_description
FROM public.routes r
JOIN public.cities c ON c.id = r.city_id
WHERE r.slug LIKE 'route-%'
ORDER BY r.slug;


-- ===== 4. Update other routes (if needed) =====
/*
-- If you have test routes:
UPDATE public.routes
SET license_category = 'B'
WHERE slug = 'test-route-tbilisi';
*/


-- ===== Future: Filter routes by category =====
/*
-- Get only B category routes
SELECT slug, name_ka, license_category
FROM public.routes
WHERE license_category = 'B';

-- Get only C category routes
SELECT slug, name_ka, license_category
FROM public.routes
WHERE license_category = 'C';
*/
