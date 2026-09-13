-- ============================================
-- 📋 EXECUTE THIS IN SUPABASE SQL EDITOR
-- ============================================
-- გადადით: https://supabase.com/dashboard/project/tuylbbdhvfcobxynwtnt/sql
-- დააკოპირეთ და გაუშვით ეს SQL კოდი

-- 1️⃣ პირველ რიგში შეამოწმეთ რა არის ახლა:
SELECT slug, name_ka, license_category, sort_order FROM public.routes ORDER BY sort_order;

-- 2️⃣ თუ ყველაფერი ისევ ძველია, გაუშვით ეს ცვლილებები:

-- მარშრუტი 2 → მარშრუტი 3
UPDATE public.routes 
SET name_ka = 'მარშრუტი 3', 
    license_category = 'B',
    sort_order = 3 
WHERE slug = 'route-2';

-- მარშრუტი 4 → მარშრუტი 2
UPDATE public.routes 
SET name_ka = 'მარშრუტი 2', 
    license_category = 'B',
    sort_order = 2 
WHERE slug = 'route-4';

-- მარშრუტი 5 → "C და D კატეგორია" (წაშალეთ "მარშრუტი 5" ტექსტი)
UPDATE public.routes 
SET name_ka = 'C და D კატეგორია', 
    license_category = 'C,D', 
    sort_order = 5 
WHERE slug = 'route-5';

-- მარშრუტი 3 - წაშლა (pins-ებიც წაიშლება)
DELETE FROM public.pins WHERE route_id = (SELECT id FROM public.routes WHERE slug = 'route-3');
DELETE FROM public.routes WHERE slug = 'route-3';

-- 3️⃣ გაუშვით ეს შემოწმების მიზნით:
SELECT slug, name_ka, license_category, sort_order FROM public.routes ORDER BY sort_order;

-- 4️⃣ უნდა დაინახოთ:
-- route-1: მარშრუტი 1 (B) - sort_order: 1
-- route-4: მარშრუტი 2 (B) - sort_order: 2
-- route-2: მარშრუტი 3 (B) - sort_order: 3
-- route-4-preview: მარშრუტი 4 (B) - sort_order: 4
-- route-5: C და D კატეგორია (C,D) - sort_order: 5
-- route-3: წაშლილია ❌

-- ⚠️ თუ შეცდომა დაგინახათ, დამიწერეთ რა შეცდომა იყო!
