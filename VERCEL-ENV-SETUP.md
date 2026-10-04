# 🔧 Vercel Environment Variables Setup

## ⚠️ პრობლემა
Console error: "Supabase is not initialized"

**მიზეზი:** Vercel-ზე არ არის Environment Variables დასეტილი!

---

## ✅ გადაწყვეტა

### Method 1: Vercel Dashboard (Recommended)

1. **გადადი Vercel Dashboard:**
   https://vercel.com/dashboard

2. **აირჩიე cityroute project**

3. **გადადი Settings → Environment Variables**

4. **დაამატე შემდეგი 3 variable:**

#### Variable 1:
- **Name:** `VITE_SUPABASE_URL`
- **Value:** `https://tuylbbdhvfcobxynwtnt.supabase.co`
- **Environments:** ☑️ Production ☑️ Preview ☑️ Development

#### Variable 2:
- **Name:** `VITE_SUPABASE_ANON_KEY`
- **Value:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1eWxiYmRodmZjb2J4eW53dG50Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3ODgwNjcsImV4cCI6MjA5ODM2NDA2N30.kqMIhAY_p16CruFsqPd80siGJkAzqgMM8KOxa_LjNvE`
- **Environments:** ☑️ Production ☑️ Preview ☑️ Development

#### Variable 3:
- **Name:** `VITE_YANDEX_MAPS_KEY`
- **Value:** `bbcec583-a9ab-4cf1-8b08-124e152c7c37`
- **Environments:** ☑️ Production ☑️ Preview ☑️ Development

5. **Save Variables**

6. **Redeploy:**
   - გადადი **Deployments** tab
   - უახლესი deployment-ის `...` menu → **Redeploy**
   - ან უბრალოდ git push გააკეთე (ავტომატურად redeploy-ს გააკეთებს)

---

### Method 2: Vercel CLI (Alternative)

თუ Vercel CLI გაქვს დაინსტალირებული:

```bash
vercel env add VITE_SUPABASE_URL production
# შეიყვანე: https://tuylbbdhvfcobxynwtnt.supabase.co

vercel env add VITE_SUPABASE_ANON_KEY production
# შეიყვანე anon key

vercel env add VITE_YANDEX_MAPS_KEY production
# შეიყვანე yandex key

# Redeploy
vercel --prod
```

---

## 🔍 როგორ შევამოწმოთ

1. Environment variables დამატების შემდეგ
2. Redeploy დასრულების შემდეგ
3. გადადი: https://cityroute.vercel.app/debug-login
4. გახსენი Console
5. **აღარ უნდა ჩანდეს** "Supabase is not initialized" error
6. ახლა ჩანს რეალური auth errors (თუ რამე არის)

---

## 📝 შენიშვნა

⚠️ **უსაფრთხოება:** 
- VITE_ prefix-იანი variables **PUBLIC**-ია (client-side)
- Supabase ANON key უსაფრთხოა client-side გამოსაყენებლად
- Row Level Security (RLS) იცავს მონაცემებს Supabase-ში

---

## ✅ შემდეგი ნაბიჯი

როგორც კი Environment Variables დაამატე და Redeploy გააკეთე:
- Login უნდა იმუშაოს ✅
- Console-ში აღარ იქნება "not initialized" error ✅
- რეალური auth testing შეგიძლია დაიწყო ✅
