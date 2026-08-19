@echo off
setlocal enabledelayedexpansion
title Evenglow - fix my checkout
cd /d "%~dp0..\.."

echo.
echo   ============================================
echo     EVENGLOW - fix my checkout
echo   ============================================
echo.
echo   Use this when an update refuses with
echo   "your local changes would be overwritten".
echo.
echo   WHAT THIS THROWS AWAY:
echo     - build output Android Studio left behind
echo     - leftovers from the old app that was retired
echo     - any edit to a project file you did not mean
echo       to make
echo.
echo   WHAT IT KEEPS:
echo     - your settings file ^(apps\mobile\.env^)
echo     - your farm's database ^(.homefarm-data^)
echo     - anything you have committed
echo.
echo   If you HAVE edited code on purpose and not
echo   committed it, close this window now.
echo.
pause

where git >nul 2>&1
if errorlevel 1 (
  echo.
  echo   PROBLEM: Git not found. Install GitHub Desktop.
  goto :failed
)

:: This script throws things away — `git reset --hard`, then a recursive delete
:: — and every path it uses is relative to whatever `cd /d` above landed on. A
:: `cd` that fails prints one line and lets the script carry on, so the check is
:: one comparison against a file that exists only at the root of this repo.
::
:: Nothing has gone wrong here. It is in front of the destructive step because
:: that is where a guard belongs, not because it is known to be needed.
if not exist "pnpm-workspace.yaml" (
  echo.
  echo   PROBLEM: this is not the Evenglow folder, so nothing has been
  echo   changed and nothing has been deleted.
  echo.
  echo   Currently in: %CD%
  echo   Copy everything in this window and send it to Claude.
  goto :failed
)

echo.
echo   [1 of 4] What is currently changed:
git status --short
echo.

echo   [2 of 4] Throwing away edits to tracked files...
git reset --hard HEAD
if errorlevel 1 goto :failed

echo.
echo   [3 of 4] Removing the retired app's leftovers...
:: Not in the repository any more — it was deleted when the web client was
:: retired. Gradle kept building it, and its output is what blocks the update.
:: Named explicitly rather than a blanket clean, so nothing else can go with it.
if exist "apps\app" rmdir /s /q "apps\app"
if exist "Task" del /q "Task"

echo.
echo   [4 of 4] Getting the latest code...
git pull --ff-only
if errorlevel 1 (
  echo.
  echo   The update still refused. Copy this whole window
  echo   and send it to Claude.
  goto :failed
)

echo.
for /f "tokens=*" %%v in ('git log -1 --pretty^=format:"%%h  %%s" 2^>nul') do echo   Now running: %%v

echo.
echo   Making sure the packages match...
call pnpm install
if errorlevel 1 goto :failed

echo.
echo   ============================================
echo     Done. Start the farm server as usual.
echo   ============================================
echo.
pause
exit /b 0

:failed
echo.
pause
exit /b 1
