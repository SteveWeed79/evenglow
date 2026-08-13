@echo off
setlocal enabledelayedexpansion
title Steading - build the app
cd /d "%~dp0..\.."

rem Builds an APK on Expo's machines and publishes it to the farm server, so the
rem address you give somebody never changes.
rem
rem The three machines, because it is not obvious and it decides what runs where:
rem
rem   this PC      uploads the SOURCE to Expo. It compiles nothing.
rem   Expo         compiles it and signs it with the keystore it holds.
rem   the box      serves it at /app, forever, at one address.
rem
rem The signing key staying with Expo rather than on the box is the reason for
rem that split - docs/TESTING-BUILD.md section 8.

echo.
echo   ============================================
echo     STEADING - build the app for a phone
echo   ============================================
echo.

call "%~dp0_shared.bat" :check_node        || goto :stop
call "%~dp0_shared.bat" :check_pnpm        || goto :stop
call "%~dp0_shared.bat" :update_code       || goto :stop
call "%~dp0_shared.bat" :ensure_packages   || goto :stop

echo.
echo   --- Which build is this? ---
rem The version NUMBER is Expo's to keep now. `appVersionSource: remote` plus
rem `autoIncrement` on the profile means EAS holds the counter and moves it on
rem every build, so there is nothing to edit, nothing to commit, and no way to
rem build two APKs that claim to be the same one.
rem
rem It used to live in app.json and be bumped here. That put a number in a file
rem which had to be committed in lockstep with every build, and twice it was
rem not - leaving a working tree that refused to pull and a phone carrying a
rem build whose number matched a different one.
for /f "tokens=*" %%v in ('node "scripts\windows\build-app.mjs" show') do echo   version     %%v
echo   [ OK ]      EAS assigns the build number. Nothing to commit.

echo   --- Building on Expo's machines ---
echo.
echo   Ten to twenty minutes, mostly queueing. Leave this window open.
echo   If it asks you to sign in, it is asking about your Expo account.
echo.
call pnpm --filter @steading/mobile exec eas build --profile preview-farm --platform android
if errorlevel 1 (
  echo.
  echo   [ FAILED ]  the build did not finish. The output above is from EAS
  echo               and says why - the log link in it has the detail.
  goto :stop
)

echo.
echo   --- Sending it to the farm server ---
rem The url rather than a downloaded file. The APK is already on Expo's servers,
rem so pulling it down here and pushing it up again is the same forty megabytes
rem crossing a home connection twice, up the slow half. The box fetches it once,
rem from a datacentre.
set "ARTIFACT="
for /f "tokens=*" %%u in ('node "scripts\windows\build-app.mjs" artifact') do set "ARTIFACT=%%u"

if not defined ARTIFACT (
  echo   [ NOTE ]    could not work out the download url. The build is fine -
  echo               open the build page, copy the url, and on the box run:
  echo                 sudo /opt/steading/scripts/deploy/publish-apk.sh ^<url^>
  goto :done
)

echo   Found it.
echo.
where ssh >nul 2>&1
if errorlevel 1 (
  echo   [ NOTE ]    no ssh on this PC, so this cannot finish the job. On the
  echo               box, run:
  echo.
  echo                 sudo /opt/steading/scripts/deploy/publish-apk.sh "!ARTIFACT!"
  goto :done
)

set "SEND="
set /p "SEND=  Publish it to api.swbuild.dev now? [Y/n] "
if /i "!SEND!"=="n" goto :manual

rem Quoted, because an artefact url carries a query string and an unquoted
rem ampersand ends the remote command early - which would publish nothing and
rem look like it worked.
ssh ubuntu@api.swbuild.dev "sudo /opt/steading/scripts/deploy/publish-apk.sh '!ARTIFACT!'"
if errorlevel 1 (
  echo.
  echo   [ NOTE ]    that did not go through. The build is safe on Expo -
  echo               nothing is lost. Try the command below by hand.
  goto :manual
)

echo.
echo   ============================================
echo     Done. Send this, once:
echo.
echo       https://api.swbuild.dev/app
echo.
echo     It never changes. The next build replaces
echo     what is behind it.
echo   ============================================
goto :done

:manual
echo.
echo   To publish it yourself, on the box:
echo.
echo     sudo /opt/steading/scripts/deploy/publish-apk.sh "!ARTIFACT!"
echo.
goto :done

:stop
echo.
echo   Stopped. Nothing was built.
echo.

:done
echo.
pause
