import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { AGE_CONFIRMATION } from '@homefarm/contracts';
import { resetApiBase, setApiBase } from '@homefarm/core/api';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { AccountScreen } from '../../apps/mobile/src/screens/AccountScreen';

/**
 * The age floor from the screen — `UNCONSIDERED.md` `[3]`.
 *
 * The server refuses a body without the assertion, and that is the guarantee.
 * What only the screen can get wrong is the three things below, and each is
 * the kind of wrong that turns a rule into an obstacle:
 *
 * **It has to be asked where an account is made and nowhere else.** Somebody
 * signing in on a second phone answered this when they made the account;
 * asking again is theatre, and theatre on the screen people use when they are
 * locked out.
 *
 * **What is sent has to be what was ticked.** A screen that sent a constant
 * would make the box decorative — the one thing an assertion must never be —
 * and it would pass every server test in the suite.
 *
 * **Both buttons make accounts.** The Google button on the claim tab creates
 * one as surely as the primary does, so a gate on only the primary is a gate
 * with a door beside it.
 */

const signedOut = (): React.ReactElement => <AccountScreen onSignedIn={() => undefined} />;

/** Captures what the screen would have sent, without letting it leave. */
function captureBody(): { of: (path: string) => Record<string, unknown> | undefined } {
  const seen = new Map<string, Record<string, unknown>>();

  vi.stubGlobal('fetch', async (input: unknown, init?: { body?: string }) => {
    const path = new URL(String(input)).pathname;
    if (typeof init?.body === 'string') seen.set(path, JSON.parse(init.body));
    return new Response('{}', { status: 500 });
  });

  return { of: (path) => seen.get(path) };
}

beforeEach(async () => {
  await freshStore();
  setApiBase('https://farm.test');

  /**
   * **Stubbed for every case, including the ones that never submit.**
   *
   * This suite pressed controls without a stub and passed on a laptop, where
   * an unresolvable host fails in milliseconds. On CI it goes through a proxy
   * and hangs — which leaves `saving` true, which disables the Google button,
   * which failed an assertion about the age gate for a reason that had nothing
   * to do with it. A screen test that reaches the network is a screen test
   * that is timing-dependent on somebody else's DNS.
   */
  vi.stubGlobal('fetch', async () => new Response('{}', { status: 500 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetApiBase();
});

describe('where the question is asked', () => {
  it('asks it on the tab that sets up an account', async () => {
    const screen = await mount(signedOut());
    await screen.pressLabel('Set up an account');

    expect(screen.has('account-age')).toBe(true);
    expect(screen.text()).toContain(AGE_CONFIRMATION);
    screen.unmount();
  });

  it('asks it on the tab that joins somebody else’s farm', async () => {
    const screen = await mount(signedOut());
    await screen.pressLabel('Join a farm');

    expect(screen.has('account-age')).toBe(true);
    screen.unmount();
  });

  /**
   * And not on sign-in. This is the assertion that would fail if somebody
   * moved the control up to sit with the email and password, which is exactly
   * where it looks like it belongs.
   *
   * **Asserted on the screen as it opens, and not by pressing "Sign in".** The
   * mode chip and the submit button carry the same words, `pressLabel` takes
   * the first exact match, and the match it takes is the *button* — so that
   * press submits a sign-in rather than changing tab. It cost an afternoon on
   * CI, where the request it fires hangs instead of failing, leaving the form
   * mid-save and every control on it disabled.
   */
  it('does not ask it of somebody signing in', async () => {
    const screen = await mount(signedOut());

    // The precondition, stated rather than assumed: only sign-in offers this.
    expect(screen.has('account-forgot')).toBe(true);

    expect(screen.has('account-age')).toBe(false);
    screen.unmount();
  });

  /** It says what the app is not gating, because the box implies otherwise. */
  it('says the app itself has no age limit', async () => {
    const screen = await mount(signedOut());
    await screen.pressLabel('Set up an account');

    expect(screen.text()).toContain('anybody can keep records on this phone');
    screen.unmount();
  });
});

describe('what it gates', () => {
  async function fillClaim(screen: Awaited<ReturnType<typeof mount>>): Promise<void> {
    await screen.type('account-farm', 'Hollow Farm');
    await screen.type('account-name', 'Sam');
    await screen.type('account-email', 'sam@example.test');
    await screen.type('account-password', 'a properly long passphrase');
    await screen.type('account-password-confirm', 'a properly long passphrase');
  }

  it('keeps the button disabled on a form that is otherwise complete', async () => {
    const screen = await mount(signedOut());
    await screen.pressLabel('Set up an account');
    await fillClaim(screen);

    expect(screen.get('account-submit').props.accessibilityState?.disabled).toBe(true);

    await screen.press('account-age');
    expect(screen.get('account-submit').props.accessibilityState?.disabled).toBeFalsy();
    screen.unmount();
  });

  /**
   * The Google button makes an account too, and it does not go through the
   * primary's gate. Left ungated it would be the way round the box.
   */
  it('keeps the Google button disabled until the box is ticked', async () => {
    const screen = await mount(signedOut());
    await screen.pressLabel('Set up an account');

    // Present because `vitest.config.ts` sets a client id — without one
    // `GOOGLE_AVAILABLE` is false, every Google control is absent from every
    // mount, and this whole case would pass by finding nothing.
    expect(screen.has('account-google')).toBe(true);

    // The button is also disabled while the auth request is being prepared and
    // while anything is in flight, so this settles both first. Asserting
    // before it does would pass for the wrong reason and go on passing with
    // the age gate deleted.
    await screen.settle();

    expect(screen.get('account-google').props.accessibilityState?.disabled).toBe(true);
    await screen.press('account-age');
    expect(screen.get('account-google').props.accessibilityState?.disabled).toBeFalsy();
    screen.unmount();
  });

  /**
   * And left alone on the sign-in tab, where the same press is a sign-in for
   * everybody but the rare person who has no account — who is told which box
   * to tick rather than met with a button that does nothing.
   */
  it('leaves the Google button alone on the sign-in tab', async () => {
    const screen = await mount(signedOut());
    await screen.settle();

    expect(screen.has('account-forgot')).toBe(true);
    expect(screen.has('account-age')).toBe(false);
    expect(screen.get('account-google').props.accessibilityState?.disabled).toBeFalsy();
    screen.unmount();
  });

  /** The tick is what travels, not a constant the screen supplies for itself. */
  it('sends the answer somebody actually gave', async () => {
    const body = captureBody();
    const screen = await mount(signedOut());
    await screen.pressLabel('Set up an account');
    await fillClaim(screen);
    await screen.press('account-age');
    await screen.press('account-submit');

    expect(body.of('/auth/signup')?.ageConfirmed).toBe(true);
    screen.unmount();
  });

  /**
   * Per visit, never remembered. A tick kept on the device would let the next
   * person to pick the handset up make an account without being asked — and
   * the handset in this app is shared by definition.
   */
  it('forgets the tick when the screen is opened again', async () => {
    const first = await mount(signedOut());
    await first.pressLabel('Set up an account');
    await first.press('account-age');
    first.unmount();

    const second = await mount(signedOut());
    await second.pressLabel('Set up an account');
    await fillClaim(second);

    expect(second.get('account-submit').props.accessibilityState?.disabled).toBe(true);
    second.unmount();
  });
});
