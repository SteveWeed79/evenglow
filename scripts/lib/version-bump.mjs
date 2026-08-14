/**
 * The Android version integer, and moving it.
 *
 * The decision only, with no filesystem in it, so it can be tested — the same
 * split as `api-origin.mjs` and `support-probe.mjs`.
 *
 * ## Why this is a script rather than a habit
 *
 * `expo.android.versionCode` is the only thing Android uses to decide whether
 * one APK is newer than another, and it has to move for every build that leaves
 * the machine (`docs/TESTING-BUILD.md` §5b). It was absent entirely until
 * recently, which meant Expo defaulted it to 1 and every build ever made
 * carried the same one.
 *
 * A rule that depends on somebody remembering a one-line edit at the start of a
 * fifteen-minute build is a rule that holds until the first time it matters.
 */

/**
 * The next value, and what it is being read from.
 *
 * Returns the whole decision rather than just a number so the caller can say
 * what it did — a build that silently renumbered itself is worse than one that
 * announces it, because the number is the thing being trusted afterwards.
 */
export function nextVersionCode(appJson) {
  const android = appJson?.expo?.android;
  const current = android?.versionCode;

  if (current === undefined) {
    /**
     * Absent means Expo has been defaulting it to 1, so every build already
     * shipped as 1 and the next honest number is 2. Starting at 1 here would
     * mint a "new" build indistinguishable from every old one.
     */
    return { from: null, to: 2, reason: 'absent — Expo has been defaulting it to 1' };
  }

  if (!Number.isInteger(current) || current < 1) {
    return { from: current, to: null, reason: 'not a positive integer' };
  }

  return { from: current, to: current + 1, reason: null };
}

/**
 * Rewrites the one number, touching nothing else in the file.
 *
 * A string edit rather than `JSON.parse` and re-stringify, because `app.json`
 * is hand-maintained and round-tripping it would reformat the whole file — a
 * diff nobody can read, on the file that decides what the icons and the
 * permissions are.
 */
export function withVersionCode(text, next) {
  const pattern = /("versionCode"\s*:\s*)(\d+)/;
  if (!pattern.test(text)) return null;
  return text.replace(pattern, `$1${next}`);
}

/**
 * The human-facing version, and moving it.
 *
 * ## A different number from `versionCode`, doing a different job
 *
 * `versionCode` is an integer Android compares to decide which APK is newer,
 * and **EAS assigns it now** — `appVersionSource: remote` with `autoIncrement`,
 * so the copy in `app.json` is only read by a local `expo run:android`. Nobody
 * ever sees it.
 *
 * `expo.version` is the one a person reads: on the install page, in Settings,
 * and in a support bundle when somebody says *"it does this on mine"*. It has
 * sat at 0.1.0 through every build this project has made, so every report so
 * far has been about "0.1.0" — which identifies nothing.
 *
 * ## Why CI moves it and a person does not
 *
 * The same argument the `versionCode` note above makes, one step further: a
 * rule that depends on remembering an edit is a rule that holds until the first
 * time it matters. Shipping is already a deliberate act with a button on it, so
 * the button is the place the number moves — a version that changes exactly
 * when something ships is a version that means something.
 */
export function nextVersion(appJson, part = 'patch') {
  const current = appJson?.expo?.version;

  if (typeof current !== 'string') {
    return { from: current ?? null, to: null, reason: 'absent or not a string' };
  }

  /**
   * Three plain integers, and nothing else accepted.
   *
   * Prereleases and build metadata — `0.1.0-beta.2+exp.sha` — are legal semver
   * and this refuses them rather than guessing what incrementing one means.
   * Nothing in this project mints them, so the only way one arrives is by hand,
   * and a hand-written version is a decision CI should not silently overwrite.
   */
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (match === null) {
    return { from: current, to: null, reason: 'not a plain major.minor.patch' };
  }

  const [major, minor, patch] = match.slice(1).map(Number);

  // Resetting the lower parts is the whole of semver's arithmetic: 0.1.9 with a
  // minor bump is 0.2.0, never 0.2.9.
  const to =
    part === 'major'
      ? `${major + 1}.0.0`
      : part === 'minor'
        ? `${major}.${minor + 1}.0`
        : `${major}.${minor}.${patch + 1}`;

  return { from: current, to, reason: null };
}

/**
 * Rewrites the one string, touching nothing else.
 *
 * Anchored on `"version"` with a word boundary that `"versionCode"` cannot
 * satisfy — the quote after it is the guard. Without that the pattern would
 * match `"versionCode": 3` on a file where it happens to come first and write a
 * semver string into an integer field, which Expo would then refuse to build.
 */
export function withVersion(text, next) {
  const pattern = /("version"\s*:\s*")(\d+\.\d+\.\d+)(")/;
  if (!pattern.test(text)) return null;
  return text.replace(pattern, `$1${next}$3`);
}
