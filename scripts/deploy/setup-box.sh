#!/usr/bin/env bash
#
# The farm server, from a fresh Oracle Always Free instance to a working
# https:// address. Run it once, on the box, as a user with sudo:
#
#   git clone https://github.com/SteveWeed79/steading /opt/steading
#   sudo /opt/steading/scripts/deploy/setup-box.sh api.swbuild.dev
#
# Idempotent — safe to run again after a failure or a change. Every step says
# what it is doing and stops on the first thing that does not work, because a
# half-configured server that answers some requests is worse than one that
# answers none.
#
# ## What this does NOT do
#
# It does not write `/etc/steading/api.env`. That file holds the database URI
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
REPO_DIR="${STEADING_DIR:-/opt/steading}"
SERVICE_USER="steading"
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
    sudo git clone https://github.com/SteveWeed79/steading $REPO_DIR"

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

# ── 2. Node ─────────────────────────────────────────────────────────────────
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

# ── 3. The user the service runs as ─────────────────────────────────────────
say "Service user: $SERVICE_USER"
if id "$SERVICE_USER" >/dev/null 2>&1; then
  note "already exists"
else
  # No login shell and no home: this account exists to own a process, and
  # anything that can log in as it is a way in.
  useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  note "created"
fi

# ── 4. Dependencies ─────────────────────────────────────────────────────────
say "Installing the API's dependencies"
cd "$REPO_DIR"
# Filtered: without it this pulls Expo and React Native onto a server that
# imports neither. The trailing dots mean "and what it depends on".
corepack pnpm install --frozen-lockfile --filter "@steading/api..."
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
note "ready"

# ── 5. The secrets file, created empty ──────────────────────────────────────
say "Configuration"
install -d -m 0750 /etc/steading
if [ -f /etc/steading/api.env ]; then
  note "/etc/steading/api.env already exists — left exactly as it is"
else
  cat > /etc/steading/api.env <<'ENV'
# Read by systemd, never committed. Mode 0600.
#
# Two values are required and the service will not start without them.

# 32 characters or more. Signs access and refresh tokens; changing it signs
# every device out. Generate one with:  openssl rand -base64 48
AUTH_SECRET=

# The Atlas connection string. Atlas blocks by IP by default, so this box's
# public address has to be on the Network Access list there or every request
# hangs for five seconds and fails.
MONGODB_URI=

# Caddy is in front and sets X-Forwarded-For. Without this the service does not
# believe that header, so request.ip is 127.0.0.1 for every request — and every
# rate limiter keys on request.ip, so the auth limiter would treat the whole
# internet as one caller and lock a farm out over a stranger's typo.
TRUSTED_PROXY_HOPS=1

PORT=3001
ENV
  chmod 0600 /etc/steading/api.env
  note "created /etc/steading/api.env — FILL IT IN before starting the service"
fi

# ── 6. The service ──────────────────────────────────────────────────────────
say "Installing the service"
sed "s#/opt/steading#${REPO_DIR}#g" \
  "$REPO_DIR/scripts/deploy/steading-api.service" > /etc/systemd/system/steading-api.service
sed "s#/opt/steading#${REPO_DIR}#g" \
  "$REPO_DIR/scripts/deploy/steading-deploy.service" > /etc/systemd/system/steading-deploy.service
cp "$REPO_DIR/scripts/deploy/steading-deploy.timer" /etc/systemd/system/steading-deploy.timer
systemctl daemon-reload
systemctl enable steading-api >/dev/null
note "enabled (starts on boot)"

# Installed but NOT started. Automatic deployment onto a box whose two secrets
# are still blank would restart a service that cannot come up, every five
# minutes, and bury the real reason under the noise. Turn it on once the thing
# is known to work.
note "steading-deploy.timer installed but not started — see DEPLOY-THE-SERVER"

# ── 7. Caddy, and with it the certificate ───────────────────────────────────
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

install -d -m 0755 /var/log/caddy
chown caddy:caddy /var/log/caddy 2>/dev/null || true
sed "s/api\.example\.com/${DOMAIN}/" "$REPO_DIR/scripts/deploy/Caddyfile" > /etc/caddy/Caddyfile
systemctl enable caddy >/dev/null
systemctl reload caddy 2>/dev/null || systemctl restart caddy
note "configured for $DOMAIN"

# ── done ────────────────────────────────────────────────────────────────────
cat <<DONE

$(printf '\033[1m')Set up. Three things left, and only you can do them.$(printf '\033[0m')

  1. Put the two values in /etc/steading/api.env

       sudo nano /etc/steading/api.env
       sudo systemctl start steading-api
       systemctl status steading-api

  2. Open 443 in the ORACLE CONSOLE, which no script on this box can reach.
     Networking -> Virtual Cloud Networks -> your VCN -> Security Lists ->
     Default -> Add Ingress Rule:

       Source CIDR   0.0.0.0/0
       IP Protocol   TCP
       Destination   443

     The instance firewall is already open. This is the other one, and
     forgetting it looks exactly like the server being down.

  3. Add this box's public address to Atlas -> Network Access. Until then
     every request waits five seconds for a connection and fails.

$(printf '\033[1m')Then check it from anywhere:$(printf '\033[0m')

       curl -i https://${DOMAIN}/health       -> {"ok":true}

     On Windows write curl.exe, not curl: in PowerShell 'curl' is an
     alias for Invoke-WebRequest and stops on a parsing prompt.

  That is the address that goes into eas.json's preview-farm profile. It is
  compiled into the APK, so changing it later means another build.

$(printf '\033[1m')Once it works, deployments can look after themselves:$(printf '\033[0m')

       sudo systemctl enable --now steading-deploy.timer

  The box then follows the 'release' branch, which CI moves only after a green
  build. Nothing inbound is opened and GitHub is given no key to this machine.

DONE
