@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dpn0.ps1" %*
set "buildExit=%ERRORLEVEL%"
echo.
if not "%buildExit%"=="0" echo Packaging failed. Review the error above before trying again.
pause
exit /b %buildExit%
