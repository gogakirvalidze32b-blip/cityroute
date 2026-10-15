-- ============================================
-- 🔊 შეამოწმე რა audio URL-ები არის ახლა ბაზაში
-- ============================================
-- გადადი: https://supabase.com/dashboard/project/tuylbbdhvfcobxynwtnt/sql
-- გაუშვი ეს SQL:

-- 1️⃣ ნახე რამდენი პინი აქვს audio_url
SELECT 
  COUNT(*) as total_pins,
  COUNT(audio_url) as pins_with_audio,
  COUNT(*) - COUNT(audio_url) as pins_without_audio
FROM route_pins;

-- 2️⃣ ნახე რა ტიპის audio ფაილები გაქვს (.mp3 თუ .wav)
SELECT 
  CASE 
    WHEN audio_url LIKE '%.mp3' THEN 'MP3'
    WHEN audio_url LIKE '%.wav' THEN 'WAV'
    WHEN audio_url IS NULL THEN 'NULL'
    ELSE 'OTHER'
  END as file_type,
  COUNT(*) as count
FROM route_pins
GROUP BY file_type
ORDER BY count DESC;

-- 3️⃣ ნახე რამდენიმე მაგალითი audio URL-ებიდან
SELECT 
  id,
  route_id,
  instruction_ka,
  audio_url,
  sort_order
FROM route_pins
WHERE audio_url IS NOT NULL
ORDER BY route_id, sort_order
LIMIT 10;

-- 4️⃣ ნახე სრული სია audio_url-ებიდან (ყველა უნიკალური)
SELECT DISTINCT audio_url
FROM route_pins
WHERE audio_url IS NOT NULL
ORDER BY audio_url;
