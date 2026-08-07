@echo off
setlocal enabledelayedexpansion
title Steading - run on my phone
cd /d "%~dp0..\.."

echo.
echo   ============================================
echo     STEADING - run the app on your phone
echo   ============================================
echo.
echo   You need STEADING already installed on your phone,
echo   and your phone on the same wifi as this computer.
echo.
echo   Not installed yet? Plug the phone in with a USB cable,
echo   turn on USB debugging, and run "Run on emulator" once -
echo   it installs to whatever is plugged in. Or ask Claude for
echo   a download link and install that.
echo.
echo   This used to say "Expo Go" and no longer does. Expo Go is
echo   one shared app that wipes itself whenever it updates, and
echo   it took a farm's records with it twice.
echo.

call "%~dp0_shared.bat" :check_node
if errorlevel 1 goto :failed

call "%~dp0_shared.bat" :check_pnpm
if errorlevel 1 goto :failed

call "%~dp0_shared.bat" :update_code

call "%~dp0_shared.bat" :ensure_packages
if errorlevel 1 goto :failed

call "%~dp0_shared.bat" :ensure_env
if errorlevel 1 goto :failed

call "%~dp0_shared.bat" :set_lan_address

echo   [1 of 2] Getting everything the app needs ready.
echo            The first time this takes a few minutes. Later runs are quick.
echo.
call pnpm install
if errorlevel 1 (
  echo.
  echo   That did not work. Copy everything above and send it to Claude.
  goto :failed
)

echo.
echo   [2 of 2] Starting the app.
echo.
echo   A big square QR CODE will appear below in a moment.
echo   Open STEADING on your phone and scan it from the
echo   screen it shows when it cannot find this computer.
echo.
echo   Leave this window OPEN while you use the app.
echo   To stop, close this window.
echo.

call pnpm mobile

echo.
echo   The app server has stopped.
pause
exit /b 0

:failed
echo.
pause
exit /b 1
