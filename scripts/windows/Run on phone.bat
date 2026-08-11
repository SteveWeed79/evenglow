@echo off
setlocal enabledelayedexpansion
title Steading - run on my phone
cd /d "%~dp0..\.."

echo.
echo   ============================================
echo     STEADING - run the app on your phone
echo   ============================================
echo.
echo   Plug the phone or tablet in with a USB cable and turn
echo   on USB debugging. If Steading is not on it yet, this
echo   window installs it; if it is, this window connects it.
echo.
echo   Steading installs as its OWN app. It does not run inside
echo   Expo Go and cannot be opened by scanning a code with Expo
echo   Go or with the camera - Expo Go is one shared sandbox that
echo   wipes itself when it updates, and it took a farm's records
echo   with it twice.
echo.
echo   For the wifi step afterwards, the phone and this computer
echo   have to be on the same network.
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

echo   [1 of 2] Everything the app needs is ready.
echo.
:: Installed in the preflight above. A second install here printed
:: `Packages: -72` on a clean checkout - see the note in Run on emulator.

::
:: Is Steading actually ON the phone? Ask, rather than assume.
::
:: This window used to go straight to the QR code, on the strength of a
:: sentence in its own header saying the app had to be installed first. A
:: tablet arrived with Expo Go on it, a USB cable plugged in, and this script
:: run - and the QR did nothing, because the QR is for Steading's own dev
:: client and NOTHING else can open it. Not the camera app, not Expo Go.
::
:: The capability was here the whole time: `expo run:android` installs to
:: whatever adb can see, USB phone included. It was behind a script called
:: "Run on emulator", which is the last place somebody holding a tablet looks.
:: So this one now finishes the job it is named for.
::
call "%~dp0_shared.bat" :check_adb
if errorlevel 1 goto :failed

set "PHONE="
set "WAITING="
for /f "skip=1 tokens=1,2" %%D in ('adb devices') do (
  if "%%E"=="device" if not defined PHONE set "PHONE=%%D"
  :: Plugged in and not yet trusted. The single most common first-time state,
  :: and it looks identical to "nothing connected" unless it is named.
  if "%%E"=="unauthorized" set "WAITING=%%D"
)

if not defined PHONE if defined WAITING (
  echo.
  echo   PROBLEM: the device is plugged in but has not allowed
  echo   this computer yet.
  echo.
  echo   Look at the phone. There is a prompt asking whether to
  echo   allow USB debugging from this computer - tap ALLOW, tick
  echo   "always allow" if it offers, then run this window again.
  echo.
  goto :failed
)

if not defined PHONE (
  echo.
  echo   PROBLEM: no phone or tablet is connected.
  echo.
  echo   Plug it in with a USB cable and turn on USB debugging:
  echo     Settings ^> About ^> tap "Build number" seven times,
  echo     then Settings ^> Developer options ^> USB debugging.
  echo   Answer "Allow" on the phone when it asks.
  echo.
  echo   If Steading is ALREADY installed and you only want to
  echo   reconnect it over wifi, you can close this and use the
  echo   app's own "cannot find this computer" screen to scan.
  echo.
  goto :failed
)

echo   Connected: !PHONE!

adb -s !PHONE! shell pm list packages 2>nul | findstr /c:"com.steading.app" >nul
if errorlevel 1 (
  echo.
  echo   Steading is not on this device yet, so it is being built
  echo   and installed now. This takes several minutes the first
  echo   time and is quick afterwards.
  echo.
  echo   It installs as its OWN app, not inside Expo Go. Expo Go is
  echo   one shared sandbox that wipes itself when it updates, and
  echo   it took a farm's records with it twice.
  echo.
  :: `--no-install` because the preflight above already ran `pnpm install`.
  :: Left alone, `expo run:android` runs its own from apps/mobile.
  call pnpm mobile:android --no-install
  goto :stopped
)

echo.
echo   [2 of 2] Starting the app.
echo.
echo   A big square QR CODE will appear below in a moment.
echo.
echo   Open STEADING ITSELF on the phone and scan from the screen
echo   it shows when it cannot find this computer. The phone's
echo   camera app will not open it, and neither will Expo Go -
echo   this code is for Steading's own app and nothing else can
echo   read it.
echo.
echo   Leave this window OPEN while you use the app.
echo   To stop, close this window.
echo.

call pnpm mobile

:stopped

echo.
echo   The app server has stopped.
pause
exit /b 0

:failed
echo.
pause
exit /b 1
