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

call "%~dp0_shared.bat" :clear_stale_metro

call "%~dp0_shared.bat" :ensure_packages
if errorlevel 1 goto :failed

call "%~dp0_shared.bat" :ensure_env
if errorlevel 1 goto :failed

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

::
:: A real device beats a running emulator, and this window has to say which.
::
:: Anybody testing on a tablet has probably had the emulator open all morning,
:: so `adb devices` lists both. Taking the first would install the app to the
:: emulator from a window called "Run on phone" - and it would look like it
:: worked, because something did start, just not on the thing in your hand.
::
:: Emulator serials are `emulator-5554`; a USB device's is its own. So the
:: emulator is only used when nothing else is attached, and the chosen serial
:: is passed to the build rather than left to be resolved again.
set "PHONE="
set "FALLBACK="
set "WAITING="
for /f "skip=1 tokens=1,2" %%D in ('adb devices') do (
  if "%%E"=="device" (
    echo %%D | findstr /b /c:"emulator-" >nul
    if errorlevel 1 (
      if not defined PHONE set "PHONE=%%D"
    ) else (
      if not defined FALLBACK set "FALLBACK=%%D"
    )
  )
  rem Plugged in and not yet trusted. The single most common first-time state,
  rem and it looks identical to "nothing connected" unless it is named.
  if "%%E"=="unauthorized" set "WAITING=%%D"
)

rem An emulator is NOT a fallback for this window, and offering it as one was
rem a mistake made and caught within the hour. Building for the emulator from a
rem window called "Run on phone" is the same fault as the QR: it does something
rem adjacent to what was asked, it looks like it worked, and the tablet in your
rem hand is untouched. "Run on emulator" is one double-click away and says so
rem in its name.
if not defined PHONE if defined FALLBACK (
  echo.
  echo   PROBLEM: the emulator is running, but no phone or tablet
  echo   is visible to this computer.
  echo.
  echo   This window only installs to a real device. To use the
  echo   emulator, close this and open "Run on emulator".
  echo.
  goto :nodevice
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

if not defined PHONE goto :nodevice

goto :found

rem Reported as "my tablet is attached" with `adb devices` listing only the
rem emulator — so the cable was in and Windows was not presenting the device at
rem all. Not even as `unauthorized`, which is what a trust prompt looks like.
rem Four causes, in the order they actually happen, because "turn on USB
rem debugging" is the advice everybody has already followed by the time they
rem are reading this.
:nodevice
echo.
echo   The computer cannot see a phone or tablet. In order of
echo   how often each one is the answer:
echo.
echo   1. THE CABLE. Many are charge-only and look identical to
echo      a data one. Try a different cable before anything else.
echo.
echo   2. THE USB MODE. Unlock the tablet, swipe down, find the
echo      "Charging this device via USB" notification and change
echo      it to "File transfer". On "No data transfer" the tablet
echo      is invisible to this computer no matter what else is on.
echo.
echo   3. USB DEBUGGING. Settings ^> About ^> tap "Build number"
echo      seven times, then Settings ^> Developer options ^>
echo      USB debugging. If a prompt appears on the tablet asking
echo      to allow this computer, tap ALLOW.
echo.
echo   4. THE WINDOWS DRIVER. Open Device Manager and look for a
echo      device with a warning triangle, or an "Other device".
echo      Android Studio ^> SDK Manager ^> "SDK Tools" tab ^>
echo      tick "Google USB Driver", then unplug and replug.
echo.
echo   After any of those, run this window again.
echo.
goto :failed

:found

echo   Connected: !PHONE!

rem Addressed AFTER the device is known, which it could not be before: the
rem tethered route needs a serial to reverse a port onto. It used to run in the
rem preflight, where the only answer available was a guess about the wifi.
call "%~dp0_shared.bat" :keep_chosen_address
if errorlevel 1 call "%~dp0_shared.bat" :set_usb_address !PHONE!

set "NEEDBUILD="
adb -s !PHONE! shell pm list packages 2>nul | findstr /c:"com.steading.app" >nul
if errorlevel 1 set "NEEDBUILD=1"

rem Checked out here rather than inside the branch below, because `goto` out of
rem a parenthesised block is the kind of thing that works until it does not.
if defined NEEDBUILD goto :build
goto :connect

:build
rem The app is COMPILED by this window now, which it never used to be — it only
rem ever started Metro and handed over a QR. So it needs the two things the
rem emulator window has always set up before a build, and neither came across
rem with the install step:
rem
rem   SDK location not found. Define a valid SDK location with an ANDROID_HOME
rem   environment variable ...
rem
rem Gradle finds the SDK through ANDROID_HOME; `:check_adb` above already
rem proved the path exists. Java is Gradle's own requirement.
call "%~dp0_shared.bat" :check_java
if errorlevel 1 goto :failed

if exist "%LOCALAPPDATA%\Android\Sdk" set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"

if 1==1 (
  echo.
  echo   Steading is not on this device yet, so it is being built
  echo   and installed now. This takes several minutes the first
  echo   time and is quick afterwards.
  echo.
  echo   It installs as its OWN app, not inside Expo Go. Expo Go is
  echo   one shared sandbox that wipes itself when it updates, and
  echo   it took a farm's records with it twice.
  echo.
  rem `expo run:android --device` wants the device's NAME, not its serial.
  rem
  rem Passing the serial produced `CommandError: Could not find device with
  rem name: 98780005E5AA274` — `resolveFromNameAsync` matches strictly on
  rem `device.name`, and for a physical device Expo builds that from the
  rem `model:` field of `adb devices -l`. The serial is what adb wants and the
  rem model is what Expo wants, and they are never the same string.
  rem
  rem So the model is read for the serial already chosen. If it cannot be read,
  rem `--device` is left off entirely rather than guessed: with one device
  rem attached Expo picks the right thing anyway, and a wrong name is a hard
  rem stop where no name is a sensible default.
  set "MODEL="
  for /f "usebackq tokens=*" %%L in (`adb devices -l ^| findstr /b /c:"!PHONE!"`) do (
    for %%T in (%%L) do (
      echo %%T | findstr /b /c:"model:" >nul
      if not errorlevel 1 set "MODEL=%%T"
    )
  )
  if defined MODEL set "MODEL=!MODEL:model:=!"

  rem `--no-install` because the preflight above already ran `pnpm install`.
  rem Left alone, `expo run:android` runs its own from apps/mobile.
  if defined MODEL (
    echo   Building for !MODEL! ^(!PHONE!^).
    echo.
    call pnpm mobile:android --no-install --device !MODEL!
  ) else (
    echo   Building for the attached device.
    echo.
    call pnpm mobile:android --no-install
  )
  goto :stopped
)

:connect
echo.
rem  Metro down the cable as well
rem
rem The app fetches its JavaScript from Metro on 8081, and until now that was
rem the ONE part of this loop still going over wifi - the QR code carried this
rem computer's LAN address. So a tablet on another network, or a Windows
rem Firewall prompt dismissed months ago, produced "failed to load" with
rem nothing on screen connecting it to either cause.
rem
rem `adb reverse` makes the DEVICE's own localhost reach this computer back
rem down the USB cable - what :set_usb_address already does for the farm server,
rem and what the comment there says React Native has always done for Metro.
rem Nothing in this repo actually did it.
rem
rem With the reverse in place, --host localhost puts localhost:8081 in the QR
rem instead of a LAN address, so the phone resolves it over the cable. No wifi,
rem no firewall rule, no "are you both on the same network".
call "%~dp0_shared.bat" :free_metro_port

set "USB_METRO="
adb -s !PHONE! reverse tcp:8081 tcp:8081 >nul 2>&1
if not errorlevel 1 set "USB_METRO=1"

echo   [2 of 2] Starting the app.
echo.
if defined USB_METRO (
  echo   Metro - down the USB cable, same as everything else.
) else (
  echo   Metro - over wifi, because the USB route could not be opened.
  echo   The phone and this computer have to be on the same network,
  echo   and Windows Firewall has to allow port 8081.
)
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

if defined USB_METRO (
  call pnpm mobile:usb
) else (
  call pnpm mobile
)

:stopped

echo.
echo   The app server has stopped.
pause
exit /b 0

:failed
echo.
pause
exit /b 1
