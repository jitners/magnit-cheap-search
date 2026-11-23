@echo off
chcp 65001 >nul
title Magnit cheap search - phone access
cd /d "%~dp0"
echo Starting server for phone access...
echo Keep this window open while using the calculator on the phone.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" -Lan -NoBrowser %*
echo.
echo Server stopped. Press any key to close this window.
pause >nul
