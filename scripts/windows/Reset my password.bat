@echo off
setlocal enabledelayedexpansion
title Steading - reset my password
cd /d "%~dp0..\.."

echo.
echo   ============================================
echo     STEADING - set a new password
echo   ============================================
echo.
echo   Use this when the app says your email or
echo   password is wrong and you know it is right.
echo.
echo   CLOSE the farm server window first, then run
echo   this. It starts the server again when it is
echo   finished, so you can leave THIS window open
echo   and carry on.
echo.
pause

call "%~dp0_shared.bat" :check_node
if errorlevel 1 goto :failed

call "%~dp0_shared.bat" :check_pnpm
if errorlevel 1 goto :failed

call pnpm farm --new-password

echo.
echo   The farm server has stopped.
pause
exit /b 0

:failed
echo.
pause
exit /b 1
