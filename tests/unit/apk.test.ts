import { describe, expect, it } from 'vitest';
import {
  certificateFrom,
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
