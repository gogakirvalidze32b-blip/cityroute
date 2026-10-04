-- ============================================
-- 🧪 Add TEST Pin to Telavi Route
-- ============================================
-- დაამატებს ტესტ pin-ს თბილისის კოორდინატით თელავის მარშრუტზე
-- რომ GPS-ით ადვილად გატესტო

-- ===== Option 1: Add to Route 1 =====
-- Delete existing test pins first (cleanup)
DELETE FROM public.pins 
WHERE route_id = (SELECT id FROM public.routes WHERE slug = 'route-1')
AND instruction_ka LIKE '%ტესტ%';

-- Add test pin at your Tbilisi location
INSERT INTO public.pins (route_id, lat, lng, instruction_ka, audio_url, sort_order, trigger_distance_m)
SELECT 
  r.id,
  41.691852,
  44.961638,
  '🧪 ტესტ: 300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ',
  '/audio/points/300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ.mp3',
  999,  -- High number so it's last
  300
FROM public.routes r
WHERE r.slug = 'route-1';


-- ===== Verify: Check all pins for Route 1 =====
SELECT 
  p.sort_order,
  p.lat,
  p.lng,
  p.instruction_ka,
  p.audio_url,
  p.trigger_distance_m,
  CASE 
    WHEN p.lat BETWEEN 41.69 AND 41.70 AND p.lng BETWEEN 44.96 AND 44.97 THEN '🧪 TEST PIN (Tbilisi)'
    ELSE '✅ Real Pin (Telavi)'
  END as location_type
FROM public.pins p
JOIN public.routes r ON r.id = p.route_id
WHERE r.slug = 'route-1'
ORDER BY p.sort_order;


-- ===== Alternative: Add to ALL 5 Routes =====
/*
-- Delete test pins from all routes
DELETE FROM public.pins 
WHERE instruction_ka LIKE '%ტესტ%';

-- Add test pin to all 5 routes
INSERT INTO public.pins (route_id, lat, lng, instruction_ka, audio_url, sort_order, trigger_distance_m)
SELECT 
  r.id,
  41.691852,
  44.961638,
  '🧪 ტესტ: 300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ',
  '/audio/points/300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ.mp3',
  999,
  300
FROM public.routes r
WHERE r.slug IN ('route-1', 'route-2', 'route-3', 'route-4', 'route-5');
*/


-- ===== CLEANUP: Remove test pins =====
/*
DELETE FROM public.pins 
WHERE instruction_ka LIKE '%ტესტ%'
OR (lat BETWEEN 41.69 AND 41.70 AND lng BETWEEN 44.96 AND 44.97);
*/
