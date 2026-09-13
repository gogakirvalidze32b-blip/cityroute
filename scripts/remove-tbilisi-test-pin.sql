-- ============================================
-- 🗑️ წაშალე თბილისის test pin მარშრუტი 1-დან
-- ============================================
-- გადადი: https://supabase.com/dashboard/project/tuylbbdhvfcobxynwtnt/sql
-- გაუშვი ეს SQL:

-- ნახე რა pins არის route-1-ზე
SELECT id, instruction_ka, lat, lng FROM public.pins 
WHERE route_id = (SELECT id FROM public.routes WHERE slug = 'route-1')
ORDER BY sort_order;

-- წაშალე თბილისის test pin (თუ არის lat ~41.691852)
DELETE FROM public.pins 
WHERE route_id = (SELECT id FROM public.routes WHERE slug = 'route-1')
  AND lat BETWEEN 41.69 AND 41.70
  AND lng BETWEEN 44.96 AND 44.97;

-- შემოწმება - რამდენი pin დარჩა:
SELECT COUNT(*) as pin_count FROM public.pins 
WHERE route_id = (SELECT id FROM public.routes WHERE slug = 'route-1');
