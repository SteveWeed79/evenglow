@echo off
setlocal enabledelayedexpansion
title Evenglow - farm server
cd /d "%~dp0..\.."

echo.
echo   ============================================
echo     EVENGLOW - start the farm server
echo   ============================================
echo.
echo   The app needs this running before you can
echo   sign in. Leave this window open while you
echo   use the app, and open the run script in a
echo   SECOND window.
echo.

call "%~dp0_shared.bat" :check_node
if errorlevel 1 goto :failed

call "%~dp0_shared.bat" :check_pnpm
if errorlevel 1 goto :failed

call "%~dp0_shared.bat" :update_code

call "%~dp0_shared.bat" :ensure_packages
if errorlevel 1 goto :failed

:: Installed in the preflight above. A second install here printed
:: `Packages: -72` on a clean checkout - see the note in Run on emulator.

call pnpm farm

echo.
echo   The farm server has stopped.
pause
exit /b 0

:failed
echo.
pause
exit /b 1
