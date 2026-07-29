---
name: android-cloud-emulator
description: >
  This skill should be used when the user wants to run, test, or drive an Android
  app on a CLOUD emulator (no local emulator or hardware virtualization needed) —
  specifically a Genymotion Cloud device controlled over adb. Trigger on requests
  like "test my app on a cloud Android device", "spin up a Genymotion cloud
  emulator", "run this APK in the cloud and click through it", "I don't want to
  install an emulator locally", "drive a cloud Android device", "screenshot the
  app on a remote device", or Android QA where the device should live in the
  cloud. Uses the gmsaas CLI for the device lifecycle and adb for interaction.
metadata:
  version: "0.1.0"
---

# Android Cloud Emulator (Genymotion Cloud)

Drive a real Android device that runs in **Genymotion's cloud**, controlled from
this machine over `adb`. The heavy emulator VM runs on Genymotion's accelerated
infrastructure — this machine only needs two lightweight CLIs (`adb` and
`gmsaas`) plus an internet connection. No local Android SDK emulator, system
image, or hardware virtualization required.

Two layers:
- **`gmsaas`** — the Genymotion Cloud CLI. Manages the device lifecycle: list
  device templates (recipes), start an instance, connect it to adb, stop it.
- **`adb`** — once an instance is adb-connected, drive it exactly like any device:
  install APKs, tap, type, screenshot, read logcat, run instrumentation tests.

Helper scripts live in `scripts/`; detailed command references are in
`references/` (`setup.md`, `gmsaas.md`, `adb-recipes.md`).

## Critical rules

**Never handle the user's API token.** The Genymotion API token is a secret. Do
NOT ask the user to paste it into the chat, and do NOT run
`gmsaas auth token <value>` with a value they gave you. Authentication is the
user's own step: they set the `GENYMOTION_API_TOKEN` environment variable, or run
`gmsaas auth token` themselves. Confirm auth succeeded with `gmsaas doctor` —
never by inspecting the token.

**Cloud instances cost money while running.** Genymotion Cloud bills for running
instances. Always stop an instance when finished, and prefer a
`--max-run-duration` safety timeout when starting one. Tell the user when an
instance is up and remind them it is billing until stopped.

## One-time setup

Run once per machine (see `references/setup.md` for per-OS detail and the manual
equivalents):

1. Install the CLIs and point gmsaas at adb: `bash scripts/bootstrap.sh`
   (installs `adb` + `gmsaas`, configures `android-sdk-path`).
2. Ask the user to authenticate (their step): create a token at
   https://cloud.geny.io/api, then either `export GENYMOTION_API_TOKEN=<token>`
   or `gmsaas auth token <token>`.
3. Verify: `gmsaas doctor` should report no issues. `bash scripts/status.sh`
   gives doctor + running instances + adb devices at a glance.

If `gmsaas doctor` reports "Authentication failed", the token is not set — this
is the user's step; do not work around it. If it reports "Android SDK not
configured", re-run the bootstrap script.

## Start a cloud device

1. Pick a device template (recipe). Browse with `gmsaas recipes list` or filter:
   `gmsaas recipes list --name "Pixel 7"`.
2. Start it and connect adb in one step:
   `bash scripts/start-device.sh "Pixel 7" claude-test 60`
   (recipe-name substring, an instance name, and an auto-stop timeout in
   minutes). The script prints the instance UUID and runs `adb devices`.
3. Note the adb serial that appears (e.g. `localhost:5555`) and the instance
   UUID. Pass the serial to adb commands when more than one device is connected.

Manual equivalent (any OS) is in `references/gmsaas.md`: `recipes list` →
`instances start <recipe> <name>` → `instances adbconnect <instance>`.

## Drive the app

Once the device shows up in `adb devices`, it behaves like any Android device.
Use the recipes in `references/adb-recipes.md`:

- Install and launch: `adb install -r -g <app.apk>` then
  `adb shell monkey -p <package> -c android.intent.category.LAUNCHER 1`.
- Look before you act: dump the UI with
  `adb exec-out uiautomator dump /dev/tty` (or `adb shell uiautomator dump` then
  cat the file) to find elements and their bounds; take a screenshot with
  `adb exec-out screencap -p > shot.png`. Compute a tap point from an element's
  `bounds` center rather than guessing pixels.
- Act: `adb shell input tap X Y`, `adb shell input swipe ...`,
  `adb shell input text 'hello'`, `adb shell input keyevent KEYCODE_ENTER`.
- Verify: screenshot or re-dump to confirm the expected screen, and deliver the
  screenshot to the user at meaningful checkpoints.
- Diagnose: `adb logcat -d -b crash` for crashes; `adb logcat -d -t 200 *:E` for
  recent errors; filter to the app with `--pid $(adb shell pidof -s <package>)`.
- Test: `adb shell am instrument -w <package>.test/androidx.test.runner.AndroidJUnitRunner`.

Always pass `-s <serial>` to adb when multiple devices are connected.

## Stop when done (important)

Stop the instance as soon as testing is finished, to end billing:

- `bash scripts/stop-device.sh <instance-uuid>` — or
- `bash scripts/stop-device.sh all` — stop every running instance.

Confirm nothing is left running with `gmsaas instances list`.

## Where this can run

This skill works wherever `adb` + `gmsaas` can be installed and can reach
Genymotion's API (`*.geny.io` on 443): a local machine, a CI box, or a cloud
Claude session. The emulator itself always runs in Genymotion's cloud, so the
host does NOT need virtualization. On Windows, run the documented commands
directly (the `.sh` helpers assume a POSIX shell — see `references/setup.md`).

## Working style

- Confirm setup with `gmsaas doctor` before trying to start a device; if auth is
  missing, hand that step back to the user rather than retrying.
- Surface cost: announce when an instance starts and always stop it when done.
- Do not narrate every adb call; screenshot at checkpoints and summarize.
- If a helper script errors, fall back to the explicit commands in
  `references/gmsaas.md` and parse the output directly.
