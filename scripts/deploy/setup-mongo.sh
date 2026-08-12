#!/usr/bin/env bash
#
# MongoDB on the box, beside the API.
#
#   sudo /opt/steading/scripts/deploy/setup-mongo.sh
#
# The second half of `ACCESS-AND-BILLING.md` §4.1a, which always said both
# Fastify and MongoDB run on the one free instance. Atlas's free M0 is 512 MB
# and photos live in GridFS, so it fills; the box has ~170 GB spare.
#
# Run `migrate-to-local-mongo.sh` afterwards to bring the data across.
#
# ## A standalone, not a replica set, and that was checked
#
# Multi-document transactions and change streams both require a replica set.
# This service uses neither — every write is a single document, sync
# idempotency is one `upsertOne` with `$setOnInsert`, and nothing tails an
# oplog. GridFS works standalone. So a single `mongod` is not a compromise here,
# it is the correct shape, and it is one process to reason about instead of
# three.
#
# ## What this deliberately does NOT do
#
# It does not open port 27017 anywhere, and nothing else should either. An
# internet-reachable MongoDB is found and ransomwared by automated scanners
# within hours — it is one of the most reliably exploited services there is.
# `bindIp` stays 127.0.0.1 and the API reaches it over loopback.

set -euo pipefail

MONGO_SERIES="8.0"
# Loopback only. Changing this is the single most dangerous edit in this repo.
BIND_IP="127.0.0.1"
# Half of what the default would take on a 12 GB box, leaving room for Node,
# argon2 and the page cache. WiredTiger otherwise claims
# max(0.5 × (RAM − 1 GB), 256 MB) — around 5.5 GB here — which it does not need
# for a working set this size and which competes with the API for the same RAM.
CACHE_GB="${STEADING_MONGO_CACHE_GB:-2}"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }
die() { printf '\n\033[1;31mSTOPPED:\033[0m %s\n\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run this with sudo."

command -v lsb_release >/dev/null 2>&1 || apt-get install -y lsb-release >/dev/null 2>&1
CODENAME="$(lsb_release -cs)"
ARCH="$(dpkg --print-architecture)"

case "$CODENAME" in
  jammy|noble) ;;
  *) die "MongoDB $MONGO_SERIES publishes packages for jammy (22.04) and noble (24.04).
  This box is '$CODENAME'. Check https://www.mongodb.com/docs/manual/administration/install-on-linux/
  before going further rather than forcing a codename that has no repository." ;;
esac

say "MongoDB $MONGO_SERIES for $CODENAME/$ARCH"
if command -v mongod >/dev/null 2>&1; then
  note "$(mongod --version | head -1) already installed"
else
  apt-get install -y gnupg curl >/dev/null
  curl -fsSL "https://www.mongodb.org/static/pgp/server-${MONGO_SERIES}.asc" \
    | gpg -o "/usr/share/keyrings/mongodb-server-${MONGO_SERIES}.gpg" --dearmor --yes
  echo "deb [ arch=${ARCH} signed-by=/usr/share/keyrings/mongodb-server-${MONGO_SERIES}.gpg ] https://repo.mongodb.org/apt/ubuntu ${CODENAME}/mongodb-org/${MONGO_SERIES} multiverse" \
    > "/etc/apt/sources.list.d/mongodb-org-${MONGO_SERIES}.list"
  apt-get update -qq
  # The metapackage brings mongosh and the database tools with it, which is
  # what `migrate-to-local-mongo.sh` and `backup-mongo.sh` both need.
  apt-get install -y mongodb-org >/dev/null
  note "installed $(mongod --version | head -1)"
fi

command -v mongodump >/dev/null 2>&1 || die "mongodump is missing. The mongodb-org metapackage
  should have brought mongodb-database-tools; install it before migrating."

# ── the configuration ───────────────────────────────────────────────────────
say "Configuring"
BACKUP="/etc/mongod.conf.before-steading"
[ -f "$BACKUP" ] || cp /etc/mongod.conf "$BACKUP"

cat > /etc/mongod.conf <<CONF
# Written by scripts/deploy/setup-mongo.sh. The original is at
# /etc/mongod.conf.before-steading.

storage:
  dbPath: /var/lib/mongodb
  wiredTiger:
    engineConfig:
      # Capped deliberately — see setup-mongo.sh for the arithmetic.
      cacheSizeGB: ${CACHE_GB}

systemLog:
  destination: file
  logAppend: true
  path: /var/log/mongodb/mongod.log

net:
  port: 27017
  # LOOPBACK ONLY. An internet-reachable MongoDB is found and ransomwared by
  # automated scanners within hours. The API is on this same box and reaches it
  # over localhost; nothing else ever should. Do not add an address here, and
  # do not open 27017 in iptables or in Oracle's security list.
  bindIp: ${BIND_IP}

security:
  # On even though it is loopback-only. Defence in depth: a bug in the API that
  # let an attacker run code as the service user should not additionally hand
  # them an unauthenticated database admin shell.
  authorization: enabled
CONF

systemctl enable mongod >/dev/null
systemctl restart mongod

for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if mongosh --quiet --eval 'db.adminCommand({ping:1}).ok' >/dev/null 2>&1; then break; fi
  sleep 1
done
systemctl is-active --quiet mongod || die "mongod did not start. journalctl -u mongod -n 50"
note "running, bound to ${BIND_IP}, cache ${CACHE_GB}GB"

# ── the account the API uses ────────────────────────────────────────────────
#
# Created only if it is absent, because re-running this must not rotate a
# password that is already in /etc/steading/api.env and working.
say "Application account"
EXISTS="$(mongosh --quiet admin --eval 'db.getSiblingDB("admin").system.users.countDocuments({user:"steading"})' 2>/dev/null || echo 0)"

if [ "$EXISTS" = "0" ]; then
  # Generated here and printed once. Not written to any file by this script —
  # you paste it into /etc/steading/api.env, which is the only place it lives.
  PASSWORD="$(openssl rand -base64 36 | tr -d '/+=' | head -c 40)"
  mongosh --quiet admin --eval "
    db.createUser({
      user: 'steading',
      pwd: '${PASSWORD}',
      roles: [
        { role: 'readWrite', db: 'steading' },
        { role: 'dbAdmin',   db: 'steading' }
      ]
    })
  " >/dev/null
  note "created"

  cat <<KEY

$(printf '\033[1m')Put this in /etc/steading/api.env, then start the API:$(printf '\033[0m')

MONGODB_URI=mongodb://steading:${PASSWORD}@127.0.0.1:27017/steading?authSource=admin

  It is printed once and stored nowhere else. If you lose it, re-create the
  user rather than guessing:

    mongosh admin --eval 'db.dropUser("steading")'
    sudo $0

KEY
else
  note "already exists — password left alone"
  note "the URI shape is: mongodb://steading:<password>@127.0.0.1:27017/steading?authSource=admin"
fi

cat <<DONE

$(printf '\033[1m')Next:$(printf '\033[0m')

  1. Bring the data across from Atlas:

       sudo /opt/steading/scripts/deploy/migrate-to-local-mongo.sh

  2. Backups are now YOURS. ACCESS-AND-BILLING §4.1a-i calls a nightly dump a
     condition of the first real farm, not a nicety — Atlas was not doing it
     either on the free tier, but there is no longer anybody else who might.

       scripts/backup-mongo.sh backup

  Do NOT open 27017 in iptables or in Oracle's security list. Nothing outside
  this box needs it.

DONE
