@echo off
chcp 65001 >nul
title Magnit cheap search
cd /d "%~dp0"
echo Starting local server, the browser will open automatically...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" %*
echo.
echo Server stopped. Press any key to close this window.
pause >nul
