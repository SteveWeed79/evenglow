# adb interaction recipes

Once a cloud instance is connected (`gmsaas instances adbconnect ...` → it shows
in `adb devices`), drive it with ordinary adb. When more than one device is
connected, add `-s <serial>` to every command (serial from `adb devices`).

## Install, launch, inspect app

```
adb install -r -g app-debug.apk                 # reinstall, grant runtime perms
adb shell pm list packages -3                    # list third-party (your) apps
adb shell monkey -p <package> -c android.intent.category.LAUNCHER 1   # launch
adb shell am start -n <package>/<activity>       # launch a specific activity
adb shell am force-stop <package>                # stop the app
adb shell pm clear <package>                     # reset app to first-launch state
adb uninstall <package>
```

Find the app's package name from its `build.gradle` (`applicationId`) or by
diffing `pm list packages -3` before/after install.

## See the screen

```
adb exec-out screencap -p > shot.png             # screenshot (PNG on stdout)
```

Dump the UI hierarchy to find elements and their positions:

```
adb shell uiautomator dump                       # writes /sdcard/window_dump.xml
adb exec-out cat /sdcard/window_dump.xml         # read it back (XML)
```

Each `<node>` has `text`, `resource-id`, `content-desc`, `clickable`, and
`bounds="[x1,y1][x2,y2]"`. Tap the CENTER of the bounds:
`x=(x1+x2)/2, y=(y1+y2)/2`. Prefer targeting by resource-id/text over guessing
pixels.

## Act

```
adb shell input tap <x> <y>
adb shell input swipe <x1> <y1> <x2> <y2> [duration_ms]      # scroll = swipe
adb shell input text 'hello'                                 # spaces: use %s, e.g. hello%sworld
adb shell input keyevent KEYCODE_ENTER                       # or BACK, HOME, TAB, APP_SWITCH, DEL...
```

Common keycodes: BACK=4, HOME=3, ENTER=66, TAB=61, DEL=67, APP_SWITCH=187,
DPAD_UP/DOWN/LEFT/RIGHT=19/20/21/22.

## Diagnose

```
adb logcat -d -b crash                           # crash dumps / stack traces
adb logcat -d -t 200 *:E                          # last 200 error-level lines
adb logcat -d --pid $(adb shell pidof -s <package>) -t 300    # only this app
adb logcat -c                                     # clear buffer before a test run
```

## Automated tests

```
adb shell am instrument -w -r <package>.test/androidx.test.runner.AndroidJUnitRunner
adb shell am instrument -w -e class <Class>#<method> <package>.test/androidx.test.runner.AndroidJUnitRunner
```

## Handy shell recipes

```
# Deterministic UI tests: disable animations
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0

# Deep link
adb shell am start -a android.intent.action.VIEW -d "myapp://path" <package>

# Permissions
adb shell pm grant <package> android.permission.CAMERA
adb shell pm revoke <package> android.permission.ACCESS_FINE_LOCATION

# Push/pull test data
adb push local.json /sdcard/Download/
adb pull /sdcard/Download/out.json ./out.json

# Screen size / density (to interpret coordinates)
adb shell wm size ; adb shell wm density
```

## Files/data on the cloud device

The device lives in Genymotion's cloud, so `adb push`/`pull` transfer over the
network tunnel that `adbconnect` created — same commands, just remember the
latency. `adb exec-out` (used for screenshots) streams binary safely.
