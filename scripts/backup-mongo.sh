#!/usr/bin/env bash
#
# Nightly encrypted MongoDB backup to S3, and the restore that justifies it.
#
# Runs on the server, not in CI. A farm's records are the product, and
# self-hosting MongoDB means these are the only copies that exist off the box.
#
#   ./scripts/backup-mongo.sh backup
#   ./scripts/backup-mongo.sh list
#   ./scripts/backup-mongo.sh restore homefarm-2026-08-05T02-00-00Z.age
#
# ## Why it encrypts to a public key
#
# The dump holds no directly usable credentials — passwords are argon2 hashes
# and refresh tokens are stored as sha256 of the token, so a leak grants no
# sessions. It does hold emails, farm names, and coordinates that are somebody's
# home.
#
# S3's own encryption protects against AWS-side access, which is not the
# failure to plan for. The realistic ones are a leaked access key and a bad
# bucket policy, and only client-side encryption covers those.
#
# `age` is asymmetric, so HOMEFARM_BACKUP_RECIPIENT is a *public* key and the
# private half never exists on this machine. **The server can write backups it
# cannot read.** A box compromise does not become a history compromise. Keep the
# identity file in a password manager; you need it once, on the worst day.
#
# ## Why nothing is sanitized
#
# A dump with `users` stripped restores a farm nobody can log into. That is a
# partial export, not a backup. Sensitivity is handled by encryption, which is
# reversible when you need it and opaque when you do not.
#
# ## Environment, never argv
#
# Everything sensitive arrives through the environment. `argv` shows up in
# `ps`, which is the same reason `db:seed` and `db:password` take their values
# this way.
#
#   MONGODB_URI                  same variable the API uses
#   HOMEFARM_BACKUP_BUCKET       s3://bucket/prefix
#   HOMEFARM_BACKUP_RECIPIENT    age public key, age1...
#   HOMEFARM_BACKUP_IDENTITY     restore only: path to the age identity file
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
#
# Rotation is an S3 lifecycle rule on the prefix, not logic in here. A bucket
# setting cannot silently stop working the way a script can.

set -Eeuo pipefail

# Anything this script writes is readable only by its owner, from the moment it
# exists. Setting modes after the fact leaves a window.
umask 077

readonly ARCHIVE_FLOOR_BYTES=4096

# When the last backup was known to be in the bucket. A timestamp rather than a
# flag, because the question worth asking is not "has one ever run" but "how
# long has it been" — which is the failure this project actually had: a script
# nobody was going to notice had stopped being typed.
#
# Beside the deploy's own markers, in the state directory one level above what
# Caddy serves, so it is a note to the machine rather than a published file.
MARKER="${HOMEFARM_BACKUP_MARKER:-/var/lib/homefarm/.last-backup}"

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is not installed. $2"
}

# One temp directory, removed on every exit path — success, failure, or signal.
# `trap ... EXIT` fires for all three; a plain `rm` at the end fires for none of
# the interesting ones.
WORK=""
cleanup() {
  if [[ -n "$WORK" && -d "$WORK" ]]; then
    # Best-effort overwrite before unlink. On a copy-on-write filesystem or an
    # SSD this is not a guarantee, which is why the real protection is that
    # plaintext exists for seconds rather than being left behind at all.
    find "$WORK" -type f -exec shred --remove --zero {} + 2>/dev/null || true
    rm -rf "$WORK"
  fi
}
trap cleanup EXIT

stamp() {
  date -u +%Y-%m-%dT%H-%M-%SZ
}

# ── Which database, and why the URI is not the answer ───────────────────────
#
# **The API ignores the URI's path entirely.** `databaseName()` in
# `apps/api/src/db/client.ts` reads `MONGODB_DB` and falls back to the literal
# `homefarm`; the path segment of `MONGODB_URI` selects nothing. This script did
# the opposite — it handed `mongodump` a URI and let the path decide — so on any
# box where the two disagree it backed up a database **nothing writes to** and
# reported success at whatever size that empty database dumps to.
#
# That is not a hypothetical shape. `setup-mongo.sh` prints a URI ending in the
# name it was run with, `--keep-db` on the rename leaves `MONGODB_DB` naming
# something else, and `backup.env` is a separate file from `api.env`, so the two
# halves are edited at different times by different steps.
#
# Resolved the same way the API resolves it, so "the database that is backed up"
# and "the database that is live" cannot come apart.
resolve_db() {
  local configured="${MONGODB_DB:-}"
  configured="${configured#"${configured%%[![:space:]]*}"}"
  configured="${configured%"${configured##*[![:space:]]}"}"

  if [[ -n "$configured" ]]; then
    printf '%s' "$configured"
  else
    printf 'homefarm'
  fi
}

# The path segment, if the URI carries one. Read only to say so — nothing
# selects on it.
uri_db() {
  local rest="${1#mongodb://}"
  rest="${rest#mongodb+srv://}"
  rest="${rest#*@}"
  rest="${rest%%\?*}"

  case "$rest" in
    */*) printf '%s' "${rest#*/}" ;;
    *) printf '' ;;
  esac
}

# The same URI with the database stripped out, so `--db` is the only thing
# naming one. `mongodump` refuses `--db` alongside a URI that already names a
# database, and the query string — which carries `authSource` — has to survive.
uri_without_db() {
  local uri="$1" scheme="" rest query=""

  case "$uri" in
    mongodb+srv://*) scheme="mongodb+srv://"; rest="${uri#mongodb+srv://}" ;;
    mongodb://*) scheme="mongodb://"; rest="${uri#mongodb://}" ;;
    *) printf '%s' "$uri"; return ;;
  esac

  case "$rest" in
    *\?*) query="?${rest#*\?}"; rest="${rest%%\?*}" ;;
  esac

  # Only the path, never the credentials: a password may contain a slash.
  local creds="" hostpart="$rest"
  case "$rest" in
    *@*) creds="${rest%%@*}@"; hostpart="${rest#*@}" ;;
  esac
  hostpart="${hostpart%%/*}"

  printf '%s%s%s/%s' "$scheme" "$creds" "$hostpart" "$query"
}

backup() {
  need mongodump 'Install the MongoDB Database Tools.'
  # Same package as mongodump, and this path now reads the archive back before
  # it uploads it.
  need mongorestore 'Install the MongoDB Database Tools.'
  need age 'https://github.com/FiloSottile/age — single static binary, arm64 builds.'
  need aws 'Install the AWS CLI.'

  : "${MONGODB_URI:?MONGODB_URI is not set}"
  : "${HOMEFARM_BACKUP_BUCKET:?HOMEFARM_BACKUP_BUCKET is not set, e.g. s3://backups/homefarm}"
  : "${HOMEFARM_BACKUP_RECIPIENT:?HOMEFARM_BACKUP_RECIPIENT is not set — the age PUBLIC key}"

  WORK="$(mktemp -d)"
  local name plain sealed
  name="homefarm-$(stamp)"
  plain="$WORK/$name.gz"
  sealed="$WORK/$name.age"

  # **No `--oplog`, and it is not an oversight — it is what made every backup on
  # every box fail.**
  #
  # It was here with a comment saying "`--oplog` needs a replica set — run mongod
  # as a single-node one", an instruction no script implements and no document
  # repeats. `setup-mongo.sh` installs a standalone and argues the case for it at
  # length, so the flag was asking for a topology this project has decided
  # against. Three independent things then refused it: `--oplog` is only
  # supported against a replica-set member; it must read `local.oplog.rs`, and
  # the account `setup-mongo.sh` creates holds `readWrite`+`dbAdmin` on one
  # database and no role on `local`; and it is rejected outright when the target
  # names a single database, which the URI on every box does.
  #
  # `mongodump` therefore exited non-zero, `set -Eeuo pipefail` aborted before
  # the upload, and no archive was ever written — on a schedule, with the only
  # thing that would have said so installed by the same step nobody ran.
  #
  # The consistency it was there for is not lost in any way that matters here.
  # Every write this service makes is a single document (`sync/apply.ts` upserts
  # one mutation and projects one record), so there is no multi-document
  # invariant for a point-in-time snapshot to protect. Restoring to an oplog
  # position would need a replica set, a `backup` role on `admin`, and a reversal
  # of `setup-mongo.sh`'s recorded decision — all three, or none.
  local db_name uri_name base
  db_name="$(resolve_db)"
  uri_name="$(uri_db "$MONGODB_URI")"
  base="$(uri_without_db "$MONGODB_URI")"

  # Said out loud when the two disagree, because the operator almost certainly
  # believes the URI is the one that counts. It is not, here or in the API.
  if [[ -n "$uri_name" && "$uri_name" != "$db_name" ]]; then
    printf 'The URI names "%s" and the API reads "%s" (MONGODB_DB). Backing up "%s", which is the live one.\n' \
      "$uri_name" "$db_name" "$db_name"
  fi

  mongodump --uri="$base" --db="$db_name" --archive="$plain" --gzip --quiet

  # ── Is it a backup of THIS database, or merely a file ─────────────────────
  #
  # **The only check here was `size >= 4096`**, a constant with no relation to
  # anything. A farm database with photos runs to hundreds of megabytes; a
  # five-kilobyte archive passed it, uploaded, moved the marker, and sat in the
  # listing looking exactly like a backup. Combined with the wrong-database
  # defect above, the likeliest way to produce one was a correct dump of an
  # empty database.
  #
  # So the floor comes from the source. `dataSize` is what the server says this
  # database holds; gzip on BSON does well but not fiftyfold, so an archive
  # under a fiftieth of it is not a copy of this database whatever else it is.
  # Deliberately loose — this is a guard against a collapse, not a compression
  # model, and a false alarm here fails a backup that was fine.
  local size floor="$ARCHIVE_FLOOR_BYTES" data_size=""
  size="$(stat -c%s "$plain" 2>/dev/null || stat -f%z "$plain")"

  if command -v mongosh >/dev/null 2>&1; then
    data_size="$(mongosh "$base" --quiet --eval "
      print(db.getSiblingDB('${db_name}').stats().dataSize);
    " 2>/dev/null | tr -dc '0-9' || true)"
  fi

  if [[ -n "$data_size" ]] && (( data_size > 0 )); then
    local derived=$(( data_size / 50 ))
    (( derived > floor )) && floor="$derived"
  fi

  (( size >= floor )) || die "Dump of '${db_name}' is ${size} bytes against a floor of ${floor}${data_size:+ (the database holds ${data_size} bytes).}
  That is not a copy of this database. Refusing to upload it, because an archive
  in the bucket at this size is worse than none: it looks like a backup."

  # ── And that it can be read back ──────────────────────────────────────────
  #
  # Size says the bytes are there; this says they are an archive. `--dryRun`
  # walks the whole file and reports what it would restore without writing
  # anything, so a truncated dump — the shape a killed `mongodump` leaves — is
  # caught here rather than on the day somebody needs it.
  #
  # Guarded on the flag existing rather than assumed: the tools are installed
  # from a distribution package whose version this project does not pin, and a
  # verification that fails a good backup is worse than one that is skipped and
  # says so.
  if mongorestore --help 2>&1 | grep -q -- '--dryRun'; then
    mongorestore --uri="$base" --archive="$plain" --gzip --dryRun --quiet >/dev/null 2>&1 \
      || die "The archive of '${db_name}' cannot be read back. It is ${size} bytes and mongorestore
  will not parse it, which is what a truncated or interrupted dump looks like."
  else
    printf 'This mongorestore has no --dryRun, so the archive was checked by size only.\n'
  fi

  age --recipient "$HOMEFARM_BACKUP_RECIPIENT" --output "$sealed" "$plain"

  # Plaintext dies here rather than at exit, so it does not outlive the upload.
  shred --remove --zero "$plain"

  aws s3 cp "$sealed" "${HOMEFARM_BACKUP_BUCKET%/}/$name.age" --only-show-errors

  # ── Did it land? ──────────────────────────────────────────────────────────
  #
  # `aws s3 cp` returning zero means the request succeeded, which is not the
  # same claim as the object being in the bucket at the size it should be — a
  # truncated body, a lifecycle rule that immediately expires the prefix, or a
  # copy to a path nobody will ever list all exit zero.
  #
  # This reads it back. It is the only verification that can be done here: a
  # real restore test needs the age identity, and the whole point of the design
  # is that the private half never exists on this machine.
  local landed
  landed="$(aws s3 ls "${HOMEFARM_BACKUP_BUCKET%/}/$name.age" 2>/dev/null | awk '{print $3}')"
  [[ -n "$landed" ]] || die "Uploaded $name.age but it is not in the bucket. Check the prefix and the bucket policy."
  (( landed >= ARCHIVE_FLOOR_BYTES )) || die "$name.age is only ${landed} bytes in the bucket. Refusing to call that a backup."

  # ── The marker the absence check reads ────────────────────────────────────
  #
  # Written only here, after the object has been read back, so its presence
  # means a backup exists off this box rather than that something ran. See
  # `scripts/deploy/check-backup.sh`, which fails a systemd unit when this
  # stops moving.
  #
  # Best effort, and deliberately last: a box where the state directory cannot
  # be written still has its backup in S3, and failing the run over a note
  # about it would turn a success into an alert.
  if mkdir -p "$(dirname "$MARKER")" 2>/dev/null; then
    date -u +%s > "$MARKER" 2>/dev/null || true
  fi

  printf 'Backed up %s from database %s (%s bytes plaintext, %s bytes in the bucket)\n' \
    "$name" "$db_name" "$size" "$landed"
}

list() {
  : "${HOMEFARM_BACKUP_BUCKET:?HOMEFARM_BACKUP_BUCKET is not set}"
  aws s3 ls "${HOMEFARM_BACKUP_BUCKET%/}/" | sort
}

# Restore is deliberately awkward: it names one archive, refuses to guess, and
# does not drop anything. Recovering into a fresh database and switching
# MONGODB_URI is safer than overwriting the one that is still serving farms.
restore() {
  local key="${1:-}"
  [[ -n "$key" ]] || die "Which archive? Run '$0 list' to see them."

  need mongorestore 'Install the MongoDB Database Tools.'
  need age 'https://github.com/FiloSottile/age'
  need aws 'Install the AWS CLI.'

  : "${MONGODB_URI:?MONGODB_URI is not set — point it at the TARGET database}"
  : "${HOMEFARM_BACKUP_BUCKET:?HOMEFARM_BACKUP_BUCKET is not set}"
  : "${HOMEFARM_BACKUP_IDENTITY:?HOMEFARM_BACKUP_IDENTITY is not set — the age private key file}"
  [[ -r "$HOMEFARM_BACKUP_IDENTITY" ]] || die "Cannot read $HOMEFARM_BACKUP_IDENTITY"

  WORK="$(mktemp -d)"
  local sealed="$WORK/archive.age" plain="$WORK/archive.gz"
  # The database comes out of the archive, so the URI must not also name one.
  local base
  base="$(uri_without_db "$MONGODB_URI")"

  aws s3 cp "${HOMEFARM_BACKUP_BUCKET%/}/$key" "$sealed" --only-show-errors
  age --decrypt --identity "$HOMEFARM_BACKUP_IDENTITY" --output "$plain" "$sealed"

  # ── Which database this lands in, said plainly ────────────────────────────
  #
  # **The archive decides, not the URI.** `mongorestore --archive` restores each
  # namespace under the name it was dumped as, so pointing the URI at a
  # differently-named target does not move it — the records arrive under the old
  # name and the operator finds an empty database where they were looking.
  #
  # Not changed, said. Renaming on restore is `--nsFrom`/`--nsTo` and it is a
  # deliberate act with its own arguments; guessing at it inside the one path
  # that runs after a farm has already lost data is the wrong place to be clever.
  printf 'Restoring %s into the server at %s\n' "$key" "${base%%\?*}"
  printf 'It lands under the database name it was dumped as, which the archive carries.\n'
  printf 'To put it somewhere else, restore by hand with --nsFrom and --nsTo.\n'

  # No `--oplogReplay`: the archive carries no oplog to replay, because the dump
  # above takes none. Passing it against an archive without one is an error, so
  # this was unusable for exactly as long as the dump was.
  mongorestore --uri="$base" --archive="$plain" --gzip

  # The EXIT trap would get this anyway; doing it here means the plaintext is
  # gone before the success message rather than after it.
  shred --remove --zero "$plain"
  printf 'Restored. Verify before pointing the API at it.\n'
}

case "${1:-}" in
  backup) backup ;;
  list) list ;;
  restore) shift; restore "$@" ;;
  *)
    die "Usage: $0 {backup|list|restore <archive>}"
    ;;
esac
