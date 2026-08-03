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
echo   --- The code you are running ---
where git >nul 2>&1
if errorlevel 1 (
  echo   Cannot check without Git.
) else (
  for /f "tokens=*" %%v in ('git log -1 --pretty^=format:"%%h  %%s" 2^>nul') do echo   %%v
  for /f "tokens=*" %%v in ('git status --porcelain 2^>nul') do echo   CHANGED: %%v
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
echo   --- Do the app's packages match Expo? ---
:: The one question this window could not answer, and the one that has cost
:: the most time: Expo Go ships fixed native module versions, so a package
:: pinned to a different version is JavaScript talking to a native side that
:: does not match it. That fails as "undefined is not a function" on a device
:: and passes every test on a computer.
:: Answered "no" for us. `expo install --check` PROMPTS, and a stray Enter
:: rewrites package.json and the lockfile — which this window's own header
:: promises it will never do, and which then makes `git pull --ff-only`
:: refuse to update the machine. It reports; fixing is a decision, made
:: somewhere it can be reviewed.
cd apps\mobile
:: Three goes at this, and the lesson is the same each time: a check that
:: names the wrong fix is worse than one that names none.
::
:: 1. It printed "expo-image-manipulator ... doesn't seem to be installed"
::    and then "Nothing missing" underneath — success reported over a failure.
:: 2. Counting the errorlevel fixed that and named ONE cure for what turned
::    out to be several conditions.
:: 3. It then told somebody "do NOT reinstall" when reinstalling was exactly
::    the fix.
::
:: `expo install --check` reads what is INSTALLED. It cannot see whether
:: package.json already agrees, so it reports all of these identically:
::
::   absent            - a pull brought a new package
::   stale             - package.json was bumped and node_modules was not.
::                       THIS WINDOW ONLY LOOKS, so a pull leaves it stale
::                       until a run script installs.
::   genuinely pinned   - package.json itself names the wrong version
::
:: Installing is safe, idempotent and never touches package.json, so it is
:: named first for every case. Only if it survives an install is it the third
:: kind — and that is a decision made where it can be reviewed, not here.
echo n| call npx expo install --check > "%TEMP%\steading-expo-check.txt" 2>&1
set EXPOFAIL=%errorlevel%
type "%TEMP%\steading-expo-check.txt"

if not "%EXPOFAIL%"=="0" (
  set /a MISSING+=1
  echo.
  echo   [ MISSING ] packages       - run "Start the farm server" once; it installs them.
  echo               This window only looks, so it cannot fix this itself.
  echo               If this line is STILL here afterwards, the project needs a
  echo               version change - send this window to Claude.
)
del "%TEMP%\steading-expo-check.txt" >nul 2>&1
cd ..\..

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
