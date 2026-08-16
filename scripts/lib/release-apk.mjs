/**
 * Which APK belongs to the commit this box is serving.
 *
 * The decisions only, with no network and no filesystem in them — the same
 * split as `apk.mjs`, and for the same reason that file gives at length: the
 * thing on the other side of this is a shell script running unattended on a
 * five-minute timer, and a shell script is very nearly as bad a place to put a
 * judgement as a workflow file.
 *
 * ## What this replaces, and the property that had to survive
 *
 * `deploy.sh` used to ask EAS for the build made from the commit it had just
 * deployed (`eas build:list --git-commit-hash`). Its own comment argued that
 * filter was better than a build id **because it needs no channel between CI
 * and the box** — the box already knows which commit it is serving, so nothing
 * has to be handed from one to the other and there is nothing to get out of
 * step.
 *
 * That property is the whole design, and "take the newest GitHub Release"
 * throws it away: `release` bumps the version, commits it and promotes *that*
 * commit, so the newest release is only coincidentally the one this box wants.
 *
 * So the commit is still the key. A release built by `.github/workflows/apk.yml`
 * carries a tag pointing at the commit it was built from, and git on the box can
 * resolve HEAD to that tag locally — no API call, no token, no channel. All the
 * network is then asked is "what is attached to this tag", which is a question
 * with one right answer.
 *
 * ## Failing closed
 *
 * Every refusal below leaves the shelf holding the APK it already has. That is
 * the correct failure: a farm goes on running the app it has, and the worst case
 * is a version behind rather than an install that takes the records with it.
 */

import { parseReleaseTag } from './apk.mjs';

/**
 * Which of the tags on a commit names the app to serve.
 *
 * Usually there is exactly one. There are two when a commit has been built
 * twice — a rebuild after a signing fix, say — and then the higher
 * `versionCode` is the only answer a device would accept anyway: Android
 * refuses an update whose code is not higher than what is installed, so
 * offering the older one produces a download that cannot be installed.
 *
 * Tags that are not ours are ignored rather than rejected, per
 * {@link parseReleaseTag}.
 *
 * @param {readonly string[]} tags
 * @returns {{ tag: string, version: string, code: number } | null}
 */
export function newestReleaseTag(tags) {
  const ours = (tags ?? [])
    .map((tag) => {
      const parsed = parseReleaseTag(tag);
      return parsed === null ? null : { tag: String(tag).trim(), ...parsed };
    })
    .filter((entry) => entry !== null);

  if (ours.length === 0) return null;
  return ours.sort((a, b) => b.code - a.code)[0];
}

/**
 * `owner/name` out of whatever `git remote get-url origin` prints.
 *
 * ## Why this refuses a remote that is not GitHub
 *
 * The caller turns the answer into an `api.github.com` request. A remote
 * pointing somewhere else is therefore not a slug to extract — it is a box
 * whose releases do not live on GitHub at all, and guessing a slug out of it
 * would send somebody else's repository name to GitHub and publish whatever
 * came back. `null` means "do not ask", which the CLI reports and carries on
 * from.
 *
 * @param {string} remote
 * @returns {string | null}
 */
export function repoSlug(remote) {
  const text = String(remote ?? '').trim();
  if (text === '') return null;

  // `git@github.com:owner/name.git` is not a URL and `new URL` will not parse
  // it, so the scp-like form is matched on its own rather than normalised into
  // one — normalising means rewriting the string before validating it.
  const scp = /^(?:[^@/]+@)?github\.com:(?<path>.+)$/.exec(text);
  let path;

  if (scp?.groups?.path !== undefined) {
    path = scp.groups.path;
  } else {
    let url;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    // `github.com` and nothing that merely ends in it — `github.com.example.net`
    // is a different host and is exactly what this check is for.
    if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return null;
    path = url.pathname;
  }

  const match = /^\/?(?<owner>[^/]+)\/(?<name>[^/]+?)(?:\.git)?\/?$/.exec(path);
  if (match?.groups === undefined) return null;

  const { owner, name } = match.groups;
  // A path segment reaching the API url has to be a segment. Anything with a
  // slash, a dot-dot or a query in it is not a repository name.
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(name)) return null;
  if (owner === '.' || owner === '..' || name === '.' || name === '..') return null;

  return `${owner}/${name}`;
}

/**
 * The release carrying a given tag, from a page of them.
 *
 * Matched here rather than by asking GitHub for `/releases/tags/<tag>`, and the
 * reason is the `+` in `v0.1.13+18`: it would have to be percent-encoded into a
 * url path, and whether the far end decodes it back is a detail this box would
 * discover by silently fetching nothing. Comparing strings in memory has no
 * such question in it.
 *
 * @param {unknown} releases
 * @param {string} tag
 */
export function findRelease(releases, tag) {
  if (!Array.isArray(releases)) return null;
  return releases.find((release) => release?.tag_name === tag) ?? null;
}

/**
 * The one APK attached to a release, or the reason there is not one.
 *
 * Returns a reason rather than throwing because every caller is a deploy that
 * has already restarted the API successfully. There is nothing here worth
 * failing a server deployment over — the app half is allowed to say "not this
 * time" and leave the shelf alone.
 *
 * ## Each refusal, and what it is actually protecting against
 *
 * **A draft** is not public, so its asset url answers 404 to the box and 200 to
 * whoever is looking at it in a browser wondering why the deploy is not
 * picking it up.
 *
 * **An asset still uploading** has a url that serves a partial file or an
 * error page. `publish-apk.sh` checks the magic bytes and would catch it, but
 * catching it here costs nothing and says something true instead of "that is
 * not even a zip".
 *
 * **Two APKs** is the one that has to refuse rather than choose. A release
 * built by `apk.yml` has exactly one, so a second means somebody attached
 * something by hand — and picking either would put an APK on a farm's shelf
 * that nobody decided to put there.
 *
 * @param {unknown} release
 * @returns {{ url: string, name: string } | { url: null, why: string }}
 */
export function apkAsset(release) {
  if (release === null || typeof release !== 'object') {
    return { url: null, why: 'there is no release for that tag' };
  }
  if (release.draft === true) {
    return { url: null, why: 'that release is still a draft, so its APK is not downloadable' };
  }

  const assets = Array.isArray(release.assets) ? release.assets : [];
  const apks = assets.filter((asset) => String(asset?.name ?? '').endsWith('.apk'));

  if (apks.length === 0) {
    return { url: null, why: 'that release has no APK attached' };
  }
  if (apks.length > 1) {
    const names = apks.map((asset) => asset.name).join(', ');
    return {
      url: null,
      why: `that release has ${apks.length} APKs attached (${names}) — refusing to guess which`,
    };
  }

  const [apk] = apks;
  // `uploaded` is the only state that serves the bytes. `starter` means the
  // upload was begun and never finished, which is a url that answers with
  // something that is not an APK.
  if (apk.state !== undefined && apk.state !== 'uploaded') {
    return { url: null, why: `${apk.name} is still uploading (state "${apk.state}")` };
  }

  const url = String(apk.browser_download_url ?? '');
  if (!url.startsWith('https://')) {
    return { url: null, why: `${apk.name} has no https download url` };
  }

  return { url, name: String(apk.name) };
}
