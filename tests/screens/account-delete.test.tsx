import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_DELETE_PATH, newId } from '@homefarm/contracts';
import { resetApiBase, setAccessToken, setApiBase } from '@homefarm/core/api';
import { googleSheet, seedSecureStore } from '../support/native/modules';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { AccountScreen } from '../../apps/mobile/src/screens/AccountScreen';

/**
 * Leaving, from the screen — `docs/ACCOUNT-DELETION.md`.
 *
 * The server half is covered against a database; none of that reaches the three
 * things that can only be wrong here, and each of them is the kind of wrong a
 * person discovers by losing a farm:
 *
 * **The warning has to carry the number.** "Other members may be affected" is
 * scrolled past; "the 2 other accounts on it" is weighed. The count comes from
 * the server, so a screen that forgot to ask, or asked and ignored the answer,
 * would show a sentence that is true in general and useless in particular.
 *
 * **The phone must not be cleared unless asked.** Sign-out keeps a farm's
 * records on purpose, and a deletion that quietly took them would be the worst
 * broken promise in the app — so the toggle starts off and the panel says which
 * way it is set.
 *
 * **Something has to be said afterwards.** The device is signed out by then, so
 * the screen is rendering against credentials that no longer exist. A deletion
 * that ended by dropping somebody onto Today with no word would read as a crash.
 */

const ORG = newId();
const USER = newId();

function signedInAs(account: Record<string, unknown> = {}): void {
  seedSecureStore({
    'homefarm.refreshToken': 'a-stored-token',
    'homefarm.claims': JSON.stringify({
      userId: USER,
      orgId: ORG,
      role: 'owner',
      name: 'The keeper',
      orgName: 'Hollow Farm',
      email: 'keeper@example.test',
      emailVerified: true,
      ...account,
    }),
  });
}

/** Every request the screen made, so a test can assert what it sent. */
let asked: { path: string; method: string; body: unknown }[] = [];

/**
 * A server that answers the preview with `members` and the deletion with
 * `outcome`. Everything else — billing on mount — is refused, which leaves
 * those panels unrendered and this screen's own state exactly as it is.
 */
function serverThatDeletes(options: {
  members?: number;
  outcome?: { status: number; body: unknown };
} = {}): void {
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const path = new URL(input).pathname;
    const method = init?.method ?? 'GET';
    asked.push({
      path,
      method,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    });

    if (path === `${ACCOUNT_DELETE_PATH}/preview`) {
      return new Response(JSON.stringify({ members: options.members ?? 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (path === ACCOUNT_DELETE_PATH) {
      const answer = options.outcome ?? { status: 200, body: { deleted: 'member' } };
      return new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { 'content-type': 'application/json' },
      });
    }

    // The sign-out this makes on success, which needs no answer worth reading.
    if (path === '/auth/logout') return new Response('', { status: 204 });

    return new Response('{}', { status: 500 });
  });
}

/** Opens the panel, which is deliberately behind a tap. */
async function openPanel(screen: Awaited<ReturnType<typeof mount>>): Promise<void> {
  await screen.press('delete-open');
  await screen.settle();
}

/** `Confirm` is two taps, and the second is the one that acts. */
async function confirmTwice(screen: Awaited<ReturnType<typeof mount>>): Promise<void> {
  await screen.press('delete-confirm');
  await screen.press('delete-confirm');
  await screen.settle();
}

beforeEach(async () => {
  await freshStore();
  // The disposal marks are module state and one test's must not reach the
  // next: a mark is a standing instruction to delete a farm's database.
  const { resetLocalStoreHandle } = await import('../../apps/mobile/src/db/store');
  resetLocalStoreHandle();

  resetApiBase();
  setApiBase('https://farm.test');
  setAccessToken('an-access-token', ORG);
  asked = [];
  googleSheet.dismisses();
});

describe('the delete panel', () => {
  /**
   * Behind a tap for the promotion-code field's reason: almost nobody came here
   * for this, and a form that deletes a farm has no business being the first
   * thing under the sign-in state.
   */
  it('offers nothing to press until it is opened', async () => {
    signedInAs();
    serverThatDeletes();

    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await screen.settle();

    expect(screen.has('delete-open')).toBe(true);
    expect(screen.has('delete-confirm')).toBe(false);
    expect(screen.has('delete-password')).toBe(false);

    screen.unmount();
  });

  it('asks for the password once it is', async () => {
    signedInAs();
    serverThatDeletes();

    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await openPanel(screen);

    // The proof, for the reason the change-of-address panel gives one field up:
    // a stolen session alone must not be enough.
    expect(screen.has('delete-password')).toBe(true);
    expect(screen.has('delete-confirm')).toBe(true);

    screen.unmount();
  });

  /** The number, from the server, in the sentence somebody decides on. */
  it('names how many other accounts would go', async () => {
    signedInAs();
    serverThatDeletes({ members: 2 });

    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await openPanel(screen);

    expect(asked.some((call) => call.path === `${ACCOUNT_DELETE_PATH}/preview`)).toBe(true);
    expect(screen.text()).toContain('2 other accounts');

    screen.unmount();
  });

  /** One person is one person, not "1 other accounts". */
  it('says it in the singular for one', async () => {
    signedInAs();
    serverThatDeletes({ members: 1 });

    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await openPanel(screen);

    expect(screen.text()).toContain('other account');
    expect(screen.text()).not.toContain('1 other accounts');

    screen.unmount();
  });

  /**
   * A count of nobody must not become a claim about nobody: this person may
   * still be a farm's only owner, and the panel says the rule rather than
   * promising the farm survives.
   */
  it('still says the farm may go when nobody else is on it', async () => {
    signedInAs();
    serverThatDeletes({ members: 0 });

    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await openPanel(screen);

    expect(screen.text()).toContain('the farm goes with it');

    screen.unmount();
  });
});

describe('what the deletion sends', () => {
  it('sends the password, and nothing else', async () => {
    signedInAs();
    serverThatDeletes();

    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await openPanel(screen);
    await screen.type('delete-password', 'a properly long passphrase');
    await confirmTwice(screen);

    const sent = asked.find(
      (call) => call.path === ACCOUNT_DELETE_PATH && call.method === 'POST',
    );
    expect(sent?.body).toEqual({ password: 'a properly long passphrase' });

    screen.unmount();
  });

  /**
   * Two taps, and the first one does not delete a farm. `Confirm` owns that
   * rule, and this is the assertion that says this panel actually uses it.
   */
  it('does not delete anything on the first tap', async () => {
    signedInAs();
    serverThatDeletes();

    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await openPanel(screen);
    await screen.press('delete-confirm');
    await screen.settle();

    expect(asked.some((call) => call.path === ACCOUNT_DELETE_PATH && call.method === 'POST')).toBe(
      false,
    );

    screen.unmount();
  });
});

describe('after the server has deleted it', () => {
  /**
   * Said against credentials that are already gone — the one branch of this
   * screen that renders on purpose against a stale session.
   */
  it('says the farm went, and how many went with it', async () => {
    signedInAs();
    serverThatDeletes({ members: 2, outcome: { status: 200, body: { deleted: 'farm', members: 2 } } });

    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await openPanel(screen);
    await confirmTwice(screen);

    expect(screen.text()).toContain('the farm have been deleted');
    expect(screen.text()).toContain('2 other accounts');

    screen.unmount();
  });

  it('says the farm carries on when only the person left', async () => {
    signedInAs();
    serverThatDeletes({ outcome: { status: 200, body: { deleted: 'member' } } });

    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await openPanel(screen);
    await confirmTwice(screen);

    expect(screen.text()).toContain('carries on without you');

    screen.unmount();
  });

  /**
   * The promise sign-out makes and this must not quietly break: the records on
   * the handset are still there unless somebody asked otherwise.
   */
  it('says the records on this phone are untouched', async () => {
    signedInAs();
    serverThatDeletes();

    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await openPanel(screen);
    await confirmTwice(screen);

    expect(screen.text()).toContain('still here');

    screen.unmount();
  });

  /** And the way onward is a tap rather than a screen that vanishes. */
  it('waits for a tap before reopening the device’s own farm', async () => {
    signedInAs();
    let carriedOn = false;
    serverThatDeletes();

    const screen = await mount(
      <AccountScreen onSignedIn={() => undefined} onSignedOut={() => (carriedOn = true)} />,
    );
    await openPanel(screen);
    await confirmTwice(screen);

    expect(carriedOn).toBe(false);
    await screen.press('delete-continue');
    expect(carriedOn).toBe(true);

    screen.unmount();
  });
});

/**
 * The half that touches a farm's records rather than the server's.
 *
 * `isMarkedForDisposal` is asked rather than the file system, because the file
 * is deliberately not deleted until the store switches — it is still open at
 * the moment the deletion returns, and `abandonLocalOrg` says why. The mark is
 * the decision; the unlink is a consequence of it.
 */
describe('the records on this phone', () => {
  it('are kept unless somebody asks otherwise', async () => {
    const { isMarkedForDisposal } = await import('../../apps/mobile/src/db/store');
    signedInAs();
    serverThatDeletes();

    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await openPanel(screen);
    // The toggle is untouched, which is the state a farmer who read nothing
    // leaves it in — and the state that must not cost them their records.
    await confirmTwice(screen);

    expect(isMarkedForDisposal(ORG)).toBe(false);

    screen.unmount();
  });

  it('go when it is asked for, and the screen says so', async () => {
    const { isMarkedForDisposal } = await import('../../apps/mobile/src/db/store');
    signedInAs();
    serverThatDeletes();

    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await openPanel(screen);
    await screen.press('delete-clear-phone');
    await confirmTwice(screen);

    expect(isMarkedForDisposal(ORG)).toBe(true);
    // And the sentence afterwards matches what was actually done, rather than
    // the default one about records still being here.
    expect(screen.text()).toContain('go with it');

    screen.unmount();
  });

  /**
   * A deletion the server refused must leave the handset exactly as it was —
   * the records included, since the farm is still there to sync with.
   */
  it('are untouched when the deletion is refused', async () => {
    const { isMarkedForDisposal } = await import('../../apps/mobile/src/db/store');
    signedInAs();
    serverThatDeletes({ outcome: { status: 403, body: { error: 'That password is not right.' } } });

    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await openPanel(screen);
    await screen.press('delete-clear-phone');
    await confirmTwice(screen);

    expect(isMarkedForDisposal(ORG)).toBe(false);

    screen.unmount();
  });
});

describe('when the server refuses', () => {
  it('shows what it said and deletes nothing', async () => {
    signedInAs();
    serverThatDeletes({
      outcome: { status: 403, body: { error: 'That password is not right.' } },
    });

    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await openPanel(screen);
    await confirmTwice(screen);

    expect(screen.text()).toContain('That password is not right.');
    // Still on the panel, with the form to try again rather than a dead end.
    expect(screen.has('delete-confirm')).toBe(true);

    screen.unmount();
  });
});

describe('the Google proof', () => {
  /** An account Google made has no password to give, so it proves itself that way. */
  it('is offered to an account with Google connected', async () => {
    signedInAs({ googleLinked: true });
    serverThatDeletes();

    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await openPanel(screen);

    expect(screen.has('delete-google')).toBe(true);

    screen.unmount();
  });

  /** And not drawn at all where it could only ever fail. */
  it('is absent from an account with no Google identity', async () => {
    signedInAs({ googleLinked: false });
    serverThatDeletes();

    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await openPanel(screen);

    expect(screen.has('delete-google')).toBe(false);

    screen.unmount();
  });
});
