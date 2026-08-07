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

call "%~dp0_shared.bat" :update_code

call "%~dp0_shared.bat" :ensure_packages
if errorlevel 1 goto :failed

call "%~dp0_shared.bat" :ensure_env
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

:: Expo Go is gone, and losing a farm twice is why.
::
:: Expo Go is one shared app that every Expo project borrows, so the records
:: lived in ITS sandbox (host.exp.exponent) rather than in Steading's. Expo Go
:: reinstalls itself whenever the SDK version moves, and an Android reinstall
:: takes the app's data with it — so bumping expo 57.0.9 to 57.0.11 emptied a
:: farm, twice, and neither time was a bug in the app.
::
:: A development build is Steading's OWN apk, com.steading.app, with its own
:: sandbox. It still talks to Metro, so editing code still reloads in a second;
:: what changes is that the records survive it.
::
:: `expo run:android` builds and installs when it needs to and starts Metro
:: either way, so this is one command for both the first run and every one
:: after. The first is slow — Gradle, five to fifteen minutes — and the rest
:: are as quick as Expo Go ever was.
echo.
echo   [2 of 2] Building and starting the app on the emulator.
echo.
echo   THE FIRST RUN IS SLOW - five to fifteen minutes while it
echo   builds the app itself. After that it is quick.
echo.
echo   This installs Steading as its own app, so what you log
echo   stays put. Expo Go could not promise that: it is one
echo   shared app, and it wipes itself whenever it updates.
echo.
echo   Leave this window OPEN while you use the app.
echo.

cd apps\mobile
call npx expo run:android

echo.
echo   The app server has stopped.
pause
exit /b 0

:failed
echo.
pause
exit /b 1
