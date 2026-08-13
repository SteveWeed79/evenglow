import { describe, expect, it } from 'vitest';
import { nextVersionCode, withVersionCode } from '../../scripts/lib/version-bump.mjs';
import appJson from '../../apps/mobile/app.json';

/**
 * The integer Android compares, and moving it.
 *
 * `expo.android.versionCode` is the only thing Android uses to decide whether
 * one APK is newer than another. It must move for every build that leaves the
 * machine (`docs/TESTING-BUILD.md` §5b): Play refuses a duplicate outright, a
 * downgrade will not install over a device already on a higher number, and
 * nothing on a handset distinguishes two builds that share one.
 *
 * A rule that depends on remembering a one-line edit at the start of a
 * fifteen-minute build is a rule that holds until the first time it matters,
 * which is why `Build the app.bat` offers to do it and this decides what to.
 */

describe('the next number', () => {
  it('moves an ordinary value on by one', () => {
    expect(nextVersionCode({ expo: { android: { versionCode: 7 } } })).toMatchObject({
      from: 7,
      to: 8,
    });
  });

  /**
   * **Absent goes to 2, not 1**, and that is the case worth thinking about.
   * Expo defaults a missing `versionCode` to 1, so every build made while it
   * was absent already shipped as 1 — minting another 1 would produce a "new"
   * build indistinguishable from every old one, which is the exact fault the
   * field was added to fix.
   */
  it('treats an absent value as the 1 that Expo has been shipping', () => {
    const { from, to, reason } = nextVersionCode({ expo: { android: {} } });

    expect(from).toBeNull();
    expect(to).toBe(2);
    expect(reason).toContain('defaulting it to 1');
  });

  it('says the same about a config with no android section at all', () => {
    expect(nextVersionCode({ expo: {} }).to).toBe(2);
    expect(nextVersionCode({}).to).toBe(2);
    expect(nextVersionCode(undefined).to).toBe(2);
  });

  /**
   * Refuses rather than guesses. A string, a float or a zero is somebody having
   * meant something this cannot infer, and inventing a number over it would put
   * a value nobody chose into the file that decides what installs.
   */
  it('refuses anything that is not a positive integer', () => {
    for (const bad of ['3', 3.5, 0, -1, null, {}]) {
      const { to } = nextVersionCode({ expo: { android: { versionCode: bad } } });
      expect(to, JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('writing it back', () => {
  /**
   * A string edit rather than parse-and-restringify, because `app.json` is
   * hand-maintained: round-tripping it would reformat the whole file and
   * produce a diff nobody can read, on the file that decides the icons, the
   * permissions and the package name.
   */
  it('changes the number and nothing else in the real app.json', () => {
    const before = JSON.stringify(appJson, null, 2);
    const after = withVersionCode(before, 99);

    expect(after).not.toBeNull();
    const lines = before.split('\n');
    // Annotated because the helper is a .mjs with no declarations, so its
    // return is `any` and the callback below would infer implicit any.
    const afterLines: string[] = String(after).split('\n');
    const changed = afterLines.filter((line, i) => line !== lines[i]);

    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain('99');
  });

  it('leaves the file parseable', () => {
    const after = withVersionCode(JSON.stringify(appJson, null, 2), 42);

    expect(JSON.parse(after as string).expo.android.versionCode).toBe(42);
  });

  /** Whitespace between the key and the number is a formatter's business. */
  it('finds it however it is spaced', () => {
    expect(withVersionCode('{"versionCode":1}', 2)).toBe('{"versionCode":2}');
    expect(withVersionCode('{ "versionCode"  :   1 }', 2)).toBe('{ "versionCode"  :   2 }');
  });

  it('says so rather than silently doing nothing when the key is missing', () => {
    expect(withVersionCode('{"expo":{"android":{}}}', 2)).toBeNull();
  });
});
