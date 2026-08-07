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
echo   --- Android Studio ^(needed to build and install the app^) ---

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
echo   --- Java, and the SDK pieces Gradle needs ---
:: None of this mattered under Expo Go, because nothing was ever compiled on
:: this machine. Building the app locally needs four things Android Studio does
:: not install by its default flow, and a window that said "Nothing missing"
:: without checking them would be exactly the false OK this file was rewritten
:: to stop giving.
set "J17="
for /d %%D in ("%ProgramFiles%\Eclipse Adoptium\jdk-17*" "%ProgramFiles%\Java\jdk-17*" "%ProgramFiles%\Microsoft\jdk-17*" "%ProgramFiles%\Zulu\zulu-17*") do (
  if exist "%%~D\bin\java.exe" set "J17=%%~D"
)
if defined J17 (
  echo   [ OK ]      Java 17
) else (
  echo   [ MISSING ] Java 17        - Temurin 17 LTS from adoptium.net.
  echo               NOT 21, and not the one inside Android Studio: React
  echo               Native asks Gradle for 17 by name.
  set /a MISSING+=1
)

:: The NDK version is not a guess and must not drift: React Native pins it in
:: `react-native/gradle/libs.versions.toml`, and Gradle asks for that exact
:: string. It is needed because expo-modules-core, expo-sqlite and
:: react-native-svg each ship an android/CMakeLists.txt, so there really is C++
:: compiled on this machine — this is not a precaution.
set "SDKMISSING="
for %%P in (
  "ndk\27.1.12297006"
  "cmake"
  "platforms\android-36"
  "build-tools\36.0.0"
) do (
  if exist "%LOCALAPPDATA%\Android\Sdk\%%~P" (
    echo   [ OK ]      SDK %%~P
  ) else (
    echo   [ MISSING ] SDK %%~P
    set "SDKMISSING=1"
    set /a MISSING+=1
  )
)

:: One command, because the GUI route has a trap in it.
::
:: "SDK Manager, SDK Tools tab" was the whole instruction, and it sends
:: somebody to a list showing "NDK (Side by Side)" with no version — ticking it
:: installs the NEWEST ndk, which is not the one Gradle asked for. The version
:: numbers only appear after checking "Show Package Details", which is easy to
:: miss and costs a two-gigabyte download to find out about.
::
:: **The NDK version is verified; the CMake one is not, and the difference is
:: stated rather than smoothed over.** 27.1.12297006 is pinned in
:: `react-native/gradle/libs.versions.toml` and Gradle asks for that string
:: exactly. No module here pins a CMake version at all — expo-modules-core,
:: expo-sqlite and react-native-svg each declare an `externalNativeBuild.cmake`
:: block with no `version`, so the Android Gradle Plugin picks its own default,
:: and which default that is cannot be settled without running a build.
:: 3.22.1 is AGP's, so it is the one offered; Gradle names the version in its
:: error if it wants another, which is a better authority than a guess here.
if defined SDKMISSING (
  echo.
  echo   To install the missing SDK pieces, paste this into a Command Prompt:
  echo.
  echo     "%LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest\bin\sdkmanager.bat" "ndk;27.1.12297006" "cmake;3.22.1" "platforms;android-36" "build-tools;36.0.0"
  echo.
  echo   If that path does not exist, install "Android SDK Command-line Tools"
  echo   first: Android Studio, Tools ^> SDK Manager, SDK Tools tab.
  echo.
  echo   Doing it by hand instead? Tick "Show Package Details" in that tab, or
  echo   the list hides the version numbers and gives you the newest NDK -
  echo   which is not the one Gradle asked for.
  echo.
  echo   If the build later says a DIFFERENT CMake version is missing, it names
  echo   the number. Install that one the same way and carry on - the NDK
  echo   version above is the one that has to be exact.
)

:: 297-character paths already exist inside node_modules\.pnpm, and Gradle
:: writes its own output underneath them. Windows truncates at 260 unless this
:: is on, and the failure looks like a corrupt checkout rather than a limit.
for /f "tokens=3" %%L in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\FileSystem" /v LongPathsEnabled 2^>nul ^| findstr LongPathsEnabled') do set "LONGPATHS=%%L"
if "%LONGPATHS%"=="0x1" (
  echo   [ OK ]      long file paths
) else (
  echo   [ NOTE ]    long file paths are OFF in Windows.
  echo               If the build fails on a path nobody can read, that is
  echo               why. The reliable fix is a short folder: C:\steading
)

echo.
echo   --- Is the app installed on the device? ---
:: The single most useful line this window can print now. Under Expo Go the
:: answer was always "Expo Go is"; with a development build, "no" explains a
:: QR code nobody can scan and a phone that never opens anything.
adb shell pm list packages 2>nul | findstr /c:"com.steading.app" >nul
if errorlevel 1 (
  echo   [ NOTE ]    Steading is not installed on the attached device.
  echo               Run "Run on emulator" once - it builds and installs it.
) else (
  echo   [ OK ]      Steading is installed
)

echo.
echo   --- Do the app's packages match Expo? ---
:: The one question this window could not answer, and the one that has cost
:: the most time. The SDK pins a native version for every one of these
:: packages, so a package.json naming a different one is JavaScript talking to
:: a native side that does not match it. That fails as "undefined is not a
:: function" on a device and passes every test on a computer.
::
:: It mattered under Expo Go because Expo Go shipped the native halves and the
:: app had to agree with them. It still matters on a development build for the
:: opposite reason: the build compiles whatever package.json says, so a wrong
:: version is now baked into an apk rather than merely disagreed with.
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
