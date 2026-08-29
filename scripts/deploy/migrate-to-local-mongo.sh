#!/usr/bin/env bash
#
# Atlas -> the box. Run it once, after `setup-mongo.sh`.
#
#   export MONGODB_DB=steadingdb
#   export ATLAS_URI="$(sudo grep -oP '^MONGODB_URI=\K.*' /etc/homefarm/api.env)"
#   export LOCAL_URI='mongodb://homefarm:…@127.0.0.1:27017/steadingdb?authSource=admin'
#   sudo -E /opt/homefarm/scripts/deploy/migrate-to-local-mongo.sh
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
#
# **Which means EXPORT them, rather than writing them on the sudo line.**
# `sudo -E VAR=… script` passes those assignments as arguments to *sudo*, so
# both strings sit in `ps` for the length of the migration — defeating the rule
# this paragraph is about. The runbook said to do it that way until somebody
# ran it.
#
# **And it stops at this script's boundary, which the rule above did not say.**
# The URI reaches here in the environment, and is then handed to `mongodump`,
# `mongorestore` and `mongosh` as `--uri=…` — their argv, visible in `ps` for
# the seconds each runs. So the password is off the command line of *this*
# process and on the command line of its children, and the paragraph above read
# as though it were off both.
#
# Not closed, and the reason is a trade rather than an oversight. The Database
# Tools take a `--config` file with the password out of band; `mongosh` has no
# equivalent and would need the credentials split out of the URI and prompted
# for, which is unusable unattended. So closing it properly means two mechanisms,
# one of them version-dependent on an unpinned package, on the paths that carry
# a farm's only copy of its records. The exposure it buys is a local account on
# a single-tenant box reading `/proc` during those seconds.
#
# Worth doing on a quiet day, with a verified backup already in hand. Not worth
# doing in the same week as the first one.

set -Eeuo pipefail
umask 077

DB_NAME="${MONGODB_DB:-homefarm}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }
die() { printf '\n\033[1;31mSTOPPED:\033[0m %s\n\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run this with sudo -E, so the URIs survive."
[ -n "${ATLAS_URI:-}" ] || die "ATLAS_URI is not set. It is the connection string currently in
  /etc/homefarm/api.env — the one the API is using right now."
[ -n "${LOCAL_URI:-}" ] || die "LOCAL_URI is not set. setup-mongo.sh printed it:
  mongodb://homefarm:<password>@127.0.0.1:27017/homefarm?authSource=admin"

command -v mongodump >/dev/null 2>&1 || die "mongodump is missing. Run setup-mongo.sh first."
command -v mongorestore >/dev/null 2>&1 || die "mongorestore is missing. Run setup-mongo.sh first."

# ── which database, said once ───────────────────────────────────────────────
#
# **The connection string and the database name are separate settings in this
# app, and conflating them is how this script would have read the wrong one.**
# `env.ts` takes `MONGODB_URI` and `MONGODB_DB` independently, defaulting the
# second to `homefarm` — so an Atlas string commonly carries no database at all
# (`mongodb+srv://user:pass@cluster/?retryWrites=true`).
#
# That matters twice below: `mongosh <uri>` would then select `test` and report
# an empty database, and `mongodump --db` errors when the URI already names a
# different one. Both are settled here instead of guessed at twice.
uri_db() {
  local rest="${1#mongodb://}"
  rest="${rest#mongodb+srv://}"
  rest="${rest%%\?*}"
  case "$rest" in */*) printf '%s' "${rest#*/}" ;; *) printf '%s' "" ;; esac
}

ATLAS_DB="$(uri_db "$ATLAS_URI")"
if [ -n "$ATLAS_DB" ] && [ "$ATLAS_DB" != "$DB_NAME" ]; then
  die "ATLAS_URI names the database '$ATLAS_DB', but this script is set to migrate
  '$DB_NAME'. One of them is wrong and guessing which would move the wrong
  records.

  If '$ATLAS_DB' is the right one:   export MONGODB_DB=$ATLAS_DB, then re-run
  If it is not, take the database off the end of ATLAS_URI."
fi

# ── what is there now, so the check at the end has something to compare ─────
say "Reading the source ($DB_NAME)"
#
# `getSiblingDB` rather than the connection's own default. Without it this reads
# whatever database the URI happens to name — `test` when it names none — and
# then compares a count of nothing against a count of nothing and calls the
# migration verified.
counts() {
  mongosh --quiet "$1" --eval "
    var target = db.getSiblingDB('${DB_NAME}');
    target.getCollectionNames().sort().forEach(function (name) {
      print(name + ' ' + target.getCollection(name).countDocuments({}));
    });
  " 2>/dev/null
}

counts "$ATLAS_URI" > "$WORK/before.txt" || die "Could not read from Atlas. Check ATLAS_URI, and
  check that this box's public address is on Atlas -> Network Access."
[ -s "$WORK/before.txt" ] || die "Atlas returned no collections at all. That is either the wrong
  URI or the wrong database name, and either way this is not the moment to guess."
note "$(wc -l < "$WORK/before.txt") collections"
sed 's/^/     /' "$WORK/before.txt"

# ── stop writing ────────────────────────────────────────────────────────────
say "Stopping the API"
if systemctl is-active --quiet homefarm-api; then
  systemctl stop homefarm-api
  note "stopped — phones will queue, which is the normal offline path"
  RESTART=1
else
  note "was not running"
  RESTART=0
fi

# ── dump, restore ───────────────────────────────────────────────────────────
say "Dumping from Atlas"
# `--db` ONLY when the URI does not already carry one. The tools reject the two
# together, and the check above has already proved they agree when both exist —
# so this passes exactly one source of the database name, never two.
#
# --gzip because this crosses the internet; the photo bytes in GridFS dominate
# and they compress poorly, but records do not.
if [ -n "$ATLAS_DB" ]; then
  mongodump --uri="$ATLAS_URI" --gzip --archive="$WORK/dump.gz" --quiet \
    || die "The dump failed. Nothing has been changed; the API is stopped and can be started with
  'sudo systemctl start homefarm-api'."
else
  mongodump --uri="$ATLAS_URI" --db="$DB_NAME" --gzip --archive="$WORK/dump.gz" --quiet \
    || die "The dump failed. Nothing has been changed; the API is stopped and can be started with
  'sudo systemctl start homefarm-api'."
fi
note "$(du -h "$WORK/dump.gz" | cut -f1)"

# ── Has the cutover already happened? ───────────────────────────────────────
#
# **`--drop` below destroys the local database, and after cutover that database
# is the farm's only copy of everything logged since.** Phones flush to it, the
# server answers `applied`, and the clients then never resend those mutations
# (invariant 7) — so a re-run does not lose a few hours of work, it loses them
# *unrecoverably*, and Atlas has none of it because Atlas stopped being written
# to the moment the URI changed.
#
# The fact that decides is on disk: the URI the API is actually configured with.
# While it still names Atlas, this script is a migration that has not landed and
# a re-run is the ordinary retry `--drop` exists for. Once it names this box,
# the migration is done and there is nothing here to re-run — only records to
# destroy.
#
# Refuses rather than offering a flag. A `--force` on this is a flag whose only
# use is the accident it would cause, and the recovery it would need does not
# exist.
API_ENV=/etc/homefarm/api.env
if [ -f "$API_ENV" ]; then
  CONFIGURED="$(sed -n 's/^MONGODB_URI=\(.*\)$/\1/p' "$API_ENV" | tail -1)"
  case "$CONFIGURED" in
    *127.0.0.1*|*localhost*)
      die "The API is already pointed at this box ($API_ENV names a loopback MONGODB_URI),
  so the cutover has happened and the local database is the live one.

  Restoring over it would drop every record logged since — and those are gone
  for good, because the phones that sent them were told 'applied' and will never
  send them again. Atlas does not have them either; nothing has written to it
  since the URI changed.

  If you genuinely mean to redo the migration, take a backup you have verified
  first, then point $API_ENV back at Atlas so this script can see that the
  cutover has been undone:

      sudo /opt/homefarm/scripts/backup-mongo.sh backup

  Nothing has been changed."
      ;;
  esac
fi

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
  /etc/homefarm/api.env and start the API to carry on where you were."

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
cd "${HOMEFARM_DIR:-/opt/homefarm}"
MONGODB_URI="$LOCAL_URI" corepack pnpm db:indexes \
  || note "could not apply — run 'pnpm db:indexes' by hand before the first sign-up"

cat <<DONE

$(printf '\033[1m')Data is on the box. Two things left.$(printf '\033[0m')

  1. Point the API at it, then start it:

       sudo nano /etc/homefarm/api.env      # MONGODB_URI= the LOCAL_URI
       sudo systemctl start homefarm-api
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
