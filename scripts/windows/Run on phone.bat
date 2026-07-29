@echo off
setlocal enabledelayedexpansion
title Steading - run on my phone
cd /d "%~dp0..\.."

echo.
echo   ============================================
echo     STEADING - run the app on your phone
echo   ============================================
echo.
echo   You will need the free "Expo Go" app from the
echo   Play Store on your phone, and your phone on the
echo   same wifi as this computer.
echo.

call "%~dp0_shared.bat" :check_node
if errorlevel 1 goto :failed

call "%~dp0_shared.bat" :check_pnpm
if errorlevel 1 goto :failed

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
echo   Open "Expo Go" on your phone and scan it.
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
