-- ============================================
-- 🏙️ TBILISI TEST ROUTE
-- ============================================
-- ტესტ მარშრუტი თბილისში pin-ების შესამოწმებლად

-- ===== 1. Add Tbilisi City =====
INSERT INTO public.cities (slug, name_ka, name_en, center_lat, center_lng, zoom, sort_order)
VALUES ('tbilisi', 'თბილისი', 'Tbilisi', 41.6938, 44.8015, 13, 0)
ON CONFLICT (slug) DO UPDATE SET
  name_ka = EXCLUDED.name_ka,
  name_en = EXCLUDED.name_en,
  center_lat = EXCLUDED.center_lat,
  center_lng = EXCLUDED.center_lng,
  zoom = EXCLUDED.zoom,
  sort_order = EXCLUDED.sort_order;


-- ===== 2. Create Test Route in Tbilisi =====
-- Simple route around the requested coordinate: 41.691852, 44.961638

WITH tbilisi AS (
  SELECT id FROM public.cities WHERE slug = 'tbilisi'
)
INSERT INTO public.routes (city_id, slug, name_ka, official_label, sort_order, polyline)
SELECT 
  tbilisi.id,
  'test-route-tbilisi',
  'ტესტ მარშრუტი (თბილისი)',
  null,
  99,  -- High number so it's last in the list
  -- Simple rectangle around the target point
  '[[41.690,44.960],[41.692,44.960],[41.694,44.962],[41.694,44.964],[41.692,44.964],[41.690,44.962],[41.690,44.960]]'
FROM tbilisi
ON CONFLICT (slug) DO UPDATE SET
  name_ka = EXCLUDED.name_ka,
  polyline = EXCLUDED.polyline;


-- ===== 3. Add Pin at Requested Location =====
-- 41.691852, 44.961638 with audio: "300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ"

WITH test_route AS (
  SELECT id FROM public.routes WHERE slug = 'test-route-tbilisi'
)
INSERT INTO public.pins (
  route_id,
  lat,
  lng,
  instruction_ka,
  audio_url,
  sort_order,
  trigger_distance_m
)
SELECT
  test_route.id,
  41.691852,
  44.961638,
  '300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ',
  '/audio/points/300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ.mp3',
  1,
  300
FROM test_route
ON CONFLICT DO NOTHING;

-- Add a few more test pins around the area
WITH test_route AS (
  SELECT id FROM public.routes WHERE slug = 'test-route-tbilisi'
)
INSERT INTO public.pins (route_id, lat, lng, instruction_ka, audio_url, sort_order, trigger_distance_m)
SELECT test_route.id, v.lat, v.lng, v.instruction_ka, v.audio_url, v.sort_order, v.trigger_distance_m
FROM test_route,
(VALUES
  (41.690500, 44.960500, 'დაწყება - ტესტ მარშრუტი', '/audio/დაწყება.mp3', 0, 50),
  (41.691852, 44.961638, '300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ', '/audio/points/300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ.mp3', 1, 300),
  (41.692500, 44.962000, 'მალე, გთხოვთ მოუხვიოთ მარჯვნივ', '/audio/points/მალე, გთხოვთ მოუხვიოთ მარჯვნივ.mp3', 2, 100),
  (41.693500, 44.963000, 'გთხოვთ, იმოძრაოთ პირდაპირ', '/audio/points/გთხოვთ, იმოძრაოთ პირდაპირ.mp3', 3, 50),
  (41.690500, 44.960500, 'ფინიში', '/audio/ფინიში.mp3', 4, 30)
) AS v(lat, lng, instruction_ka, audio_url, sort_order, trigger_distance_m)
ON CONFLICT DO NOTHING;


-- ===== Verify: Check the route and pins =====
SELECT 
  c.name_ka as city,
  r.name_ka as route,
  r.slug,
  COUNT(p.id) as pin_count
FROM public.routes r
JOIN public.cities c ON c.id = r.city_id
LEFT JOIN public.pins p ON p.route_id = r.id
WHERE r.slug = 'test-route-tbilisi'
GROUP BY c.name_ka, r.name_ka, r.slug;

-- ===== View all pins for this route =====
SELECT 
  p.sort_order,
  p.lat,
  p.lng,
  p.instruction_ka,
  p.audio_url,
  p.trigger_distance_m
FROM public.pins p
JOIN public.routes r ON r.id = p.route_id
WHERE r.slug = 'test-route-tbilisi'
ORDER BY p.sort_order;


-- ===== CLEANUP (if you want to delete test route later) =====
/*
-- Delete pins first
DELETE FROM public.pins
WHERE route_id = (SELECT id FROM public.routes WHERE slug = 'test-route-tbilisi');

-- Delete route
DELETE FROM public.routes WHERE slug = 'test-route-tbilisi';

-- Optionally delete Tbilisi city (if no other routes use it)
-- DELETE FROM public.cities WHERE slug = 'tbilisi';
*/
