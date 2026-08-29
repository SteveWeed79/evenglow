#!/usr/bin/env bash
#
# The farm server, from a fresh Oracle Always Free instance to a working
# https:// address. Run it once, on the box, as a user with sudo:
#
#   git clone https://github.com/SteveWeed79/evenglow /opt/homefarm
#   sudo /opt/homefarm/scripts/deploy/setup-box.sh api.swbuild.dev
#
# Idempotent — safe to run again after a failure or a change. Every step says
# what it is doing and stops on the first thing that does not work, because a
# half-configured server that answers some requests is worse than one that
# answers none.
#
# ## What this does NOT do
#
# It does not write `/etc/homefarm/api.env`. That file holds the database URI
# and the token signing secret, and a script that generated or copied secrets
# would put them in a shell history, a log, or this repository. The script
# creates it empty at mode 0600 and tells you what to put in it.
#
# ## Ubuntu, ARM
#
# Written for the aarch64 Ubuntu image, which is what `ACCESS-AND-BILLING.md`
# §4.1a specifies. Nothing here compiles: `@node-rs/argon2-linux-arm64-gnu` and
# `@esbuild/linux-arm64` are both in the lockfile as optional dependencies, so
# the right binaries install and no toolchain is needed. Checked, not assumed.

set -euo pipefail

DOMAIN="${1:-}"
REPO_DIR="${HOMEFARM_DIR:-/opt/homefarm}"
SERVICE_USER="homefarm"
NODE_MAJOR=22

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }
die() { printf '\n\033[1;31mSTOPPED:\033[0m %s\n\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run this with sudo."

if [ -z "$DOMAIN" ]; then
  die "Give it the name the app will use, e.g.

    sudo $0 api.swbuild.dev

  That name needs an A record pointing at this box BEFORE you run this,
  because Caddy asks Let's Encrypt for a certificate and Let's Encrypt
  checks the name resolves here. Check it with:

    dig +short api.swbuild.dev"
fi

[ -d "$REPO_DIR/.git" ] || die "No checkout at $REPO_DIR. Clone the repo there first:
    sudo git clone https://github.com/SteveWeed79/evenglow $REPO_DIR"

# ── 1. The firewall Oracle does not tell you about ──────────────────────────
#
# Two firewalls stand between the internet and this box, and opening one is
# the single most common way an Oracle deployment appears dead:
#
#   1. The VCN security list, in the cloud console. NOT scriptable from here —
#      it lives in Oracle's control plane, not on the instance.
#   2. The instance's own iptables. Oracle's Ubuntu images ship with a REJECT
#      rule near the end of the INPUT chain and allow only SSH before it, and
#      `ufw` does not manage those rules — so `ufw allow 443` reports success
#      and changes nothing.
#
# This handles the second and cannot handle the first.
say "Opening 80 and 443 on the instance firewall"
if command -v iptables >/dev/null 2>&1; then
  for port in 80 443; do
    # -C tests for the rule; appending only when absent keeps this idempotent
    # rather than growing the chain by two on every run.
    if iptables -C INPUT -p tcp --dport "$port" -m conntrack --ctstate NEW -j ACCEPT 2>/dev/null; then
      note "port $port already open"
    else
      # Inserted at the TOP, because Oracle's chain ends in a REJECT that a
      # rule appended after it would never be reached past.
      iptables -I INPUT 1 -p tcp --dport "$port" -m conntrack --ctstate NEW -j ACCEPT
      note "port $port opened"
    fi
  done

  if command -v netfilter-persistent >/dev/null 2>&1; then
    netfilter-persistent save >/dev/null
    note "saved, so it survives a reboot"
  else
    DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent >/dev/null 2>&1 || true
    command -v netfilter-persistent >/dev/null 2>&1 && netfilter-persistent save >/dev/null
    note "installed iptables-persistent and saved"
  fi
else
  note "no iptables here — check what this image uses before assuming it is open"
fi

# ── 2. The small tools the deploy path assumes ──────────────────────────────
#
# **`unzip` is not a convenience here, it is a security control.** Both of the
# checks that establish an APK is an APK and is *ours* live in
# `publish-apk.sh` and both need it — they used to be skipped when it was
# absent, which is every box, so any zip named `.apk` was published as the
# farm's app. That script refuses to publish without it now; this is what makes
# the refusal something a box never meets.
#
# Unconditional, unlike the block below it: the Node install already pulls
# `ca-certificates curl gnupg git`, but only on a box that needed Node. A box
# that already had it got none of them, which is the shape of dependency that
# goes missing exactly where nobody is looking.
say "Tools the deploy path needs"
if command -v unzip >/dev/null 2>&1; then
  note "unzip already installed"
else
  apt-get update -qq
  apt-get install -y unzip >/dev/null
  note "installed unzip — publish-apk.sh cannot verify a build without it"
fi

# ── 3. Node ─────────────────────────────────────────────────────────────────
say "Node $NODE_MAJOR"
if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge "$NODE_MAJOR" ]; then
  note "$(node --version) already installed"
else
  apt-get update -qq
  apt-get install -y ca-certificates curl gnupg git >/dev/null
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg --yes
  chmod a+r /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y nodejs >/dev/null
  note "installed $(node --version)"
fi

# Corepack takes the pnpm version from package.json's `packageManager` field,
# so the box cannot resolve against a different pnpm than CI and the developer.
say "pnpm, via corepack"
corepack enable
note "$(cd "$REPO_DIR" && corepack pnpm --version 2>/dev/null || echo 'will pin on first use')"

# ── 4. The user the service runs as ─────────────────────────────────────────
say "Service user: $SERVICE_USER"
if id "$SERVICE_USER" >/dev/null 2>&1; then
  note "already exists"
else
  # No login shell and no home: this account exists to own a process, and
  # anything that can log in as it is a way in.
  useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  note "created"
fi

# ── 5. Dependencies ─────────────────────────────────────────────────────────
say "Installing the API's dependencies"
cd "$REPO_DIR"
# Filtered: without it this pulls Expo and React Native onto a server that
# imports neither. The trailing dots mean "and what it depends on".
corepack pnpm install --frozen-lockfile --filter "@homefarm/api..."
[ -f "$REPO_DIR/node_modules/tsx/dist/cli.mjs" ] \
  || die "tsx is not where the service unit expects it ($REPO_DIR/node_modules/tsx/dist/cli.mjs).
  That means the install did not hoist. Check .npmrc still sets node-linker=hoisted."
chown -R "$SERVICE_USER:$SERVICE_USER" "$REPO_DIR"

# The chown above is what makes this necessary. Root running git in a checkout
# owned by another user is refused since CVE-2022-24765, and `deploy.sh` runs
# as root — so without this the deploy timer fails every five minutes into the
# journal and never deploys anything, while the box looks perfectly healthy.
# `deploy.sh` sets it too; doing it here means the first run is already clean.
git config --system --get-all safe.directory 2>/dev/null | grep -qxF "$REPO_DIR" \
  || git config --system --add safe.directory "$REPO_DIR"

# ── so the operator commands work here without ceremony ─────────────────────
#
# Every command in `docs/OPERATOR.md` — farm:ls, farm:show, farm:grant,
# db:usage, db:indexes — runs `tsx --env-file-if-exists=../../.env.local`. On a
# developer's machine that file is the config. On this box the config lives in
# /etc/homefarm/api.env instead, so all of them came up with
#
#   Error: MONGODB_URI is not set. Copy .env.example to .env.local ...
#
# and the workaround was two exports typed again after every reconnect — which
# is also two chances to answer an operational question against the wrong
# database, having pasted a stale URI from further up the scrollback.
#
# A symlink rather than a copy, deliberately: it reads the LIVE config, so it
# cannot drift from what the service itself is using. Three things make it safe
# — `.env*` is gitignored so it cannot be committed, the target stays 0600 and
# root-owned so only sudo reads it, and `deploy.sh`'s chown touches the link
# rather than the file behind it.
# `-e` alone is not enough, and the gap is not theoretical: `-e` follows the
# link, so a **dangling** one reads as absent, and the bare `ln -s` that
# followed then failed with "File exists" and took this whole script down with
# it under `set -e`. That is exactly the state a box is left in after
# `rename-to-homefarm.sh` moves `/etc/steading` out from under a link that names
# it — so re-running setup-box, which is the documented repair, was the one
# thing guaranteed to abort. `-L` sees the link itself, and `-sfn` replaces it.
if [ ! -e "$REPO_DIR/.env.local" ] || [ -L "$REPO_DIR/.env.local" ]; then
  ln -sfn /etc/homefarm/api.env "$REPO_DIR/.env.local"
  note "linked .env.local -> /etc/homefarm/api.env, so sudo pnpm farm:ls works"
fi
note "ready"

# ── 6. The secrets file, created empty ──────────────────────────────────────
say "Configuration"
install -d -m 0750 /etc/homefarm
if [ -f /etc/homefarm/api.env ]; then
  note "/etc/homefarm/api.env already exists — left exactly as it is"
else
  cat > /etc/homefarm/api.env <<'ENV'
# Read by systemd, never committed. Mode 0600.
#
# Two values are required and the service will not start without them.

# 32 characters or more. Signs access and refresh tokens; changing it signs
# every device out. Generate one with:  openssl rand -base64 48
AUTH_SECRET=

# The connection string. This deployment runs `mongod` on this same box, bound
# to 127.0.0.1 — `setup-mongo.sh` installs it and prints the string once, and
# that is what goes here. A managed cluster's string works too; if you use one,
# its Network Access list has to carry this box's public address or every
# request hangs for five seconds and fails.
MONGODB_URI=

# **Which database inside that cluster, and this is NOT taken from the URI.**
#
# `client.ts` calls `client.db(process.env.MONGODB_DB ?? 'homefarm')` — so a
# connection string ending in /something is connected to and then ignored. The
# two are separate settings and the default is only right if the database is
# actually called `homefarm`.
#
# It caught the first real deployment. A cluster named `steadingdb` holding a
# database also named `steadingdb` is an ordinary thing to end up
# with, and the server then answers /health perfectly while every real request
# reads an empty database that it silently creates. Which looks, from a
# handset, exactly like a farm's records having vanished.
#
# **Commented out rather than left blank, and the difference is not cosmetic.**
# systemd turns `MONGODB_DB=` into an empty STRING, not an absent variable, and
# an empty string is a value — so it would be used. `client.ts` guards against
# that now; leaving the line commented means nothing depends on the guard.
#
# Uncomment and fill in when the database is not called `homefarm`. Check
# rather than assume:
#   mongosh "<uri>" --eval 'db.adminCommand({listDatabases:1}).databases.forEach(d=>print(d.name))'
#MONGODB_DB=

# Caddy is in front and sets X-Forwarded-For. Without this the service does not
# believe that header, so request.ip is 127.0.0.1 for every request — and every
# rate limiter keys on request.ip, so the auth limiter would treat the whole
# internet as one caller and lock a farm out over a stranger's typo.
TRUSTED_PROXY_HOPS=1

PORT=3001

# ── "Something is wrong" (docs/SUPPORT-LOOP.md) ─────────────────────────────
#
# The app's report button posts a bundle here and this server files it as a
# GitHub issue. Without both lines below /support answers 501, and the app tells
# the farm *this server has nowhere to file a report* and offers its share
# sheet instead. That is a supported state — but it is not the loop, and it is
# not what you want on the box you are testing against.
#
# **This is per-server, and that is what catches people.** Setting it in the
# repo checkout on a laptop configures the laptop. A handset pointed at this box
# is asking THIS file.
#
# A fine-grained token from
# https://github.com/settings/personal-access-tokens/new
#   Repository access -> Only select repositories -> homefarm
#   Permissions -> Repository permissions -> Issues: Read and write
# and nothing else. It files issues and that is the whole of what it can do.
#SUPPORT_GITHUB_TOKEN=
#SUPPORT_REPO=SteveWeed79/evenglow

# Whether a farm's own records may ride along with a report (S5).
#
# LEAVE THIS OFF WHILE THE REPOSITORY IS PUBLIC. An issue on a public repo is
# world-readable and a farm cannot meaningfully consent to that on a prompt in
# a barn. The lean bundle is safe in public by construction — structure and
# counts, never content — and this switch is the other half.
#SUPPORT_ACCEPT_RECORDS=
ENV
  chmod 0600 /etc/homefarm/api.env
  note "created /etc/homefarm/api.env — FILL IT IN before starting the service"
fi

# ── 7. The service ──────────────────────────────────────────────────────────
say "Installing the service"
sed "s#/opt/homefarm#${REPO_DIR}#g" \
  "$REPO_DIR/scripts/deploy/homefarm-api.service" > /etc/systemd/system/homefarm-api.service
sed "s#/opt/homefarm#${REPO_DIR}#g" \
  "$REPO_DIR/scripts/deploy/homefarm-deploy.service" > /etc/systemd/system/homefarm-deploy.service
cp "$REPO_DIR/scripts/deploy/homefarm-deploy.timer" /etc/systemd/system/homefarm-deploy.timer

# ── The backup pair, which nothing used to install ──────────────────────────
#
# **This script mentioned backups nowhere at all.** The four units were a manual
# copy in the middle of a deployment document, so the documented build produced a
# box with no backups — and, because the checker is one of the four, no alarm
# either. `systemctl --failed` stayed clean. A box with no off-box copy of a
# farm's records looked exactly like a working one, and that is how one was found
# months later.
#
# `homefarm-backup-check` is enabled here and now, before `backup.env` exists and
# before the timer beside it is started. That is deliberate: with no marker,
# `check-backup.sh` says "No backup has ever completed on this box" and prints
# the command that fixes it — which is the true state of a box that has just been
# built, and the one thing the old arrangement could never say.
#
# `homefarm-backup.timer` is left for the operator, exactly like the deploy
# timer above and for the same reason: a nightly job against an unwritten
# `backup.env` is a failure a night, and the check already names it.
for u in homefarm-backup.service homefarm-backup.timer \
         homefarm-backup-check.service homefarm-backup-check.timer; do
  sed "s#/opt/homefarm#${REPO_DIR}#g" "$REPO_DIR/scripts/deploy/$u" > "/etc/systemd/system/$u"
done

systemctl daemon-reload
systemctl enable homefarm-api >/dev/null
note "enabled (starts on boot)"
systemctl enable --now homefarm-backup-check.timer >/dev/null
note "homefarm-backup-check.timer enabled — it will report that no backup exists yet, which is true"

# Installed but NOT started. Automatic deployment onto a box whose two secrets
# are still blank would restart a service that cannot come up, every five
# minutes, and bury the real reason under the noise. Turn it on once the thing
# is known to work.
note "homefarm-deploy.timer installed but not started — see DEPLOY-THE-SERVER"

# ── 8. Caddy, and with it the certificate ───────────────────────────────────
say "Caddy, for $DOMAIN"
if command -v caddy >/dev/null 2>&1; then
  note "already installed"
else
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https >/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg --yes
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y caddy >/dev/null
  note "installed"
fi

# ── The directory AND the file ────────────────────────────────────────────
#
# This created the directory and stopped, which looks complete and is not. The
# Caddyfile names `/var/log/caddy/homefarm.log`, and whichever process wrote
# there first owned the file — on the live box that was root running the rename
# by hand, at 0600. Caddy opens its log files as `caddy` when it loads a config
# and refuses the whole config when it cannot, so the box served a pre-rename
# config for ten days while reporting `active (running)`.
#
# `deploy.sh` repairs this on every tick as well, because a box already built
# will never run this script again.
install -d -m 0755 /var/log/caddy
[ -e /var/log/caddy/homefarm.log ] || : > /var/log/caddy/homefarm.log
chmod 0644 /var/log/caddy/homefarm.log 2>/dev/null || true
chown caddy:caddy /var/log/caddy /var/log/caddy/homefarm.log 2>/dev/null || true

# Where the APK is served from (`/app`, see the Caddyfile). Created empty and
# **outside the repository on purpose** — the deploy timer pulls into
# $REPO_DIR every five minutes, so a build kept in that tree would be one
# `git clean` from gone. Nothing publishes here automatically; that is
# `scripts/deploy/publish-apk.sh`, run by hand after an EAS build.
install -d -m 0755 /var/lib/homefarm/dist
chown caddy:caddy /var/lib/homefarm/dist 2>/dev/null || true

# Where this box keeps site blocks the repository does not own — the operations
# board's, most likely. `deploy.sh` renders the Caddyfile over the running one
# every five minutes and imports this directory without ever writing to it, so
# anything put here survives a deploy and anything put in the Caddyfile itself
# does not. Created empty; an empty glob is not an error to Caddy.
install -d -m 0755 /etc/caddy/conf.d

sed "s/api\.example\.com/${DOMAIN}/" "$REPO_DIR/scripts/deploy/Caddyfile" > /etc/caddy/Caddyfile
systemctl enable caddy >/dev/null
systemctl reload caddy 2>/dev/null || systemctl restart caddy
note "configured for $DOMAIN"

# ── done ────────────────────────────────────────────────────────────────────
cat <<DONE

$(printf '\033[1m')Set up. Four things left, and only you can do them.$(printf '\033[0m')

  1. Put the two values in /etc/homefarm/api.env

       sudo nano /etc/homefarm/api.env
       sudo systemctl start homefarm-api
       systemctl status homefarm-api

  2. Open 443 in the ORACLE CONSOLE, which no script on this box can reach.
     Networking -> Virtual Cloud Networks -> your VCN -> Security Lists ->
     Default -> Add Ingress Rule:

       Source CIDR   0.0.0.0/0
       IP Protocol   TCP
       Destination   443

     The instance firewall is already open. This is the other one, and
     forgetting it looks exactly like the server being down.

  3. Install the database on this box, if it is not there yet:
       sudo /opt/homefarm/scripts/deploy/setup-mongo.sh
     A fresh box needs no MONGODB_DB at all — the code defaults to 'homefarm'.
     Pass one only to match a database that already exists under another name.
     It binds mongod to 127.0.0.1 and prints the connection string once.
     Nothing to open in any firewall for it, which is the point.

  4. Turn on backups. Until you do, this box holds the only server-side copy
     of the farm's records, and homefarm-backup-check will say so once a day:

       sudo nano /etc/homefarm/backup.env        # bucket, and the age PUBLIC key
       sudo systemctl enable --now homefarm-backup.timer
       sudo /opt/homefarm/scripts/backup-mongo.sh backup    # prove it before trusting it

     The check timer is already running, so a backup that stops working is
     reported rather than discovered when it is needed.

$(printf '\033[1m')Then check it from anywhere:$(printf '\033[0m')

       curl -i https://${DOMAIN}/health       -> {"ok":true}

     On Windows write curl.exe, not curl: in PowerShell 'curl' is an
     alias for Invoke-WebRequest and stops on a parsing prompt.

  That is the address that goes into eas.json's preview-farm profile. It is
  compiled into the APK, so changing it later means another build.

$(printf '\033[1m')Once it works, deployments can look after themselves:$(printf '\033[0m')

       sudo systemctl enable --now homefarm-deploy.timer

  The box then follows the 'release' branch, which CI moves only after a green
  build. Nothing inbound is opened and GitHub is given no key to this machine.

DONE
