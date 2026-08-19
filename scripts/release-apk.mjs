import { readFileSync } from 'node:fs';
import { newestReleaseTag, apkAsset, findRelease, repoSlug } from './lib/release-apk.mjs';

/**
 * The APK for the commit a box is serving, from the repository's Releases.
 *
 *   git tag --points-at HEAD | node scripts/release-apk.mjs --remote "$(git remote get-url origin)"
 *   git tag --points-at HEAD | node scripts/release-apk.mjs --repo SteveWeed79/evenglow
 *
 * Prints `url<TAB>version<TAB>code` on stdout when there is one to fetch, and
 * **nothing at all** when there is not. `deploy.sh` reads it exactly the way it
 * read the EAS query this replaces, so the publish, the `.last-artifact`
 * marker and the "already serving" check are untouched.
 *
 * Everything it decided goes to stderr, which is the deploy's log. That split
 * matters: the caller substitutes stdout into a variable, so a diagnostic
 * printed there would become part of a url.
 *
 * ## It exits 0 when it finds nothing, on purpose
 *
 * This runs after the API has been restarted and checked. A farm server that
 * failed its deployment because GitHub was slow, rate limited, or mid-incident
 * would be the tail wagging the dog — the same argument the EAS block made for
 * `|| true` throughout. The only non-zero exit is being called wrongly, which
 * is a bug in `deploy.sh` rather than a condition on the box.
 *
 * Tags arrive on stdin rather than being looked up here, and that is the design
 * rather than a convenience: git on the box already knows which tags point at
 * HEAD, so the commit-to-release mapping needs no API call, no token and no
 * channel between CI and this machine.
 */

const API = 'https://api.github.com';
const TIMEOUT_MS = 15_000;

function note(message) {
  process.stderr.write(`   ${message}\n`);
}

function fail(message) {
  process.stderr.write(`\n  ${message}\n\n`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const value = (flag) => {
  const at = argv.indexOf(flag);
  return at === -1 ? null : (argv[at + 1] ?? null);
};

const explicit = value('--repo');
const remote = value('--remote');
const slug = explicit ?? (remote === null ? null : repoSlug(remote));

if (slug === null) {
  if (remote !== null) {
    // Not a failure of the box. A checkout whose origin is not GitHub has no
    // Releases to ask about, and saying so is the whole answer.
    note(`origin (${remote}) is not a GitHub remote, so there are no releases to ask about`);
    process.exit(0);
  }
  fail('Usage: release-apk.mjs --remote <git remote url> | --repo <owner/name>');
}

const tags = readFileSync(0, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '');

const wanted = newestReleaseTag(tags);

if (wanted === null) {
  note('no app release tag on this commit — the shelf keeps what it has');
  process.exit(0);
}

/**
 * One page, newest first, rather than a request per tag.
 *
 * The box is on a five-minute timer and asks unauthenticated, which GitHub
 * rate limits to sixty an hour per address. One call a tick is twelve, with
 * room to spare for a person running this by hand while wondering why the
 * shelf has not moved.
 *
 * `GITHUB_TOKEN` is honoured when `/etc/homefarm/deploy.env` sets one — needed
 * only if this repository is ever made private, since a public repository's
 * releases are readable by anybody.
 */
const headers = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  // GitHub refuses a request without one.
  'user-agent': 'homefarm-deploy',
};
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

let releases;
try {
  const response = await fetch(`${API}/repos/${slug}/releases?per_page=100`, {
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    note(`GitHub answered ${response.status} for ${slug}'s releases — the shelf keeps what it has`);
    process.exit(0);
  }
  releases = await response.json();
} catch (error) {
  // Unreachable, timed out, mid-incident. All the same answer.
  note(`could not reach GitHub (${error instanceof Error ? error.message : String(error)})`);
  process.exit(0);
}

const found = apkAsset(findRelease(releases, wanted.tag));

if (found.url === null) {
  note(`${wanted.tag}: ${found.why}`);
  process.exit(0);
}

note(`${wanted.tag} -> ${found.name}`);
process.stdout.write(`${found.url}\t${wanted.version}\t${wanted.code}`);
