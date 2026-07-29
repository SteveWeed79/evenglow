@echo off
setlocal enabledelayedexpansion
title Steading - check my setup
cd /d "%~dp0..\.."

echo.
echo   ============================================
echo     STEADING - what is installed on this PC
echo   ============================================
echo.
echo   Nothing here changes anything. It only looks.
echo.

set MISSING=0

:: Written out one at a time on purpose. A clever loop would be shorter and
:: this has to work first time on a machine nobody can debug from here.

where node >nul 2>&1
if errorlevel 1 (
  echo   [ MISSING ] Node.js        - get the LTS from https://nodejs.org
  set /a MISSING+=1
) else (
  for /f "tokens=*" %%v in ('node --version 2^>^&1') do echo   [ OK ]      Node.js        %%v
)

where pnpm >nul 2>&1
if errorlevel 1 (
  echo   [ MISSING ] pnpm           - the run scripts install this for you
) else (
  for /f "tokens=*" %%v in ('pnpm --version 2^>^&1') do echo   [ OK ]      pnpm           %%v
)

where git >nul 2>&1
if errorlevel 1 (
  echo   [ MISSING ] Git            - comes with GitHub Desktop
  set /a MISSING+=1
) else (
  for /f "tokens=*" %%v in ('git --version 2^>^&1') do echo   [ OK ]      Git            %%v
)

echo.
echo   --- The app's own settings ---

if exist "apps\mobile\.env" (
  echo   [ OK ]      settings file
  for /f "tokens=*" %%v in ('findstr /b "EXPO_PUBLIC_API_URL" "apps\mobile\.env" 2^>^&1') do echo               %%v
) else (
  echo   [ MISSING ] settings file  - either run script makes this for you
  echo               Without it the app still opens and still saves
  echo               everything you log. It just cannot sync.
)

echo.
echo   --- Android Studio ^(only needed for the emulator^) ---

if exist "%LOCALAPPDATA%\Android\Sdk" (
  echo   [ OK ]      Android SDK
) else (
  echo   [ MISSING ] Android SDK    - install Android Studio
  set /a MISSING+=1
)

if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" (
  echo   [ OK ]      adb
  set "PATH=%LOCALAPPDATA%\Android\Sdk\platform-tools;%PATH%"
) else (
  echo   [ MISSING ] adb            - install Android Studio
  set /a MISSING+=1
)

if exist "%LOCALAPPDATA%\Android\Sdk\emulator\emulator.exe" (
  echo   [ OK ]      emulator
) else (
  echo   [ MISSING ] emulator       - install Android Studio
  set /a MISSING+=1
)

echo.
echo   --- Virtual devices you have made ---
if exist "%LOCALAPPDATA%\Android\Sdk\emulator\emulator.exe" (
  "%LOCALAPPDATA%\Android\Sdk\emulator\emulator.exe" -list-avds 2>nul
  echo.
  echo   ^(Nothing listed means you have not made one yet.
  echo    Android Studio, Device Manager, the + button.^)
) else (
  echo   Cannot check without Android Studio.
)

echo.
echo   --- Phones or emulators connected right now ---
where adb >nul 2>&1
if errorlevel 1 (
  echo   Cannot check without Android Studio.
) else (
  adb devices
)

echo.
echo   ============================================
if "%MISSING%"=="0" (
  echo     Nothing missing.
) else (
  echo     %MISSING% still to install - see MISSING above.
)
echo   ============================================
echo.
echo   TO SEND THIS TO CLAUDE:
echo     right-click the blue title bar at the top of this window,
echo     choose  Edit ^> Select All,  press Enter, then paste in chat.
echo.
pause
exit /b 0
