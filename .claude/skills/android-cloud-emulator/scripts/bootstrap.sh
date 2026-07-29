#!/usr/bin/env bash
# One-time-per-machine setup for the Android Cloud Emulator skill.
# Installs adb + gmsaas and points gmsaas at adb.
# It does NOT touch your Genymotion API token -- that stays with you.
set -euo pipefail

echo "[1/3] Ensuring adb is installed..."
if command -v adb >/dev/null 2>&1; then
  echo "  adb found: $(command -v adb)"
else
  if command -v apt-get >/dev/null 2>&1; then
    (sudo apt-get update -y >/dev/null 2>&1 && sudo apt-get install -y android-tools-adb) \
      || apt-get install -y android-tools-adb
  elif command -v brew >/dev/null 2>&1; then
    brew install android-platform-tools
  else
    echo "  Could not auto-install adb. Install Android platform-tools manually and re-run." >&2
    exit 1
  fi
  echo "  adb installed: $(command -v adb)"
fi

echo "[2/3] Ensuring gmsaas (Genymotion Cloud CLI) is installed..."
if command -v gmsaas >/dev/null 2>&1; then
  echo "  gmsaas found: $(gmsaas --version 2>&1 | head -1)"
else
  pip3 install gmsaas --break-system-packages 2>/dev/null \
    || pip3 install --user gmsaas 2>/dev/null \
    || pip install gmsaas
  command -v gmsaas >/dev/null 2>&1 || {
    echo "  gmsaas installed but not on PATH. Add your pip bin dir (often ~/.local/bin) to PATH." >&2
    exit 1
  }
  echo "  gmsaas installed: $(gmsaas --version 2>&1 | head -1)"
fi

echo "[3/3] Pointing gmsaas at adb..."
SDK=""
for c in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}"; do
  if [ -n "$c" ] && { [ -x "$c/platform-tools/adb" ] || [ -f "$c/platform-tools/adb.exe" ]; }; then
    SDK="$c"; break
  fi
done
if [ -z "$SDK" ]; then
  SDK="$HOME/.android-cloud-sdk"
  mkdir -p "$SDK/platform-tools"
  ln -sf "$(command -v adb)" "$SDK/platform-tools/adb"
fi
gmsaas config set android-sdk-path "$SDK"
echo "  android-sdk-path = $SDK"

echo
echo "Setup complete. Final step is YOURS (keeps your token private):"
echo "  1) Create an API token at https://cloud.geny.io/api"
echo "  2) export GENYMOTION_API_TOKEN=<your-token>"
echo "     (or run:  gmsaas auth token <your-token>)"
echo "Then verify everything is green:"
echo "  gmsaas doctor"
