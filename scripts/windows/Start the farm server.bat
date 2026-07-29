@echo off
setlocal enabledelayedexpansion
title Steading - farm server
cd /d "%~dp0..\.."

echo.
echo   ============================================
echo     STEADING - start the farm server
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

echo   Getting everything ready. The first time this
echo   takes a few minutes.
echo.
call pnpm install
if errorlevel 1 (
  echo.
  echo   That did not work. Copy everything above and send it to Claude.
  goto :failed
)

call pnpm farm

echo.
echo   The farm server has stopped.
pause
exit /b 0

:failed
echo.
pause
exit /b 1
