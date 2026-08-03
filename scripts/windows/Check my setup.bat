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
:: Counted AND told apart, which took two goes to get right.
::
:: First this window printed "expo-image-manipulator ... doesn't seem to be
:: installed" and then "Nothing missing" underneath it — a check reporting
:: success over a failed step, which is worse than staying quiet.
::
:: Counting the errorlevel fixed that and introduced the next fault: `expo
:: install --check` fails for TWO unrelated reasons, and the first fix named
:: one cure for both.
::
::   not installed  - a pull brought a new package. `pnpm install` fixes it,
::                    and the run scripts now do that for themselves.
::   wrong version  - installed, but not the version Expo Go's native side
::                    expects. `pnpm install` CANNOT fix this: it installs
::                    what package.json says, and package.json is the thing
::                    that is wrong. It needs a deliberate bump, reviewed.
::
:: Telling somebody to reinstall when the manifest is what needs changing is
:: the same defect as the Try again button that retried the wrong thing. So
:: the output is captured and read, and each case gets its own line.
echo n| call npx expo install --check > "%TEMP%\steading-expo-check.txt" 2>&1
set EXPOFAIL=%errorlevel%
type "%TEMP%\steading-expo-check.txt"

if not "%EXPOFAIL%"=="0" (
  set /a MISSING+=1
  findstr /c:"doesn't seem to be installed" "%TEMP%\steading-expo-check.txt" >nul 2>&1
  if errorlevel 1 (
    echo.
    echo   [ MISSING ] package versions - do NOT reinstall; this needs a version
    echo               change in the project. Send this window to Claude.
  ) else (
    echo.
    echo   [ MISSING ] packages       - run "Start the farm server" once; it installs them
  )
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
