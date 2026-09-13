-- ============================================
-- 📍 ADD CUSTOM PIN
-- ============================================

-- ===== EXAMPLE: Add pin at specific coordinates =====

-- Find the route first (check which route this coordinate belongs to)
-- Coordinates: 41.691852, 44.961638

-- Option 1: Add to Route 1
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
  id as route_id,
  41.691852 as lat,
  44.961638 as lng,
  '300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ' as instruction_ka,
  '/audio/points/300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ.mp3' as audio_url,
  (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM public.pins WHERE route_id = r.id) as sort_order,
  300 as trigger_distance_m
FROM public.routes r
WHERE r.slug = 'route-1';  -- ← შეცვალე route-1/route-2/route-3/etc


-- ===== OR: Add to specific route by ID =====
/*
INSERT INTO public.pins (route_id, lat, lng, instruction_ka, audio_url, sort_order, trigger_distance_m)
VALUES (
  'your-route-uuid-here',
  41.691852,
  44.961638,
  '300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ',
  '/audio/points/300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ.mp3',
  10,  -- sort_order (შეცვალე)
  300  -- trigger distance in meters
);
*/


-- ===== Verify: Check all pins for a route =====
SELECT 
  p.id,
  p.lat,
  p.lng,
  p.instruction_ka,
  p.audio_url,
  p.sort_order,
  p.trigger_distance_m,
  r.name_ka as route_name
FROM public.pins p
JOIN public.routes r ON r.id = p.route_id
WHERE r.slug = 'route-1'  -- ← შეცვალე route slug
ORDER BY p.sort_order;


-- ===== Available Audio Files =====
-- Check public/audio/points/ folder for available audio files:
-- 
-- '300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ.mp3'
-- '300 მეტრში გთხოვთ მოუხვიოთ მარჯვნივ.mp3'
-- '300 მეტრში წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარჯვნივ.mp3'
-- '300 მეტრში, წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარცხნივ.mp3'
-- '500 მეტრში მარჯვნივ.mp3'
-- '500 მეტრში წრიული მოძრაობისას მარცხნივ.mp3'
-- '500 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ.mp3'
-- '500 მეტრში, წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარჯვნივ.mp3'
-- 'გთხოვთ, იმოძრაოთ მარჯვნივ.mp3'
-- 'გთხოვთ, იმოძრაოთ პირდაპირ.mp3'
-- 'გთხოვთ, მოუხვიოთ მარცხნივ.mp3'
-- 'გთხოვთ, მოუხვიოთ მარჯვნივ და შემდეგ მოუხვიოთ მარცხნივ.mp3'
-- 'მალე, გთხოვთ მოუხვიოთ მარცხნივ.mp3'
-- 'მალე, გთხოვთ მოუხვიოთ მარჯვნივ.mp3'
-- 'მალე, გთხოვთ მოუხვიოთ მარცხნივ და შემდეგ მოუხვიოთ მარცხნივ.mp3'
-- 'მალე, წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარჯვნივ.mp3'
-- 'მალე, წრიული მოძრაობისას, გთხოვთ იმოძრაოთ პირდაპირ.mp3'
-- 'მალე, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარცხნივ.mp3'
-- 'მალე, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარჯვნივ.mp3'
-- 'მინიშნება.mp3'
-- 'ხუთას მეტრში, გთხოვთ მოუხვიოთ მარცხნივ.mp3'


-- ===== Delete a pin (if needed) =====
/*
DELETE FROM public.pins
WHERE id = 'pin-uuid-here';
*/


-- ===== Update a pin (if needed) =====
/*
UPDATE public.pins
SET 
  lat = 41.691852,
  lng = 44.961638,
  instruction_ka = '300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ',
  audio_url = '/audio/points/300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ.mp3',
  trigger_distance_m = 300
WHERE id = 'pin-uuid-here';
*/
