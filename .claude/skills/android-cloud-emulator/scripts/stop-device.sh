#!/usr/bin/env bash
# Stop a Genymotion Cloud device (or all running instances).
# Usage: stop-device.sh <instance-uuid|all>
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-all}"

command -v gmsaas >/dev/null || { echo "gmsaas not installed."; exit 1; }

if [ "$TARGET" = "all" ]; then
  echo "Stopping ALL running instances..."
  IDS="$(gmsaas --format json instances list 2>/dev/null | python3 "$HERE/pick_uuid.py" all-instances)"
  if [ -z "$IDS" ]; then echo "No running instances."; exit 0; fi
  for id in $IDS; do
    echo "  stopping $id"
    gmsaas instances adbdisconnect "$id" >/dev/null 2>&1 || true
    gmsaas instances stop "$id" >/dev/null 2>&1 || true
  done
  echo "Done. Verify with: gmsaas instances list"
else
  gmsaas instances adbdisconnect "$TARGET" >/dev/null 2>&1 || true
  gmsaas instances stop "$TARGET"
  echo "Stopped $TARGET."
fi
