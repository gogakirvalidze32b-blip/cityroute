# 📡 ოფლაინ რეჟიმი

## ✅ რა მუშაობს ოფლაინში

### სცენარი: Login → ინტერნეტის გამორთვა → Navigation

1. **📱 ინტერნეტით შესვლა:**
   - Login გვერდზე შესვლა
   - Credentials შეყვანა
   - Routes ჩატვირთვა

2. **📡 ინტერნეტის გამორთვა:**
   - მობილური data/WiFi off
   - აპი კვლავ მუშაობს! ✅

3. **🚗 რა მუშაობს ოფლაინში:**
   - ✅ **GPS/Geolocation** - მანქანის პოზიცია
   - ✅ **რუკის ფილები** - თელავის რეგიონი (zoom 16-18)
   - ✅ **Audio ინსტრუქციები** - ყველა mp3 cached
   - ✅ **Routes მონაცემები** - ყველა მარშრუტი
   - ✅ **შეცდომების პანელი** - სრულად მუშაობს
   - ✅ **Navigation logic** - GPS tracking + audio
   - ✅ **Session summary** - შედეგების ჩვენება

---

## 🗺️ რუკის Cache სტრატეგია

### თელავის რუკა:
- **Zoom 16** - მთელი ქალაქი (500 tiles)
- **Zoom 17** - street level (1000 tiles)  
- **Zoom 18** - detailed (2000 tiles)

**Storage:** ~150-200 MB თელავის რუკისთვის

### როგორ მუშაობს:
1. პირველად რუკაზე გადახვალ → tiles ჩაიტვირთება
2. Tiles cache-დება 6 თვით
3. ოფლაინში → იგივე tiles cache-დან

---

## 📊 Cache სტატისტიკა

| რესურსი | Cache დრო | Max ზომა |
|---------|-----------|----------|
| App Code (JS/CSS/HTML) | უვადო | ~1 MB |
| Audio ფაილები | 90 დღე | ~10 MB |
| Routes მონაცემები | 30 დღე | ~100 KB |
| რუკის ფილები (თელავი) | 6 თვე | ~200 MB |
| რუკის ფილები (სხვა) | 90 დღე | ~50 MB |

**სულ:** ~260 MB storage

---

## 🧪 ტესტირება

### ვებში (Chrome DevTools):
1. გახსენი DevTools (F12)
2. Network tab → "Offline" checkbox ☑️
3. ან Application → Service Workers → "Offline"

### მობილურზე:
1. შედი აპში WiFi-ით
2. გადახედე ყველა მარშრუტს (რუკა ჩაიტვირთოს)
3. გამორთე WiFi + Mobile Data
4. სცადე navigation!

---

## ⚠️ შეზღუდვები

### რა **არ** მუშაობს ოფლაინში:

❌ **პირველი Login** - საჭიროებს connection-ს
- მაგრამ session cache-დება 30 დღით
- შემდეგი login-ები offline-შიც მუშაობს

❌ **ახალი Routes sync** - საჭიროებს connection-ს
- მაგრამ ბოლო 30 დღის routes cached არის

❌ **რუკის ფილები რაც არ ნანახია**
- მხოლოდ ის რეგიონი რაც ონლაინში ნანახია
- თელავის ძირითადი რეგიონი 100% covered

---

## 💡 რეკომენდაციები

### ინსტრუქტორებისთვის:

1. **პირველად ონლაინით:**
   - შედი ყველა route-ზე ერთხელ
   - რუკა სრულად ჩაიტვირთება

2. **შემდეგ:**
   - ოფლაინშიც მუშაობს
   - GPS + Audio + Map ყველაფერი ჩართულია

3. **ყოველ 30 დღეში:**
   - ერთხელ მაინც შედი ინტერნეტით
   - Routes და cache განახლდება

---

## 🔧 Technical Details

### Service Worker Strategy:
- **App Shell:** Precache (installEvent)
- **Routes API:** NetworkFirst (fallback to cache)
- **Audio:** CacheFirst (6 თვე)
- **Map Tiles:** CacheFirst (6 თვე, RegExp filtered)

### Cache Names:
- `routes-cache` - Supabase routes
- `audio-cache` - mp3 ფაილები
- `telavi-map-tiles-z16/z17/z18` - თელავის რუკა
- `map-tiles-other` - სხვა რეგიონები

---

## 📱 Progressive Web App

აპი არის PWA რაც ნიშნავს:
- ✅ Home screen-ზე დაყენება
- ✅ Offline support built-in
- ✅ Auto-update როცა ახალი ვერსია არის
- ✅ Native app-ის ფუნქციონალი

---

გილოცავ! ახლა აპი ოფლაინშიც მუშაობს! 🎉
