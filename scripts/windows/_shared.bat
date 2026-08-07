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

:set_lan_address
:: The example points at 10.0.2.2, which is how the EMULATOR reaches this
:: computer. A real phone on wifi cannot use that address at all, so the phone
:: script swaps in this computer's own address.
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
:: JDK. `expo run:android` is Gradle, and Gradle is Java — so this is now as
:: load-bearing as the Node check.
::
:: Android Studio ships its own (JBR) and that one is fine; it is just not on
:: PATH, so this looks there before giving up.
where java >nul 2>&1
if not errorlevel 1 goto :java_ok
if exist "%ProgramFiles%\Android\Android Studio\jbr\bin\java.exe" (
  set "PATH=%ProgramFiles%\Android\Android Studio\jbr\bin;%PATH%"
  goto :java_ok
)
echo.
echo   PROBLEM: no Java found, and building the app needs it.
echo.
echo   Android Studio comes with one. If you have Android Studio,
echo   it is usually here and just not on the PATH:
echo     %ProgramFiles%\Android\Android Studio\jbr
echo.
echo   Otherwise install Temurin JDK 17 from adoptium.net.
echo.
exit /b 1
:java_ok
echo   Java - found.
exit /b 0

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
