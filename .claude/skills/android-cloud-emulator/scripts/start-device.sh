#!/usr/bin/env bash
# Start a Genymotion Cloud Android device and connect it to adb.
# Usage: start-device.sh "<recipe name substring>" [instance-name] [max-run-minutes]
# Example: start-device.sh "Pixel 7" my-test 60
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
QUERY="${1:?Usage: start-device.sh \"<recipe name>\" [instance-name] [max-run-minutes]}"
NAME="${2:-claude-test}"
MAXRUN="${3:-60}"   # auto-stop after N minutes as a cost safety net (0 = no timeout)

command -v gmsaas >/dev/null || { echo "gmsaas not installed -- run bootstrap.sh first."; exit 1; }

echo "Finding a recipe matching \"$QUERY\"..."
RJSON="$(gmsaas --format json recipes list --name "$QUERY" 2>&1)" || { echo "recipes list failed:"; echo "$RJSON"; exit 2; }
RUUID="$(printf '%s' "$RJSON" | python3 "$HERE/pick_uuid.py" recipe)"
[ -n "$RUUID" ] || { echo "No recipe matched \"$QUERY\". See choices with:  gmsaas recipes list"; exit 2; }
echo "Recipe UUID: $RUUID"

echo "Starting instance \"$NAME\" (auto-stop after ${MAXRUN} min)..."
SJSON="$(gmsaas --format json instances start --max-run-duration "$MAXRUN" "$RUUID" "$NAME" 2>&1)" || { echo "start failed:"; echo "$SJSON"; exit 3; }
IUUID="$(printf '%s' "$SJSON" | python3 "$HERE/pick_uuid.py" instance)"
[ -n "$IUUID" ] || { echo "Could not read instance UUID. Raw output:"; echo "$SJSON"; exit 3; }
echo "Instance UUID: $IUUID"

echo "Connecting to adb..."
gmsaas instances adbconnect "$IUUID" >/dev/null 2>&1 || true
sleep 2
echo "--- adb devices ---"
adb devices
echo
echo "READY. Instance UUID: $IUUID"
echo "Stop it when finished to avoid charges:  scripts/stop-device.sh $IUUID"
