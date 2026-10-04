-- ============================================
-- 🗑️ წაშალე თელავის სააგენტოს პინები
-- ============================================
-- გადადი: https://supabase.com/dashboard/project/tuylbbdhvfcobxynwtnt/sql
-- გაუშვი ეს SQL:

-- წაშალე ეს 5 pin-ი:
DELETE FROM public.pins 
WHERE id IN (
  '7a85c029-64c9-42b1-8307-fe28d7d10f99',  -- დაწყება — მომსახურების სააგენტო
  '496dee2c-1b0d-4faf-825b-a6a801ea01bf',  -- მარჯვნივ შუახევი
  '258ca4e2-b93e-4c94-9a97-b89b2d6e52f2',  -- გააგრძელე პირდაპირ
  '325b8b97-71ee-46ba-be38-1db610d4b3f8',  -- მარცხნივ შუახევი
  'b3713c93-eb4f-402c-ba3b-1b7379da0d15'   -- დასრულება — დაბრუნდი სააგენტოსთვა
);

-- შემოწმება - რამდენი pin დარჩა route-1-ზე:
SELECT COUNT(*) as remaining_pins FROM public.pins 
WHERE route_id = (SELECT id FROM public.routes WHERE slug = 'route-1');

-- ნახე რა pins დარჩა:
SELECT id, instruction_ka, lat, lng FROM public.pins 
WHERE route_id = (SELECT id FROM public.routes WHERE slug = 'route-1')
ORDER BY lat DESC;

-- ✅ უნდა დარჩეს მხოლოდ 2 თბილისის test pin (lat=41.691852)
