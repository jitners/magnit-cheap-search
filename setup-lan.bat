@echo off
title Magnit - phone access setup (administrator)
cd /d "%~dp0"

set PORT=5080
if not "%~1"=="" set PORT=%~1

net session >nul 2>&1
if %errorlevel%==0 goto :run

echo.
echo This one-time setup needs administrator rights.
echo Click "Yes" in the Windows prompt.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -ArgumentList '%PORT%' -Verb RunAs"
exit /b

:run
echo.
echo Allowing the local server to listen on port %PORT% ...
netsh http delete urlacl url=http://+:%PORT%/ >nul 2>&1
netsh http add urlacl url=http://+:%PORT%/ user=%USERNAME%
if errorlevel 1 goto :failed

echo.
echo Allowing TCP port %PORT% through Windows Firewall ...
netsh advfirewall firewall delete rule name="Magnit local" >nul 2>&1
netsh advfirewall firewall add rule name="Magnit local" dir=in action=allow protocol=TCP localport=%PORT% >nul
if errorlevel 1 goto :failed

echo.
echo Done. Now close this window and run start-lan.bat.
echo.
pause
exit /b 0

:failed
echo.
echo Something went wrong. Run this file again as administrator.
echo.
pause
exit /b 1
