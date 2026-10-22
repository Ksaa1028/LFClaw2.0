@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0LFClaw\08-构建运行\start-local.ps1"
if errorlevel 1 echo LFClaw startup failed. See the message above and .artifacts\lfclaw-start logs.
pause
