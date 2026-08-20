#!/usr/bin/env bash
#
# One-shot migration of a live box from the `steading` names to `homefarm`.
#
# check:names-ok-file — the old name is this script's subject. It has to say
# what it is migrating from, and the day it stops naming it is the day it
# stops working.
#
#   sudo /opt/steading/scripts/deploy/rename-to-homefarm.sh          # report only
#   sudo /opt/steading/scripts/deploy/rename-to-homefarm.sh --go     # do it
#
# ## Why this exists as a script rather than a page of instructions
#
# The rename touches six things that must all move together — a checkout, an
# environment directory, a state directory, a service account, eight systemd
# units, and a database — and the box is down for the whole of it. A checklist
# run by hand at that moment is a checklist with a step missed in it. The one
# that gets missed is the service account, because `usermod -l` refuses while
# anything is still running as the user, and the natural recovery is to skip it
# and carry on with a chown that never happens.
#
# It reports by default and changes nothing without `--go`, because the first
# thing anybody wants to know is what it is about to stop.
#
# ## What it does NOT do
#
# **It never drops the old database.** MongoDB has no rename, so the data is
# copied into the new one and the old is left exactly where it was. That is the
# rollback: point `MONGODB_DB` back and restart. Dropping it is a separate
# decision, taken later, by a person who has watched the new one work — the
# last lines printed say how.
#
# **It does not create a new database user.** The obvious reading of "rename
# everything" is to make a `homefarm` Mongo account and retire the `steading`
# one, and it is the wrong move: `createUser` needs a password, so the new
# account arrives with a new secret that has to reach `api.env` intact in the
# middle of an outage, and the old password is not recoverable if that goes
# wrong. Instead the existing account is granted rights on the new database and
# keeps its name and its password. A database user is not a brand — it is a
# credential, and rotating a credential during a rename is two risky operations
# wearing one coat. Rename it later, on a quiet day, or never.
set -euo pipefail

OLD=steading
NEW=homefarm
GO=0
[ "${1:-}" = "--go" ] && GO=1

BOLD=$(printf '\033[1m'); DIM=$(printf '\033[2m'); OFF=$(printf '\033[0m')
say()  { printf '\n%s%s%s\n' "$BOLD" "$*" "$OFF"; }
note() { printf '  %s\n' "$*"; }
skip() { printf '  %s— %s%s\n' "$DIM" "$*" "$OFF"; }
die()  { printf '\n  ERROR: %s\n\n' "$*" >&2; exit 1; }
do_it() { if [ "$GO" = 1 ]; then "$@"; else printf '  %swould: %s%s\n' "$DIM" "$*" "$OFF"; fi; }

[ "$(id -u)" = 0 ] || die "run this with sudo"

# The eight units, oldest name first. Order matters on the way down: the timers
# stop before the services they trigger, so nothing fires mid-migration.
UNITS=(
  "${OLD}-deploy.timer" "${OLD}-backup.timer" "${OLD}-backup-check.timer"
  "${OLD}-deploy.service" "${OLD}-backup.service" "${OLD}-backup-check.service"
  "${OLD}-ops.service" "${OLD}-api.service"
)

# ── 1. what is actually here ────────────────────────────────────────────────
#
# Discovered rather than assumed. This box may have been set up before some of
# these existed, or may already be half migrated by an earlier run of this
# script that stopped on an error — both are ordinary states to start from.

say "What is on this box"

MOVES=()
for pair in "/opt/${OLD}:/opt/${NEW}" "/etc/${OLD}:/etc/${NEW}" "/var/lib/${OLD}:/var/lib/${NEW}"; do
  from="${pair%%:*}"; to="${pair##*:}"
  if [ -e "$from" ]; then
    [ -e "$to" ] && die "both $from and $to exist — resolve that by hand, this script will not merge two trees"
    MOVES+=("$pair"); note "$from  ->  $to"
  else
    skip "$from is not here"
  fi
done

LIVE=()
for u in "${UNITS[@]}"; do
  if systemctl list-unit-files "$u" >/dev/null 2>&1 && [ -f "/etc/systemd/system/$u" ]; then
    LIVE+=("$u")
    note "$u ($(systemctl is-active "$u" 2>/dev/null || true))"
  fi
done
[ ${#LIVE[@]} -eq 0 ] && skip "no ${OLD}-* units installed"

RENAME_USER=0
if id "$OLD" >/dev/null 2>&1; then
  if id "$NEW" >/dev/null 2>&1; then
    skip "both users exist — leaving accounts alone"
  else
    RENAME_USER=1; note "service account $OLD  ->  $NEW"
  fi
else
  skip "no $OLD service account"
fi

ENV_FILE="/etc/${OLD}/api.env"
[ -e "$ENV_FILE" ] || ENV_FILE="/etc/${NEW}/api.env"
[ -f "$ENV_FILE" ] || die "no api.env under /etc/${OLD} or /etc/${NEW} — nothing to migrate"

# Reported because it is the one thing here that a move silently breaks rather
# than obviously breaks: an absolute symlink whose target is about to walk away.
for c in "/opt/${OLD}" "/opt/${NEW}"; do
  [ -L "$c/.env.local" ] || continue
  note ".env.local -> $(readlink "$c/.env.local")  (re-pointed at /etc/${NEW}/api.env)"
done

# The database the API reads today. `databaseName()` in db/client.ts takes
# MONGODB_DB and ignores the path on the URI, so this is the only line that
# decides, and an absent or empty value means the code default.
OLD_DB="$(sed -n 's/^MONGODB_DB=\(.*\)$/\1/p' "$ENV_FILE" | tail -1)"
[ -z "$OLD_DB" ] && OLD_DB="${OLD}db"
MONGO_URI="$(sed -n 's/^MONGODB_URI=\(.*\)$/\1/p' "$ENV_FILE" | tail -1)"
[ -n "$MONGO_URI" ] || die "$ENV_FILE has no MONGODB_URI"

if [ "$OLD_DB" = "$NEW" ]; then
  skip "database is already '$NEW'"
  COPY_DB=0
else
  note "database $OLD_DB  ->  $NEW  (copied; the old one is left in place)"
  COPY_DB=1
fi

if [ "$GO" != 1 ]; then
  cat <<PREVIEW

${BOLD}Nothing has been changed.${OFF} Re-run with --go to carry it out.

  The API is down from the moment the units stop until they come back —
  a minute or two, plus however long the database copy takes.

PREVIEW
  exit 0
fi

# ── 2. down ─────────────────────────────────────────────────────────────────

say "Stopping the old units"
for u in "${LIVE[@]}"; do
  do_it systemctl disable --now "$u"
done
note "stopped"

# ── 3. the trees ────────────────────────────────────────────────────────────
#
# `mv` within one filesystem is a rename: atomic, and it keeps ownership,
# permissions and the git checkout's own state untouched. Copying would double
# the disk and leave two trees that can drift.

say "Moving directories"
for pair in "${MOVES[@]}"; do
  do_it mv "${pair%%:*}" "${pair##*:}"
  note "${pair%%:*}  ->  ${pair##*:}"
done

# ── 4. the account ──────────────────────────────────────────────────────────
#
# After the units are down, because `usermod` refuses to rename a user that
# owns a running process — and the failure is easy to shrug off, which leaves
# the new units running as a user that does not own the files they read.

if [ "$RENAME_USER" = 1 ]; then
  say "Renaming the service account"
  do_it usermod --login "$NEW" "$OLD"
  # The group too: `useradd --system` made one matching the user, and systemd's
  # `User=` resolves the primary group from passwd, so a stale group name is
  # cosmetic — but a stale group name is also the thing somebody greps for in
  # six months to convince themselves the migration finished.
  if getent group "$OLD" >/dev/null 2>&1; then do_it groupmod --new-name "$NEW" "$OLD"; fi
  note "$OLD -> $NEW"
fi

# Ownership is by uid, so the rename above kept it — but a tree that was moved
# from a directory the old setup created may carry group ownership that no
# longer resolves. Re-asserting costs nothing and removes the doubt.
for d in "/opt/${NEW}" "/var/lib/${NEW}"; do
  if [ -d "$d" ] && id "$NEW" >/dev/null 2>&1; then do_it chown -R "${NEW}:${NEW}" "$d"; fi
done
# Except the published APKs, which Caddy serves and setup-box.sh gives to caddy.
#
# **Non-fatal, and that matters more here than where it is copied from.**
# `setup-box.sh` writes this same line as `chown … 2>/dev/null || true` because
# a box may not have a caddy user yet. Here it ran bare under `set -e`, and the
# place it stopped was the worst one available: three directories already moved,
# the units not yet installed, the symlink below not yet re-pointed — a box
# renamed on disk with nothing running and no obvious way back. Found by running
# this script against a fake box rather than by reading it.
if [ -d "/var/lib/${NEW}/dist" ]; then
  do_it chown -R caddy:caddy "/var/lib/${NEW}/dist" 2>/dev/null || \
    skip "no caddy user yet — deploy.sh will set the shelf's ownership when it publishes"
fi

# ── 4a. the one link that does not move with its directory ──────────────────
#
# `setup-box.sh` links `<checkout>/.env.local` at `/etc/<name>/api.env` with an
# **absolute** target, so moving both trees leaves the link inside the moved
# checkout still naming `/etc/steading/api.env` — which no longer exists. The
# checkout moved, the target moved, and the sentence joining them did not.
#
# What breaks is quiet and only shows up later: `sudo pnpm farm:ls`,
# `farm:grant`, `db:indexes` and every other operator command reads that link
# and reports *"MONGODB_URI is not set"* on a box whose API is running
# perfectly. Worse, the obvious repair — re-running `setup-box.sh` — used to
# abort on it, because `-e` on a dangling link reads as absent and the `ln -s`
# that followed then failed with "File exists". Both ends are fixed; this is
# the end that knows the migration happened.
if [ -e "/opt/${NEW}" ]; then
  do_it ln -sfn "/etc/${NEW}/api.env" "/opt/${NEW}/.env.local"
  note "/opt/${NEW}/.env.local  ->  /etc/${NEW}/api.env"
fi

# ── 5. the environment files ────────────────────────────────────────────────

say "Rewriting the environment files"
for f in "/etc/${NEW}"/*.env; do
  [ -f "$f" ] || continue
  do_it cp -a "$f" "$f.pre-rename"
  if [ "$GO" = 1 ]; then
    # STEADING_* -> HOMEFARM_*, and the database the API reads. The URI's own
    # trailing path is cosmetic (client.ts ignores it) but a URI that says one
    # database while MONGODB_DB says another is a trap for the next reader.
    #
    # **Anchored to the start of the line, which is the whole of the care here.**
    # An env file is `KEY=value`, and only the key is a name this rename owns.
    # Unanchored, `STEADING_` matched inside values too — including the one
    # value on this box that cannot be regenerated from the repository, the
    # Mongo password on `MONGODB_URI`. A password is arbitrary text; the day one
    # contains that substring, an unanchored rewrite silently changes it and the
    # API comes back unable to authenticate against a database whose credential
    # now exists nowhere but the `.pre-rename` copy.
    sed -i \
      -e 's/^STEADING_/HOMEFARM_/' \
      -e "s#^MONGODB_DB=.*#MONGODB_DB=${NEW}#" \
      -e "s#/${OLD_DB}?#/${NEW}?#" \
      "$f"
    grep -q '^MONGODB_DB=' "$f" || printf 'MONGODB_DB=%s\n' "$NEW" >> "$f"
  fi
  note "$f (copy kept at $f.pre-rename)"
done

# ── 6. the database ─────────────────────────────────────────────────────────
#
# No rename exists, so this is a dump piped into a restore with the namespaces
# remapped. `--archive` keeps it in memory rather than writing a copy of the
# farm's records to disk in the clear.

if [ "$COPY_DB" = 1 ]; then
  say "Copying the database"
  command -v mongodump >/dev/null 2>&1 || die "mongodump is not installed (apt-get install -y mongodb-database-tools)"

  if [ "$GO" = 1 ]; then
    # The account keeps its name and password; it just gains the new database.
    # `mongosh` needs the same credentials the API uses, which are on the URI.
    mongosh "$MONGO_URI" --quiet --eval "
      db.getSiblingDB('admin').runCommand({
        grantRolesToUser: db.getSiblingDB('admin').runCommand({connectionStatus:1})
          .authInfo.authenticatedUsers[0].user,
        roles: [ {role:'readWrite', db:'${NEW}'}, {role:'dbAdmin', db:'${NEW}'} ]
      })
    " >/dev/null || die "could not grant the API's account rights on '${NEW}'"
    note "the API's Mongo account now has readWrite+dbAdmin on '${NEW}'"

    mongodump --uri="$MONGO_URI" --db="$OLD_DB" --archive \
      | mongorestore --uri="$MONGO_URI" --archive \
          --nsFrom="${OLD_DB}.*" --nsTo="${NEW}.*" --drop \
      || die "the copy failed — nothing was removed, the API is still pointed at '${OLD_DB}' in the .pre-rename files"

    # Counted rather than trusted: a restore that wrote nothing exits 0. Every
    # collection the source holds, asked of the database rather than listed
    # here — a list of collection names written into this script is one that
    # goes stale the first time an entity is added, and it would go stale
    # silently, which is the whole failure this check exists to catch.
    TALLY="$(mongosh "$MONGO_URI" --quiet --eval "
      const a = db.getSiblingDB('${OLD_DB}'), b = db.getSiblingDB('${NEW}');
      a.getCollectionNames().sort().map(n =>
        [n, a.getCollection(n).countDocuments({}), b.getCollection(n).countDocuments({})].join(' ')
      ).join('\n')
    ")" || die "could not count the copied collections"

    while read -r name from to; do
      [ -n "$name" ] || continue
      [ "$from" = "$to" ] || die "$name: ${OLD_DB} has $from, ${NEW} has $to — the copy is incomplete, do NOT start the API. Nothing was removed, and the .pre-rename copies still point at ${OLD_DB}."
      note "$name: $from in both"
    done <<< "$TALLY"
  else
    note "would copy ${OLD_DB} -> ${NEW} and verify the counts match"
  fi
fi

# ── 7. up ───────────────────────────────────────────────────────────────────
#
# The unit files come out of the moved checkout, which is now the renamed one,
# so `setup-box.sh`'s installation step is the thing to reuse rather than a
# second copy of it here. It is idempotent and rewrites what it finds.

say "Installing the new units"
for u in "${UNITS[@]}"; do
  do_it rm -f "/etc/systemd/system/$u"
done
do_it systemctl daemon-reload

REPO="/opt/${NEW}"
for u in "${NEW}-api.service" "${NEW}-ops.service" "${NEW}-deploy.service" "${NEW}-deploy.timer" \
         "${NEW}-backup.service" "${NEW}-backup.timer" "${NEW}-backup-check.service" "${NEW}-backup-check.timer"; do
  [ -f "$REPO/scripts/deploy/$u" ] || { skip "$u is not in the checkout"; continue; }
  do_it cp "$REPO/scripts/deploy/$u" "/etc/systemd/system/$u"
done
do_it systemctl daemon-reload
do_it systemctl enable --now "${NEW}-api"
for u in "${NEW}-deploy.timer" "${NEW}-backup.timer" "${NEW}-backup-check.timer"; do
  if [ -f "/etc/systemd/system/$u" ]; then do_it systemctl enable --now "$u"; fi
done

cat <<DONE

${BOLD}Done.${OFF} Two things left, and one of them is not for today.

  1. Caddy still serves the install page from the old path. Re-render it:

       sudo ${REPO}/scripts/deploy/deploy.sh

     which rewrites /etc/caddy/Caddyfile from the checkout and reloads.

  2. Check it, before believing any of the above:

       systemctl status ${NEW}-api
       curl -fsS https://\$DOMAIN/health

  ${BOLD}The old database is still there, untouched.${OFF} That is deliberate — it is
  the way back. When the new one has carried a few days of real use:

       mongosh "\$MONGODB_URI" --eval 'db.getSiblingDB("${OLD_DB}").dropDatabase()'

  Not before. There is no undo for that line and no second copy.

DONE
