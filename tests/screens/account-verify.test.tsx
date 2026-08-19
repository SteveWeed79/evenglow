import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '@homefarm/contracts';
import { resetApiBase, setApiBase } from '@homefarm/core/api';
import { seedSecureStore } from '../support/native/modules';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { AccountScreen } from '../../apps/mobile/src/screens/AccountScreen';

/**
 * The panel that tells a farm its address is unconfirmed.
 *
 * **This is the half of email verification that actually prevents the damage**,
 * and it is the half that would be easy to skip. The server gate is what closes
 * the hole — an unproved address is sent no reset code — but a gate nobody is
 * told about is a farm that one day discovers recovery does not work, on the
 * morning it needed to.
 *
 * What stops the typo is somebody reading their own address back and noticing
 * they wrote `alcie@`. So the address has to be on screen, and the way to fix
 * it has to be one tap away.
 *
 * ## The third state is the one worth testing
 *
 * `emailVerified` is absent against a server that predates this, and absent
 * must not render as unconfirmed — that would put a warning about recovery in
 * front of a farm whose server has no opinion about it, with a button that
 * would 404. Two states are obvious; the third is the one that gets built
 * wrong.
 */

const ORG = newId();
const USER = newId();

function signedInAs(account: { email?: string; emailVerified?: boolean }): void {
  seedSecureStore({
    'homefarm.claims': JSON.stringify({
      userId: USER,
      orgId: ORG,
      role: 'owner',
      name: 'The keeper',
      orgName: 'Hollow Farm',
      ...account,
    }),
  });
}

beforeEach(async () => {
  await freshStore();
  resetApiBase();
  setApiBase('https://farm.test');
  // Billing is fetched on mount and is not what this file is about; a refusal
  // leaves that panel unrendered and everything else exactly as it is.
  vi.stubGlobal('fetch', async () => new Response('{}', { status: 500 }));
});

describe('an account whose address is unconfirmed', () => {
  it('says so, and names the address it is talking about', async () => {
    signedInAs({ email: 'alcie@example.test', emailVerified: false });

    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await screen.settle();

    // The address itself, because a warning without it cannot be acted on.
    expect(screen.text()).toContain('alcie@example.test');
    expect(screen.has('verify-send')).toBe(true);

    screen.unmount();
  });

  /**
   * The way out, for the person no code ever reached. Without it a typo at
   * signup is recovery permanently off with no in-app remedy, which would make
   * the whole feature a trap rather than a guard.
   */
  it('offers to correct the address', async () => {
    signedInAs({ email: 'alcie@example.test', emailVerified: false });

    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await screen.settle();

    // Behind a tap, because most people came to type a code they already have.
    expect(screen.has('verify-new-email')).toBe(false);
    await screen.press('verify-fix');

    expect(screen.has('verify-new-email')).toBe(true);
    // The password, because a stolen session alone must not move an address.
    expect(screen.has('verify-password')).toBe(true);

    screen.unmount();
  });
});

describe('an account whose address is confirmed', () => {
  it('shows no warning at all', async () => {
    signedInAs({ email: 'alice@example.test', emailVerified: true });

    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await screen.settle();

    expect(screen.has('verify-send')).toBe(false);
    expect(screen.has('verify-fix')).toBe(false);
    // Still says which address, so somebody can check where a reset would go.
    expect(screen.text()).toContain('alice@example.test');

    screen.unmount();
  });
});

describe('a server that has never heard of verification', () => {
  /**
   * The state a device is in against an older server, and the one a naive
   * `!claims.emailVerified` would get wrong — absent is not false.
   */
  it('is not treated as unconfirmed', async () => {
    signedInAs({});

    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await screen.settle();

    expect(screen.has('verify-send')).toBe(false);
    expect(screen.has('verify-fix')).toBe(false);

    screen.unmount();
  });
});
