#!/usr/bin/env bash
#
# A new version onto a box that is already set up.
#
#   sudo /opt/steading/scripts/deploy/deploy.sh
#
# Pull, install, restart, check. Four steps, and the fourth is the one that
# matters: it verifies the service is actually answering afterwards rather than
# assuming a restart that returned 0 means a server that works.
#
# `setup-box.sh` is the first run. This is every run after it — by hand, or
# every five minutes from `steading-deploy.timer`, which is the same command
# either way so there is nothing that only happens in one of them.

set -euo pipefail

REPO_DIR="${STEADING_DIR:-/opt/steading}"
SERVICE_USER="steading"
PORT="${PORT:-3001}"

# ── Which ref this box follows ──────────────────────────────────────────────
#
# `release`, not `main`. CI pushes that branch only after `verify` goes green
# (see .github/workflows/ci.yml), so a red build cannot reach a farm during the
# minutes between a bad merge and somebody noticing.
#
# Override it in /etc/steading/deploy.env to point a box at `dev` or at a
# branch under test. That file is also where the timer reads its settings, so
# there is one place to look rather than an argument somebody has to remember.
[ -f /etc/steading/deploy.env ] && . /etc/steading/deploy.env
REF="${STEADING_REF:-release}"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }
die() { printf '\n\033[1;31mSTOPPED:\033[0m %s\n\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run this with sudo."
[ -d "$REPO_DIR/.git" ] || die "No checkout at $REPO_DIR."

cd "$REPO_DIR"

# What is running now, so the rollback below has somewhere to go back to.
WAS="$(git rev-parse --short HEAD)"

say "Fetching ($REF)"
git fetch --quiet origin "$REF" || die "Could not fetch '$REF' from origin.
  If this box has never seen that branch, check the name. CI creates 'release'
  on the first green run on main."
# --ff-only refuses to invent a merge. A box that has diverged — somebody
# edited a file in place at 6am to fix something — stops here and says so
# rather than resolving it silently into a tree nobody can reason about. The
# same rule the Windows scripts use, for the same reason.
git merge --ff-only FETCH_HEAD || die "This box has changes of its own, or has diverged from $REF.
  Look at 'git status' here before going further. Nothing has been changed."

NOW="$(git rev-parse --short HEAD)"
if [ "$WAS" = "$NOW" ]; then
  note "already on $NOW — nothing to deploy"
else
  note "$WAS -> $NOW"
fi

say "Dependencies"
corepack pnpm install --frozen-lockfile --filter "@steading/api..."
chown -R "$SERVICE_USER:$SERVICE_USER" "$REPO_DIR"

say "Restarting"
systemctl restart steading-api

# ── the part that is not optional ───────────────────────────────────────────
#
# `systemctl restart` returns as soon as the process is spawned, not when it is
# serving — and the two failures most likely here (a bad MONGODB_URI, a syntax
# error in something that only loads at boot) both take a second or two to
# surface. Without this check a deploy that killed the server reports success.
say "Checking it came back"
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS --max-time 3 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    note "answering on :${PORT} after ${attempt}s"
    printf '\n\033[1mDeployed: %s\033[0m\n\n' "$NOW"
    exit 0
  fi
  sleep 1
done

# Rolling back automatically would be worse than stopping: the new code may be
# fine and the database unreachable, in which case reverting fixes nothing and
# hides which of the two it was.
printf '\n\033[1;31mThe service did not come back.\033[0m\n\n'
printf 'It is on %s. The previous version was %s.\n\n' "$NOW" "$WAS"
printf 'What it says:\n\n'
journalctl -u steading-api -n 30 --no-pager
printf '\nTo go back:\n\n    cd %s && sudo git checkout %s && sudo systemctl restart steading-api\n\n' "$REPO_DIR" "$WAS"
exit 1
