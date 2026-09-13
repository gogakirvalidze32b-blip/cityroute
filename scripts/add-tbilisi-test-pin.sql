-- ============================================
-- 📍 დაამატე თბილისის test pin (ლილოს მხარე)
-- ============================================
-- გადადი: https://supabase.com/dashboard/project/tuylbbdhvfcobxynwtnt/sql
-- გაუშვი ეს SQL:

-- პირველ რიგში შეამოწმე route-1-ის ID
SELECT id, slug, name_ka FROM public.routes WHERE slug = 'route-1';

-- დაამატე test pin თბილისში (ლილოს მხარე)
INSERT INTO public.pins (
  route_id,
  lat,
  lng,
  radius_m,
  trigger_distance_m,
  instruction_ka,
  audio_url,
  sort_order,
  active
)
VALUES (
  (SELECT id FROM public.routes WHERE slug = 'route-1'),
  41.691852,
  44.961638,
  25,
  50,
  '300 მეტრში გთხოვთ მოუხვიოთ მარცხნივ',
  '/audio/points/300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ.mp3',
  999,
  true
);

-- შემოწმება - რამდენი pin არის route-1-ზე:
SELECT id, instruction_ka, lat, lng, trigger_distance_m 
FROM public.pins 
WHERE route_id = (SELECT id FROM public.routes WHERE slug = 'route-1')
ORDER BY sort_order;

-- ✅ თუ ჩანს ახალი pin lat=41.691852 - გაკეთდა!
