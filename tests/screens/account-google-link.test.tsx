import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GOOGLE_ALREADY_LINKED, GOOGLE_TAKEN, newId } from '@homefarm/contracts';
import { resetApiBase, setAccessToken, setApiBase } from '@homefarm/core/api';
import { googleSheet, seedSecureStore } from '../support/native/modules';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { AccountScreen } from '../../apps/mobile/src/screens/AccountScreen';

/**
 * Connecting a Google account from inside a session — the way back from H1.
 *
 * `/auth/google` refuses to bind a Google identity to an account whose address
 * was never proved, because an address in `users` is a claim rather than a
 * fact. Every password account is in that state, so since that fix the Google
 * button on the sign-in screen turns a farm away until a code has been read out
 * of an inbox — which, for the mistyped address the whole verification feature
 * exists for, is somebody else's.
 *
 * This panel is the remedy, and it is the half that can only be proved from a
 * screen: the route can be right while the control is absent, disabled, or
 * silent about which Google account it just bound.
 *
 * **None of this could be tested until the suite had a Google client id.**
 * `GOOGLE_AVAILABLE` is computed at import from `EXPO_PUBLIC_*`, no test set
 * either, so every Google control was absent from every mount and
 * `screen.has(...)` was false for the same reason it is false for a typo. It is
 * set in `vitest.config.ts` now, and the sheet in `support/native/modules.tsx`
 * can be told to come back with a token instead of only ever being dismissed.
 */

const ORG = newId();
const USER = newId();

function signedInAs(account: Record<string, unknown>): void {
  seedSecureStore({
    'homefarm.refreshToken': 'a-stored-token',
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

/** Every request the screen made, so a test can assert what it asked for. */
let asked: { path: string; body: unknown }[] = [];

function serverThatLinks(answer: { status: number; body: unknown }): void {
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const path = new URL(input).pathname;
    asked.push({
      path,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    });

    if (path === '/auth/google/link') {
      return new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { 'content-type': 'application/json' },
      });
    }
    // Billing is fetched on mount and is not what this file is about.
    return new Response('{}', { status: 500 });
  });
}

beforeEach(async () => {
  await freshStore();
  resetApiBase();
  setApiBase('https://farm.test');
  // In memory, so the call does not first go looking for a refresh.
  setAccessToken('an-access-token', ORG);
  asked = [];
  googleSheet.dismisses();
});

describe('the Google panel on a signed-in account', () => {
  it('is offered to an account whose address was never confirmed', async () => {
    signedInAs({ email: 'alcie@example.test', emailVerified: false });
    serverThatLinks({ status: 200, body: {} });

    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await screen.settle();

    // The whole point: this is exactly the account the sign-in screen's Google
    // button refuses, and it must not have to confirm an email first.
    expect(screen.has('link-google')).toBe(true);
    expect(screen.has('link-password')).toBe(true);

    screen.unmount();
  });

  /**
   * And to one that confirmed months ago. Connecting is worth as much there —
   * one tap instead of a password on the handset bought yesterday — and the
   * verify panel it sits under has gone by then.
   */
  it('is offered to an account that has confirmed its address', async () => {
    signedInAs({ email: 'alice@example.test', emailVerified: true });
    serverThatLinks({ status: 200, body: {} });

    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await screen.settle();

    expect(screen.has('link-google')).toBe(true);

    screen.unmount();
  });

  it('offers no way to connect a second one to an account that already has one', async () => {
    signedInAs({ email: 'alice@example.test', emailVerified: true, googleLinked: true });
    serverThatLinks({ status: 200, body: {} });

    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await screen.settle();

    expect(screen.has('link-google')).toBe(false);
    expect(screen.has('link-password')).toBe(false);
    expect(screen.text()).toContain('connected to a Google account');

    screen.unmount();
  });

  it('sends the token and the password, and says which account it connected', async () => {
    signedInAs({ email: 'alcie@example.test', emailVerified: false });
    serverThatLinks({
      status: 200,
      body: {
        ok: true,
        account: { email: 'alcie@example.test', emailVerified: false, googleLinked: true },
        linked: { email: 'sam.personal@gmail.test' },
      },
    });

    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await screen.settle();

    await screen.type('link-password', 'a properly long passphrase');
    googleSheet.returns('an-id-token');
    await screen.press('link-google');

    const link = asked.find((a) => a.path === '/auth/google/link');
    expect(link?.body).toEqual({
      idToken: 'an-id-token',
      password: 'a properly long passphrase',
    });

    /**
     * The address, and this is the only moment it can be checked. An Android
     * handset with two Google accounts offers a chooser whose default is the
     * top one, so connecting the wrong one is the likeliest real failure here
     * and nothing else in the app would ever name the subject that was bound.
     */
    expect(screen.text()).toContain('sam.personal@gmail.test');
    // And the form is gone with it — the panel has nothing left to ask for, so
    // the password is not merely cleared, it is off the screen.
    expect(screen.has('link-password')).toBe(false);
    expect(screen.has('link-google')).toBe(false);

    screen.unmount();
  });

  /**
   * The case the `linkedTo` half of the panel's condition exists for.
   *
   * A server that predates the link route answers without an `account` object,
   * so nothing sets `googleLinked` on the cached claims and the panel would
   * otherwise stay on the form — with the link already made, offering to make
   * it again, and never naming the address it bound. The device's own knowledge
   * that it just succeeded is the only thing left to go on.
   */
  it('says it is connected even when the server said nothing about the account', async () => {
    signedInAs({ email: 'alcie@example.test', emailVerified: false });
    serverThatLinks({
      status: 200,
      body: { ok: true, linked: { email: 'sam.personal@gmail.test' } },
    });

    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await screen.settle();

    await screen.type('link-password', 'a properly long passphrase');
    googleSheet.returns('an-id-token');
    await screen.press('link-google');

    expect(screen.text()).toContain('sam.personal@gmail.test');
    expect(screen.has('link-google')).toBe(false);

    screen.unmount();
  });

  /**
   * Backing out of the sheet is a decision, not a fault — the same reading
   * `useGoogleSignIn` gives it. A red message there would be the app telling
   * somebody off for changing their mind.
   */
  it('says nothing when somebody closes the Google sheet', async () => {
    signedInAs({ email: 'alcie@example.test', emailVerified: false });
    serverThatLinks({ status: 200, body: {} });

    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await screen.settle();

    googleSheet.dismisses();
    await screen.press('link-google');

    expect(asked.some((a) => a.path === '/auth/google/link')).toBe(false);
    expect(screen.text()).not.toContain('could not be connected');

    screen.unmount();
  });

  /** The server's own sentence, because it knows which of the refusals it is. */
  it('shows the server’s refusal rather than one of its own', async () => {
    signedInAs({ email: 'alcie@example.test', emailVerified: false });
    // The server's own constant rather than a copy of the sentence: a test
    // holding its own spelling of the copy is a test that goes on passing
    // after somebody rewrites it, and `PRODUCT_NAME` is interpolated into this
    // one so writing it out by hand also spells the brand a second time.
    serverThatLinks({ status: 409, body: { error: GOOGLE_TAKEN } });

    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await screen.settle();

    await screen.type('link-password', 'a properly long passphrase');
    googleSheet.returns('an-id-token');
    await screen.press('link-google');

    expect(screen.text()).toContain('already registered');

    screen.unmount();
  });

  /**
   * An account Google made has no password to type. It must reach the server's
   * honest answer rather than meet a button it can never enable — the failure
   * this screen names in its own comment about the signed-out one.
   */
  it('lets a tap through with no password typed', async () => {
    signedInAs({ email: 'alice@example.test', emailVerified: true });
    serverThatLinks({ status: 409, body: { error: GOOGLE_ALREADY_LINKED } });

    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await screen.settle();

    googleSheet.returns('an-id-token');
    await screen.press('link-google');

    const link = asked.find((a) => a.path === '/auth/google/link');
    // The password key is left off entirely, so the server answers about the
    // link rather than about a password that does not exist.
    expect(link?.body).toEqual({ idToken: 'an-id-token' });

    screen.unmount();
  });
});
