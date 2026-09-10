# CityRoute - Push with GitHub Token
# ===================================

Write-Host "`n🚀 CityRoute GitHub Push Helper`n" -ForegroundColor Cyan

# Check if already ahead
$status = git status 2>&1 | Out-String
if ($status -match "Your branch is ahead") {
    Write-Host "✅ Changes are committed locally" -ForegroundColor Green
    git log --oneline -1
} else {
    Write-Host "⚠️  No changes to push" -ForegroundColor Yellow
    exit 0
}

Write-Host "`n📝 შეიყვანე GitHub Personal Access Token:`n" -ForegroundColor Yellow
Write-Host "Token-ის გაკეთება:" -ForegroundColor Gray
Write-Host "  1. გადადი: https://github.com/settings/tokens/new" -ForegroundColor Gray
Write-Host "  2. Note: CityRoute" -ForegroundColor Gray
Write-Host "  3. Expiration: 7 days" -ForegroundColor Gray
Write-Host "  4. Select: ✓ repo (ყველა checkbox)" -ForegroundColor Gray
Write-Host "  5. Generate token → Copy`n" -ForegroundColor Gray

$token = Read-Host "Token (ghp_...)"

if ([string]::IsNullOrWhiteSpace($token)) {
    Write-Host "`n❌ Token არ შეყვანილა" -ForegroundColor Red
    exit 1
}

Write-Host "`n🔄 Setting remote URL with token..." -ForegroundColor Cyan
$currentRemote = git remote get-url origin
Write-Host "Current: $currentRemote" -ForegroundColor Gray

# Set remote with token
git remote set-url origin "https://$token@github.com/gogakirvalidze32b-blip/cityroute.git"

Write-Host "`n📤 Pushing to GitHub..." -ForegroundColor Cyan
$pushResult = git push origin main 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n✅ SUCCESS! Pushed to GitHub`n" -ForegroundColor Green
    Write-Host "🎉 Vercel ავტომატურად deploy-ს დაიწყებს 2-3 წუთში" -ForegroundColor Green
    Write-Host "📊 Check: https://vercel.com/dashboard`n" -ForegroundColor Cyan
    
    # Restore remote without token (for security)
    Write-Host "🔐 Removing token from remote URL..." -ForegroundColor Gray
    git remote set-url origin $currentRemote
} else {
    Write-Host "`n❌ Push Failed:`n" -ForegroundColor Red
    Write-Host $pushResult -ForegroundColor Red
    Write-Host "`nშეამოწმე Token-ის permissions და სცადე თავიდან`n" -ForegroundColor Yellow
    
    # Restore original remote
    git remote set-url origin $currentRemote
    exit 1
}
