import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isNewerVersion } from '@homefarm/contracts';
import { resetApiBase, setApiBase } from '@homefarm/core/api';
import { shelfUpdate } from '@homefarm/mobile/update/shelf';

/**
 * Whether there is a newer build to go and get — `[23]`, phase 1.
 *
 * **Every failure here returns the same `null`**, which is correct behaviour
 * and a genuinely nasty thing to leave untested: a mistake in any branch is
 * invisible, because a banner that never appears looks exactly like a farm that
 * is already up to date. Nobody would report it. So each path that must stay
 * quiet is asserted to be quiet *for its own reason*, and the one path that
 * must speak is asserted to speak.
 *
 * The two build-time constants are injected rather than stubbed. Expo inlines
 * them into the bundle as literals, so a suite cannot change them after import
 * — which is why `shelfUpdate` takes them at all.
 */

/** A shelf that answers with whatever the test hands it. */
function serving(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

const SHELF = { fromShelf: () => true, current: '0.3.16' };

beforeEach(() => {
  resetApiBase();
  setApiBase('https://farm.test');
});

afterEach(() => {
  resetApiBase();
});

describe('when the box is serving something newer', () => {
  it('says so, with the build number for the sentence', async () => {
    const found = await shelfUpdate({
      ...SHELF,
      fetch: serving({ version: '0.3.17', code: '47' }),
    });

    expect(found).toEqual({ version: '0.3.17', code: '47' });
  });

  /** The code is for the sentence, not the comparison, so it may be absent. */
  it('manages without a build number', async () => {
    const found = await shelfUpdate({ ...SHELF, fetch: serving({ version: '0.4.0' }) });

    expect(found).toEqual({ version: '0.4.0', code: undefined });
  });

  /**
   * A field added to this file next year must not make every installed app
   * stop noticing updates — it is written by a shell script on a box whose
   * checkout may be older than the handset's.
   */
  it('ignores fields it does not know', async () => {
    const found = await shelfUpdate({
      ...SHELF,
      fetch: serving({ version: '0.3.17', code: '47', sha: 'abc1234', notes: 'hello' }),
    });

    expect(found?.version).toBe('0.3.17');
  });

  it('compares properly rather than by string', async () => {
    // '0.3.9' > '0.3.10' as strings, and this is the comparison that decides
    // whether a farm is told about a fix.
    const found = await shelfUpdate({
      fromShelf: () => true,
      current: '0.3.9',
      fetch: serving({ version: '0.3.10' }),
    });

    expect(found?.version).toBe('0.3.10');
  });
});

describe('when there is nothing to say', () => {
  it('is quiet when the shelf matches this build', async () => {
    expect(await shelfUpdate({ ...SHELF, fetch: serving({ version: '0.3.16' }) })).toBeNull();
  });

  it('is quiet when the shelf is older than this build', async () => {
    expect(await shelfUpdate({ ...SHELF, fetch: serving({ version: '0.3.15' }) })).toBeNull();
  });

  /**
   * The policy one, and the reason the channel is a build-time stamp at all.
   * Play forbids an app it distributed from updating itself another way, and
   * the box cannot answer for a Play device regardless.
   */
  it('never offers an APK to a build that came from Play', async () => {
    let asked = false;
    const fetcher = (async () => {
      asked = true;
      return new Response('{"version":"9.9.9"}', { status: 200 });
    }) as unknown as typeof fetch;

    const found = await shelfUpdate({ fromShelf: () => false, current: '0.3.16', fetch: fetcher });

    expect(found).toBeNull();
    // And it did not even ask, rather than asking and discarding the answer.
    expect(asked).toBe(false);
  });

  it('is quiet on a build with no farm server configured', async () => {
    resetApiBase();
    expect(await shelfUpdate({ ...SHELF, fetch: serving({ version: '9.9.9' }) })).toBeNull();
  });

  /** A box that has never published anything has no file to serve. */
  it('is quiet on a 404', async () => {
    expect(await shelfUpdate({ ...SHELF, fetch: serving('', 404) })).toBeNull();
  });

  it('is quiet when the box is unreachable', async () => {
    const offline = (async () => {
      throw new Error('Network request failed');
    }) as unknown as typeof fetch;

    expect(await shelfUpdate({ ...SHELF, fetch: offline })).toBeNull();
  });

  it('is quiet on a file that is not JSON', async () => {
    expect(await shelfUpdate({ ...SHELF, fetch: serving('<html>nope</html>') })).toBeNull();
  });

  /**
   * A hand-edited stamp must not become a version the app acts on. The shell
   * that writes the file refuses to produce this, and the reader refuses to
   * believe it — neither is load-bearing alone.
   */
  it('is quiet on a version it cannot parse', async () => {
    expect(await shelfUpdate({ ...SHELF, fetch: serving({ version: 'nightly' }) })).toBeNull();
  });

  it('is quiet when the file has no version at all', async () => {
    expect(await shelfUpdate({ ...SHELF, fetch: serving({ code: '47' }) })).toBeNull();
  });
});

describe('the comparison itself', () => {
  it('orders the three parts, major first', () => {
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true);
    expect(isNewerVersion('0.4.0', '0.3.99')).toBe(true);
    expect(isNewerVersion('0.3.10', '0.3.9')).toBe(true);
    expect(isNewerVersion('0.3.9', '0.3.10')).toBe(false);
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
  });

  /**
   * Unreadable is never "newer", which is the opposite default from the
   * server's floor — and deliberately. Being strict there withholds sync from a
   * build the server cannot talk to; being strict here would nag a farm about
   * an update that may not exist.
   */
  it('refuses to call anything unreadable an update', () => {
    expect(isNewerVersion('nightly', '0.3.16')).toBe(false);
    expect(isNewerVersion('0.3.17', 'nightly')).toBe(false);
    expect(isNewerVersion('', '0.3.16')).toBe(false);
  });
});
