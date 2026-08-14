#!/usr/bin/env bash
#
# A new version onto a box that is already set up.
#
#   sudo /opt/steading/scripts/deploy/deploy.sh
#
# Pull, install, restart, check. Four steps, and the fourth is the one that
# matters: it verifies the service is actually answering afterwards rather than
# assuming a restart that returned 0 means a server that works.
#
# `setup-box.sh` is the first run. This is every run after it — by hand, or
# every five minutes from `steading-deploy.timer`, which is the same command
# either way so there is nothing that only happens in one of them.

set -euo pipefail

REPO_DIR="${STEADING_DIR:-/opt/steading}"
SERVICE_USER="steading"
PORT="${PORT:-3001}"

# ── Which ref this box follows ──────────────────────────────────────────────
#
# `release`, not `main`. CI pushes that branch only after `verify` goes green
# (see .github/workflows/ci.yml), so a red build cannot reach a farm during the
# minutes between a bad merge and somebody noticing.
#
# Override it in /etc/steading/deploy.env to point a box at `dev` or at a
# branch under test. That file is also where the timer reads its settings, so
# there is one place to look rather than an argument somebody has to remember.
[ -f /etc/steading/deploy.env ] && . /etc/steading/deploy.env
REF="${STEADING_REF:-release}"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }
die() { printf '\n\033[1;31mSTOPPED:\033[0m %s\n\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run this with sudo."
[ -d "$REPO_DIR/.git" ] || die "No checkout at $REPO_DIR."

cd "$REPO_DIR"

# ── Git will not touch a repository it thinks belongs to somebody else ───────
#
# **This is not optional and it broke the timer before it ever ran once.** The
# checkout is owned by the `steading` service user; this script runs as root.
# Since CVE-2022-24765 git refuses that combination outright:
#
#   fatal: detected dubious ownership in repository at '/opt/steading'
#
# Under `sudo` from a terminal it is a confusing error. Under systemd it is
# invisible — a timer that fails every five minutes into the journal and never
# deploys anything, while the box looks perfectly healthy.
#
# `--system` rather than `--global`, so it belongs to the machine rather than
# to whichever user happened to run the script the first time. Idempotent:
# `--add` on an identical value is checked for first.
git config --system --get-all safe.directory 2>/dev/null | grep -qxF "$REPO_DIR" \
  || git config --system --add safe.directory "$REPO_DIR"

# What is running now, so the rollback below has somewhere to go back to.
WAS="$(git rev-parse --short HEAD)"

say "Fetching ($REF)"
git fetch --quiet origin "$REF" || die "Could not fetch '$REF' from origin.
  If this box has never seen that branch, check the name. CI creates 'release'
  on the first green run on main."

TARGET="$(git rev-parse --short FETCH_HEAD)"

# ── Three cases, and the middle one is why this is not just `merge --ff-only` ─
#
# **A box AHEAD of the release ref is the failure worth spelling out.** Run
# `git pull` here once — the obvious thing to try, and the first thing anybody
# asks about — and this checkout jumps to `main`. From then on
# `merge --ff-only FETCH_HEAD` finds the release commit is an *ancestor*,
# prints "Already up to date", and exits 0. The box quietly serves untested
# code and every deployment after it reports nothing to do. Silent, permanent
# until somebody happens to look, and it defeats the entire point of tracking a
# CI-gated ref.
#
# Reproduced before this was written: main two commits ahead of release, a box
# on main, `merge --ff-only` exit 0 and "Already up to date".
if [ "$WAS" = "$TARGET" ]; then
  note "already on $TARGET — nothing to deploy"
elif git merge-base --is-ancestor HEAD FETCH_HEAD; then
  # The ordinary case: release has moved forward and this is a fast-forward.
  git merge --ff-only FETCH_HEAD --quiet \
    || die "The fast-forward failed unexpectedly. Nothing has been changed."
  note "$WAS -> $TARGET"
else
  die "This box is NOT on $REF, and pulling would not fix it.

  Here:    $WAS
  $REF:    $TARGET

  HEAD is ahead of $REF, or the two have diverged. The usual cause is a
  'git pull' run here by hand, which moves this checkout to main — ahead of
  the commit CI has actually passed. The deploy timer would then report
  'nothing to deploy' for ever while serving untested code.

  To get back on the tracked ref, discarding whatever is here:

      cd $REPO_DIR && sudo git reset --hard $TARGET

  Look at 'git log --oneline $TARGET..HEAD' first if you want to know what
  that throws away. Nothing has been changed."
fi

NOW="$(git rev-parse --short HEAD)"

say "Dependencies"
corepack pnpm install --frozen-lockfile --filter "@steading/api..."
chown -R "$SERVICE_USER:$SERVICE_USER" "$REPO_DIR"

# ── Caddy, which nothing was deploying ──────────────────────────────────────
#
# **The Caddyfile is in this repository and was only ever installed by
# `setup-box.sh`.** That runs once, by hand, when a box is built — so every
# change to it since has been sitting in the checkout doing nothing, and the
# box has gone on serving whatever it was given the day it was set up.
#
# It surfaced as a 404 from the API for a route Caddy was supposed to answer:
# `/app` had been added to the Caddyfile, merged, and deployed, and the box had
# never read it. The reply came from Fastify, which is exactly what the config
# exists to stop reaching.
#
# Reloaded rather than restarted: a reload keeps the certificate and drops no
# connections. Validated first, because an invalid config reloaded is a web
# server that stops answering — and the API being fine underneath would make
# that look like a much bigger failure than it is.
if command -v caddy >/dev/null 2>&1 && [ -f /etc/caddy/Caddyfile ]; then
  say "Caddy"
  DOMAIN="$(sed -n 's/^\([a-z0-9.-]*\) {$/\1/p' /etc/caddy/Caddyfile | head -1)"

  if [ -z "$DOMAIN" ]; then
    note "could not read the domain out of /etc/caddy/Caddyfile — left alone"
  else
    sed "s/api\.example\.com/${DOMAIN}/" "$REPO_DIR/scripts/deploy/Caddyfile" > /tmp/Caddyfile.next

    if ! caddy validate --config /tmp/Caddyfile.next --adapter caddyfile >/dev/null 2>&1; then
      note "the Caddyfile in this commit is not valid — left the running one alone"
    elif cmp -s /tmp/Caddyfile.next /etc/caddy/Caddyfile; then
      note "unchanged"
    else
      install -m 0644 /tmp/Caddyfile.next /etc/caddy/Caddyfile
      systemctl reload caddy
      note "reloaded for ${DOMAIN}"
    fi
    rm -f /tmp/Caddyfile.next
  fi

  # Where publish-apk.sh puts a build. Created here as well as in setup-box.sh
  # so a box built before /app existed grows one without being rebuilt.
  install -d -m 0755 /var/lib/steading/dist
  chown caddy:caddy /var/lib/steading/dist 2>/dev/null || true

  # The install page, before there is anything to install.
  #
  # `publish-apk.sh` also lays this down, but only on a successful publish — so
  # between the first deploy and the first build the directory existed and was
  # empty, and /app answered with Caddy's bodiless 404. Reported as *"this page
  # can't be found"*, which reads as a broken box rather than as a box with no
  # build on it yet.
  #
  # The Caddyfile already argues this case for a missing APK and routes it here
  # with `try_files`; the hole was that the page it routes to did not exist yet.
  # Copied on every deploy so a wording change ships with the rest of the repo,
  # and it is the same file either way — nothing here can drift from what
  # publish-apk.sh installs.
  if [ -f "${REPO_DIR}/scripts/deploy/install-page.html" ]; then
    install -m 0644 "${REPO_DIR}/scripts/deploy/install-page.html" \
      /var/lib/steading/dist/index.html
  fi
fi

say "Restarting"
systemctl restart steading-api

# ── the part that is not optional ───────────────────────────────────────────
#
# `systemctl restart` returns as soon as the process is spawned, not when it is
# serving — and the two failures most likely here (a bad MONGODB_URI, a syntax
# error in something that only loads at boot) both take a second or two to
# surface. Without this check a deploy that killed the server reports success.
# ── The app, which the server half never touched ────────────────────────────
#
# **This is the gap that kept catching us.** `release` moving updates the API
# and the Caddyfile, and the phone runs an APK built on Expo's machines — so a
# fix to a screen could be merged, promoted, and deployed, and the handset went
# on showing the old one because nothing anywhere rebuilt it. Every report of
# "none of the changes landed" traced back to this, and the answer was always
# the same manual two steps that nobody should have had to remember.
#
# So the box pulls the app the way it already pulls the code. Same argument the
# release note makes about not putting an SSH key in GitHub: nothing inbound is
# opened, and the newest finished build is a question the box can ask Expo.
#
# Needs `EXPO_TOKEN` in /etc/steading/deploy.env, which is where the ref
# override already lives. Without one this is skipped in a sentence rather than
# failing — a farm server that stops deploying its API because it could not
# reach Expo would be the tail wagging the dog.
if [ -n "${EXPO_TOKEN:-}" ]; then
  say "The app"

  # `|| true` throughout: Expo being unreachable, rate limited or mid-outage is
  # not a reason to fail a deploy that has already restarted the API.
  ARTIFACT="$(EXPO_TOKEN="$EXPO_TOKEN" pnpm --filter @steading/mobile exec eas build:list \
    --platform android --status finished --limit 1 --json --non-interactive 2>/dev/null || true)"

  URL="$(printf '%s' "$ARTIFACT" | node -e '
    let raw = "";
    process.stdin.on("data", (d) => (raw += d));
    process.stdin.on("end", () => {
      // eas-cli prints the array on its own line; anything else on stdout is
      // noise from the workspace runner and must not be parsed as the answer.
      const start = raw.indexOf("[");
      try {
        const builds = JSON.parse(raw.slice(start === -1 ? 0 : start));
        const build = builds?.[0];
        const url = build?.artifacts?.buildUrl ?? build?.artifacts?.applicationArchiveUrl;
        // The version too, so the publish can be skipped when it is the one
        // already on the shelf rather than downloading forty megabytes to find
        // out.
        if (typeof url === "string" && url !== "") {
          process.stdout.write(`${url}\t${build?.appVersion ?? ""}\t${build?.appBuildVersion ?? ""}`);
        }
      } catch {}
    });
  ' 2>/dev/null || true)"

  APK_URL="${URL%%$'\t'*}"
  REST="${URL#*$'\t'}"
  APK_VERSION="${REST%%$'\t'*}"
  APK_CODE="${REST##*$'\t'}"

  if [ -z "$APK_URL" ]; then
    note "no finished Android build to fetch (or Expo could not be reached)"
  elif [ -n "$APK_VERSION" ] && [ -f "/var/lib/steading/dist/steading-${APK_VERSION}-${APK_CODE}.apk" ]; then
    note "already serving ${APK_VERSION} (build ${APK_CODE})"
  else
    note "fetching ${APK_VERSION:-the newest build}"
    # The version is passed, not left to be read out of the file.
    #
    # `publish-apk.sh` reads it with `aapt2` when there is one — and there is
    # not, on this box, by its own stated decision: "the box has no Android SDK
    # and is not getting one". Without a label it therefore fell all the way
    # through to a timestamp name, steading-20260814-0412.apk, which is unique,
    # sortable and tells nobody anything — and the install page's version
    # stamp, guarded on the same read, never appeared at all.
    #
    # EAS already told us both numbers a few lines up; they are what the
    # "already serving" check compares. The answer was in hand and simply not
    # handed on, and the script's own note says to pass one.
    LABEL="${APK_VERSION:+${APK_VERSION}${APK_CODE:+-$APK_CODE}}"
    "${REPO_DIR}/scripts/deploy/publish-apk.sh" "$APK_URL" "$LABEL" \
      || note "could not publish it — the API is unaffected"
  fi
fi

say "Checking it came back"
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS --max-time 3 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    note "answering on :${PORT} after ${attempt}s"
    printf '\n\033[1mDeployed: %s\033[0m\n\n' "$NOW"
    exit 0
  fi
  sleep 1
done

# Rolling back automatically would be worse than stopping: the new code may be
# fine and the database unreachable, in which case reverting fixes nothing and
# hides which of the two it was.
printf '\n\033[1;31mThe service did not come back.\033[0m\n\n'
printf 'It is on %s. The previous version was %s.\n\n' "$NOW" "$WAS"
printf 'What it says:\n\n'
journalctl -u steading-api -n 30 --no-pager
printf '\nTo go back:\n\n    cd %s && sudo git checkout %s && sudo systemctl restart steading-api\n\n' "$REPO_DIR" "$WAS"
exit 1
