# 🔄 როგორ წავშალოთ Vercel Cache და მოვისმინოთ ახალი ვოისები

## პრობლემა
- Database-ში: ✅ WAV URL-ები
- Git-ში: ✅ WAV ფაილები  
- Local-ზე: ✅ ახალი ვოისები ისმის
- Vercel-ზე: ❌ ძველი ვოისები ისმის

**მიზეზი:** Browser cache + Service Worker cache

## გამოსწორება

### 1️⃣ Redeploy Vercel (უმთავრესი)
```bash
git push origin audio-wav-126
```

ან Vercel Dashboard-ში:
1. გადადი: https://vercel.com/dashboard
2. ნახე შენი project
3. დააჭირე "Redeploy" უახლეს deployment-ზე

### 2️⃣ Clear Browser Cache (სავალდებულო!)

**Chrome/Edge:**
1. დააჭირე `Ctrl + Shift + Delete`
2. აირჩიე "Cached images and files"
3. დააჭირე "Clear data"

**ან:**
1. გახსენი DevTools (`F12`)
2. დააჭირე Network tab
3. დააჭირე "Disable cache" ✓
4. Hard Refresh: `Ctrl + Shift + R`

### 3️⃣ Clear Service Worker Cache

1. გახსენი DevTools (`F12`)
2. გადადი **Application** tab-ზე
3. მარცხენა sidebar-ში ნახე **Cache Storage**
4. წაშალე ყველა cache:
   - `audio-cache`
   - `image-cache`
   - სხვა cache-ები
5. გადადი **Service Workers**
6. დააჭირე **Unregister**
7. გადატვირთე გვერდი `Ctrl + Shift + R`

### 4️⃣ Test ახალი incognito window-ში
- დააჭირე `Ctrl + Shift + N` (Chrome/Edge)
- გახსენი შენი Vercel site
- შეამოწმე ახალი ვოისები

---

## ✅ რას უნდა ველოდოთ
ახალი WAV ფაილები:
- `/audio/გილოცავთ.wav` (გილოცავთ)
- `/audio/დაწყება.wav` (დაწყება)
- `/audio/ფინიში.wav` (ფინიში)
- `/audio/points/*.wav` (ყველა instruction)

---

## 🚨 თუ მაინც ძველია

Redeploy with fresh build:
```bash
# 1. Commit everything
git add .
git commit -m "Force redeploy with new audio files"

# 2. Push
git push origin audio-wav-126

# 3. In Vercel Dashboard, manually trigger new deployment
```
