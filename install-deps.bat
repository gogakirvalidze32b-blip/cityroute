@echo off
cd /d "%~dp0"
echo Installing dependencies...
call npm install
echo.
echo Done! Press any key to close...
pause > nul
