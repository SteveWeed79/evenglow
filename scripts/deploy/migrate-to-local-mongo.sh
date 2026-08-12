#!/usr/bin/env bash
#
# Atlas -> the box. Run it once, after `setup-mongo.sh`.
#
#   sudo ATLAS_URI='mongodb+srv://…' LOCAL_URI='mongodb://steading:…@127.0.0.1:27017/steading?authSource=admin' \
#     /opt/steading/scripts/deploy/migrate-to-local-mongo.sh
#
# ## Downtime is free here, and that is worth using
#
# This stops the API for the duration. On almost any other app that would be
# the hard part; on this one it costs nothing. The app is offline-first — a
# phone with no server queues its mutations and flushes them when one comes
# back, which is the ordinary path exercised every time somebody logs eggs in a
# barn with no signal. So the service is stopped for real rather than a live
# migration attempted, because a dump taken while writes are landing is a dump
# that silently misses some.
#
# ## Environment, never argv
#
# Both URIs hold passwords, and `argv` is visible in `ps` to every user on the
# box. Same rule as `backup-mongo.sh`, `db:seed` and `db:password`.

set -Eeuo pipefail
umask 077

DB_NAME="${MONGODB_DB:-steading}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }
die() { printf '\n\033[1;31mSTOPPED:\033[0m %s\n\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run this with sudo -E, so the URIs survive."
[ -n "${ATLAS_URI:-}" ] || die "ATLAS_URI is not set. It is the connection string currently in
  /etc/steading/api.env — the one the API is using right now."
[ -n "${LOCAL_URI:-}" ] || die "LOCAL_URI is not set. setup-mongo.sh printed it:
  mongodb://steading:<password>@127.0.0.1:27017/steading?authSource=admin"

command -v mongodump >/dev/null 2>&1 || die "mongodump is missing. Run setup-mongo.sh first."
command -v mongorestore >/dev/null 2>&1 || die "mongorestore is missing. Run setup-mongo.sh first."

# ── what is there now, so the check at the end has something to compare ─────
say "Reading the source"
counts() {
  mongosh --quiet "$1" --eval '
    db.getCollectionNames().sort().forEach(function (name) {
      print(name + " " + db.getCollection(name).countDocuments({}));
    });
  ' 2>/dev/null
}

counts "$ATLAS_URI" > "$WORK/before.txt" || die "Could not read from Atlas. Check ATLAS_URI, and
  check that this box's public address is on Atlas -> Network Access."
[ -s "$WORK/before.txt" ] || die "Atlas returned no collections at all. That is either the wrong
  URI or the wrong database name, and either way this is not the moment to guess."
note "$(wc -l < "$WORK/before.txt") collections"
sed 's/^/     /' "$WORK/before.txt"

# ── stop writing ────────────────────────────────────────────────────────────
say "Stopping the API"
if systemctl is-active --quiet steading-api; then
  systemctl stop steading-api
  note "stopped — phones will queue, which is the normal offline path"
  RESTART=1
else
  note "was not running"
  RESTART=0
fi

# ── dump, restore ───────────────────────────────────────────────────────────
say "Dumping from Atlas"
# --gzip because this crosses the internet; the photo bytes in GridFS dominate
# and they compress poorly, but records do not.
mongodump --uri="$ATLAS_URI" --db="$DB_NAME" --gzip --archive="$WORK/dump.gz" --quiet \
  || die "The dump failed. Nothing has been changed; the API is stopped and can be started with
  'sudo systemctl start steading-api'."
note "$(du -h "$WORK/dump.gz" | cut -f1)"

say "Restoring onto this box"
# --drop so a re-run replaces rather than merges. A second run without it would
# leave the first run's documents beside the new ones and every _id collision
# silently skipped, which looks like success and is not.
#
# --preserveUUID is deliberately NOT used: these are different clusters and the
# collection UUIDs have no meaning across them.
mongorestore --uri="$LOCAL_URI" --gzip --archive="$WORK/dump.gz" \
  --nsFrom="${DB_NAME}.*" --nsTo="${DB_NAME}.*" --drop --quiet \
  || die "The restore failed. Atlas is untouched — put the old MONGODB_URI back in
  /etc/steading/api.env and start the API to carry on where you were."

# ── prove it ────────────────────────────────────────────────────────────────
say "Comparing"
counts "$LOCAL_URI" > "$WORK/after.txt" || die "Could not read back from the local database."

if diff -q "$WORK/before.txt" "$WORK/after.txt" >/dev/null; then
  note "every collection matches, document for document"
else
  printf '\n\033[1;31mThe two do not match.\033[0m\n\n'
  diff "$WORK/before.txt" "$WORK/after.txt" || true
  printf '\nAtlas is untouched. Put the old MONGODB_URI back and start the API.\n\n'
  exit 1
fi

say "Applying indexes"
# The same command §5b of DEPLOY-THE-SERVER documents, so there is one way to do
# this rather than two that can drift. `mongorestore` brings the dump's indexes
# with it, but this is the authoritative definition and it is idempotent —
# cheaper to run than to wonder about. A missing unique index on `users.email`
# is not an error, it is two accounts on one address a month from now.
cd "${STEADING_DIR:-/opt/steading}"
MONGODB_URI="$LOCAL_URI" corepack pnpm db:indexes \
  || note "could not apply — run 'pnpm db:indexes' by hand before the first sign-up"

cat <<DONE

$(printf '\033[1m')Data is on the box. Two things left.$(printf '\033[0m')

  1. Point the API at it, then start it:

       sudo nano /etc/steading/api.env      # MONGODB_URI= the LOCAL_URI
       sudo systemctl start steading-api
       curl -i https://api.swbuild.dev/health      # curl.exe on Windows

  2. Leave the Atlas cluster alone for a week before deleting anything. It is
     a free, off-site, known-good copy of the farm's records, and it costs
     nothing to keep until the box has proven itself.

$(printf '\033[1m')And backups are now yours.$(printf '\033[0m') Nobody else has a copy after that
  week. scripts/backup-mongo.sh is the job; ACCESS-AND-BILLING §4.1a-i calls it
  a condition of the first real farm.

DONE

[ "$RESTART" = "1" ] && note "The API is still stopped — start it after step 1."
exit 0
