@echo off
setlocal enabledelayedexpansion
title Steading - run on the emulator
cd /d "%~dp0..\.."

echo.
echo   ============================================
echo     STEADING - run the app on the emulator
echo   ============================================
echo.
echo   Start your virtual device in Android Studio FIRST
echo   (Device Manager, then the play arrow), and wait
echo   until you can see its home screen.
echo.
pause

call "%~dp0_shared.bat" :check_node
if errorlevel 1 goto :failed

call "%~dp0_shared.bat" :check_pnpm
if errorlevel 1 goto :failed

call "%~dp0_shared.bat" :check_adb
if errorlevel 1 goto :failed

echo.
echo   Looking for your virtual device...
adb devices | findstr /r "device$" >nul
if errorlevel 1 (
  echo.
  echo   PROBLEM: no running device found.
  echo.
  echo   Open Android Studio, then Device Manager on the left,
  echo   then click the play arrow next to your device. Wait for
  echo   its home screen, then run this again.
  echo.
  goto :failed
)
echo   Found it.
echo.

echo   [1 of 2] Getting everything the app needs ready.
call pnpm install
if errorlevel 1 (
  echo.
  echo   That did not work. Copy everything above and send it to Claude.
  goto :failed
)

echo.
echo   [2 of 2] Starting the app on the emulator.
echo.
echo   Expo Go will install itself on the virtual device the
echo   first time, then the app opens by itself.
echo.
echo   Leave this window OPEN while you use the app.
echo.

cd apps\mobile
call npx expo start --android

echo.
echo   The app server has stopped.
pause
exit /b 0

:failed
echo.
pause
exit /b 1
