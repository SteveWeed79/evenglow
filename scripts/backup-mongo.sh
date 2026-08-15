#!/usr/bin/env bash
#
# Nightly encrypted MongoDB backup to S3, and the restore that justifies it.
#
# Runs on the server, not in CI. A farm's records are the product, and
# self-hosting MongoDB means these are the only copies that exist off the box.
#
#   ./scripts/backup-mongo.sh backup
#   ./scripts/backup-mongo.sh list
#   ./scripts/backup-mongo.sh restore steading-2026-08-05T02-00-00Z.age
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
# `age` is asymmetric, so STEADING_BACKUP_RECIPIENT is a *public* key and the
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
#   STEADING_BACKUP_BUCKET       s3://bucket/prefix
#   STEADING_BACKUP_RECIPIENT    age public key, age1...
#   STEADING_BACKUP_IDENTITY     restore only: path to the age identity file
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
MARKER="${STEADING_BACKUP_MARKER:-/var/lib/steading/.last-backup}"

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

backup() {
  need mongodump 'Install the MongoDB Database Tools.'
  need age 'https://github.com/FiloSottile/age — single static binary, arm64 builds.'
  need aws 'Install the AWS CLI.'

  : "${MONGODB_URI:?MONGODB_URI is not set}"
  : "${STEADING_BACKUP_BUCKET:?STEADING_BACKUP_BUCKET is not set, e.g. s3://backups/steading}"
  : "${STEADING_BACKUP_RECIPIENT:?STEADING_BACKUP_RECIPIENT is not set — the age PUBLIC key}"

  WORK="$(mktemp -d)"
  local name plain sealed
  name="steading-$(stamp)"
  plain="$WORK/$name.gz"
  sealed="$WORK/$name.age"

  # `--oplog` needs a replica set — run mongod as a single-node one. Without it
  # collections are read at slightly different moments and the snapshot is not
  # internally consistent.
  mongodump --uri="$MONGODB_URI" --archive="$plain" --gzip --oplog --quiet

  # A failed dump can still leave a small, structurally valid file. Uploading
  # one is worse than failing, because it looks like a backup in the listing.
  local size
  size="$(stat -c%s "$plain" 2>/dev/null || stat -f%z "$plain")"
  (( size >= ARCHIVE_FLOOR_BYTES )) || die "Dump is only ${size} bytes. Refusing to upload it."

  age --recipient "$STEADING_BACKUP_RECIPIENT" --output "$sealed" "$plain"

  # Plaintext dies here rather than at exit, so it does not outlive the upload.
  shred --remove --zero "$plain"

  aws s3 cp "$sealed" "${STEADING_BACKUP_BUCKET%/}/$name.age" --only-show-errors

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
  landed="$(aws s3 ls "${STEADING_BACKUP_BUCKET%/}/$name.age" 2>/dev/null | awk '{print $3}')"
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

  printf 'Backed up %s (%s bytes plaintext, %s bytes in the bucket)\n' "$name" "$size" "$landed"
}

list() {
  : "${STEADING_BACKUP_BUCKET:?STEADING_BACKUP_BUCKET is not set}"
  aws s3 ls "${STEADING_BACKUP_BUCKET%/}/" | sort
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
  : "${STEADING_BACKUP_BUCKET:?STEADING_BACKUP_BUCKET is not set}"
  : "${STEADING_BACKUP_IDENTITY:?STEADING_BACKUP_IDENTITY is not set — the age private key file}"
  [[ -r "$STEADING_BACKUP_IDENTITY" ]] || die "Cannot read $STEADING_BACKUP_IDENTITY"

  WORK="$(mktemp -d)"
  local sealed="$WORK/archive.age" plain="$WORK/archive.gz"

  aws s3 cp "${STEADING_BACKUP_BUCKET%/}/$key" "$sealed" --only-show-errors
  age --decrypt --identity "$STEADING_BACKUP_IDENTITY" --output "$plain" "$sealed"

  printf 'Restoring %s into %s\n' "$key" "${MONGODB_URI%%\?*}"
  mongorestore --uri="$MONGODB_URI" --archive="$plain" --gzip --oplogReplay

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
