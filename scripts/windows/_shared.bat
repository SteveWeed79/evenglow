@echo off
:: Shared checks for the double-click scripts beside this file.
::
:: Called as:  call "_shared.bat" :check_node
:: Every routine prints plain English and sets errorlevel 1 when it cannot
:: continue, so the calling script can stop without the user reading a stack
:: trace.
goto %1

:check_node
where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo   PROBLEM: Node.js is not installed on this computer.
  echo.
  echo   Fix it once and you never do it again:
  echo     1. Go to    https://nodejs.org
  echo     2. Download the big green "LTS" button
  echo     3. Run the installer, click Next until it finishes
  echo     4. RESTART this script
  echo.
  exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set NODEVER=%%v
echo   Node.js %NODEVER% - found.
exit /b 0

:check_pnpm
where pnpm >nul 2>&1
if not errorlevel 1 (
  for /f "tokens=*" %%v in ('pnpm --version') do set PNPMVER=%%v
  echo   pnpm !PNPMVER! - found.
  exit /b 0
)

echo   pnpm is not installed yet. Installing it now...
call corepack enable pnpm >nul 2>&1
where pnpm >nul 2>&1
if not errorlevel 1 (
  echo   pnpm - installed.
  exit /b 0
)

call npm install -g pnpm
where pnpm >nul 2>&1
if errorlevel 1 (
  echo.
  echo   PROBLEM: pnpm would not install.
  echo   Copy everything in this window and send it to Claude.
  echo.
  exit /b 1
)
echo   pnpm - installed.
exit /b 0

:update_code
:: Every fix has to reach this machine somehow, and until now the only route
:: was a git command typed by hand — which meant three rounds of testing the
:: same bundle and reporting the same failure. The scripts fetch their own
:: updates now, and print what they are running so a screenshot always says
:: which code produced it.
where git >nul 2>&1
if errorlevel 1 (
  echo   Git not found - skipping update.
  exit /b 0
)

echo   Checking for updates...
:: --ff-only refuses to invent a merge. If this machine has local changes or
:: has diverged, the pull stops and says so rather than resolving it silently
:: and handing back a tree nobody can reason about.
git pull --ff-only
if errorlevel 1 (
  echo.
  echo   Could not update automatically - carrying on with what is here.
  echo.
  echo   If it said "your local changes would be overwritten",
  echo   close this and run "Fix my checkout" first.
  echo.
)

for /f "tokens=*" %%v in ('git log -1 --pretty^=format:"%%h  %%s" 2^>nul') do echo   Running: %%v
exit /b 0

:ensure_packages
:: The step whose absence broke a device run.
::
:: `:update_code` pulls, and a pull that brings a new dependency leaves
:: node_modules behind the package.json that now names it. Expo then refuses to
:: start with "expo-image-manipulator is added as a dependency but it doesn't
:: seem to be installed" — a message that names a package and not the fix.
::
:: pnpm is fast and idempotent when nothing changed, so this runs every time
:: rather than trying to guess whether the pull touched a manifest. Guessing
:: wrong is a broken run; guessing right saves two seconds.
:: A layout change is not something `pnpm install` will do on its own here.
::
:: `.npmrc` sets `node-linker=hoisted`, because the Android C++ build cannot
:: complete under pnpm's default layout on Windows — see the file for the
:: arithmetic. Switching linkers means deleting and rebuilding node_modules,
:: and pnpm asks before doing that. There is no console to ask on, so a script
:: install answers nothing and **quietly leaves the old layout in place**:
::
::   Lockfile is up to date, resolution step is skipped
::   Packages: -72
::   Done in 2.2s
::
:: — after which the build fails on `.pnpm` paths that should not exist any
:: more, and the window says nothing about why. Cost a real evening.
::
:: node_modules records which linker built it, so the mismatch is detectable
:: rather than guessable. When it differs, rebuild rather than asking.
if exist "node_modules\.modules.yaml" (
  findstr /r /c:"nodeLinker.*hoisted" "node_modules\.modules.yaml" >nul 2>&1
  if errorlevel 1 (
    echo   The package layout has changed - rebuilding it.
    echo   This takes a couple of minutes and only happens once.
    rd /s /q "node_modules" 2>nul
    rd /s /q "apps\mobile\node_modules" 2>nul
    rd /s /q "apps\api\node_modules" 2>nul
    rd /s /q "packages\contracts\node_modules" 2>nul
    rd /s /q "packages\core\node_modules" 2>nul
    :: The generated Android project has the old paths compiled into it, and
    :: Gradle will happily reuse them. `expo prebuild` makes it again.
    rd /s /q "apps\mobile\android" 2>nul
  )
)

echo   Checking the packages...
call pnpm install --silent
if errorlevel 1 (
  echo.
  echo   PROBLEM: the packages would not install.
  echo   Copy everything in this window and send it to Claude.
  echo.
  exit /b 1
)
echo   Packages - ready.
exit /b 0

:ensure_env
:: The settings file is deliberately not in git (it differs per machine), so a
:: fresh clone has none and the app opens with nowhere to sync to. Making it
:: here means nobody has to be handed a command to copy.
if exist "apps\mobile\.env" (
  echo   Settings file - found.
  exit /b 0
)
echo   No settings file yet. Making one from the example...
copy /y "apps\mobile\.env.example" "apps\mobile\.env" >nul
if errorlevel 1 (
  echo.
  echo   PROBLEM: could not create apps\mobile\.env
  echo   Copy everything in this window and send it to Claude.
  echo.
  exit /b 1
)
echo   Settings file - created.
exit /b 0

:set_emulator_address
:: The inverse of :set_lan_address, and it did not used to be needed.
::
:: Under Expo Go, Metro re-read this value on every start, so a wifi address
:: left behind by the phone script was live configuration and swapping back
:: happened for free. A development build BAKES it into the apk at compile
:: time — so a phone address left in place produces an emulator build that
:: cannot reach the server on the machine that built it, with no clue on
:: screen beyond "Not set up".
powershell -NoProfile -Command "(Get-Content 'apps\mobile\.env') -replace 'EXPO_PUBLIC_API_URL=.*', 'EXPO_PUBLIC_API_URL=http://10.0.2.2:3001' | Set-Content 'apps\mobile\.env'"
echo   Server address - set for the emulator.
exit /b 0

:set_lan_address
:: The example points at 10.0.2.2, which is how the EMULATOR reaches this
:: computer. A real phone on wifi cannot use that address at all, so the phone
:: script swaps in this computer's own address.
::
:: Baked into the apk now rather than re-read every start, so `Run on
:: emulator` calls :set_emulator_address to put it back before it builds.
findstr /c:"10.0.2.2" "apps\mobile\.env" >nul 2>&1
if errorlevel 1 (
  echo   Server address - already set.
  exit /b 0
)

echo   Finding this computer's address on your wifi...
set "LANIP="
for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } ^| Sort-Object -Property InterfaceMetric ^| Select-Object -First 1 -ExpandProperty IPAddress"`) do set "LANIP=%%i"

if "%LANIP%"=="" (
  echo.
  echo   Could not work out this computer's address by itself.
  echo   The app will still open and still save everything you log,
  echo   it just will not sync until the address is set.
  echo.
  exit /b 0
)

powershell -NoProfile -Command "(Get-Content 'apps\mobile\.env') -replace 'EXPO_PUBLIC_API_URL=.*', 'EXPO_PUBLIC_API_URL=http://%LANIP%:3001' | Set-Content 'apps\mobile\.env'"
echo   Server address - set to %LANIP%.
exit /b 0

:check_java
:: Nothing was ever compiled locally under Expo Go, so no run script needed a
:: JDK. `expo run:android` is Gradle, and Gradle is Java.
::
:: **Seventeen specifically, and this is the part that surprises people.**
:: React Native's Gradle plugin calls `jvmToolchain(17)` with no auto-download
:: configured, so Gradle needs a JDK 17 on the machine — it will not satisfy a
:: 17 toolchain with the 21 that recent Android Studio bundles. A check that
:: only asked "is there a java" would print OK on a machine that then fails
:: with a Gradle stack trace, which is the exact failure these scripts exist
:: to prevent.
set "JAVA17="
for /d %%D in ("%ProgramFiles%\Eclipse Adoptium\jdk-17*" "%ProgramFiles%\Java\jdk-17*" "%ProgramFiles%\Microsoft\jdk-17*" "%ProgramFiles%\Zulu\zulu-17*") do (
  if exist "%%~D\bin\java.exe" set "JAVA17=%%~D"
)

if not defined JAVA17 if defined JAVA_HOME (
  "%JAVA_HOME%\bin\java.exe" -version 2>&1 | findstr /r /c:"version .1*7\." >nul && set "JAVA17=%JAVA_HOME%"
)

if defined JAVA17 (
  set "JAVA_HOME=%JAVA17%"
  set "PATH=%JAVA17%\bin;%PATH%"
  echo   Java 17 - found.
  exit /b 0
)

echo.
echo   PROBLEM: no Java 17 found, and building the app needs exactly that.
echo.
echo   Not 21, and not the one inside Android Studio - React Native asks
echo   Gradle for 17 by name and will not accept a newer one.
echo.
echo   Get "Temurin 17 (LTS)" from https://adoptium.net and install it.
echo   Then close this window and run it again.
echo.
if defined JAVA_HOME echo   ^(JAVA_HOME is currently %JAVA_HOME%^)
echo.
exit /b 1

:check_adb
where adb >nul 2>&1
if not errorlevel 1 exit /b 0
if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" (
  set "PATH=%LOCALAPPDATA%\Android\Sdk\platform-tools;%PATH%"
  exit /b 0
)
echo.
echo   PROBLEM: Android Studio's tools were not found.
echo.
echo   This script needs Android Studio installed, with one
echo   virtual device created in its Device Manager.
echo   The setup guide Claude wrote walks through it.
echo.
exit /b 1
