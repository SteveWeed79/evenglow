#!/usr/bin/env bash
#
# Is this box actually set up? Read-only — changes nothing, starts nothing.
#
#   sudo /opt/homefarm/scripts/deploy/check-box.sh
#
# ## Why this exists
#
# Every failure this repository has had on a live box looked like nothing at
# all: backup units nothing installed, a deploy unit failing every five minutes
# behind a green timer, an `.env.local` pointing at a directory that had walked
# away, an API answering `/health` while reading an empty database, an
# auth-disabled window that outlived the script that opened it. None of them
# announced themselves, and each was found by somebody happening to look.
#
# So this looks, in one command, at the things that are silent when they break.
# It exits non-zero if any check fails, so a timer or a deployment step can use
# it as well as a person.
#
# It asserts nothing it cannot check. An unauthenticated Mongo read must be
# REFUSED rather than merely erroring; `/ready` must name a reachable database
# rather than merely answering; the checkout is compared against the release ref
# rather than against whatever it happens to hold.
set -uo pipefail

[ "$(id -u)" = 0 ] || { printf '\n  Run this with sudo — several checks read root-only files.\n\n' >&2; exit 2; }

NEW=homefarm
OLD=steading   # check:names-ok-file — this looks for leftovers of the old name
PORT="${PORT:-3001}"

ok=0; bad=0; warn=0
OK(){ printf '  \033[32mok  \033[0m %s\n' "$*"; ok=$((ok+1)); }
NO(){ printf '  \033[31mFAIL\033[0m %s\n' "$*"; bad=$((bad+1)); }
HM(){ printf '  \033[33mnote\033[0m %s\n' "$*"; warn=$((warn+1)); }
H (){ printf '\n\033[1m%s\033[0m\n' "$*"; }
# A follow-up line under a finding, indented to where its message starts. Not a
# result of its own — it counts toward nothing and only ever explains the line
# above it.
TIP(){ printf '       %s\n' "$*"; }

H "Paths and ownership"
for d in "/opt/$NEW" "/etc/$NEW" "/var/lib/$NEW"; do
  [ -d "$d" ] && OK "$d exists" || NO "$d is missing"
done
[ -e "/opt/$OLD" ] && HM "/opt/$OLD still exists — a leftover of the rename" || OK "no /opt/$OLD remnant"
id "$NEW" >/dev/null 2>&1 && OK "service account $NEW exists" || NO "no $NEW account"
[ "$(stat -c%U "/opt/$NEW" 2>/dev/null)" = "$NEW" ] && OK "/opt/$NEW owned by $NEW" || NO "/opt/$NEW is not owned by $NEW"

# The one thing a directory move breaks silently rather than obviously.
LINK="/opt/$NEW/.env.local"
if [ -L "$LINK" ]; then
  [ -e "$LINK" ] && OK ".env.local -> $(readlink "$LINK")" \
                 || NO ".env.local is DANGLING -> $(readlink "$LINK") (farm:ls and db:indexes will say MONGODB_URI is not set)"
elif [ -f "$LINK" ]; then OK ".env.local is a real file"
else HM "no .env.local — only the pnpm operator commands need it"; fi

ENVF="/etc/$NEW/api.env"
[ -f "$ENVF" ] && OK "api.env present" || NO "api.env missing"
[ "$(stat -c%a "$ENVF" 2>/dev/null)" = "600" ] && OK "api.env is 0600" || NO "api.env is $(stat -c%a "$ENVF" 2>/dev/null), want 600"
DB="$(sed -n 's/^MONGODB_DB=\(.*\)$/\1/p' "$ENVF" 2>/dev/null | tail -1)"
[ -n "$DB" ] && OK "MONGODB_DB=$DB" || HM "MONGODB_DB unset — databaseName()'s default applies"

H "Units"
for u in "$NEW-api.service" "$NEW-deploy.timer" "$NEW-backup.timer" "$NEW-backup-check.timer"; do
  [ -f "/etc/systemd/system/$u" ] && OK "$u installed" || NO "$u NOT installed"
done
systemctl is-active  --quiet "$NEW-api" && OK "$NEW-api running"        || NO "$NEW-api NOT running"
systemctl is-enabled --quiet "$NEW-api" && OK "$NEW-api starts on boot" || NO "$NEW-api not enabled"
# Not a failure either way, but the board reads every farm, so say when it is up.
systemctl is-active --quiet "$NEW-ops" 2>/dev/null && HM "ops board is RUNNING — it reads every farm on this box" || OK "ops board not running"
for t in "$NEW-deploy.timer" "$NEW-backup.timer" "$NEW-backup-check.timer"; do
  systemctl is-enabled --quiet "$t" 2>/dev/null && OK "$t enabled" || HM "$t not enabled"
done
# ── A failed unit, and which kind of failed ─────────────────────────────────
#
# **`rename-to-homefarm.sh` stopped the old units and never removed them.** It
# runs `systemctl disable --now` over the five `steading-*` names and moves on;
# their files stay in /etc/systemd/system, and a unit that failed before it was
# disabled stays failed. So every box that was renamed rather than built fresh
# carries permanent entries here — the live one has carried two since the
# rename.
#
# **Still a FAIL, and the reason is not the dead units.** They serve nothing and
# cost nothing on their own. What they cost is the alarm:
# `homefarm-backup-check` reports "no backup in 36 hours" *by going red*, and
# `systemctl --failed` is where somebody would see it. A list that always has
# something in it is a list nobody reads a new line in — which is this script's
# own subject, a signal that is technically present and useless.
#
# Split rather than merely listed, so a genuine failure cannot be read as more
# of the same and so the line can say what to do about the leftovers. **This
# script changes nothing** and does not start here: the command is printed for
# a person to run.
#
# ## Three details in that command, each of which was wrong first
#
# **`disable --now` before the removal**, because an enabled unit has symlinks
# in `*.wants/` that a deleted file leaves dangling — `daemon-reload` then
# complains about a unit nobody can look at any more. `rename-to-homefarm.sh`
# already disabled these, so on the live box it is a no-op; a box where it half
# ran is exactly the one that needs it. Failures are swallowed for the same
# reason: disabling a unit that is already gone must not stop the removal.
#
# **`-rf` and no suffix**, because a unit can have a drop-in *directory* beside
# it. The live box carries `steading-api.service.d/netlink.conf` — the
# hand-applied `AF_NETLINK` fix from the first deployment, which is now a
# tracked line in `homefarm-api.service` and needs nothing done to keep it. A
# glob ending in `.service` walks straight past that directory and leaves an
# orphan configuring a unit that no longer exists.
#
# **`ls` first**, and it is not politeness. This is the only line in this script
# that suggests deleting anything, on a box holding a farm's only copy of its
# records; a person looking at what the glob covers before running it is the
# whole safety property.
#
# Trimmed rather than left with the trailing space `tr` leaves, because `$STALE`
# is interpolated into a command a person is meant to paste. Followed by a
# redirect it would otherwise have to read `${STALE}2>...`, which is one brace
# away from expanding a variable named `STALE2` and exiting on `set -u`.
FAILED="$(systemctl --failed --no-legend --plain 2>/dev/null | awk '{print $1}')"
STALE="$(printf '%s\n' "$FAILED" | grep "^$OLD-" | tr '\n' ' ' | sed 's/ *$//' || true)"
LIVE="$(printf '%s\n' "$FAILED" | grep -v "^$OLD-" | grep . | tr '\n' ' ' | sed 's/ *$//' || true)"

[ -z "$LIVE" ] && OK "no failed units" || NO "failed: $LIVE"
if [ -n "$STALE" ]; then
  NO "left over from the rename, permanently red: $STALE"
  TIP "these hide the next real one. Look, then remove them:"
  TIP "    ls -la /etc/systemd/system/$OLD-*"
  TIP "    sudo systemctl disable --now $STALE 2>/dev/null"
  TIP "    sudo rm -rf /etc/systemd/system/$OLD-*"
  TIP "    sudo systemctl daemon-reload && sudo systemctl reset-failed"
fi

H "The API"
curl -fsS "localhost:$PORT/health" >/dev/null 2>&1 && OK "/health answers on $PORT" || NO "/health does not answer on $PORT"
READY="$(curl -fsS "localhost:$PORT/ready" 2>/dev/null)"
case "$READY" in
  *'"database":"reachable"'*) OK "/ready — database reachable" ;;
  *)                          NO "/ready says: ${READY:-no answer}" ;;
esac

H "MongoDB"
systemctl is-active --quiet mongod && OK "mongod running" || NO "mongod NOT running"
grep -q 'authorization: *enabled' /etc/mongod.conf 2>/dev/null \
  && OK "authorization: enabled in mongod.conf" \
  || NO "authorization NOT enabled in /etc/mongod.conf"
if command -v mongosh >/dev/null 2>&1; then
  # Refused, not merely errored. This is the check that would have caught a
  # setup-mongo.sh that died inside its auth-disabled window.
  if mongosh --quiet --eval 'db.getSiblingDB("admin").system.users.countDocuments({})' >/dev/null 2>&1; then
    NO "UNAUTHENTICATED READ SUCCEEDED — every process on this box can read and write every farm"
  else
    OK "unauthenticated read refused"
  fi
else HM "mongosh not installed — cannot test the lock"; fi

H "Backups"
MARK="/var/lib/$NEW/.last-backup"
if [ -f "$MARK" ]; then
  AGE=$(( ( $(date -u +%s) - $(cat "$MARK") ) / 3600 ))
  [ "$AGE" -lt 36 ] && OK "last backup ${AGE}h ago" || NO "last backup ${AGE}h ago — past the 36h threshold"
else
  NO "NO BACKUP HAS EVER COMPLETED on this box"
fi
[ -f "/etc/$NEW/backup.env" ] && OK "backup.env present" || NO "backup.env missing — backups cannot run"

H "Checkout"
if [ -d "/opt/$NEW/.git" ]; then
  HEADC="$(git -C "/opt/$NEW" rev-parse --short HEAD 2>/dev/null)"
  git -C "/opt/$NEW" fetch -q origin release 2>/dev/null
  RELC="$(git -C "/opt/$NEW" rev-parse --short FETCH_HEAD 2>/dev/null)"
  if [ -z "$RELC" ]; then HM "could not read the release ref (offline?) — HEAD is $HEADC"
  elif [ "$HEADC" = "$RELC" ]; then OK "on release ($HEADC)"
  else NO "HEAD=$HEADC but release=$RELC — this box is behind"; fi
  git -C "/opt/$NEW" remote get-url origin 2>/dev/null | grep -q evenglow \
    && OK "remote points at evenglow" \
    || HM "remote is $(git -C "/opt/$NEW" remote get-url origin 2>/dev/null) — works only while GitHub redirects"
else NO "no checkout at /opt/$NEW"; fi

H "Caddy and the download page"
if ! command -v caddy >/dev/null 2>&1; then
  HM "caddy is not installed — nothing on this box serves TLS or /app"
else
  systemctl is-active --quiet caddy && OK "caddy running" || NO "caddy NOT running"

  # ── Running, and serving something else entirely ──────────────────────────
  #
  # **`is-active` is true of a Caddy that refused its last config.** It logs the
  # refusal and goes on serving the previous one, which is a sensible thing to
  # do and completely invisible from here.
  #
  # This box did that for ten days. `/var/log/caddy/homefarm.log` had been
  # created by root at 0600, caddy could not open it, so every reload was
  # rejected and a pre-rename config stayed live — rooted at a directory that
  # no longer existed. `systemctl status caddy` said `active (running)`,
  # `deploy.sh` said `unchanged`, this script said `ok caddy running`, and the
  # download answered 404 the whole time. Three green checks and a broken box.
  #
  # The admin API is the only thing here that knows what is loaded.
  RUNNING="$(curl -fsS --max-time 5 http://127.0.0.1:2019/config/ 2>/dev/null || true)"
  if [ -z "$RUNNING" ]; then
    HM "caddy's admin API did not answer on 2019 — cannot tell which config is live"
  elif printf '%s' "$RUNNING" | grep -q "/var/lib/$NEW/dist"; then
    OK "caddy is running the config on disk"
  else
    NO "CADDY IS RUNNING A CONFIG THAT IS NOT THE ONE ON DISK — a reload was refused (journalctl -u caddy -n 40)"
  fi

  # The cause of that failure rather than the symptom, so it is repairable
  # without reading a journal. Ownership, not mode: caddy opens this as itself.
  CLOG="/var/log/caddy/$NEW.log"
  if [ ! -e "$CLOG" ]; then
    HM "$CLOG does not exist — caddy or the next deploy creates it"
  elif [ "$(stat -c%U "$CLOG" 2>/dev/null)" = caddy ]; then
    OK "$CLOG belongs to caddy"
  else
    NO "$CLOG is owned by $(stat -c%U "$CLOG" 2>/dev/null) — caddy cannot open it, so EVERY reload is refused"
  fi

  # ── The thing somebody is actually sent to ────────────────────────────────
  #
  # Every check above can pass while this fails, and this is the one a person
  # notices: *"I still cannot access the download."* Asked over the real name
  # and the real certificate, because that is how a handset asks — a local
  # request answers 308 and proves nothing.
  #
  # Every site block is tried rather than the first. A box that predates conf.d
  # has the operations board in this file too, and which one `head -1` returns
  # is not something to stake a FAIL on.
  BLOCKS="$(sed -n 's/^\([a-z0-9.-]*\) {$/\1/p' /etc/caddy/Caddyfile 2>/dev/null)"
  if [ -z "$BLOCKS" ]; then
    HM "could not read a site name out of /etc/caddy/Caddyfile — did not test /app/"
  else
    APP=""; SEEN=""; REACHED=0
    for d in $BLOCKS; do
      CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "https://$d/app/" 2>/dev/null || true)"
      SEEN="$SEEN $d=${CODE:-000}"
      [ "${CODE:-000}" = 000 ] || REACHED=1
      [ "$CODE" = 200 ] && APP="$d"
    done
    if [ -n "$APP" ]; then
      OK "https://$APP/app/ answers 200"
    elif [ "$REACHED" = 0 ]; then
      # Not a failure on its own: a box is not always able to reach its own
      # public name from the inside.
      HM "could not reach any site's /app/ from this box —$SEEN"
    else
      NO "/app/ is not being served —$SEEN"
    fi
  fi
fi

H "SSH and firewall"
SSHD="$(sshd -T 2>/dev/null)"
if [ -n "$SSHD" ]; then
  printf '%s\n' "$SSHD" | grep -qi '^passwordauthentication no' && OK "password auth off" || NO "PASSWORD AUTH IS ON"
  printf '%s\n' "$SSHD" | grep -qi '^permitrootlogin no'        && OK "root login off"    || NO "ROOT LOGIN IS ALLOWED"
else HM "could not read the effective sshd config"; fi
if command -v iptables >/dev/null 2>&1; then
  iptables -C INPUT -p tcp --dport 27017 -m conntrack --ctstate NEW -j ACCEPT 2>/dev/null \
    && NO "27017 IS OPEN — nothing outside this box needs it" \
    || OK "27017 not opened"
fi

printf '\n\033[1m%s ok, %s failed, %s to look at\033[0m\n\n' "$ok" "$bad" "$warn"
[ "$bad" = 0 ]
