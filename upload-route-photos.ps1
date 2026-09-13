# ============================================
# 📸 Upload Route Photos to Vercel
# ============================================
# გამოყენება: ჩააგდე ფოტოები public/routes/ ფოლდერში
# და გაუშვი ეს script (Right-click → Run with PowerShell)

Write-Host "📸 Uploading route photos to Vercel..." -ForegroundColor Cyan

# Check if we're in the right directory
if (-not (Test-Path "public/routes")) {
    Write-Host "❌ Error: public/routes folder not found!" -ForegroundColor Red
    Write-Host "Please run this script from the cityroute folder" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

# Check for new/modified photos
$photos = Get-ChildItem "public/routes" -Filter "*-official-map.*"
if ($photos.Count -eq 0) {
    Write-Host "⚠️  No route photos found in public/routes/" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 0
}

Write-Host "`n📋 Found $($photos.Count) route photos:" -ForegroundColor Green
$photos | ForEach-Object { Write-Host "   - $($_.Name)" -ForegroundColor Gray }

# Git add
Write-Host "`n📦 Adding photos to git..." -ForegroundColor Cyan
git add public/routes/

# Git commit
$commitMessage = Read-Host "`n💬 Enter commit message (or press Enter for default)"
if ([string]::IsNullOrWhiteSpace($commitMessage)) {
    $commitMessage = "Update route photos"
}

Write-Host "`n💾 Creating commit..." -ForegroundColor Cyan
git commit -m $commitMessage

# Git push
Write-Host "`n🚀 Pushing to GitHub..." -ForegroundColor Cyan
git push origin main

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n✅ Success! Photos uploaded to GitHub" -ForegroundColor Green
    Write-Host "⏳ Vercel will automatically deploy in 2-3 minutes" -ForegroundColor Yellow
    Write-Host "🌐 Check status: https://vercel.com/dashboard" -ForegroundColor Cyan
} else {
    Write-Host "`n❌ Error: Push failed!" -ForegroundColor Red
}

Write-Host "`n"
Read-Host "Press Enter to exit"
