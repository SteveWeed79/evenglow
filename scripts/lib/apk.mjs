/**
 * The decisions a self-built APK needs, with no filesystem and no network in
 * them — the same split as `version-bump.mjs` and `api-origin.mjs`, and for a
 * sharper reason than usual.
 *
 * **A workflow file is the worst place in this repository to put a judgement.**
 * It cannot be run locally, it cannot be unit tested, and it is exercised for
 * the first time on the run that matters. Every non-obvious rule in
 * `.github/workflows/apk.yml` is therefore here instead, where
 * `tests/unit/apk.test.ts` can hold it, and the YAML is left doing what YAML is
 * good at: ordering steps.
 *
 * The three rules below are the ones that can lose a farm's records if they are
 * wrong, so each says out loud what it is protecting against.
 */

/**
 * The last `versionCode` EAS minted before we started building our own.
 *
 * Read off the build log of run 31896385226: *"Incremented versionCode from 16
 * to 17"*. That submission then failed on the monthly quota, so 17 was consumed
 * without producing an APK — which is exactly why it is the floor rather than
 * the ceiling. Anything at or below it may already exist in the wild.
 *
 * **Why a constant and not a lookup.** `eas.json` sets
 * `appVersionSource: remote`, so the real counter lives in Expo's project state
 * and `app.json`'s copy is stale at 3. Reaching back into EAS to ask would put
 * the quota we are escaping back on the critical path. This is a high-water
 * mark, written down once; raise it if EAS is ever used again.
 */
export const EAS_LAST_CODE = 17;

/** `v0.1.13+18` — the version a person reads, and the integer Android compares. */
const TAG = /^v(\d+\.\d+\.\d+)\+(\d+)$/;

export function releaseTag(version, code) {
  return `v${version}+${code}`;
}

/**
 * The `versionCode`s already released, newest first, from a list of tags.
 *
 * Anything that is not one of our tags is ignored rather than rejected: the
 * repository is free to carry tags this workflow did not make, and a release
 * process that fell over because somebody tagged `docs-v2` would be a bad
 * trade for the strictness.
 */
export function shippedCodes(tags) {
  return tags
    .map((tag) => TAG.exec(String(tag).trim()))
    .filter((match) => match !== null)
    .map((match) => Number(match[2]))
    .sort((a, b) => b - a);
}

/**
 * Which `versionCode` this build gets.
 *
 * ## What this is protecting against
 *
 * Android compares this integer and nothing else to decide whether an APK is
 * an update. Ship one at or below what a tablet already has and the install is
 * refused; the way round it is an uninstall, and an uninstall takes the farm's
 * records with it (`docs/TESTING-BUILD.md` §3). It is a one-line mistake with
 * a data-loss shape, and the first draft of the workflow made it a free-text
 * input with the right answer written in the description — which is not a
 * guard, it is a hope.
 *
 * So the number is **derived** and only overridable upward:
 *
 *   - the high-water mark of everything released so far, plus one;
 *   - never at or below {@link EAS_LAST_CODE}, because EAS minted those
 *     against an account this repository cannot see;
 *   - an explicit `override` is honoured only if it clears both of those.
 *
 * Returns the decision and its reason rather than a bare number, the same way
 * `nextVersionCode` does, so the job summary can say where the number came
 * from. A build that silently renumbered itself is worse than one that
 * announces it, because the number is the thing being trusted afterwards.
 *
 * `undefined` is spelled out because the repo runs `exactOptionalPropertyTypes`,
 * and an untouched workflow input genuinely arrives as one.
 *
 * @param {{ shipped?: readonly (number|string)[] | undefined, override?: number|string|null|undefined }} [options]
 * @returns {{ code: number, reason: string }}
 */
export function chooseVersionCode({ shipped = [], override = null } = {}) {
  const highest = Math.max(EAS_LAST_CODE, ...shipped.map(Number).filter(Number.isInteger));
  const derived = highest + 1;

  if (override === null || override === undefined || override === '') {
    return {
      code: derived,
      reason:
        shipped.length === 0
          ? `first self-built release, so one past EAS's last (${EAS_LAST_CODE})`
          : `one past the highest already released (${highest})`,
    };
  }

  const wanted = Number(override);
  if (!Number.isInteger(wanted) || wanted < 1) {
    throw new Error(`versionCode must be a positive integer, got "${override}".`);
  }
  if (wanted <= highest) {
    throw new Error(
      `versionCode ${wanted} is not above ${highest}, which is already out there. ` +
        `Android refuses an update whose code is not higher, and the only way past ` +
        `that on a device is an uninstall — which takes the farm's records with it. ` +
        `Use ${derived} or leave it blank.`,
    );
  }

  return { code: wanted, reason: `asked for, and clears ${highest}` };
}

/**
 * What `aapt2 dump badging` says the APK actually is.
 *
 * Parsed rather than trusted, because everything that produces these values
 * sits between the input and the artefact — `app.json` edited in the runner,
 * `expo prebuild` reading it, Gradle reading what prebuild wrote. Any one of
 * them silently using a stale value produces a completely normal APK with the
 * wrong number in it, and the only place that shows up is here.
 */
export function parseBadging(text) {
  const line = String(text).split('\n').find((l) => l.startsWith('package:')) ?? '';
  const field = (name) => {
    const match = new RegExp(`${name}='([^']*)'`).exec(line);
    return match === null ? null : match[1];
  };

  const code = field('versionCode');
  return {
    package: field('name'),
    versionCode: code === null ? null : Number(code),
    versionName: field('versionName'),
  };
}

/**
 * The signing certificate's SHA-256, from `apksigner verify --print-certs`.
 *
 * `null` when there is none to find, which is itself a failure the caller must
 * treat as one — an unsigned APK is not a lesser problem than a wrongly signed
 * one.
 */
export function certificateFrom(text) {
  const match = /Signer #1 certificate SHA-256 digest:\s*([0-9a-fA-F:\s]+)/.exec(String(text));
  return match === null ? null : normaliseFingerprint(match[1]);
}

/**
 * Colons, spaces and case removed, because the three tools that produce these
 * disagree about all three.
 *
 * `keytool` prints `AB:CD:EF…` uppercase, `apksigner` prints `abcdef…`
 * lowercase and unseparated, and a secret pasted out of either may have picked
 * up a line break. Comparing the raw strings would fail on a key that is
 * perfectly correct, and the failure mode of *that* is somebody deleting the
 * check because it "always breaks".
 */
export function normaliseFingerprint(value) {
  return String(value).replace(/[^0-9a-fA-F]/g, '').toUpperCase();
}

export function sameCertificate(a, b) {
  const left = normaliseFingerprint(a);
  const right = normaliseFingerprint(b);
  // Not "both empty are equal": an absent fingerprint on either side is the
  // check having nothing to say, and it must never read as a pass.
  return left.length === 64 && left === right;
}
