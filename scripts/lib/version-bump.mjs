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
