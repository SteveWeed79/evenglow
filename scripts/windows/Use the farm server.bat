@echo off
setlocal enabledelayedexpansion
title Steading - use the farm server
cd /d "%~dp0..\.."

echo.
echo   ============================================
echo     STEADING - point the app at the farm server
echo   ============================================
echo.
echo   For testing the whole thing end to end - the app on a
echo   device, talking to the real server on the internet,
echo   rather than to this computer.
echo.
echo   After this, "Run on phone" and "Run on emulator" build
echo   against the farm server and leave the address alone.
echo   Double-click "Use my own computer" to go back.
echo.

rem Written because there was no way to do this at all. `eas.json` sends the
rem preview-farm and production profiles at the deployed server, so a cloud
rem build reaches it - but every run script in this folder rewrites the address
rem to something LOCAL on each run. That is right for what they were written
rem for and it meant "does it work end to end" could only be answered by a full
rem EAS build: ten minutes, and no Metro reload.
rem
rem The address is read from eas.json rather than written down here, so there is
rem one place it lives and not two.

call "%~dp0_shared.bat" :check_node
if errorlevel 1 goto :failed

rem Every other script in this folder pulls before it acts, for the reason
rem :update_code gives - a fix has to reach this machine somehow, and the
rem alternative is a screenshot of a bug that was corrected days ago. These two
rem were the exception, which meant the address they write could be stale in a
rem way nothing on screen would show.
call "%~dp0_shared.bat" :update_code

call "%~dp0_shared.bat" :ensure_env
if errorlevel 1 goto :failed

node "%~dp0api-origin.mjs" use-farm
if errorlevel 1 (
  echo.
  echo   PROBLEM: could not find the farm server's address.
  echo.
  echo   It comes from the preview-farm profile in
  echo   apps\mobile\eas.json. If that still says REPLACE-ME,
  echo   the server has not been deployed yet - see
  echo   docs\DEPLOY-THE-SERVER.md.
  echo.
  goto :failed
)

echo.
echo   ============================================
echo     DONE
echo   ============================================
echo.
echo   The next build will talk to the farm server.
echo.
echo   IMPORTANT: the address is compiled INTO the app, so the
echo   change only reaches a device on the next build. Run
echo   "Run on phone" now.
echo.
echo   Two devices only share a farm if they were built against
echo   the SAME server. A tablet pointed at this computer and a
echo   phone pointed at the farm server are two separate farms,
echo   whatever account you sign into.
echo.
pause
exit /b 0

:failed
echo.
pause
exit /b 1
