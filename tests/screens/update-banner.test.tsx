import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApiBase, setApiBase } from '@homefarm/core/api';
import { APP_VERSION } from '@homefarm/mobile/version';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { DiagnosticsScreen } from '../../apps/mobile/src/screens/DiagnosticsScreen';

/**
 * The banner that tells a sideloaded farm a newer build exists — `[23]`.
 *
 * **The thing Android could never tell them.** A farm that installed from the
 * box's shelf is never notified about anything, so every fix shipped after that
 * install was invisible until somebody said so out loud. The server-side floor
 * was the other half of this item and it only ever refuses; nothing offered.
 *
 * What is asserted here is what the unit test cannot reach: that the panel is
 * actually drawn, that it says which build is which, and that it is **news
 * rather than a wall** — the rest of the screen is still there, because this
 * app works with no server at all and blocking it over a version would break
 * that premise to enforce a nicety.
 */

/**
 * A version that is certainly newer than this build, derived rather than
 * written down: `APP_VERSION` moves on every release, and a hardcoded `0.3.18`
 * would quietly stop being newer the day the minor turned over.
 */
const NEWER = `${Number(APP_VERSION.split('.')[0]) + 1}.0.0`;
const OLDER = '0.0.1';

function shelfServing(body: unknown, status = 200): void {
  vi.stubGlobal('fetch', async (input: string) => {
    if (String(input).endsWith('/app/version.json')) {
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('{}', { status: 500 });
  });
}

beforeEach(async () => {
  await freshStore();
  resetApiBase();
  setApiBase('https://farm.test');
});

describe('when the shelf has a newer build', () => {
  it('draws the panel and names both versions', async () => {
    shelfServing({ version: NEWER, code: '99' });

    const screen = await mount(<DiagnosticsScreen />);
    await screen.settle();

    expect(screen.has('update-open')).toBe(true);
    expect(screen.text()).toContain(NEWER);
    // And what the phone is on, so the two can be compared at a glance.
    expect(screen.text()).toContain(APP_VERSION);
    expect(screen.text()).toContain('build 99');

    screen.unmount();
  });

  /**
   * News, not a fault. Somebody reading this has nothing wrong with their
   * phone and nothing at risk, and the sentence says so — the alternative is a
   * farm that reads an update notice as "my records are in trouble".
   */
  it('says nothing is wrong and nothing is at risk', async () => {
    shelfServing({ version: NEWER });

    const screen = await mount(<DiagnosticsScreen />);
    await screen.settle();

    expect(screen.text()).toContain('Nothing is wrong and nothing is at risk');
    // The thing a farmer actually worries about before installing over the top.
    expect(screen.text()).toContain('keeps your records');

    screen.unmount();
  });

  /**
   * **Not a wall.** The standard pattern blocks the app until it is updated,
   * which breaks D14 outright: this app's premise is that a handset works with
   * no server at all. The queue and the rest of the screen stay exactly as they
   * were.
   */
  it('leaves the rest of the screen alone', async () => {
    shelfServing({ version: NEWER });

    const screen = await mount(<DiagnosticsScreen />);
    await screen.settle();

    expect(screen.text()).toContain('Waiting to send');
    expect(screen.text()).toContain('Everything you have logged is on this device');

    screen.unmount();
  });
});

describe('when there is nothing to offer', () => {
  it('draws no panel for a shelf that matches this build', async () => {
    shelfServing({ version: APP_VERSION });

    const screen = await mount(<DiagnosticsScreen />);
    await screen.settle();

    expect(screen.has('update-open')).toBe(false);

    screen.unmount();
  });

  it('draws no panel for a shelf that is behind', async () => {
    shelfServing({ version: OLDER });

    const screen = await mount(<DiagnosticsScreen />);
    await screen.settle();

    expect(screen.has('update-open')).toBe(false);

    screen.unmount();
  });

  /**
   * A box that has never published. The screen is the one somebody opens when
   * sync is behaving oddly, so a spurious "could not check for updates" here
   * would be a second fault to read about on a screen already full of them.
   */
  it('says nothing at all when the box has no version file', async () => {
    shelfServing('', 404);

    const screen = await mount(<DiagnosticsScreen />);
    await screen.settle();

    expect(screen.has('update-open')).toBe(false);
    expect(screen.text()).not.toContain('newer build');

    screen.unmount();
  });
});
