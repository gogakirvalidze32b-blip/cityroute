-- ============================================
-- შეამოწმე რა არის ბაზაში ახლა
-- ============================================
-- გადადი: https://supabase.com/dashboard/project/tuylbbdhvfcobxynwtnt/sql
-- გაუშვი ეს SQL:

SELECT 
  id,
  slug, 
  name_ka, 
  license_category, 
  sort_order,
  active
FROM public.routes 
WHERE slug LIKE 'route-%'
ORDER BY sort_order;

-- თუ ბაზაში ჯერ კიდევ ძველია - კიდევ გაუშვი UPDATE-ები:
-- (თუ უკვე სწორია - არაფერი არ გააკეთოს)

UPDATE public.routes 
SET name_ka = 'მარშრუტი 3', license_category = 'B', sort_order = 3 
WHERE slug = 'route-2';

UPDATE public.routes 
SET name_ka = 'მარშრუტი 2', license_category = 'B', sort_order = 2 
WHERE slug = 'route-4';

UPDATE public.routes 
SET name_ka = 'C, D კატეგორია', license_category = 'C,D', sort_order = 5 
WHERE slug = 'route-5';

-- მარშრუტი 3 წაშლა:
DELETE FROM public.pins WHERE route_id = (SELECT id FROM public.routes WHERE slug = 'route-3');
DELETE FROM public.routes WHERE slug = 'route-3';

-- კიდევ შემოწმება:
SELECT slug, name_ka, license_category, sort_order FROM public.routes ORDER BY sort_order;
