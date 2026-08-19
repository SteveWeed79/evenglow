import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedSecureStore } from '../support/native/modules';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { SettingsScreen } from '../../apps/mobile/src/screens/SettingsScreen';

/**
 * Signing out, and the screen noticing.
 *
 * Reported from the phone: *"the sign out button on the bottom of the settings
 * page never changes from sign out, even when the account is signed out. It
 * doesn't look like anything changes on the app until after it is restarted."*
 *
 * This is the **second** report of the same shape. The first — *"tap again to
 * sign out does nothing"* — was answered by poking `setAccount(null)` into the
 * handler by hand, which corrected the one row somebody happened to be looking
 * at and left the farm's name and the button itself saying what they said
 * before. A repair that has to be remembered at each call site covers whichever
 * call site was in view.
 *
 * So the fix moved to the thing that owns the value: `clearCredentials`
 * publishes, and anything watching is told. These tests are written against the
 * screen rather than the store, because the store was never the part that was
 * wrong — the storage was correct the whole time, which is exactly why a
 * restart looked like a fix.
 */

const CLAIMS = JSON.stringify({
  userId: 'u1',
  orgId: '01J0000000000000000000000A',
  role: 'owner',
  name: 'Steve',
  orgName: 'Hollow Farm',
});

beforeEach(async () => {
  await freshStore();
  seedSecureStore({ 'homefarm.claims': CLAIMS, 'homefarm.refreshToken': 'r' });

  /**
   * A refresh token is seeded because that is what a signed-in device holds,
   * and holding one is what makes `signOut` try to tell the server.
   *
   * **These tests run with no API base configured**, which D14 makes an
   * ordinary state rather than a broken one — and that is how they caught
   * `signOut` rejecting instead of shrugging: `url()` throws before any request
   * exists, so the `.catch()` on the fetch never saw it and the screen sat on
   * "Signing out…" indefinitely. Fixed in `session.ts` by guarding the call
   * rather than the request.
   *
   * The stub stands in for the case where a base *is* configured, so this file
   * never reaches the network whichever way that goes.
   */
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 204 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The screen needs somewhere to report a sign-out to; nothing here reads it. */
const noop = (): void => undefined;

describe('a device with an account', () => {
  it('offers to sign out', async () => {
    const screen = await mount(<SettingsScreen onSignedOut={noop} />);

    expect(screen.has('sign-out')).toBe(true);
    expect(screen.text()).toContain('Signed in as Steve');

    screen.unmount();
  });
});

describe('after signing out, without leaving the screen', () => {
  /**
   * The reported sentence, asserted directly: the control is gone rather than
   * still saying "Sign out" over a device with nothing to sign out of.
   */
  it('stops offering to sign out', async () => {
    const screen = await mount(<SettingsScreen onSignedOut={noop} />);

    await screen.press('sign-out');
    await screen.press('sign-out');

    expect(screen.has('sign-out')).toBe(false);

    screen.unmount();
  });

  it('stops saying who is signed in', async () => {
    const screen = await mount(<SettingsScreen onSignedOut={noop} />);

    await screen.press('sign-out');
    await screen.press('sign-out');

    expect(screen.text()).not.toContain('Signed in as Steve');

    screen.unmount();
  });

  /**
   * The other half of *"nothing changes until it is restarted"*. The farm's
   * name is read through `useFarmName`, which had its own copy of the claims
   * and its own mount effect, so it went on naming a farm this device was no
   * longer signed in to.
   */
  it('stops naming the farm it is no longer signed in to', async () => {
    const screen = await mount(<SettingsScreen onSignedOut={noop} />);
    expect(screen.text()).toContain('Hollow Farm');

    await screen.press('sign-out');
    await screen.press('sign-out');

    expect(screen.text()).not.toContain('Hollow Farm');

    screen.unmount();
  });

  /** Two taps, and the first one must not sign anybody out. */
  it('does not sign out on the first tap', async () => {
    const screen = await mount(<SettingsScreen onSignedOut={noop} />);

    await screen.press('sign-out');

    expect(screen.has('sign-out')).toBe(true);
    expect(screen.text()).toContain('Tap again to sign out');

    screen.unmount();
  });

  it('tells whoever asked that it happened', async () => {
    const onSignedOut = vi.fn();
    const screen = await mount(<SettingsScreen onSignedOut={onSignedOut} />);

    await screen.press('sign-out');
    await screen.press('sign-out');

    expect(onSignedOut).toHaveBeenCalledTimes(1);

    screen.unmount();
  });
});

describe('a device that never had an account', () => {
  /**
   * D14: opening with no account is the ordinary state, not a setup step
   * somebody has not finished. So the answer is not a disabled button — there
   * is nothing to end, and the row above already leads to making one.
   */
  it('does not offer to sign out of nothing', async () => {
    seedSecureStore({});
    const screen = await mount(<SettingsScreen onSignedOut={noop} />);

    expect(screen.has('sign-out')).toBe(false);
    expect(screen.text()).toContain('No account on this phone');

    screen.unmount();
  });
});
