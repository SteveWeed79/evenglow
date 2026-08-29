#!/usr/bin/env bash
#
# One-shot migration of a live box from the `steading` names to `homefarm`.
#
# check:names-ok-file — the old name is this script's subject. It has to say
# what it is migrating from, and the day it stops naming it is the day it
# stops working.
#
#   sudo /opt/steading/scripts/deploy/rename-to-homefarm.sh            # report only
#   sudo /opt/steading/scripts/deploy/rename-to-homefarm.sh --go       # do it
#   sudo /opt/steading/scripts/deploy/rename-to-homefarm.sh --go --keep-db
#
# `--keep-db` renames the box and leaves the database under its old name. The
# name is cosmetic — `client.ts` selects on `MONGODB_DB` — and the copy is the
# only irreversible half of this, so on a box whose Mongo account cannot grant
# itself rights on a new database (which is every box `setup-mongo.sh` built)
# this is the supported way through rather than a workaround.
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
KEEP_DB=0
for arg in "$@"; do
  case "$arg" in
    --go)      GO=1 ;;
    --keep-db) KEEP_DB=1 ;;
    *) printf '\n  ERROR: unknown option "%s". Use --go and/or --keep-db.\n\n' "$arg" >&2; exit 2 ;;
  esac
done

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

# ── An absent MONGODB_DB is a question, not a default ───────────────────────
#
# **The fallback was `${OLD}db` — "steadingdb" — a name the code has never
# used.** `databaseName()` returned the bare `steading` before the rename commit
# and `homefarm` after it; the `db` suffix is a convention of one box's env file
# and nothing else. And `setup-box.sh` leaves `MONGODB_DB` commented out by
# default, so the fallback is the common path rather than the rare one.
#
# What a wrong guess does here is not a wrong message. It is `mongodump --db
# steadingdb` against a database that does not exist, which dumps nothing,
# restores nothing, passes a count check comparing zero to zero (see the tally
# below), and points the API at an empty database that the script has just
# reported as verified.
#
# There is no safe guess to make. The value decides which farm's records get
# copied, this script cannot see the API's build to know which default it
# compiled in, and being wrong is silent. So it asks.
if [ -z "$OLD_DB" ]; then
  die "$ENV_FILE does not set MONGODB_DB, so this script cannot tell which database
  the API is reading — and the answer depends on which build is installed
  ('steading' before the rename commit, 'homefarm' after). Guessing here copies
  the wrong database, or none, and reports success either way.

  Look at what is actually there:

      mongosh \"\$MONGODB_URI\" --quiet --eval 'db.adminCommand({listDatabases:1}).databases.map(d => d.name + \" \" + d.sizeOnDisk).join(\"\\n\")'

  then put the answer in $ENV_FILE as MONGODB_DB=<name> and run this again.
  Nothing has been changed."
fi
MONGO_URI="$(sed -n 's/^MONGODB_URI=\(.*\)$/\1/p' "$ENV_FILE" | tail -1)"
[ -n "$MONGO_URI" ] || die "$ENV_FILE has no MONGODB_URI"

if [ "$KEEP_DB" = 1 ]; then
  skip "database stays '$OLD_DB' (--keep-db)"
  COPY_DB=0
elif [ "$OLD_DB" = "$NEW" ]; then
  skip "database is already '$NEW'"
  COPY_DB=0
else
  note "database $OLD_DB  ->  $NEW  (copied; the old one is left in place)"
  COPY_DB=1
fi

# ── 1a. what would stop this halfway ────────────────────────────────────────
#
# **Every one of these used to be discovered mid-migration**, which is the one
# way this script can hurt a farm. It is written as a report and a `--go`
# precisely so it can refuse at the door; a check that runs at step 6 is not a
# check, it is a trap with a description attached.
#
# Both of the failures that made this necessary were found by running it on a
# live box, and both left the same wreckage — three directories moved, the
# service account renamed, the units not yet installed, and nothing serving:
#
#   * `grantRolesToUser` authenticated as the API's OWN Mongo account. That
#     account is created by `setup-mongo.sh` with `readWrite` and `dbAdmin` on
#     one database and nothing else, so it cannot grant itself rights on a
#     database that does not exist yet. It is not a permission that is usually
#     present and occasionally missing — on a box built by these scripts it can
#     never be there, so the copy could never have worked.
#
#   * `pnpm` links workspace packages by symlink, and on that box they resolved
#     to absolute paths under the OLD tree. Moving the checkout dangled every
#     one of them, so the API came up and died on `ERR_MODULE_NOT_FOUND` for
#     `@homefarm/contracts` before it bound a port. Step 7 would have started it
#     straight into that crash loop, after the database had been copied — a
#     worse place to debug from than the one the grant failure stopped at.
#
# Reported in both modes, because the whole value is that the report tells you
# it will not work while everything is still running.

say "Checks"

PREFLIGHT=0
bad() { printf '  %sFAIL%s %s\n' "$BOLD" "$OFF" "$*"; PREFLIGHT=1; }

# One probe per line, and every one of them says `command -v`, which is what
# `tests/unit/rename-migration.test.ts` keys on when it proves nothing
# destructive runs before the preview. A loop over a word list would put these
# names on a line that reads like an invocation and is not one.
command -v node >/dev/null 2>&1 && note "node is installed" || bad "node is not installed — the checkout has to be reinstalled once it moves"
command -v corepack >/dev/null 2>&1 && note "corepack is installed" || bad "corepack is not installed — the checkout has to be reinstalled once it moves"

if [ "$COPY_DB" = 1 ]; then
  command -v mongosh >/dev/null 2>&1 && note "mongosh is installed" || bad "mongosh is not installed (apt-get install -y mongodb-mongosh)"
  command -v mongodump >/dev/null 2>&1 && note "mongodump is installed" || bad "mongodump is not installed (apt-get install -y mongodb-database-tools)"
  command -v mongorestore >/dev/null 2>&1 && note "mongorestore is installed" || bad "mongorestore is not installed (apt-get install -y mongodb-database-tools)"

  # Asked now, and asked of the account that would have to do it. Granting on a
  # database this user holds no role on needs `grantRole` there, which comes
  # only from userAdminAnyDatabase or root.
  if command -v mongosh >/dev/null 2>&1; then
    ROLES="$(mongosh "$MONGO_URI" --quiet --eval '
      db.runCommand({connectionStatus:1}).authInfo.authenticatedUserRoles
        .map(function (r) { return r.role + "@" + r.db; }).join(",")
    ' 2>/dev/null || true)"

    case ",${ROLES}," in
      *,root@admin,*|*,userAdminAnyDatabase@admin,*)
        note "the API's Mongo account can grant itself rights on '${NEW}'" ;;
      *)
        bad "the API's Mongo account cannot grant itself rights on '${NEW}'.
       It holds: ${ROLES:-<could not read its own roles>}
       That grant needs root@admin or userAdminAnyDatabase@admin, and
       setup-mongo.sh creates this account without either.

       Re-run with --keep-db to rename the box and leave the database
       called '${OLD_DB}'. The name is cosmetic — client.ts selects on
       MONGODB_DB — and the copy is the only irreversible half of this." ;;
    esac
  fi
fi

if [ "$PREFLIGHT" != 0 ]; then
  cat >&2 <<STOP

  ${BOLD}Refusing to start.${OFF} Nothing has been changed, and the API is still up.

  Every check above runs before the first unit is stopped, because the failures
  they describe used to surface halfway through — with the box renamed on disk
  and nothing serving.

STOP
  exit 1
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

# ── 5. the database, BEFORE anything is pointed at it ────────────────────────
#
# ── Why this moved ahead of the environment rewrite ─────────────────────────
#
# **It used to run after it, and a failed copy was then unrecoverable by
# re-running.** Step 5 rewrote `MONGODB_DB=homefarm` into `api.env` and step 6
# then made the database. If the copy failed, the env file already said
# `homefarm` — so on the next run `OLD_DB` read back as `homefarm`, the script
# said "database is already 'homefarm'", set `COPY_DB=0`, and **skipped the copy
# entirely** while pointing the API at a database that was never made. The
# `.pre-rename` backup, which held the only on-box record of the old name, was
# overwritten by the same run.
#
# The order that survives a failure is: make the new database, verify it, and
# only then point anything at it. Nothing below this line runs unless the copy
# above it was counted and matched, so a failure leaves the box exactly as it
# was — old name in `api.env`, old database untouched, and a re-run that reads
# the same facts this one did.
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

    # ── A copy that moved nothing must not report verified ────────────────
    #
    # **The loop below cannot fail on an empty source.** `getCollectionNames()`
    # returns `[]`, `TALLY` is empty, the body never runs once, and the script
    # walks on to rewrite the API's environment and print success — having
    # copied nothing at all. That is the exact outcome a wrong `OLD_DB`
    # produces, so the two defects covered for each other.
    #
    # A farm being renamed has collections; a source with none is a name that is
    # wrong or a database that is gone, and both are reasons to stop before the
    # API is pointed anywhere. The sibling `migrate-to-local-mongo.sh` has this
    # guard already.
    [ -n "$(printf '%s' "$TALLY" | tr -d '[:space:]')" ] || die "'${OLD_DB}' has no collections, so there is nothing to copy and nothing to verify.
  Either that is not the database the API is reading, or it is empty. Check:

      mongosh \"\$MONGODB_URI\" --quiet --eval 'db.adminCommand({listDatabases:1}).databases.map(d => d.name + \" \" + d.sizeOnDisk).join(\"\\n\")'

  Nothing has been removed and nothing has been rewritten."

    COUNTED=0
    while read -r name from to; do
      [ -n "$name" ] || continue
      [ "$from" = "$to" ] || die "$name: ${OLD_DB} has $from, ${NEW} has $to — the copy is incomplete, do NOT start the API. Nothing was removed, and the .pre-rename copies still point at ${OLD_DB}."
      note "$name: $from in both"
      COUNTED=$((COUNTED + 1))
    done <<< "$TALLY"

    # Belt to the check above's braces: `TALLY` non-empty and yet no row read
    # would mean the shape changed under this loop, and a verification that
    # verifies nothing is the thing being fixed here.
    [ "$COUNTED" -gt 0 ] || die "Read no collection counts out of the tally, so nothing was verified.
  Do NOT start the API. Nothing has been removed and nothing has been rewritten." 
  else
    note "would copy ${OLD_DB} -> ${NEW} and verify the counts match"
  fi
fi

# ── 6. the environment files ────────────────────────────────────────────────

say "Rewriting the environment files"
for f in "/etc/${NEW}"/*.env; do
  [ -f "$f" ] || continue
  # ── Never over an existing one ──────────────────────────────────────────
  #
  # **The `.pre-rename` copy is the only on-box record of what this file said
  # before the migration** — the old database name, the old variable names, and
  # the Mongo password if a rewrite ever damages it. A second run overwriting it
  # replaces that record with the already-rewritten file, so the thing kept for
  # recovery becomes a copy of the thing it was meant to recover from.
  #
  # The copy above is now ordered ahead of this, which stops the half-state that
  # made a second run likely. This is the other half: if there is a second run,
  # it must not destroy what the first one preserved.
  if [ -e "$f.pre-rename" ]; then
    note "$f (kept the existing $f.pre-rename — it is from before the first run)"
  else
    do_it cp -a "$f" "$f.pre-rename"
  fi
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
    sed -i -e 's/^STEADING_/HOMEFARM_/' "$f"

    # Only when the database is actually being copied. Pointing the API at a
    # database that was never made is how a rename becomes an outage, and it is
    # exactly what --keep-db exists to avoid.
    if [ "$COPY_DB" = 1 ]; then
      sed -i \
        -e "s#^MONGODB_DB=.*#MONGODB_DB=${NEW}#" \
        -e "s#/${OLD_DB}?#/${NEW}?#" \
        "$f"
      grep -q '^MONGODB_DB=' "$f" || printf 'MONGODB_DB=%s\n' "$NEW" >> "$f"
    fi
  fi
  note "$f rewritten"
done

# ── 6a. the workspace, which does not survive the move on its own ───────────
#
# `pnpm` links workspace packages by symlink. On the box this was written for
# they were absolute paths into the OLD tree, so moving it left every one of
# them dangling and the API died at its first import — `ERR_MODULE_NOT_FOUND`
# for `@homefarm/contracts`, before it bound a port, on a loop until systemd's
# start limiter gave up.
#
# The same command `deploy.sh` and `setup-box.sh` use, so this is the box's own
# supported path rather than a third opinion about how to install. The chown
# follows it because pnpm runs as root here and writes into `node_modules`;
# without it the service user cannot read what was just built.

say "Reinstalling the workspace"
if [ "$GO" = 1 ]; then
  ( cd "/opt/${NEW}" && corepack pnpm install --frozen-lockfile --filter "@${NEW}/api..." ) \
    || die "the reinstall failed — the tree has moved and its workspace links are not rebuilt, so do NOT start the API. Fix the install, then re-run this script."
  # Guarded exactly as the chown in step 4 is. A missing account here is a bare
  # `chown: invalid user` and a silent `set -e` exit, after the tree has moved
  # and the database has been copied — no message, nothing serving.
  if id "$NEW" >/dev/null 2>&1; then
    chown -R "${NEW}:${NEW}" "/opt/${NEW}"
    note "workspace links rebuilt and owned by ${NEW}"
  else
    note "workspace links rebuilt (no ${NEW} account to own them)"
  fi
else
  note "would run: corepack pnpm install --frozen-lockfile --filter \"@${NEW}/api...\" in /opt/${NEW}"
fi

# ── 7. up ───────────────────────────────────────────────────────────────────
#
# The unit files come out of the moved checkout, which is now the renamed one,
# so `setup-box.sh`'s installation step is the thing to reuse rather than a
# second copy of it here. It is idempotent and rewrites what it finds.

say "Installing the new units"
REPO="/opt/${NEW}"
NEW_UNITS=("${NEW}-api.service" "${NEW}-ops.service" "${NEW}-deploy.service" "${NEW}-deploy.timer" \
           "${NEW}-backup.service" "${NEW}-backup.timer" "${NEW}-backup-check.service" "${NEW}-backup-check.timer")

# ── The replacements have to exist before the originals are removed ─────────
#
# **Every old unit was `rm -f`'d first, and only then was the checkout asked
# whether it had new ones.** A checkout that does not carry them — an older
# release, a shallow clone, a tree that moved but did not update — therefore
# left the box with **no API unit at all**, after the database had already been
# copied and the trees already moved. Nothing to start, and the thing that would
# have deployed a fix is one of the units that was just deleted.
#
# The API's unit is the one that matters; the rest degrade. So: refuse before
# removing anything if it is missing, and name what is there.
[ -f "$REPO/scripts/deploy/${NEW}-api.service" ] || die "$REPO/scripts/deploy/${NEW}-api.service is not in the checkout, so removing
  the old units would leave this box with nothing to start the API. The trees
  have moved and the database is copied; the environment files have been
  rewritten. Nothing else has been touched.

  This is an old or incomplete checkout. Update it and run this again:

      cd $REPO && sudo git fetch origin release && sudo git reset --hard FETCH_HEAD"

MISSING=()
for u in "${NEW_UNITS[@]}"; do
  [ -f "$REPO/scripts/deploy/$u" ] || MISSING+=("$u")
done
[ ${#MISSING[@]} -eq 0 ] || note "not in this checkout, so not installed: ${MISSING[*]}"

for u in "${UNITS[@]}"; do
  do_it rm -f "/etc/systemd/system/$u"
done
do_it systemctl daemon-reload

for u in "${NEW_UNITS[@]}"; do
  [ -f "$REPO/scripts/deploy/$u" ] || continue
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

DONE

# **Which database is safe to drop depends on whether one was copied**, and
# printing the wrong answer here is worse than printing nothing.
#
# With `--keep-db` there is no second copy: `$OLD_DB` is not a spare left behind
# for rollback, it is the database the API was just started against. The
# paragraph below used to print unconditionally, so the one flag added to keep a
# box safe ended by handing the operator a command that destroys the farm's only
# dataset — days later, with the box healthy, following the script's own advice.
if [ "$COPY_DB" = 1 ]; then
  cat <<KEPT

  ${BOLD}The old database is still there, untouched.${OFF} That is deliberate — it is
  the way back. When the new one has carried a few days of real use:

       mongosh "\$MONGODB_URI" --eval 'db.getSiblingDB("${OLD_DB}").dropDatabase()'

  Not before. There is no undo for that line and no second copy.

KEPT
else
  cat <<LIVE

  ${BOLD}The database is still called '${OLD_DB}', and it is the live one.${OFF}
  Nothing was copied, so there is no spare and nothing here is safe to drop.

  The box is renamed; the database name is not, and it does not need to be —
  ${BOLD}client.ts${OFF} selects on MONGODB_DB, so the name is cosmetic. Renaming it later
  means granting this box's Mongo account rights on the new name first, which
  needs root or userAdminAnyDatabase.

LIVE
fi
