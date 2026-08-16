import { describe, expect, it } from 'vitest';
import { parseReleaseTag, releaseTag, shippedCodes } from '../../scripts/lib/apk.mjs';
import {
  apkAsset,
  findRelease,
  newestReleaseTag,
  repoSlug,
} from '../../scripts/lib/release-apk.mjs';

/**
 * How the box decides which APK belongs to the commit it is serving.
 *
 * This is the second half of #153. The first half stopped a build quota being
 * able to refuse a release; this stops the box going on serving the last EAS
 * build for ever afterwards — the same silent half-done shape as the issue
 * itself, where everything reports success and the artefact never moves.
 *
 * The rules live in a `.mjs` lib rather than in `deploy.sh` for the reason
 * `scripts/lib/apk.mjs` gives about workflow files, which applies about as
 * hard to a shell script that runs unattended on a five-minute timer with
 * nobody reading its output.
 *
 * **Every case below fails closed**, and what "closed" means here is worth
 * stating: the shelf keeps the APK it already has. A farm goes on running the
 * app it has got. That is always better than publishing one nobody chose,
 * because the way off a wrong APK is an uninstall and an uninstall takes the
 * records with it (`docs/TESTING-BUILD.md` §3).
 */

describe('which tag on this commit names the app', () => {
  it('finds ours and ignores everything else', () => {
    const found = newestReleaseTag(['v0.1.13+18', 'some-other-tag']);
    expect(found).toEqual({ tag: 'v0.1.13+18', version: '0.1.13', code: 18 });
  });

  /**
   * A commit built twice — a rebuild after a signing fix, which is exactly
   * what run 1 needed — carries two tags. The higher `versionCode` is not a
   * preference: Android refuses an update whose code is not higher than what
   * is installed, so offering the older one publishes a download that every
   * device already carrying the newer one will decline.
   */
  it('takes the higher versionCode when a commit was built twice', () => {
    expect(newestReleaseTag(['v0.1.13+18', 'v0.1.13+19'])?.code).toBe(19);
    expect(newestReleaseTag(['v0.1.13+19', 'v0.1.13+18'])?.code).toBe(19);
    // Numerically, not lexically. '9' > '10' as strings, and a versionCode is
    // the one number in this project where that mistake is unrecoverable.
    expect(newestReleaseTag(['v0.2.0+9', 'v0.2.0+10'])?.code).toBe(10);
  });

  it('survives the whitespace git leaves behind', () => {
    expect(newestReleaseTag(['  v0.1.13+18\r'])?.tag).toBe('v0.1.13+18');
  });

  it('is null when this commit has no release, which is the ordinary case', () => {
    // A server-only promote ships no app, and the box must leave the shelf
    // alone rather than reach for the newest release of anything.
    expect(newestReleaseTag([])).toBeNull();
    expect(newestReleaseTag(['release', 'v1.0.0', ''])).toBeNull();
    expect(newestReleaseTag(undefined as never)).toBeNull();
  });

  it('round-trips with the tag the workflow writes', () => {
    expect(newestReleaseTag([releaseTag('0.1.13', 18)])).toEqual({
      tag: 'v0.1.13+18',
      version: '0.1.13',
      code: 18,
    });
  });
});

/**
 * The format lives in one place now, because two files read it. These hold the
 * refactor: `shippedCodes` must keep behaving exactly as it did when it owned
 * the regex itself.
 */
describe('the tag format, now shared', () => {
  it('parses both halves', () => {
    expect(parseReleaseTag('v0.1.13+18')).toEqual({ version: '0.1.13', code: 18 });
  });

  it('is null for anything that is not one of ours', () => {
    for (const bad of ['v1.0.0', 'docs-v2', 'v0.1+18', 'v0.1.13-18', '', 'release']) {
      expect(parseReleaseTag(bad), bad).toBeNull();
    }
  });

  it('still gives shippedCodes what it had', () => {
    expect(shippedCodes(['v0.1.13+18', 'docs-v2', 'v0.1.14+19'])).toEqual([19, 18]);
  });
});

describe('turning the origin remote into a repository', () => {
  it('reads the forms git actually prints', () => {
    for (const remote of [
      'https://github.com/SteveWeed79/steading',
      'https://github.com/SteveWeed79/steading.git',
      'https://github.com/SteveWeed79/steading/',
      'git@github.com:SteveWeed79/steading.git',
      'ssh://git@github.com/SteveWeed79/steading.git',
    ]) {
      expect(repoSlug(remote), remote).toBe('SteveWeed79/steading');
    }
  });

  /**
   * The answer becomes an `api.github.com` path, so a remote pointing anywhere
   * else is not a slug to extract — it is a box whose releases do not live on
   * GitHub. Guessing one would send a name to GitHub and publish whatever came
   * back.
   *
   * `github.com.example.net` is the case this is really for: it ends in the
   * right characters and is a completely different host.
   */
  it('refuses a remote that is not GitHub', () => {
    for (const remote of [
      'https://github.com.example.net/SteveWeed79/steading.git',
      'https://gitlab.com/SteveWeed79/steading.git',
      'git@example.com:SteveWeed79/steading.git',
      '/srv/git/steading.git',
      '',
    ]) {
      expect(repoSlug(remote), remote).toBeNull();
    }
  });

  it('refuses a path that is not exactly owner and name', () => {
    for (const remote of [
      'https://github.com/SteveWeed79',
      'https://github.com/owner/name/tree/main',
      'git@github.com:steading.git',
    ]) {
      expect(repoSlug(remote), remote).toBeNull();
    }
  });

  /**
   * Traversal, and where the guard actually earns its place.
   *
   * On the https form `new URL` has already collapsed `..` before this code
   * looks — `https://github.com/../../etc/passwd` arrives as the perfectly
   * ordinary two-segment path `/etc/passwd`. **The scp form gets no such
   * help**: it is not a URL, nothing parses it, and the segments reach the
   * regex exactly as written. So that is the form the check has to hold for,
   * and this asserts it there rather than where the platform was doing the
   * work.
   */
  it('refuses a traversal in the scp form, which nothing normalises', () => {
    expect(repoSlug('git@github.com:../evil.git')).toBeNull();
    expect(repoSlug('git@github.com:../../etc/passwd')).toBeNull();
    expect(repoSlug('git@github.com:owner/../../../x')).toBeNull();
  });
});

describe('finding the release for a tag', () => {
  const releases = [{ tag_name: 'v0.1.14+19' }, { tag_name: 'v0.1.13+18' }];

  it('matches the tag and not merely the newest', () => {
    // The whole point. `release` bumps the version, commits it and promotes
    // that commit, so the newest release is only coincidentally the one a
    // given box wants.
    expect(findRelease(releases, 'v0.1.13+18')).toBe(releases[1]);
  });

  it('is null when the tag is not on the page', () => {
    expect(findRelease(releases, 'v0.9.9+99')).toBeNull();
  });

  it('is null rather than throwing when GitHub returned something else', () => {
    // A rate-limit body is an object, not an array. This must not be the thing
    // that takes a deploy down.
    expect(findRelease({ message: 'API rate limit exceeded' }, 'v0.1.13+18')).toBeNull();
    expect(findRelease(null, 'v0.1.13+18')).toBeNull();
  });
});

describe('the APK on a release', () => {
  const asset = (over: Record<string, unknown> = {}) => ({
    name: 'steading-0.1.13-18.apk',
    state: 'uploaded',
    browser_download_url:
      'https://github.com/SteveWeed79/steading/releases/download/v0.1.13%2B18/steading-0.1.13-18.apk',
    ...over,
  });

  /**
   * The two arms, narrowed on `url` — which is exactly how `release-apk.mjs`
   * reads the answer. Going through these rather than reaching into the union
   * means a test cannot assert against a shape the caller could not have got.
   */
  const accepted = (release: unknown): { url: string; name: string } => {
    const found = apkAsset(release);
    if (found.url === null) throw new Error(`expected an APK, was refused: ${found.why}`);
    return found;
  };

  const refused = (release: unknown): string => {
    const found = apkAsset(release);
    if (found.url !== null) throw new Error(`expected a refusal, got ${found.url}`);
    return found.why;
  };

  it('takes the one that is there', () => {
    const found = accepted({ assets: [asset()] });
    expect(found.url).toMatch(/^https:\/\/github\.com\//);
    expect(found.name).toBe('steading-0.1.13-18.apk');
  });

  it('ignores whatever else is attached', () => {
    expect(accepted({ assets: [{ name: 'notes.txt' }, asset()] }).name).toBe(
      'steading-0.1.13-18.apk',
    );
  });

  /**
   * A release built by `apk.yml` has exactly one APK, so a second means
   * somebody attached something by hand. Choosing either would put an APK on a
   * farm's shelf that nobody decided to put there.
   */
  it('refuses two rather than choosing', () => {
    expect(refused({ assets: [asset(), asset({ name: 'steading-0.1.13-19.apk' })] })).toMatch(
      /refusing to guess/,
    );
  });

  it('refuses a draft, whose asset the box cannot download', () => {
    // 404 to the box, 200 in the browser of whoever is wondering why the
    // deploy has not picked it up.
    expect(refused({ draft: true, assets: [asset()] })).toMatch(/draft/);
  });

  it('refuses an asset that has not finished uploading', () => {
    expect(refused({ assets: [asset({ state: 'starter' })] })).toMatch(/still uploading/);
  });

  it('refuses a url that is not https', () => {
    // `publish-apk.sh` refuses one too — "an APK fetched over http is an APK
    // somebody on the path could have replaced" — and saying so here means the
    // deploy log names the reason rather than the symptom.
    expect(refused({ assets: [asset({ browser_download_url: 'http://example.com/a.apk' })] })).toMatch(
      /https/,
    );
  });

  it('says so when there is no APK, rather than reaching for something else', () => {
    expect(refused({ assets: [{ name: 'source.zip' }] })).toMatch(/no APK/);
    expect(refused({ assets: [] })).toMatch(/no APK/);
    expect(refused({})).toMatch(/no APK/);
    expect(refused(null)).toMatch(/no release/);
  });

  it('gives a reason every time it refuses', () => {
    // The deploy prints this into a log nobody is watching live, so "it did not
    // work" has to be a sentence somebody can act on a week later.
    for (const release of [null, {}, { draft: true, assets: [asset()] }, { assets: [] }]) {
      expect(refused(release).length, JSON.stringify(release)).toBeGreaterThan(10);
    }
  });
});
