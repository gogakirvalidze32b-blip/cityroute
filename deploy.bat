@echo off
echo ================================
echo CityRoute Deployment Script
echo ================================
echo.

REM Disable Git askpass
set GIT_ASKPASS=
set GIT_TERMINAL_PROMPT=0
set GCM_INTERACTIVE=never

echo [1/3] Checking git status...
git status
echo.

echo [2/3] Attempting push...
echo.
echo If this fails, please use ONE of these methods:
echo.
echo METHOD 1 - GitHub Token (Recommended):
echo   1. Go to: https://github.com/settings/tokens/new
echo   2. Create token with 'repo' scope
echo   3. Run: git remote set-url origin https://YOUR_TOKEN@github.com/gogakirvalidze32b-blip/cityroute.git
echo   4. Run: git push
echo.
echo METHOD 2 - VS Code UI:
echo   1. Open Source Control panel (Ctrl+Shift+G)
echo   2. Click ... menu
echo   3. Click Push
echo.
echo METHOD 3 - GitHub Desktop:
echo   1. Open project in GitHub Desktop
echo   2. Click Push origin
echo.
pause

REM Try to push (will likely fail due to credential manager issue)
git push origin main 2>&1

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ================================
    echo Push FAILED - Manual Action Required
    echo ================================
    echo.
    echo Your changes are committed locally:
    git log --oneline -1
    echo.
    echo Please use one of the methods above to push.
    echo.
) else (
    echo.
    echo ================================
    echo SUCCESS! Pushed to GitHub
    echo ================================
    echo.
    echo Vercel will auto-deploy in 2-3 minutes
    echo Check: https://vercel.com/dashboard
    echo.
)

pause
