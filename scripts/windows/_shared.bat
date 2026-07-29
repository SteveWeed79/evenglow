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
