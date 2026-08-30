#!/usr/bin/env bash
#
# A new version onto a box that is already set up.
#
#   sudo /opt/homefarm/scripts/deploy/deploy.sh
#
# Pull, install, restart, check. Four steps, and the fourth is the one that
# matters: it verifies the service is actually answering afterwards rather than
# assuming a restart that returned 0 means a server that works.
#
# `setup-box.sh` is the first run. This is every run after it — by hand, or
# every five minutes from `homefarm-deploy.timer`, which is the same command
# either way so there is nothing that only happens in one of them.

set -euo pipefail

# ── Settings, read before anything that could default them ──────────────────
#
# **This used to sit thirteen lines further down, and the two settings above it
# could therefore never be overridden.** `HOMEFARM_REF` and `HOMEFARM_APP_ID`
# are read after it and work; `HOMEFARM_DIR` and `PORT` were read before it and
# did not. `homefarm-deploy.service` carries no `EnvironmentFile=`, so sourcing
# this file is the only channel there is, and `sudo HOMEFARM_DIR=… deploy.sh` is
# refused by a default sudoers.
#
# That is not a tidiness point. `setup-box.sh` rewrites the unit's ExecStart to
# the box's real checkout, so a box at another path correctly invokes its own
# copy of this script — which then looked for `/opt/homefarm`, died, and failed
# every five minutes for ever. The box could not deploy, so it could not receive
# the fix for its own condition, and nothing surfaced it but a failed unit.
[ -f /etc/homefarm/deploy.env ] && . /etc/homefarm/deploy.env

# **Defaults to this script's own checkout**, so a copy that has been moved is
# self-locating even with nothing set. The literal is kept as the last resort
# only for a script invoked through a path that cannot be resolved.
REPO_DIR="${HOMEFARM_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd || echo /opt/homefarm)}"
SERVICE_USER="homefarm"
PORT="${PORT:-3001}"

# Set by the Caddy section when the running web server config is not the one on
# disk. Consulted by the successful exit at the very bottom rather than acted on
# where it is found, because the API restart below must not be skipped for it.
CADDY_WRONG=0

# ── Which ref this box follows ──────────────────────────────────────────────
#
# `release`, not `main`. CI pushes that branch only after `verify` goes green
# (see .github/workflows/ci.yml), so a red build cannot reach a farm during the
# minutes between a bad merge and somebody noticing.
#
# Override it in /etc/homefarm/deploy.env, alongside everything else — that file
# is also where the timer reads its settings, so there is one place to look
# rather than an argument somebody has to remember.
REF="${HOMEFARM_REF:-release}"

# ── Which app this box is allowed to serve ──────────────────────────────────
#
# The application id `app.json` declares. `publish-apk.sh` reads it out of the
# bytes that actually arrived — the manifest inside the APK — and refuses
# anything that names a different application. Exported rather than merely set,
# because that check runs in a child process and a `deploy.env` override that
# only this script could see would be an override that does nothing.
export HOMEFARM_APP_ID="${HOMEFARM_APP_ID:-dev.swbuild.homefarm}"

# ── The other two `deploy.env` settings a child process reads ───────────────
#
# **Sourcing a file sets shell variables, not environment ones**, and the two
# below are read by children only — so `deploy.env` could carry them and neither
# child would ever see one. `HOMEFARM_APP_ID` above was exported for exactly
# this reason and these were not, which is what made it easy to miss.
#
# `GITHUB_TOKEN` is the sharper of the two: the comment further down promises it
# is *"honoured if this repository is ever made private"*, and
# `release-apk.mjs` really does read `process.env.GITHUB_TOKEN` — but it never
# arrived, so the documented recovery path for a private repository could not
# work. It would have been discovered on the day it was needed.
#
# Conditional, because `export VAR=""` and an unset one are different things to
# a child: `release-apk.mjs` tests the value's truthiness and would send an empty
# bearer header, which GitHub answers 401 to rather than treating as anonymous.
[ -n "${GITHUB_TOKEN:-}" ] && export GITHUB_TOKEN
[ -n "${HOMEFARM_DOMAIN:-}" ] && export HOMEFARM_DOMAIN

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }
die() { printf '\n\033[1;31mSTOPPED:\033[0m %s\n\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run this with sudo."
[ -d "$REPO_DIR/.git" ] || die "No checkout at $REPO_DIR."

cd "$REPO_DIR"

# ── Git will not touch a repository it thinks belongs to somebody else ───────
#
# **This is not optional and it broke the timer before it ever ran once.** The
# checkout is owned by the `homefarm` service user; this script runs as root.
# Since CVE-2022-24765 git refuses that combination outright:
#
#   fatal: detected dubious ownership in repository at '/opt/homefarm'
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
# ── `--tags`, which the app half depends on ─────────────────────────────────
#
# The APK for a commit is found by resolving that commit to a `v<version>+<code>`
# tag locally — see the app block near the end of this file for why the commit
# is the key rather than "the newest release". Without the tags in this
# checkout there is nothing to resolve, and the box would go on serving the APK
# it already has while reporting nothing wrong.
#
# Cheap: a tag is a ref and a few bytes, and the objects behind it are already
# here because it points at a commit on the branch just fetched.
git fetch --quiet --tags origin "$REF" || die "Could not fetch '$REF' from origin.
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
#
# ── And "nothing to deploy" has to mean it ──────────────────────────────────
#
# **This branch said so and then deployed anyway.** It printed the line and
# fell straight through to `pnpm install` and `systemctl restart`, both
# unconditional, so an unchanged production box reinstalled its dependencies
# and bounced the API about twelve times an hour, for ever. The timer's own
# comment claims a run that finds nothing new "exits before touching
# anything" — it described the intention and nothing enforced it, which is why
# this went unnoticed: the log line was right, the behaviour was not.
#
# A flag rather than an `exit`, because not everything below is about the
# commit. The Caddy block reconciles a config that can drift on its own and
# re-renders an install page whose version note "recovers on the next tick";
# the app block asks Expo for a build that can appear with no server commit at
# all. Both are per-tick self-healing by design and both say so. What must not
# run is the work that only makes sense when the code changed: reinstalling
# dependencies, and restarting the service.
#
# ── And it has to mean the RUNNING code, not this tick's fetch ──────────────
#
# `CHANGED` was `WAS != TARGET`: did HEAD move during this run. That is not the
# question. A deploy that fast-forwards and then dies — a failed `pnpm install`,
# a restart that did not come back, an SSH session dropped in the middle — has
# already moved HEAD, so the NEXT tick finds `WAS = TARGET`, prints "nothing to
# deploy", and exits 0. **For ever.** New code on disk, old code in memory, and
# a green timer saying so every five minutes.
#
# So the box records the commit it last got all the way through on, and that is
# what this compares against. A tick is "nothing to deploy" only when HEAD is at
# the release ref *and* that ref is what is actually running.
#
# A box that has never written the marker — every box already deployed — reads
# it as empty and does one full pass. That is one extra install and one restart,
# once, and then it settles.
DEPLOYED_MARK=/var/lib/homefarm/deployed-sha
DEPLOYED="$(cat "$DEPLOYED_MARK" 2>/dev/null || true)"

CHANGED=1
if [ "$WAS" = "$TARGET" ] && [ "$DEPLOYED" = "$TARGET" ]; then
  note "already on $TARGET — nothing to deploy"
  CHANGED=0
elif [ "$WAS" = "$TARGET" ]; then
  note "on $TARGET, but the last completed deploy was ${DEPLOYED:-unrecorded} — finishing it"
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

# Only when the commit moved. A lockfile that has not changed installs the tree
# that is already there, and the ownership fix has nothing to fix.
if [ "$CHANGED" -eq 1 ]; then
  say "Dependencies"
  corepack pnpm install --frozen-lockfile --filter "@homefarm/api..."
  chown -R "$SERVICE_USER:$SERVICE_USER" "$REPO_DIR"
fi

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

  # Where a box keeps what only that box needs, and the reason the overwrite
  # below is survivable at all. Created BEFORE the validate, because the
  # rendered file imports it — see the Caddyfile's own note on why an empty
  # glob is fine but a relative path would not be.
  install -d -m 0755 /etc/caddy/conf.d

  # ── The log file, and the reload that was refused for ten days ───────────
  #
  # The rendered Caddyfile names `/var/log/caddy/homefarm.log`. `setup-box.sh`
  # creates the *directory* owned by caddy and always has — but nothing has ever
  # created the file, so it belonged to whichever process wrote there first. On
  # the live box that was root, running the rename by hand, and the file landed
  # `root:root 0600`.
  #
  # **Caddy opens its log files as the `caddy` user when it loads a config, and
  # a file it cannot open makes it refuse the whole config.** It then goes on
  # serving the one it already had. So the box kept a pre-rename config live for
  # ten days, rooted at a directory that no longer existed, while
  # `systemctl status caddy` said `active (running)` and `/app/` answered 404.
  #
  # `unchanged` is what made it permanent. The file on disk was already correct,
  # `cmp` agreed, and this script never asked Caddy to read it again. Every five
  # minutes, for ten days.
  #
  # **Never truncated.** `install /dev/null` over an existing log would throw
  # away the history that says when it broke, so the file is created only when
  # absent. The ownership is corrected either way — a file that is already there
  # and unopenable is the entire case this exists for.
  install -d -m 0755 /var/log/caddy
  [ -e /var/log/caddy/homefarm.log ] || : > /var/log/caddy/homefarm.log
  chmod 0644 /var/log/caddy/homefarm.log 2>/dev/null || true
  chown caddy:caddy /var/log/caddy /var/log/caddy/homefarm.log 2>/dev/null || true

  # ── Which name to render for, and a refusal rather than a guess ───────────
  #
  # The template owns exactly ONE site block, so a correctly managed box has
  # exactly one in its running file. This used to take `head -1` of them, which
  # is right only as long as that stays true — and `DEPLOY-THE-SERVER.md` spent
  # months telling operators to add a second one by hand for the operations
  # board.
  #
  # **Two blocks, and `head -1` is a coin toss with the farm on it.** Appended,
  # the deploy silently deleted the board's block. *Prepended*, it read
  # `ops.example.com` as the domain and rendered the API's entire config for
  # that name — every handset loses its server, reported as `reloaded for
  # ops.example.com`. Verified against both orderings before this was written.
  #
  # So a second block is not something to work around. It means the box predates
  # `conf.d` and this deploy does not know which name is the API's. It keeps a
  # copy, says what to do, and leaves the Caddyfile alone — a config that stops
  # being updated is a real cost, and it is the smaller one, bounded by a single
  # manual step and loud every five minutes until somebody takes it.
  BLOCKS="$(sed -n 's/^\([a-z0-9.-]*\) {$/\1/p' /etc/caddy/Caddyfile)"
  COUNT="$(printf '%s\n' "$BLOCKS" | grep -c . || true)"
  DOMAIN="$(printf '%s\n' "$BLOCKS" | head -1)"

  if [ -z "$DOMAIN" ]; then
    note "could not read the domain out of /etc/caddy/Caddyfile — left alone"
  elif [ "$COUNT" -gt 1 ]; then
    # One fixed name, never overwritten: the first copy is the one taken while
    # the extra blocks were still in the file. Outside conf.d deliberately — a
    # backup in there ending in `.caddy` would be imported, re-declaring the
    # API's own block and leaving Caddy a config it refuses to load.
    if [ ! -f /etc/caddy/Caddyfile.local-blocks.bak ]; then
      cp -a /etc/caddy/Caddyfile /etc/caddy/Caddyfile.local-blocks.bak
    fi
    note "/etc/caddy/Caddyfile has ${COUNT} site blocks ($(printf '%s\n' "$BLOCKS" | tr '\n' ' ')) — this deploy will not guess which is the API's, so it left the file alone"
    note "copy at /etc/caddy/Caddyfile.local-blocks.bak — move the blocks that are not the API's into /etc/caddy/conf.d/<name>.caddy, leave one in the Caddyfile, then reload caddy"
  else
    # ── A name nobody else can have taken ─────────────────────────────────
    #
    # This was the fixed path `/tmp/Caddyfile.next`, written as root from a unit
    # that had no `PrivateTmp`. Any local account could create it first as a
    # symlink and have the redirect below follow it. `mktemp` removes the race
    # here; `PrivateTmp=true` on `homefarm-deploy.service` removes it again for
    # the scheduled run. Both, because this script is also run by hand.
    NEXT="$(mktemp /tmp/Caddyfile.next.XXXXXX)"
    sed "s/api\.example\.com/${DOMAIN}/" "$REPO_DIR/scripts/deploy/Caddyfile" > "$NEXT"

    # Validated against the whole config, imports included — so a syntax error
    # in a local block under conf.d is caught here rather than by a reload that
    # leaves the box serving nothing.
    if ! caddy validate --config "$NEXT" --adapter caddyfile >/dev/null 2>&1; then
      note "the rendered Caddyfile is not valid — left the running one alone (check /etc/caddy/conf.d)"
    elif cmp -s "$NEXT" /etc/caddy/Caddyfile; then
      note "unchanged"
    else
      install -m 0644 "$NEXT" /etc/caddy/Caddyfile
      # ── A refused reload must not take the API deploy with it ─────────────
      #
      # Unguarded under `set -e`, this killed the script where it stood —
      # between the checkout and `systemctl restart homefarm-api`. So a Caddy
      # config Caddy would not take left **new code installed and the old
      # process still running**, and `cmp -s` reported "unchanged" on every
      # tick after, because the file on disk was by then the right one.
      #
      # It is not ignored, it is deferred: the verification immediately below
      # asks the admin API what is actually loaded, which is a stronger question
      # than this exit code answers — a reload returns 0 for a signal delivered,
      # not for a config accepted. Whatever this says, that block decides.
      if systemctl reload caddy 2>/dev/null; then
        note "reloaded for ${DOMAIN}"
      else
        note "caddy refused the reload — the check below says what it is serving"
      fi
    fi
    rm -f "$NEXT"
  fi

  # ── What is actually running, which is not what was installed ────────────
  #
  # **`systemctl reload caddy` returns 0 when the signal was delivered**, not
  # when the config was accepted. Caddy validates and loads in its own time, and
  # a config it refuses is logged and discarded — it goes on serving the last
  # one that worked. So the reload succeeds, the file on disk is right, and the
  # box serves something else entirely. See the log-file note above: that is
  # exactly what happened, and every check on this box reported a clean run
  # throughout.
  #
  # `cmp` cannot see it either. It compares the file this script rendered
  # against the file on disk, and both were correct the whole time. The thing
  # that was wrong was the only thing neither of them looks at.
  #
  # The admin API is what knows. Caddy listens on 127.0.0.1:2019 by default and
  # answers with the config it has actually loaded. Checked on every tick,
  # including the `unchanged` path — which is the state a refused reload leaves
  # behind, and a deploy that looks only when it changed something can never
  # find this.
  #
  # **Only when this deploy owns the running Caddyfile.** On a box that predates
  # `conf.d` the block above deliberately leaves the file alone, so whether that
  # config serves `/app` is not this script's finding to make — least of all as
  # a permanent failure over something it has already decided not to repair.
  if [ "$COUNT" = 1 ] && [ -n "$DOMAIN" ]; then
    RUNNING="$(curl -fsS --max-time 5 http://127.0.0.1:2019/config/ 2>/dev/null || true)"
    if [ -z "$RUNNING" ]; then
      # Not a failure: the admin endpoint can be moved or turned off, and a box
      # configured that way is somebody's deliberate choice rather than a fault.
      note "caddy's admin API did not answer on 2019 — cannot tell which config is live"
    elif printf '%s' "$RUNNING" | grep -q '/var/lib/homefarm/dist'; then
      note "serving the config on disk"
    else
      # One reload, then look again. The usual cause is a permission Caddy could
      # not satisfy at its last load and this script has since repaired — the
      # log file above is the case this was written for. Without the retry the
      # repair lands on disk and nothing ever asks Caddy to read it, because
      # `cmp` says the file is unchanged. That is the loop that ran ten days.
      note "caddy is not serving the config on disk — reloading"
      systemctl reload caddy 2>/dev/null || true
      sleep 1
      RUNNING="$(curl -fsS --max-time 5 http://127.0.0.1:2019/config/ 2>/dev/null || true)"
      if printf '%s' "$RUNNING" | grep -q '/var/lib/homefarm/dist'; then
        note "it has taken it now"
      else
        CADDY_WRONG=1
        note "CADDY IS SERVING A CONFIG THAT IS NOT THE ONE ON DISK, and a reload did not change that"
        note "journalctl -u caddy -n 40 --no-pager  — a log file it cannot open is the cause this was written for"
      fi
    fi
  fi

  # Where publish-apk.sh puts a build. Created here as well as in setup-box.sh
  # so a box built before /app existed grows one without being rebuilt.
  install -d -m 0755 /var/lib/homefarm/dist
  chown caddy:caddy /var/lib/homefarm/dist 2>/dev/null || true

  # The install page, before there is anything to install — and after.
  #
  # `publish-apk.sh` also lays this down, but only on a successful publish — so
  # between the first deploy and the first build the directory existed and was
  # empty, and /app answered with Caddy's bodiless 404. Reported as *"this page
  # can't be found"*, which reads as a broken box rather than as a box with no
  # build on it yet.
  #
  # Copied on every deploy so a wording change ships with the rest of the repo.
  #
  # ## And that is exactly how the version stamp disappeared
  #
  # This used to copy the raw template, placeholder and all, over whatever was
  # there. `publish-apk.sh` stamps the page with the version; this ran five
  # minutes later and took the stamp off again. Reported as *"the version number
  # disappeared from the download site?"* — and it had.
  #
  # **The re-download loop was hiding it.** While that bug was live,
  # `publish-apk.sh` ran on every tick as well, so it re-stamped the page moments
  # after this had blanked it. Fixing the loop did not cause this; it stopped
  # masking something that had been wrong the whole time.
  #
  # So the version is read back from where the publish wrote it, and one script
  # renders the page for both callers. This can no longer write a page it does
  # not know the contents of.
  STAMP=""
  [ -f /var/lib/homefarm/.version ] && STAMP="$(cat /var/lib/homefarm/.version)"

  # ── The shelf is asked when the note is missing ──────────────────────────
  #
  # Only `publish-apk.sh` writes that file, so every box already serving a build
  # has no note for the one it is serving — and would show a blank version until
  # the next app release, which on a server-only change is never.
  #
  # The APK on the shelf knows perfectly well what it is: `homefarm.apk` is a
  # symlink to `homefarm-<version>-<code>.apk`, so the name is the answer. Read
  # rather than remembered, which also means a box whose note is lost recovers
  # on the next tick instead of staying blank.
  #
  # Only when it looks like a version. The publish script falls back to a
  # timestamp name when it can read neither the file nor a label, and
  # "Version 20260814-0412" would be a number that means nothing dressed up as
  # one that means something — so a leading digit and a dot are required, which
  # `20260814-0412` has not got.
  #
  # Worded the same way `publish-apk.sh` words it, and that is the point of
  # splitting the code off rather than printing the stem: these two are the only
  # writers of this line, they render the same shelf, and a recovery path that
  # said `Version 0.1.15-19` where the ordinary path says
  # `Version 0.1.15 · build 19` would look like the box had changed its mind
  # about what it was serving.
  if [ -z "$STAMP" ] && [ -L /var/lib/homefarm/dist/homefarm.apk ]; then
    ON_SHELF="$(basename "$(readlink /var/lib/homefarm/dist/homefarm.apk)" .apk)"
    ON_SHELF="${ON_SHELF#homefarm-}"
    case "$ON_SHELF" in
      [0-9]*.*-*)
        SHELF_CODE="${ON_SHELF##*-}"
        case "$SHELF_CODE" in
          '' | *[!0-9]*) STAMP="Version ${ON_SHELF}" ;;
          *) STAMP="Version ${ON_SHELF%-*} · build ${SHELF_CODE}" ;;
        esac
        ;;
      [0-9]*.*) STAMP="Version ${ON_SHELF}" ;;
    esac
  fi

  "${REPO_DIR}/scripts/deploy/render-install-page.sh" /var/lib/homefarm/dist "$STAMP" || true
fi

if [ "$CHANGED" -eq 1 ]; then
  say "Restarting"
  systemctl restart homefarm-api
fi

# ── the part that is not optional ───────────────────────────────────────────
#
# `systemctl restart` returns as soon as the process is spawned, not when it is
# serving — and the two failures most likely here (a bad MONGODB_URI, a syntax
# error in something that only loads at boot) both take a second or two to
# surface. Without this check a deploy that killed the server reports success.
#
# **This paragraph was true of only one of the two for a long time.** The poll
# asked `/health`, which opens no database connection, so a bad MONGODB_URI
# passed it every time — the sentence above described a check the script did
# not have. It asks `/ready` now; see the block near the end of this file.
# ── The app, which the server half never touched ────────────────────────────
#
# **This is the gap that kept catching us.** `release` moving updates the API
# and the Caddyfile, and the phone runs an APK built somewhere else — so a fix
# to a screen could be merged, promoted, and deployed, and the handset went on
# showing the old one because nothing anywhere rebuilt it. Every report of
# "none of the changes landed" traced back to this, and the answer was always
# the same manual two steps that nobody should have had to remember.
#
# So the box pulls the app the way it already pulls the code. Same argument the
# release note makes about not putting an SSH key in GitHub: nothing inbound is
# opened, and "what is the app for the commit I am serving" is a question the
# box can ask on its own.
#
# ── Where the APK comes from now, and why it stopped being EAS ──────────────
#
# **This asked EAS, and that was #153's remaining half.** `apk.yml` builds the
# APK on a GitHub runner precisely so a build quota cannot refuse a release —
# but the box went on asking `eas build:list`, so a runner-built APK never
# reached the shelf and the box served the last EAS build for ever, with no
# error anywhere. The same silent half-done shape as the issue itself.
#
# What did NOT change is the thing that made the EAS lookup good: **the commit
# is the key**. Its comment argued `--git-commit-hash` beat a build id because
# it needs no channel between CI and this box, and that is still the argument.
# Git resolves HEAD to a `v<version>+<code>` tag right here, on this machine,
# with no network and nothing handed over from the promote; only "what is
# attached to that tag" is asked of GitHub. "Newest GitHub Release" would have
# thrown that away — `release` bumps the version, commits it and promotes THAT
# commit, so the newest release is only coincidentally this box's.
#
# A commit with no tag finds nothing and publishes nothing, which is correct: a
# server-only release leaves the shelf holding the APK it was already holding.
# A build still running finds nothing too, and the next tick picks it up, which
# is why this block runs before the no-change exit.
#
# No token, and that is a property worth naming: `EXPO_TOKEN` is off this box
# entirely. A public repository's releases are readable by anybody, so there is
# no longer a credential here for anything to leak. `GITHUB_TOKEN` in
# `/etc/homefarm/deploy.env` is honoured if this repository is ever made
# private, and is not needed otherwise.
say "The app"

# ── The tool the publish below refuses to run without ───────────────────────
#
# `publish-apk.sh` needs `unzip` for the two checks that establish a fetched
# file is an APK and is *this* application, and it refuses to publish without
# them rather than skipping them — any zip on a url is otherwise published as
# the farm's app.
#
# **`setup-box.sh` installs it, and that reaches boxes built after it was
# written and no others.** The box pulls this repository every five minutes, so
# the new `setup-box.sh` is already sitting on it; nothing runs a first-run
# script again. The fix arrives as text, the box goes on refusing every build,
# and the deploy that carried the fix is the thing that cannot apply it.
#
# Backfilled here for the reason `/var/lib/homefarm/dist` is created here as
# well as in `setup-box.sh`: a box grows what a later release assumes without
# being rebuilt. One `command -v` per tick after the first.
#
# Best effort, deliberately. Apt being unreachable must not fail a deploy that
# has already restarted the API — and a box that cannot install it is exactly
# where it was, with the shelf holding the APK it has and the refusal below
# saying why.
if ! command -v unzip >/dev/null 2>&1; then
  if apt-get update -qq >/dev/null 2>&1 && apt-get install -y unzip >/dev/null 2>&1; then
    note "installed unzip — publish-apk.sh cannot verify a build without it"
  else
    note "COULD NOT INSTALL unzip, so no build can be published until it is there:"
    note "    sudo apt-get install -y unzip"
  fi
fi

# The decision — which tag, which asset, and every refusal — is in
# `scripts/lib/release-apk.mjs`, held by `tests/unit/release-apk.test.ts`, for
# the reason `scripts/lib/apk.mjs` gives about workflow files: it applies about
# as hard to a shell script running unattended with nobody reading its output.
#
# `|| true`: GitHub being unreachable, rate limited or mid-incident is not a
# reason to fail a deploy that has already restarted the API. The script exits 0
# on all of those anyway; this is the belt for the case where node itself is
# missing.
URL="$(git tag --points-at HEAD --list 'v*' 2>/dev/null \
  | node "$REPO_DIR/scripts/release-apk.mjs" --remote "$(git remote get-url origin)" \
  || true)"

APK_URL="${URL%%$'\t'*}"
REST="${URL#*$'\t'}"
APK_VERSION="${REST%%$'\t'*}"
APK_CODE="${REST##*$'\t'}"

# ── What was fetched last, by the build's own identity ──────────────────────
#
# **This guard was a filename, and a filename is not an identity.** The check
# looked for homefarm-<version>-<code>.apk; when the version could not be
# worked out the file was written under a timestamp instead, so the check never
# matched and the timer downloaded the same ninety megabytes again every six
# minutes. A box left overnight had five identical copies of one build and had
# pulled half a gigabyte to get them.
#
# The artefact url IS the identity — one build, one url — so remembering it
# closes the loop whatever the file ends up called, including the case that
# caused it: no version reported, no name to compare. A release asset url is a
# constant per build in the same way an EAS artefact url was, so the marker
# means exactly what it meant before.
#
# Outside the repo, because it describes what is on this shelf and a deploy
# must never be able to `git clean` it away — and outside `dist/`, because
# Caddy points `file_server` at that directory and a deploy marker is a note to
# the next deploy rather than something to publish. It sat in `dist/` when it
# was written, which served the artefact url at /app/.last-artifact to anybody
# who asked.
LAST="/var/lib/homefarm/.last-artifact"

# A box that published before the move keeps its marker rather than deciding it
# has never fetched anything and pulling ninety megabytes to find out.
if [ ! -f "$LAST" ] && [ -f /var/lib/homefarm/dist/.last-artifact ]; then
  mv /var/lib/homefarm/dist/.last-artifact "$LAST"
fi

if [ -z "$APK_URL" ]; then
  # The script above has already said which of the several reasons it was, on
  # stderr, so this does not guess at one.
  note "nothing to publish for this commit"
elif [ -f "$LAST" ] && [ "$(cat "$LAST" 2>/dev/null)" = "$APK_URL" ]; then
  note "already serving ${APK_VERSION:-that build}"
elif [ -n "$APK_VERSION" ] && [ -f "/var/lib/homefarm/dist/homefarm-${APK_VERSION}-${APK_CODE}.apk" ]; then
  # Kept as well as the url check: a box that published before this file
  # existed has the APK and no marker, and should not re-fetch to learn that.
  printf '%s' "$APK_URL" > "$LAST"
  note "already serving ${APK_VERSION} (build ${APK_CODE})"
else
  note "fetching ${APK_VERSION:-the release for this commit}"
  # The version is passed, not left to be read out of the file.
  #
  # `publish-apk.sh` reads it with `aapt2` when there is one — and there is
  # not, on this box, by its own stated decision: "the box has no Android SDK
  # and is not getting one". Without a label it therefore fell all the way
  # through to a timestamp name, homefarm-20260814-0412.apk, which is unique,
  # sortable and tells nobody anything — and the install page's version stamp,
  # guarded on the same read, never appeared at all.
  #
  # Both numbers are in the tag, which is where they came from a few lines up;
  # they are what the "already serving" check compares. The answer is in hand
  # and the script's own note says to pass one.
  LABEL="${APK_VERSION:+${APK_VERSION}${APK_CODE:+-$APK_CODE}}"
  if "${REPO_DIR}/scripts/deploy/publish-apk.sh" "$APK_URL" "$LABEL"; then
    # Only after it actually landed. Writing this on a failed publish would
    # make the next run skip a build that is not on the shelf.
    printf '%s' "$APK_URL" > "$LAST"
  else
    note "could not publish it — the API is unaffected"
  fi
fi

# ── The probe runs on EVERY tick, and it used to run on none of the quiet ones ─
#
# This block was gated on `CHANGED`, on the reasoning that nothing was restarted
# so there is nothing to have come back. True of the deploy, and it left the box
# with **nothing that ever asks whether the API is answering** — the timer runs
# every five minutes and, on a box whose release ref has not moved, checked
# precisely nothing. `homefarm-api.service` carries `StartLimitBurst=5`, so an
# API that dies five times in its interval is one systemd stops restarting: dead
# server, silent unit, and a deploy timer reporting success around the clock.
#
# So the check is unconditional now, and on a quiet tick a failure is acted on
# rather than reported: `reset-failed` clears the start limit that is the reason
# nothing is retrying, one restart, and then the same diagnosis as any other
# failed deploy. A box that cannot be revived leaves homefarm-deploy.service in
# `systemctl --failed`, which is what `check-box.sh` reads.
ready() {
  # Six seconds, not three: the driver's server-selection timeout is five
  # (`db/client.ts`), so a shorter deadline aborts the request before `/ready`
  # can answer and we lose the distinction the block below depends on.
  local attempt
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS --max-time 6 "http://127.0.0.1:${PORT}/ready" >/dev/null 2>&1; then
      note "serving on :${PORT} after ${attempt}s"
      return 0
    fi
    sleep 1
  done
  return 1
}

if [ "$CHANGED" -eq 0 ]; then
  say "Checking it is still up"

  if ready; then
    printf '\n\033[1mUp to date: %s\033[0m\n\n' "$NOW"
    if [ "$CADDY_WRONG" -eq 1 ]; then
      printf '\033[1;31mThe API is fine. Caddy is not serving the config on disk.\033[0m\n\n'
      printf 'Nothing above fixed it, so a person has to look:\n\n'
      printf '    journalctl -u caddy -n 40 --no-pager\n\n'
      exit 1
    fi
    exit 0
  fi

  # Nothing changed, so this is not a bad deploy — it is a server that went away
  # on its own and that systemd has given up on.
  printf '\n\033[1;31mThe API is not answering, and nothing was deployed.\033[0m\n\n'
  printf 'Clearing the start limit and restarting it once.\n\n'
  systemctl reset-failed homefarm-api 2>/dev/null || true
  systemctl restart homefarm-api || true
fi

say "Checking it came back"
# ── `/ready`, not `/health` ─────────────────────────────────────────────────
#
# The comment on this check (above, near the top) says it exists because "the
# two failures most likely here — a bad MONGODB_URI, a syntax error in
# something that only loads at boot — both take a second or two to surface".
# `/health` catches the second and cannot catch the first: Mongo connects
# lazily, so a wrong URI leaves the process up and cheerfully answering
# `/health` while every data route fails. `/ready` opens the connection, so a
# deploy that cannot reach the database fails here rather than at the first
# farm to log an egg.
if ready; then
  # ── The marker, written the moment the box is actually serving this commit ──
  #
  # What `CHANGED` reads next tick. Written here rather than after the Caddy
  # verdict below, because Caddy being wrong does not make the API undeployed —
  # and withholding it would reinstall and bounce the API every five minutes
  # over a web-server config, which is the exact churn `CHANGED` exists to stop.
  install -d -m 0755 /var/lib/homefarm 2>/dev/null || true
  printf '%s\n' "$NOW" > "$DEPLOYED_MARK" 2>/dev/null || true

  printf '\n\033[1mDeployed: %s\033[0m\n\n' "$NOW"

  # ── Deployed, and still not a clean run ───────────────────────────────────
  #
  # Checked here rather than where it was found, so the API restart is never
  # skipped for it: a web server serving a stale config is bad, and an API left
  # down is worse.
  #
  # **But it is not success.** Exiting 0 is how this stayed quiet for ten days —
  # the timer was green, `systemctl --failed` was empty, this script printed
  # `unchanged` every five minutes, and the one route a farmer needed answered
  # 404. Non-zero puts homefarm-deploy.service in `systemctl --failed`, which is
  # what check-box.sh reads and what somebody sees without having gone looking.
  if [ "$CADDY_WRONG" -eq 1 ]; then
    printf '\033[1;31mThe API is fine. Caddy is not serving the config on disk.\033[0m\n\n'
    printf 'Nothing above fixed it, so a person has to look:\n\n'
    printf '    journalctl -u caddy -n 40 --no-pager\n\n'
    exit 1
  fi
  exit 0
fi

# ── Which of the two it was ─────────────────────────────────────────────────
#
# `/health` touches nothing, so a process answering it while `/ready` fails is
# running the new code perfectly well and cannot reach the database. That is a
# different repair, and the rollback offered below would not perform it — it
# would restore code that was never the problem and hide the setting that was.
if curl -fsS --max-time 3 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
  printf '\n\033[1;31mThe service is up but cannot reach the database.\033[0m\n\n'
  printf 'It is on %s, and the code is almost certainly fine —\n' "$NOW"
  printf 'going back to %s will not fix this.\n\n' "$WAS"
  printf 'Check MONGODB_URI and MONGODB_DB in /etc/homefarm/api.env, then:\n\n'
  printf '    sudo systemctl restart homefarm-api\n\n'
  printf 'What it says:\n\n'
  journalctl -u homefarm-api -n 30 --no-pager
  exit 1
fi

# Rolling back automatically would be worse than stopping: the new code may be
# fine and the database unreachable, in which case reverting fixes nothing and
# hides which of the two it was. The check above now tells them apart, and this
# is the branch where the process itself never came back.
printf '\n\033[1;31mThe service did not come back.\033[0m\n\n'
printf 'What it says:\n\n'
journalctl -u homefarm-api -n 30 --no-pager

# ── And "go back to $WAS" is nonsense on a tick that deployed nothing ───────
#
# The rollback line is advice about a deploy that broke something. Now that this
# block is reached on a quiet tick too, `$WAS` is `$NOW` there — so it would
# offer a checkout of the commit already running as the repair for that commit
# not running, which is the shape of advice that costs somebody an hour.
if [ "$CHANGED" -eq 0 ]; then
  printf '\nNothing was deployed this run — it is on %s and was already.\n' "$NOW"
  printf 'So this is not a bad release; the server went away on its own and the\n'
  printf 'restart above did not bring it back.\n\n'
else
  printf '\nIt is on %s. The previous version was %s.\n' "$NOW" "$WAS"
  printf '\nTo go back:\n\n    cd %s && sudo git checkout %s && sudo systemctl restart homefarm-api\n\n' "$REPO_DIR" "$WAS"
fi
exit 1
