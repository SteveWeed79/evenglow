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
:: install answers nothing and **quietly leaves the old layout in place**,
:: after which the build fails on `.pnpm` paths that should not exist any more
:: and the window says nothing about why. Cost a real evening.
::
:: **`Packages: -72` was named here as the signature of that, and it is not.**
:: The run scripts used to install twice - once here and once again in their
:: own step - and the second install prints that line on a perfectly clean
:: checkout. It was in the output of the original failure, so it looked
:: diagnostic; it fires on healthy machines too, and it sent a later debugging
:: session after the wrong fault. The duplicate installs are gone and the line
:: means nothing. What does mean something is the directory check below.
::
:: node_modules records which linker built it, so the mismatch is detectable
:: rather than guessable. When it differs, rebuild rather than asking.
::
:: **The manifest is not enough, and trusting it cost a second evening.**
:: `.modules.yaml` records the linker pnpm was CONFIGURED with, not the tree it
:: actually left behind. A machine that had built under the old layout came
:: through this check reporting "Packages - ready", still holding
:: `node_modules\.pnpm\react-native@0.86.2_...\` — half pruned, so Metro served
:: the app and then 404'd on an asset inside it:
::
::   ENOENT: no such file or directory, scandir
::     'C:\steading\node_modules\.pnpm\react-native@0.86.2_...\
::      node_modules\react-native\Libraries\LogBox\UI\LogBoxImages'
::
:: A correctly hoisted tree has NO `.pnpm\react-native@*` directory at all —
:: verified against a clean install — so its presence is a fact about the disk
:: rather than an inference, and it is the one worth checking. `Packages: -72`
:: in the install output is the same event seen from the other side.
set "layout_wrong="
if exist "node_modules\.modules.yaml" (
  findstr /r /c:"nodeLinker.*hoisted" "node_modules\.modules.yaml" >nul 2>&1
  if errorlevel 1 set "layout_wrong=1"
)

:: Leftovers from an isolated install, whatever the manifest claims.
:: `dir /b` rather than `if exist`, which does not match a directory wildcard
:: reliably. Errorlevel 0 means it found one, and finding one is the fault.
dir /b "node_modules\.pnpm\react-native@*" >nul 2>&1
if not errorlevel 1 set "layout_wrong=1"

:: Every delete below is a RELATIVE path, and relative to the wrong directory
:: `rd /s /q node_modules` is a different command entirely. The callers all
:: `cd /d "%~dp0..\.."` first and none of them check that it worked — and a
:: `cd` that fails in cmd prints one line and carries on, which is how a script
:: ends up recursively deleting from wherever the window happened to open.
::
:: Nothing has gone wrong here. It is one comparison against a file that only
:: exists at the root of this repo, in front of the only block in these scripts
:: that removes a directory tree, and it costs nothing to be sure.
if defined layout_wrong (
  if not exist "pnpm-workspace.yaml" (
    echo.
    echo   PROBLEM: this script is not running from the Steading folder,
    echo   so it has stopped rather than deleting anything.
    echo.
    echo   Currently in: %CD%
    echo   Copy everything in this window and send it to Claude.
    echo.
    exit /b 1
  )
)

if defined layout_wrong (
  echo   The package layout has changed - rebuilding it.
  echo   This takes a couple of minutes and only happens once.
  rd /s /q "node_modules" 2>nul
  rd /s /q "apps\mobile\node_modules" 2>nul
  rd /s /q "apps\api\node_modules" 2>nul
  rd /s /q "packages\contracts\node_modules" 2>nul
  rd /s /q "packages\core\node_modules" 2>nul
  rem The generated Android project has the old paths compiled into it, and
  rem Gradle will happily reuse them. `expo prebuild` makes it again.
  rd /s /q "apps\mobile\android" 2>nul
  rem And Metro's cache, which is the part that survived the last rebuild and
  rem produced the failure above. It stores RESOLVED ABSOLUTE PATHS, so a tree
  rem rebuilt underneath it is still asked for at the old `.pnpm` location — the
  rem app bundles, then 404s on an asset, and nothing says why.
  for /d %%D in ("%TEMP%\metro-*") do rd /s /q "%%D" 2>nul
  for /d %%D in ("%TEMP%\haste-map-*") do rd /s /q "%%D" 2>nul
)

:: The native build caches a fingerprint of every CMakeLists it configured
:: against, and a reinstall replaces those files underneath it. AGP then fails
:: mid-check rather than reconfiguring:
::
::   [bug 255965912] ... CMakeLists.txt was modified during checks for C/C++
::   configuration invalidation. Before [DELETED], after [LAST_MODIFIED_CHANGED]
::
:: The rebuild branch above already deletes `apps\mobile\android`, so it cannot
:: happen there. It happens when somebody reinstalls BY HAND — which is exactly
:: what the previous failure told them to do — and then the stale `.cxx`
:: survives into the next build and blames a file it cannot see change.
::
:: `.modules.yaml` is written by every install, so it being newer than `.cxx`
:: means the tree moved after the last native configure. That is a comparison
:: rather than a guess, and node is already required above.
:: **This was a `for /f` around a `node -e` one-liner, and it never ran once.**
:: The command went through a second `cmd /c`, so it was parsed twice, and the
:: snippet was made of exactly what does not survive that: single quotes inside
:: a single-quoted argument, double quotes inside those, and colons that a
:: mangled fragment reads as a drive letter. What a real machine printed was
::
::   The system cannot find the drive specified.
::   The system cannot find the drive specified.
::
:: twice per run, with `%%R` unset and the `do` block skipped — so the guard
:: below has been decorative on Windows since it was written, and those two
:: lines were the only sign of it.
::
:: An exit code needs no `for /f` and has nothing to quote. See
:: `scripts\windows\cxx-stale.mjs`.
if exist "apps\mobile\android\app\.cxx" (
  node "%~dp0cxx-stale.mjs"
  if errorlevel 1 (
    echo   The packages moved since the last native build - clearing its cache.
    rd /s /q "apps\mobile\android\app\.cxx" 2>nul
    rem Metro's too, for the same reason and from the same event: it stores
    rem resolved ABSOLUTE paths, so a tree replaced underneath it is still
    rem asked for where it used to be.
    for /d %%M in ("%TEMP%\metro-*") do rd /s /q "%%M" 2>nul
    for /d %%M in ("%TEMP%\haste-map-*") do rd /s /q "%%M" 2>nul
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

rem `Get-NetIPAddress` came back empty on a real machine, and the fallback for
rem that was a shrug. It cannot be one: this value is BAKED INTO THE APK, so
rem giving up leaves 10.0.2.2 in place and builds a tablet app pointed at the
rem emulator's loopback — an address that device can never reach, with nothing
rem on screen to say why.
rem
rem `ipconfig` is on every Windows there has ever been and needs no module, so
rem it is asked second.
if "%LANIP%"=="" (
  for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
    set "CANDIDATE=%%a"
    call :trim_ip
    if not defined LANIP set "LANIP=!CANDIDATE!"
  )
)

rem And if the computer still will not say, ask. A number somebody reads off
rem their own router beats a build that is silently pointed at nothing.
if "%LANIP%"=="" (
  echo.
  echo   This computer will not say what its address is on your wifi.
  echo.
  echo   Find it: press the Windows key, type "cmd", press Enter, then
  echo   type   ipconfig   and look for "IPv4 Address" - it usually
  echo   starts 192.168. or 10.
  echo.
  set /p "LANIP=Type it here and press Enter (or press Enter to skip): "
)

if "%LANIP%"=="" (
  echo.
  echo   Carrying on without it. The app will open and will save
  echo   everything you log - it just will not sync, and the address
  echo   is compiled in, so fixing it later means building again.
  echo.
  exit /b 0
)

powershell -NoProfile -Command "(Get-Content 'apps\mobile\.env') -replace 'EXPO_PUBLIC_API_URL=.*', 'EXPO_PUBLIC_API_URL=http://%LANIP%:3001' | Set-Content 'apps\mobile\.env'"
echo   Server address - set to %LANIP%.
exit /b 0

:trim_ip
rem `ipconfig` indents its values, and a leading space in an address is a URL
rem nothing will parse. Called rather than inlined because a for-loop body is
rem the one place delayed expansion makes this awkward to do in place.
for /f "tokens=* delims= " %%v in ("!CANDIDATE!") do set "CANDIDATE=%%v"
if "!CANDIDATE:~0,4!"=="127." set "CANDIDATE="
if "!CANDIDATE:~0,8!"=="169.254." set "CANDIDATE="
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
