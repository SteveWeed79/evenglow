@echo off
setlocal enabledelayedexpansion
title Evenglow - catch a crash
cd /d "%~dp0..\.."

echo.
echo   ============================================
echo     EVENGLOW - catch a crash
echo   ============================================
echo.
echo   For when the app closes itself, restarts, or loses
echo   something it should have kept.
echo.
echo   This window watches what Android says while it happens,
echo   and writes it to a file you can send to Claude. It only
echo   reads - nothing here changes the app or the tablet.
echo.

rem Written because the alternative was handing somebody two `adb` commands to
rem type, and `adb` is not on the PATH - which is the whole reason every script
rem in this folder has to go and find it. A diagnostic nobody can run is not a
rem diagnostic.

call "%~dp0_shared.bat" :check_adb
if errorlevel 1 goto :failed

rem Same preference as "Run on phone": a real device beats a running emulator,
rem because the crash being chased is on the thing in your hand.
set "PHONE="
set "FALLBACK="
for /f "skip=1 tokens=1,2" %%D in ('adb devices') do (
  if "%%E"=="device" (
    echo %%D | findstr /b /c:"emulator-" >nul
    if errorlevel 1 (
      if not defined PHONE set "PHONE=%%D"
    ) else (
      if not defined FALLBACK set "FALLBACK=%%D"
    )
  )
)
if not defined PHONE if defined FALLBACK set "PHONE=!FALLBACK!"

if not defined PHONE (
  echo.
  echo   PROBLEM: nothing is connected.
  echo.
  echo   Plug the phone or tablet in with a USB cable. If it is
  echo   already plugged in, "Check my setup" says which of the
  echo   usual four causes it is.
  echo.
  goto :failed
)

echo   Watching: !PHONE!
echo.

rem Cleared first, so what comes back is about the thing that just happened
rem rather than about everything since the tablet was switched on.
adb -s !PHONE! logcat -c >nul 2>&1

echo   ============================================
echo     NOW GO AND MAKE IT HAPPEN
echo   ============================================
echo.
echo   On the tablet, do the thing that goes wrong - take the
echo   photo, or whatever it was. Wait for the app to come back.
echo.
echo   Then come back here and press any key.
echo.
pause

set "REPORT=%TEMP%\homefarm-crash.txt"

echo. > "%REPORT%"
echo === Evenglow crash report === >> "%REPORT%"
echo Device: !PHONE! >> "%REPORT%"
echo. >> "%REPORT%"

rem Three buffers, because they answer three different questions and the app
rem dying looks like nothing at all in the wrong one.
rem
rem   crash  - a real crash, with the stack. FATAL EXCEPTION, OutOfMemoryError.
rem   main   - everything else the app said on its way down.
rem   events - the system's own account, which is where an app being KILLED
rem            for memory shows up. A kill is not a crash and leaves no stack;
rem            it is the difference between "we broke" and "Android took the
rem            memory back", and it decides which fix is the right one.
echo --- crashes --- >> "%REPORT%"
adb -s !PHONE! logcat -d -b crash >> "%REPORT%" 2>&1

echo. >> "%REPORT%"
echo --- errors --- >> "%REPORT%"
adb -s !PHONE! logcat -d -b main *:E >> "%REPORT%" 2>&1

echo. >> "%REPORT%"
echo --- what the system did about it --- >> "%REPORT%"
adb -s !PHONE! logcat -d -b events >> "%REPORT%" 2>&1

echo.
echo   ============================================
echo     WHAT IT FOUND
echo   ============================================
echo.

rem The short answer on screen, so nobody has to read the file to know whether
rem there is anything in it.
set "FOUND="
findstr /i /c:"FATAL EXCEPTION" /c:"OutOfMemoryError" "%REPORT%" >nul 2>&1
if not errorlevel 1 (
  echo   The app CRASHED. There is a stack trace in the file.
  set "FOUND=1"
)

findstr /i /c:"am_kill" /c:"lowmemorykiller" /c:"am_proc_died" "%REPORT%" >nul 2>&1
if not errorlevel 1 (
  echo   Android KILLED the app - it did not crash. Usually the
  echo   camera needing the memory the app was holding.
  set "FOUND=1"
)

if not defined FOUND (
  echo   Nothing obvious. The file still has everything, and the
  echo   absence is itself worth knowing.
)

echo.
echo   Written to:
echo     %REPORT%
echo.
echo   TO SEND IT: press any key and it opens in Notepad. Then
echo   Ctrl+A, Ctrl+C, and paste it to Claude.
echo.
pause
start notepad "%REPORT%"
exit /b 0

:failed
echo.
pause
exit /b 1
