#!/usr/bin/env bash
# Show the current state of the cloud-emulator setup.
set -uo pipefail
echo "=== gmsaas doctor (auth + sdk configuration) ==="
gmsaas doctor || true
echo
echo "=== running cloud instances (these cost money while up) ==="
gmsaas instances list || true
echo
echo "=== adb devices (connected) ==="
adb devices || true
