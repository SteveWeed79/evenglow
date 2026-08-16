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
 * The two numbers inside one of our tags, or `null` for anything else.
 *
 * The format is written down once, here, because two places now read it:
 * {@link shippedCodes} deciding the next `versionCode`, and
 * `release-apk.mjs` deciding which release holds the APK for a commit. A
 * second regex somewhere else is a second thing to keep in step with
 * {@link releaseTag}.
 *
 * Anything that is not one of our tags is ignored rather than rejected: the
 * repository is free to carry tags this workflow did not make, and a release
 * process that fell over because somebody tagged `docs-v2` would be a bad
 * trade for the strictness.
 */
export function parseReleaseTag(tag) {
  const match = TAG.exec(String(tag).trim());
  return match === null ? null : { version: match[1], code: Number(match[2]) };
}

/** The `versionCode`s already released, newest first, from a list of tags. */
export function shippedCodes(tags) {
  return tags
    .map(parseReleaseTag)
    .filter((parsed) => parsed !== null)
    .map((parsed) => parsed.code)
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
/**
 * The certificate digest, from whatever shape `apksigner` prints this week.
 *
 * ## Three formats in three attempts, and the lesson in that
 *
 * This started pinned to the literal `Signer #1 certificate SHA-256 digest:`.
 * It then guessed at the SDK-range form. What the runner actually prints is a
 * **per-scheme** prefix:
 *
 *     V3.0 Signer: certificate DN: CN=, OU=, O=, L=, ST=, C=US
 *     V3.0 Signer: certificate SHA-256 digest: e5cc9f91…
 *     V3.0 Signer: certificate SHA-1 digest: a25ba0bf…
 *
 * — and there are `V1.0`, `V2.0`, `V3.1` and `V4.0` forms of the same thing.
 * Two builds, twenty-six minutes, spent learning that the prefix is the part
 * that moves. **So the prefix is no longer matched at all.**
 *
 * What is matched is the part every version of every format has agreed on:
 * `certificate SHA-256 digest:` followed by hex. The workflow deliberately
 * takes the NEWEST build-tools on the runner, so anything keyed to a signer
 * label is a thing that will break again on somebody else's afternoon.
 *
 * `SHA-?256` and nothing looser: the SHA-1 and MD5 digests sit on the very
 * next lines, and picking one of those would compare a real fingerprint
 * against a real fingerprint of the wrong kind — which fails looking exactly
 * like a wrong key, and would send somebody hunting for a keystore problem
 * that does not exist.
 *
 * Matched per line, so a capture cannot run past the end of its own line into
 * the digest below it.
 */
const CERT_SHA256 = /\bcertificate\s+SHA-?256\s+digest\s*:\s*([0-9a-fA-F][0-9a-fA-F:\s]*?)\s*$/i;

export function certificateFrom(text) {
  for (const line of String(text).split('\n')) {
    const match = CERT_SHA256.exec(line);
    if (match === null) continue;
    const digest = normaliseFingerprint(match[1]);
    // A digest line with nothing usable after the colon is not an answer. Keep
    // looking, and fall through to null rather than returning an empty string
    // that `sameCertificate` would have to refuse a second time.
    if (digest !== '') return digest;
  }
  return null;
}

/**
 * What the tool actually printed, for a failure that could not read it.
 *
 * **The check said "is the APK signed?" and showed nothing**, so the only way
 * to find out what `apksigner` had really written was another thirteen-minute
 * build. That is the same shape as run 1's failure text being buried under
 * Gradle's cache output: the guard fired correctly and told nobody anything
 * they could act on.
 *
 * Bounded, because this goes into a log and the point is the first few lines —
 * `apksigner` puts `Verifies` and the scheme results at the top, which is
 * exactly what distinguishes "unsigned" from "signed, printed differently".
 */
export function certsExcerpt(text, limit = 12) {
  const lines = String(text ?? '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '');

  if (lines.length === 0) return '(it printed nothing at all)';

  const shown = lines.slice(0, limit);
  const rest = lines.length - shown.length;
  return shown.join('\n') + (rest > 0 ? `\n… and ${rest} more line${rest === 1 ? '' : 's'}` : '');
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
  /**
   * The label comes off first, and it has to.
   *
   * `keytool` prints `         SHA256: A1:B2:…` and copying the whole line is
   * the obvious thing to do. **`SHA256` contains four hex characters** — S, H
   * are not, but A, 2, 5, 6 are — so stripping non-hex without removing the
   * label first silently prepends `A256` and yields 68 characters that look
   * almost right. Run 1 of the APK workflow failed on exactly this shape.
   *
   * Only a recognised label is removed, not any prefix: the point is to
   * tolerate the format the tools emit, not to go hunting for 64 hex
   * characters somewhere inside arbitrary text. A genuinely wrong key must
   * still fail.
   */
  const withoutLabel = String(value).replace(/SHA-?(256|1)\s*[:=]/gi, ' ');
  return withoutLabel.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
}

export function sameCertificate(a, b) {
  const left = normaliseFingerprint(a);
  const right = normaliseFingerprint(b);
  // Not "both empty are equal": an absent fingerprint on either side is the
  // check having nothing to say, and it must never read as a pass.
  return left.length === 64 && left === right;
}
