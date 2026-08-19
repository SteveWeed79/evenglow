#!/usr/bin/env bash
#
# Puts a built APK where Caddy serves it.
#
#   sudo /opt/steading/scripts/deploy/publish-apk.sh https://expo.dev/artifacts/eas/XXXX.apk
#   sudo /opt/steading/scripts/deploy/publish-apk.sh ~/steading-0.1.0-3.apk
#
# **The url form is the one to use.** The APK is built on Expo's machines, so a
# file on the PC got there by being downloaded from Expo already — sending it on
# to the box means the same forty megabytes crossing a home connection twice, up
# the slow half. The box fetches it once, from a datacentre. Get the url with
# `eas build:list --limit 1 --json` or off the build page.
#
# EAS builds it (`docs/TESTING-BUILD.md` §7) and this publishes it. The split is
# the point: the signing key stays in Expo's credential store rather than on an
# internet-facing box, which §8 argues is the one piece of state that must not
# live here.
#
# ## What it is actually for
#
# `https://api.swbuild.dev/app` never changes. EAS mints a new url per build and
# expires the artefact after thirty days, so sending an EAS link means sending
# a new one every time and watching old ones die. Here the address is a
# constant and the file behind it moves.
#
# **Both are kept.** `steading.apk` is what the stable link serves, and every
# build also stays under its own version so "the build she had in August" is a
# question with an answer. Nothing is deleted; see PRUNE below for why that is
# a decision rather than an oversight.
set -euo pipefail

DIST="${STEADING_DIST:-/var/lib/steading/dist}"
# One level up from what Caddy serves. Deploy markers live here — which build
# was fetched last, which version is on the shelf — because they are notes to
# the next deploy rather than files to publish, and `$DIST` has `file_server`
# pointed straight at it.
STATE="$(dirname "$DIST")"
SOURCE="${1:-}"

# The application this box serves. `deploy.sh` passes the same value to EAS as a
# query filter; this is the check on the file that actually arrived.
EXPECT_APP_ID="${STEADING_APP_ID:-dev.swbuild.homefarm}"

die() { printf '\n  %s\n\n' "$*" >&2; exit 1; }
say() { printf '\n  %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }

[ -n "$SOURCE" ] || die "Usage: publish-apk.sh <path-to.apk | https://…apk>"

# A url is fetched to a temporary file and then treated exactly like a local
# one, so everything below — the extension check, the refusal to overwrite, the
# symlink — is one code path rather than two that drift.
FETCHED=""
cleanup() { [ -n "$FETCHED" ] && rm -f "$FETCHED"; }
trap cleanup EXIT

case "$SOURCE" in
  https://*)
    FETCHED="$(mktemp /tmp/steading-XXXXXX.apk)"
    say "Fetching from ${SOURCE%%\?*}"
    # --fail so an HTML error page does not get published as an APK, and
    # --location because artefact urls redirect to storage.
    curl --fail --location --silent --show-error --output "$FETCHED" "$SOURCE" \
      || die "Could not download it. Check the url has not expired — EAS artefacts last thirty days."
    # The name in the url means nothing useful (EAS uses an opaque id), so the
    # version is read out of the file below or falls back to the built name.
    SOURCE="$FETCHED"
    note "$(du -h "$FETCHED" | cut -f1) downloaded"
    ;;
  http://*)
    die "Refusing an unencrypted download. An APK fetched over http is an APK somebody on the path could have replaced."
    ;;
esac

[ -f "$SOURCE" ] || die "No such file: $SOURCE"

case "$SOURCE" in
  *.apk) ;;
  # An AAB is what the `production` profile makes and it is for Play, not for a
  # phone. Android cannot install one, so catching it here saves somebody
  # discovering that on a handset in a barn.
  *.aab) die "That is an app bundle, for Play. A phone needs an APK — build the preview-farm profile." ;;
  *) die "That does not look like an APK: $SOURCE" ;;
esac

# Is this actually an Android package?
#
# **The extension proves nothing, and on the url path it proves less than
# nothing.** A fetched file is written to a mktemp template ending in `.apk`, so
# the check above passes for whatever came back — found by publishing this
# repository's README as a build. `--fail` catches an HTTP error and says
# nothing about a 200 that returned the wrong thing.
#
# An APK is a zip, so the first four bytes settle it, and the manifest inside
# separates an APK from any other zip when `unzip` is here to look. Cheap, and
# it runs on the local path too — a file named `.apk` by hand is a guess as much
# as a download is.
MAGIC="$(head -c 4 "$SOURCE" | od -An -tx1 | tr -d ' \n')"
[ "$MAGIC" = "504b0304" ] \
  || die "That is not an Android package — it is not even a zip. Check the url returned the build and not a login page."

if command -v unzip >/dev/null 2>&1; then
  unzip -l "$SOURCE" AndroidManifest.xml >/dev/null 2>&1 \
    || die "That zip has no AndroidManifest.xml, so it is not an APK. An app bundle or a source archive will look like this."

  # ── Whose app is it? (P2-2) ───────────────────────────────────────────────
  #
  # An APK is an APK; that says nothing about which application it is. The
  # deploy asks EAS for a build matching this application id, so this is the
  # second belt — it checks the bytes that arrived rather than the query that
  # asked for them, and it is the only check on the hand-run path, where there
  # is no query at all.
  #
  # The manifest is binary XML and the box has no Android SDK by its own stated
  # decision, so this reads the string pool rather than parsing. `tr -d '\0'`
  # is what makes that work for both encodings AAPT2 emits: a UTF-16LE string
  # is the same ASCII with a null after every byte, and stripping nulls leaves
  # one form to match. Neither `unzip -p` nor `grep -a` cares that the rest of
  # the file is not text.
  #
  # Refuses rather than warns. A timer-driven deploy has nobody reading its
  # output, so a warning here is a warning nobody sees — and the cost of being
  # wrong is bounded and loud: the shelf keeps the APK it has, the deploy notes
  # that it could not publish, and the API is untouched.
  if ! unzip -p "$SOURCE" AndroidManifest.xml 2>/dev/null | tr -d '\0' | grep -qa "$EXPECT_APP_ID"; then
    die "That APK does not name ${EXPECT_APP_ID}. It is some other application — check which profile built it."
  fi
fi

command -v aapt2 >/dev/null 2>&1 && AAPT=aapt2 || AAPT=""

# Reads the version out of the APK when the tooling is there, so the filename
# describes the file rather than whatever was typed. The box has no Android SDK
# and is not getting one, so this is a nicety that must not be a requirement.
VERSION=""
CODE=""
if [ -n "$AAPT" ]; then
  BADGING="$($AAPT dump badging "$SOURCE" 2>/dev/null || true)"
  VERSION="$(printf '%s' "$BADGING" | sed -n "s/.*versionName='\([^']*\)'.*/\1/p" | head -1)"
  CODE="$(printf '%s' "$BADGING" | sed -n "s/.*versionCode='\([^']*\)'.*/\1/p" | head -1)"
fi

LABEL="${2:-}"

# ── The label knows the two numbers; read them out of it ────────────────────
#
# **Without this the install page said `Version 0.1.15-19`.** The stamp further
# down renders `Version <version> · build <code>` when `aapt2` supplied both and
# fell back to printing the label verbatim when it did not — and the box has no
# Android SDK and is not getting one, so on this box the fallback is the only
# path there is. A filename stem dressed up as a version number is what a tester
# actually saw.
#
# The label is `<version>-<code>` because that is what `deploy.sh` builds it
# from, so the two numbers are in there; they were simply never taken apart.
# Splitting them here rather than at the stamp means the name, the "Publishing"
# line and the stamp all come from one place, and a caller that passes a label
# in the documented form gets the same output as a machine with `aapt2` on it.
#
# Guarded, and only a label that really is `<version>-<code>` is split: the
# version must start with a digit and contain a dot, the code must be all
# digits. Anything else — `nightly`, `for-sarah` — is left whole and still
# names the file, which is the behaviour that was there before.
if [ -z "$VERSION" ] && [ -n "$LABEL" ]; then
  case "$LABEL" in
    [0-9]*.*-*)
      MAYBE_VERSION="${LABEL%-*}"
      MAYBE_CODE="${LABEL##*-}"
      case "$MAYBE_CODE" in
        '' | *[!0-9]*) ;;
        *)
          VERSION="$MAYBE_VERSION"
          CODE="$MAYBE_CODE"
          ;;
      esac
      ;;
  esac
fi

if [ -n "$VERSION" ] && [ -n "$CODE" ]; then
  NAME="steading-${VERSION}-${CODE}.apk"
  say "Publishing Steading $VERSION (versionCode $CODE)"
elif [ -n "$LABEL" ]; then
  # Said rather than read. The box has no Android SDK and is not getting one,
  # so on the url path this is how a build gets a name that means something.
  NAME="steading-${LABEL}.apk"
  say "Publishing $NAME"
elif [ -z "$FETCHED" ]; then
  # A local file already carries whatever name the person who downloaded it
  # gave it, and that is usually the EAS one, which has the version in it.
  NAME="$(basename "$SOURCE")"
  say "Publishing $NAME"
else
  # Downloaded, unreadable and unnamed. A timestamp is unique and sortable and
  # tells you nothing about what is in the file, so this says so plainly rather
  # than letting a meaningless name look deliberate.
  NAME="steading-$(date -u +%Y%m%d-%H%M).apk"
  say "Publishing $NAME"
  note "no version in the name — pass one as a second argument:"
  note "  publish-apk.sh <url> 0.1.0-2"
  note "the refusal to overwrite cannot protect you when every name is unique"
fi

install -d -m 0755 "$DIST"

TARGET="$DIST/$NAME"
if [ -e "$TARGET" ]; then
  # **Refuses rather than overwrites**, and this is the versionCode rule with
  # teeth. Two different builds under one name means the archive is a lie and
  # `/app` serves something nobody can identify. §5b of TESTING-BUILD.md is the
  # bump this is asking for.
  die "$NAME is already published. Bump expo.android.versionCode and build again — see docs/TESTING-BUILD.md §5b."
fi

install -m 0644 "$SOURCE" "$TARGET"
note "kept as $NAME"

# The stable link. Replaced every time, which is the whole reason the address
# can be sent once and never again.
ln -sfn "$NAME" "$DIST/steading.apk"
note "/app/steading.apk now serves it"

# ── Which build this is, remembered where the next deploy can find it ───────
#
# CI moves `expo.version` on every release now, which makes the number worth
# reading — and a tester deciding whether to install again has no other way to
# tell what the box is serving without installing it first.
#
# From whichever of the two knew. `aapt2` reads it out of the file when the box
# happens to have one; otherwise the caller was told by EAS and passed it as the
# label. Guarding this on the `aapt2` read alone — which it once did — meant the
# stamp never rendered on the one box it was written for, because that box has
# no Android SDK and is not getting one.
STAMP=""
if [ -n "$VERSION" ]; then
  STAMP="Version ${VERSION}${CODE:+ · build $CODE}"
elif [ -n "$LABEL" ]; then
  STAMP="Version ${LABEL}"
fi

# **Written down, not just rendered.** `deploy.sh` re-renders this page every
# five minutes and has no idea what is on the shelf; without a record it wrote
# the template back over the stamped page and the version vanished. One line in
# a file the deploy can read is the whole fix.
#
# In the state directory rather than in `$DIST`, because `$DIST` is served to
# the internet by Caddy and a deploy marker is not something to publish. The
# same applies to `.last-artifact` beside it. Still outside the repository, so a
# `git clean` cannot reach either.
install -d -m 0755 "$STATE"
printf '%s' "$STAMP" > "$STATE/.version"

"$(cd "$(dirname "$0")" && pwd)/render-install-page.sh" "$DIST" "$STAMP"
note "install page refreshed${STAMP:+ — $STAMP}"

chown -R caddy:caddy "$DIST" 2>/dev/null || true

say "Published"
note "Send this, once: https://${STEADING_DOMAIN:-api.swbuild.dev}/app"
note ""
note "Everything published so far:"
# Real files only. `steading.apk` is the symlink to whichever of these is
# current, and listing it alongside them showed a build of zero bytes.
find "$DIST" -maxdepth 1 -type f -name '*.apk' -printf '%f\t%s\n' 2>/dev/null \
  | sort \
  | while IFS=$'\t' read -r f bytes; do
      current=""
      [ "$(readlink "$DIST/steading.apk" 2>/dev/null)" = "$f" ] && current="   <- /app/steading.apk"
      note "  $f  $((bytes / 1024 / 1024)) MB$current"
    done

# PRUNE — nothing here deletes an old build, deliberately.
#
# An APK is forty megabytes and the box's disk is a fixed allowance, so this
# will need attention eventually. It is manual because the one thing worse than
# a full disk is a script that quietly deleted the build a farm is still
# running when somebody needs to reproduce a defect against it.
#
#   ls -lt /var/lib/steading/dist/*.apk        # newest first
#   sudo rm /var/lib/steading/dist/steading-0.1.0-2.apk
#
# Never delete the target of the steading.apk symlink; `ls -l` shows which.
