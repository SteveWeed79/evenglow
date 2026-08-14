#!/usr/bin/env bash
#
# The install page, in the one place that decides what it says.
#
#   render-install-page.sh <dist-dir> [stamp]
#
# ## Why this is its own file
#
# Two scripts wrote this page. `publish-apk.sh` wrote it **stamped** with the
# version it had just published; `deploy.sh` wrote it **unstamped**, for the
# window before anything had been published at all. Both were right on their
# own and wrong together, because `deploy.sh` runs every five minutes and
# `publish-apk.sh` only runs when there is a new build.
#
# So the sequence was: publish stamps the page, and the very next deploy tick
# copies the template back over it and takes the version off. Reported as
# *"the version number disappeared from the download site?"* — and it had.
#
# **The re-download loop was hiding it.** Until that was fixed, `publish-apk.sh`
# ran on every tick too, so it re-stamped the page moments after the deploy had
# blanked it. Fixing the loop did not cause this bug; it stopped masking one
# that had been there the whole time.
#
# One renderer, called by both, so a page cannot be written by something that
# does not know what to put on it.
set -euo pipefail

DIST="${1:?usage: render-install-page.sh <dist-dir> [stamp]}"
STAMP="${2:-}"

HERE="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE="$HERE/install-page.html"

# The page travels with the repo so it is reviewed like everything else. A box
# whose checkout predates it keeps whatever is already there rather than losing
# the page entirely.
[ -f "$TEMPLATE" ] || exit 0

install -d -m 0755 "$DIST"
install -m 0644 "$TEMPLATE" "$DIST/index.html"

# An empty stamp leaves the placeholder in place, and the page's own CSS
# collapses it — `.stamp:empty { display: none }`. That is the honest state
# before the first build: no version, rather than a version that is not there.
if [ -n "$STAMP" ]; then
  # `|` as the delimiter: a version has dots but never a pipe, and the
  # replacement is data rather than a pattern.
  sed -i "s|<!--VERSION-->|${STAMP}|" "$DIST/index.html"
fi

chown caddy:caddy "$DIST/index.html" 2>/dev/null || true
