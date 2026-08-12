@echo off
setlocal enabledelayedexpansion
title Steading - use my own computer
cd /d "%~dp0..\.."

echo.
echo   ============================================
echo     STEADING - point the app back at this computer
echo   ============================================
echo.
echo   The way back from "Use the farm server".
echo.
echo   After this, "Run on phone" and "Run on emulator" go back
echo   to choosing the address themselves - down the USB cable
echo   for a tethered phone, or this computer's wifi address.
echo.

rem Clears the value rather than guessing one. Each run script writes the
rem address that suits how the device is attached - USB, emulator or wifi - and
rem an address invented here would either be overwritten on the next run anyway
rem or, worse, be wrong in a way that looks configured.

call "%~dp0_shared.bat" :check_node
if errorlevel 1 goto :failed

call "%~dp0_shared.bat" :ensure_env
if errorlevel 1 goto :failed

node "%~dp0api-origin.mjs" use-local
if errorlevel 1 goto :failed

echo   Done. The next run picks its own address again.
echo.
echo   IMPORTANT: the address is compiled INTO the app, so this
echo   only reaches a device on the next build. Run "Run on
echo   phone" or "Run on emulator" now.
echo.
pause
exit /b 0

:failed
echo.
pause
exit /b 1
