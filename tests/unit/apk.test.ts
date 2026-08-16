import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { farmOrigin } from '../../scripts/lib/api-origin.mjs';
import {
  certificateFrom,
  certsExcerpt,
  chooseVersionCode,
  EAS_LAST_CODE,
  normaliseFingerprint,
  parseBadging,
  releaseTag,
  sameCertificate,
  shippedCodes,
} from '../../scripts/lib/apk.mjs';

/**
 * The rules a self-built APK is held to.
 *
 * These live in a `.mjs` lib rather than in `.github/workflows/apk.yml` for one
 * reason: **a workflow file cannot be tested and is exercised for the first
 * time on the run that matters.** Everything below decides whether an APK
 * reaches a tablet, and the failure mode of every one of them is the same —
 * an APK that looks completely normal and cannot be installed over the one a
 * farm already has, where the way round is an uninstall and an uninstall takes
 * the records with it.
 *
 * So the bar here is not "the happy path works". It is that each rule **fails
 * closed**, which is what the negative cases below are for.
 */

describe('choosing a versionCode', () => {
  it('starts one past what EAS already minted', () => {
    // EAS built against an account this repo cannot query, so its high-water
    // mark is written down rather than looked up. Anything at or below it may
    // already be on a device.
    const { code } = chooseVersionCode({ shipped: [] });
    expect(code).toBe(EAS_LAST_CODE + 1);
  });

  it('climbs past everything already released', () => {
    expect(chooseVersionCode({ shipped: [18, 19, 20] }).code).toBe(21);
    // Order is not assumed. A tag list arrives however git felt like sorting it.
    expect(chooseVersionCode({ shipped: [20, 18, 19] }).code).toBe(21);
  });

  it('never drops below the EAS mark, however few releases there are', () => {
    // The case that matters after a release is deleted: the high-water mark
    // falls, and the floor is what stops the counter walking backwards into
    // numbers that are already out in the world.
    expect(chooseVersionCode({ shipped: [5, 6] }).code).toBe(EAS_LAST_CODE + 1);
  });

  it('says where the number came from', () => {
    // A build that silently renumbered itself is worse than one that announces
    // it, because the number is the thing being trusted afterwards.
    expect(chooseVersionCode({ shipped: [] }).reason).toContain(String(EAS_LAST_CODE));
    expect(chooseVersionCode({ shipped: [30] }).reason).toContain('30');
  });

  describe('and the override, which is the dangerous half', () => {
    it('is honoured when it clears everything already out there', () => {
      const { code, reason } = chooseVersionCode({ shipped: [18], override: 25 });
      expect(code).toBe(25);
      expect(reason).toContain('asked for');
    });

    it('accepts the string a workflow input actually gives it', () => {
      // `inputs.versionCode` arrives as a string however the type is declared.
      expect(chooseVersionCode({ shipped: [18], override: '25' }).code).toBe(25);
    });

    /**
     * The whole reason this function exists.
     *
     * The first draft of the workflow made `versionCode` a required free-text
     * input with the right answer written in the description. A description is
     * not a guard. A typo of `8` there produces an APK that is refused by
     * every device it is offered to.
     */
    it('refuses a code at or below what is already released', () => {
      expect(() => chooseVersionCode({ shipped: [18, 19], override: 19 })).toThrow(/not above 19/);
      expect(() => chooseVersionCode({ shipped: [18, 19], override: 8 })).toThrow(/not above 19/);
    });

    it('refuses one at or below the EAS mark even with nothing released', () => {
      expect(() => chooseVersionCode({ shipped: [], override: EAS_LAST_CODE })).toThrow();
      expect(() => chooseVersionCode({ shipped: [], override: 3 })).toThrow();
    });

    it('refuses anything that is not a positive integer', () => {
      for (const bad of ['abc', '1.5', '-2', '0', 'NaN']) {
        expect(() => chooseVersionCode({ shipped: [], override: bad }), bad).toThrow();
      }
    });

    it('treats blank as not asking', () => {
      // An untouched optional input is an empty string, not an absent one.
      for (const blank of ['', null, undefined]) {
        expect(chooseVersionCode({ shipped: [20], override: blank }).code).toBe(21);
      }
    });
  });
});

describe('reading the tags', () => {
  it('finds our releases and ignores everything else', () => {
    const tags = ['v0.1.13+18', 'docs-v2', 'v0.1.14+19', '', 'release', 'v1.0.0'];
    expect(shippedCodes(tags)).toEqual([19, 18]);
  });

  it('survives the whitespace `git tag --list` leaves behind', () => {
    expect(shippedCodes(['  v0.1.13+18  ', '\tv0.2.0+21\n'])).toEqual([21, 18]);
  });

  it('round-trips with the tag it writes', () => {
    expect(shippedCodes([releaseTag('0.1.13', 18)])).toEqual([18]);
  });
});

describe('what the APK says it is', () => {
  const BADGING =
    "package: name='com.steading.app' versionCode='18' versionName='0.1.13' " +
    "compileSdkVersion='36'\nsdkVersion:'24'\napplication-label:'Steading'\n";

  it('reads the three fields that matter', () => {
    expect(parseBadging(BADGING)).toEqual({
      package: 'com.steading.app',
      versionCode: 18,
      versionName: '0.1.13',
    });
  });

  it('does not confuse versionCode with compileSdkVersion', () => {
    // Both end in `Version` and both are on the same line.
    expect(parseBadging(BADGING).versionCode).toBe(18);
  });

  it('returns nulls rather than guessing when there is no package line', () => {
    expect(parseBadging("sdkVersion:'24'\n")).toEqual({
      package: null,
      versionCode: null,
      versionName: null,
    });
  });
});

describe('the signing certificate', () => {
  const CERTS = `Signer #1 certificate DN: CN=Steading
Signer #1 certificate SHA-256 digest: a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90
Signer #1 certificate SHA-1 digest: 0123456789abcdef0123456789abcdef01234567
`;

  it('picks the SHA-256 and not the SHA-1 above or below it', () => {
    expect(certificateFrom(CERTS)).toBe(
      'A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F60718293A4B5C6D7E8F90',
    );
  });

  it('is null when there is nothing to find', () => {
    // An unsigned APK is not a lesser problem than a wrongly signed one, so
    // this has to be distinguishable from a match.
    expect(certificateFrom('DOES NOT VERIFY')).toBeNull();
  });

  /**
   * **The output a real runner really produced**, copied from APK run 2 — the
   * build that cost thirteen minutes to learn one line. Verbatim on purpose:
   * every previous version of this parser was written against a guess at the
   * format, and each guess was wrong in a different way.
   */
  it('reads what the runner actually printed', () => {
    const real =
      'V3.0 Signer: certificate DN: CN=, OU=, O=, L=, ST=, C=US\n' +
      'V3.0 Signer: certificate SHA-256 digest: e5cc9f91ba8d6f5ce0afa2482ca765d10efebfd7d2f5fbc111d93247428863cc\n' +
      'V3.0 Signer: certificate SHA-1 digest: a25ba0bf06d52ed6e109d361ffc1ccb43c5ef4fb\n' +
      'V3.0 Signer: certificate MD5 digest: e57ad165764850942329018d31af2152\n';

    expect(certificateFrom(real)).toBe(
      'E5CC9F91BA8D6F5CE0AFA2482CA765D10EFEBFD7D2F5FBC111D93247428863CC',
    );
  });

  /**
   * Three formats in three attempts: the literal `Signer #1`, a guess at the
   * SDK-range form, and the per-scheme `V3.0 Signer:` that turned out to be
   * real. The prefix is the part that moves, so the prefix is no longer
   * matched — only `certificate SHA-256 digest:`, which every version of every
   * format has agreed on.
   */
  it('does not care what the signer is called', () => {
    const digest = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const want = digest.toUpperCase();

    for (const prefix of [
      'Signer #1',
      'Signer #1 (minSdkVersion=24, maxSdkVersion=2147483647)',
      'Signer (minSdkVersion=24, maxSdkVersion=32) #1',
      'V1.0 Signer:',
      'V2.0 Signer:',
      'V3.0 Signer:',
      'V3.1 Signer:',
      'V4.0 Signer:',
    ]) {
      const text = `Verifies\n${prefix} certificate SHA-256 digest: ${digest}\n`;
      expect(certificateFrom(text), prefix).toBe(want);
    }
  });

  it('reads it without the hyphen too', () => {
    const digest = 'f'.repeat(64);
    expect(certificateFrom(`V2.0 Signer: certificate SHA256 digest: ${digest}\n`)).toBe(
      digest.toUpperCase(),
    );
  });

  it('takes the same answer when several schemes each report it', () => {
    // v1, v2 and v3 all list the one certificate, so any of them is the answer
    // — but the parser must not stitch two lines into one.
    const digest = '9'.repeat(64);
    const text =
      `V1.0 Signer: certificate SHA-256 digest: ${digest}\n` +
      `V2.0 Signer: certificate SHA-256 digest: ${digest}\n` +
      `V3.0 Signer: certificate SHA-256 digest: ${digest}\n`;
    expect(certificateFrom(text)).toBe(digest.toUpperCase());
  });

  it('does not read the SHA-1 or the MD5 sitting next to it', () => {
    // All three are adjacent and all three are real fingerprints, so picking
    // the wrong one compares a genuine digest against a genuine digest of the
    // wrong kind — a mismatch indistinguishable from a wrong key, which would
    // send somebody hunting a keystore problem that does not exist.
    const noSha256 =
      'V3.0 Signer: certificate DN: CN=, OU=, O=, L=, ST=, C=US\n' +
      'V3.0 Signer: certificate SHA-1 digest: a25ba0bf06d52ed6e109d361ffc1ccb43c5ef4fb\n' +
      'V3.0 Signer: certificate MD5 digest: e57ad165764850942329018d31af2152\n';
    expect(certificateFrom(noSha256)).toBeNull();
  });

  it('does not run past the end of its own line', () => {
    // Matched per line for this reason: the old whole-text regex captured a
    // character class that included whitespace, so it was one unlucky
    // neighbouring line away from swallowing the digest below it.
    const digest = 'a'.repeat(64);
    const text =
      `Signer #1 certificate SHA-256 digest: ${digest}\n` +
      `Signer #1 certificate SHA-1 digest: ${'b'.repeat(40)}\n`;
    expect(certificateFrom(text)).toBe(digest.toUpperCase());
  });

  it('keeps looking past a digest line with nothing after the colon', () => {
    const digest = 'c'.repeat(64);
    const text = `Signer #1 certificate SHA-256 digest:\nSigner #2 certificate SHA-256 digest: ${digest}\n`;
    expect(certificateFrom(text)).toBe(digest.toUpperCase());
    // And an empty one on its own is still nothing, not an empty string.
    expect(certificateFrom('Signer #1 certificate SHA-256 digest:\n')).toBeNull();
  });
});

/**
 * What the tool printed, when the parser could not read it.
 *
 * The check used to say only *"is the APK signed?"*, which is two completely
 * different repairs wearing one sentence — and the only way to tell them apart
 * was to build again. Thirteen minutes to learn one line.
 */
describe('showing what could not be parsed', () => {
  it('says plainly when there was nothing at all', () => {
    // An empty file and an unrecognised format are not the same problem.
    expect(certsExcerpt('')).toMatch(/nothing at all/);
    expect(certsExcerpt(null)).toMatch(/nothing at all/);
    expect(certsExcerpt('\n\n   \n')).toMatch(/nothing at all/);
  });

  it('keeps the first lines, which are the ones that identify the format', () => {
    // apksigner leads with `Verifies` and the scheme results, and those are
    // exactly what separates "unsigned" from "signed, printed differently".
    const excerpt = certsExcerpt('Verifies\nVerified using v2 scheme: true\nSigner #1 …\n');
    expect(excerpt).toContain('Verifies');
    expect(excerpt).toContain('v2 scheme');
  });

  it('is bounded, and says how much it left out', () => {
    const excerpt = certsExcerpt(
      Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n'),
      12,
    );
    expect(excerpt.split('\n')).toHaveLength(13);
    expect(excerpt).toContain('18 more lines');
    expect(excerpt).not.toContain('line 20');
  });

  /**
   * The three tools disagree about formatting, and a check that "always
   * breaks" is a check somebody deletes.
   *
   * `keytool` prints uppercase with colons, `apksigner` prints lowercase
   * without, and a secret pasted out of either can pick up a line break.
   */
  it('matches across the formats the tools actually emit', () => {
    const plain = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const keytool = plain.toUpperCase().replace(/(..)(?=.)/g, '$1:');

    expect(sameCertificate(plain, keytool)).toBe(true);
    expect(sameCertificate(plain, ` ${keytool}\n`)).toBe(true);
    expect(normaliseFingerprint(keytool)).toBe(plain.toUpperCase());
  });

  /**
   * The failure that took run 1 down, and the reason it was not obvious.
   *
   * `keytool` prints `         SHA256: A1:B2:…` and copying the whole line is
   * the natural thing to do. **`SHA256` contains four hex characters** — A, 2,
   * 5 and 6 — so stripping non-hex without removing the label first prepends
   * `A256`, giving 68 characters that look almost right and match nothing.
   *
   * Refusing that was technically correct and practically useless: it is the
   * "check that always breaks" shape this function's own comment warns about.
   */
  it('tolerates the label keytool prints in front of it', () => {
    const plain = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const colons = plain.toUpperCase().replace(/(..)(?=.)/g, '$1:');

    for (const pasted of [`         SHA256: ${colons}`, `SHA-256: ${colons}`, `sha256=${colons}`]) {
      expect(sameCertificate(pasted, plain), pasted.trim().slice(0, 12)).toBe(true);
    }
    expect(normaliseFingerprint(`SHA256: ${colons}`)).toHaveLength(64);
  });

  it('still refuses a wrong key wearing that same label', () => {
    // Tolerating the label must not become "find 64 hex characters anywhere".
    expect(sameCertificate(`SHA256: ${'b'.repeat(64)}`, 'a'.repeat(64))).toBe(false);
    expect(sameCertificate('SHA256:', 'a'.repeat(64))).toBe(false);
  });

  it('does not match a different key', () => {
    const a = 'a'.repeat(64);
    const b = `${'a'.repeat(63)}b`;
    expect(sameCertificate(a, b)).toBe(false);
  });

  /**
   * Empty must never read as a pass.
   *
   * This is the shape of bug that turns a guard into decoration: an unset
   * secret makes both sides empty, `a === b` is true, and the check reports
   * success on an APK it never looked at.
   */
  it('refuses two absent fingerprints', () => {
    expect(sameCertificate('', '')).toBe(false);
    expect(sameCertificate(null, null)).toBe(false);
    expect(sameCertificate(undefined, '')).toBe(false);
  });

  it('refuses a fingerprint that is the right shape but the wrong length', () => {
    // A truncated paste — 63 hex characters — must not pass by prefix.
    const short = 'a'.repeat(63);
    expect(sameCertificate(short, short)).toBe(false);
  });
});

/**
 * The address the APK carries, which it cannot ask for later.
 *
 * ## Why this is here and not only in `api-origin.test.ts`
 *
 * That file tests `farmOrigin` as a function. This tests the *fact the runner
 * build depends on*: that `eas.json` still holds a real remote origin under
 * `preview-farm`, because a runner build reads no profile and `apk-plan.mjs`
 * lifts it from there.
 *
 * The first version of that script did not, and the failure is the worst shape
 * in this whole pipeline: the APK builds, signs, passes every check, installs
 * cleanly — and boots saying *"This copy of the app was built without the
 * address of your farm server"*. Every guard held and the artefact was useless.
 */
describe('the farm server address a runner build has to supply', () => {
  it('is in eas.json, and is not a local machine', async () => {
    const easJson = JSON.parse(
      await readFile(new URL('../../apps/mobile/eas.json', import.meta.url), 'utf8'),
    );
    const origin = farmOrigin(easJson);

    expect(origin).not.toBeNull();
    // `farmOrigin` returns null for localhost, 10.x, the emulator alias and so
    // on — so this passing means an APK built from it can actually reach a farm.
    expect(origin).toMatch(/^https:\/\//);
  });
});
