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

:: The address is compiled into the app now, so a wifi address left behind by
:: "Run on phone" would build something the emulator cannot reach.
call "%~dp0_shared.bat" :set_emulator_address

call "%~dp0_shared.bat" :check_adb
if errorlevel 1 goto :failed

:: The app is compiled here now, so the build toolchain is checked here too.
call "%~dp0_shared.bat" :check_java
if errorlevel 1 goto :failed

:: Gradle finds the SDK through this. `:check_adb` already located it.
if exist "%LOCALAPPDATA%\Android\Sdk" set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"

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

echo   [1 of 2] Everything the app needs is ready.
::
:: The install happened in the preflight above, and this used to run a SECOND
:: one. Two installs of the same tree in one window is not merely waste: the
:: second printed `Packages: -72` on a perfectly clean checkout, which is the
:: line a comment in _shared.bat had named as the signature of a broken
:: layout. A diagnostic that fires on healthy machines is worse than none, and
:: it sent a real debugging session after the wrong fault.

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
echo   THE VERY FIRST RUN IS SLOW - it can be half an hour while
echo   it downloads Android's build tools. After that it is a
echo   couple of minutes, and a code change still reloads in a
echo   second.
echo.
echo   This installs Steading as its own app, so what you log
echo   stays put. Expo Go could not promise that: it is one
echo   shared app, and it wipes itself whenever it updates.
echo.
echo   Leave this window OPEN while you use the app.
echo.

:: Through the package script, not `npx expo run:android` directly — the script
:: is `pnpm stamp && expo run:android`, and skipping it builds an app that
:: cannot say which commit it came from.
::
:: `--no-install` because this window already ran `pnpm install` above. Left to
:: itself `expo run:android` runs its own package install from apps/mobile,
:: which in a pnpm workspace is redundant at best.
call pnpm mobile:android --no-install

echo.
echo   The app server has stopped.
pause
exit /b 0

:failed
echo.
pause
exit /b 1
