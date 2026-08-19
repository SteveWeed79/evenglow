#!/usr/bin/env bash
#
# Fails when the last backup is too old.
#
#   sudo /opt/homefarm/scripts/deploy/check-backup.sh
#
# ## Why a script that exists to fail
#
# `backup-mongo.sh` was good work with nothing scheduling it, and a backup
# nobody is told about is not a backup — a farm's only off-box copy depended on
# somebody remembering to type a command, with nothing that noticed when they
# stopped. The timer beside this fixes the first half. This is the second: an
# absence has to be *reported*, and a backup that silently stops is exactly the
# shape of failure that goes unnoticed until the day it matters.
#
# There is no mail sender on this box and no monitoring agent, so the reachable
# channel is systemd's own. A oneshot unit that exits non-zero puts the machine
# into `systemctl --failed`, which is the one place an operator already looks
# and the one thing any future monitoring will already be watching. That is a
# different level of visibility from a line in a journal nobody opens.
#
#   systemctl --failed
#   systemctl status homefarm-backup-check
#   journalctl -u homefarm-backup -n 50
#
# Reading the marker rather than the bucket is deliberate. `backup-mongo.sh`
# writes it only after reading the object back out of S3, so its timestamp
# already means "a backup exists off this box" — and asking S3 here would need
# credentials in a second place and would turn an AWS outage into a false alarm
# about a backup that is fine.
set -euo pipefail

MARKER="${HOMEFARM_BACKUP_MARKER:-/var/lib/homefarm/.last-backup}"

# Thirty-six hours, for a nightly backup. Twenty-four would fire on any run that
# started late — a reboot, a long dump, the timer's own randomised delay — and a
# check that cries wolf is a check somebody disables. Thirty-six means one
# missed night is reported and a merely slow one is not.
MAX_AGE_HOURS="${HOMEFARM_BACKUP_MAX_AGE_HOURS:-36}"

if [ ! -f "$MARKER" ]; then
  printf 'No backup has ever completed on this box.\n\n' >&2
  printf 'Either the timer is not enabled:\n\n' >&2
  printf '    sudo systemctl enable --now homefarm-backup.timer\n\n' >&2
  printf 'or every run so far has failed:\n\n' >&2
  printf '    journalctl -u homefarm-backup -n 50\n\n' >&2
  exit 1
fi

LAST="$(cat "$MARKER" 2>/dev/null || echo 0)"
case "$LAST" in
  ''|*[!0-9]*)
    printf 'The backup marker at %s is not a timestamp. Treating that as no backup.\n' "$MARKER" >&2
    exit 1
    ;;
esac

NOW="$(date -u +%s)"
AGE_HOURS=$(( (NOW - LAST) / 3600 ))

if [ "$AGE_HOURS" -gt "$MAX_AGE_HOURS" ]; then
  printf 'The last successful backup was %s hours ago (limit %s).\n\n' "$AGE_HOURS" "$MAX_AGE_HOURS" >&2
  printf 'What it says:\n\n' >&2
  journalctl -u homefarm-backup -n 30 --no-pager >&2 || true
  printf '\nTo run one now:\n\n    sudo systemctl start homefarm-backup\n\n' >&2
  exit 1
fi

printf 'Last backup %s hours ago.\n' "$AGE_HOURS"
