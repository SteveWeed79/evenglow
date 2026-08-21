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
FAILED="$(systemctl --failed --no-legend --plain 2>/dev/null | awk '{print $1}' | tr '\n' ' ')"
[ -z "$FAILED" ] && OK "no failed units" || NO "failed: $FAILED"

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

H "SSH and firewall"
SSHD="$(sshd -T 2>/dev/null)"
if [ -n "$SSHD" ]; then
  printf '%s\n' "$SSHD" | grep -qi '^passwordauthentication no' && OK "password auth off" || NO "PASSWORD AUTH IS ON"
  printf '%s\n' "$SSHD" | grep -qi '^permitrootlogin no'        && OK "root login off"    || NO "ROOT LOGIN IS ALLOWED"
else HM "could not read the effective sshd config"; fi
if command -v caddy >/dev/null 2>&1; then
  systemctl is-active --quiet caddy && OK "caddy running" || NO "caddy NOT running"
fi
if command -v iptables >/dev/null 2>&1; then
  iptables -C INPUT -p tcp --dport 27017 -m conntrack --ctstate NEW -j ACCEPT 2>/dev/null \
    && NO "27017 IS OPEN — nothing outside this box needs it" \
    || OK "27017 not opened"
fi

printf '\n\033[1m%s ok, %s failed, %s to look at\033[0m\n\n' "$ok" "$bad" "$warn"
[ "$bad" = 0 ]
