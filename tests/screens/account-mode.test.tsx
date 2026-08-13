import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '@steading/contracts';
import { enqueue } from '@steading/core/sync/queue';
import { resetApiBase, setApiBase } from '@steading/core/api';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { AccountScreen } from '../../apps/mobile/src/screens/AccountScreen';

/**
 * Which of the three ways in this screen opens on.
 *
 * It was always "Set up an account", so a second phone landed on the wrong one
 * with sign-in behind a selector, under a panel of prose about why an account
 * is worth having — a question somebody arriving with a password had already
 * answered. Reported as the login form being hidden, and it was.
 *
 * ## What the device can be asked
 *
 * Not "do you have an account" — it cannot know. But every handset mints a farm
 * on first launch (D14), so **what is in that farm says which of two people
 * this is**: somebody with a season of records is here to keep them, and a bare
 * handset is here to join something that already exists.
 *
 * Getting it wrong in the other direction is the expensive one, which is why
 * the presence of records wins: signing in on a phone with records opens a
 * different database and leaves them behind.
 */

const BED = newId();
const SITE = newId();

async function somethingLogged(): Promise<void> {
  await enqueue({
    entity: 'site',
    op: 'create',
    targetId: SITE,
    payload: { name: 'The farm', zone: { system: 'usda', value: '7a' } },
  });
  await enqueue({
    entity: 'bed',
    op: 'create',
    targetId: BED,
    payload: { siteId: SITE, name: 'The top bed', covered: false },
  });
}

beforeEach(async () => {
  await freshStore();
  setApiBase('https://farm.test');
  vi.stubGlobal('fetch', async () => new Response('{}', { status: 500 }));
});

describe('the way in this screen opens on', () => {
  /**
   * Nothing logged: there is nothing to claim, so somebody here is adding a
   * device to a farm that already exists.
   */
  it('offers sign in on a handset with nothing on it', async () => {
    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await screen.settle();

    // The claim form asks for a farm name; the sign-in form does not.
    expect(screen.has('account-farm')).toBe(false);

    screen.unmount();
  });

  /**
   * Records present: claiming keeps them and signing in would open a different
   * database, so the default has to be the one that cannot lose anything.
   */
  it('offers setting one up when there are records to keep', async () => {
    await somethingLogged();
    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await screen.settle();

    expect(screen.has('account-farm')).toBe(true);

    screen.unmount();
  });

  /**
   * A default, not a decision. The selector still offers all three and a choice
   * made by hand must survive whatever the exposure read says next.
   */
  it('stops guessing once somebody has picked for themselves', async () => {
    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await screen.settle();

    await screen.pressLabel('Set up an account');
    expect(screen.has('account-farm')).toBe(true);

    await screen.settle();
    expect(screen.has('account-farm'), 'the guess overrode the choice').toBe(true);

    screen.unmount();
  });
});

describe('the panel about why an account is worth having', () => {
  /**
   * A2.3 puts it first for somebody weighing it up, which is the claim path.
   */
  it('leads for somebody still deciding', async () => {
    await somethingLogged();
    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await screen.settle();

    expect(screen.text()).toContain('nowhere else');

    screen.unmount();
  });

  /**
   * And is two hundred pixels of prose between the screen and the field for
   * somebody arriving with a password in hand.
   */
  it('is out of the way for somebody who has already decided', async () => {
    await somethingLogged();
    const screen = await mount(<AccountScreen onSignedIn={() => undefined} />);
    await screen.settle();

    await screen.pressLabel('Sign in');

    expect(screen.text()).not.toContain('a phone in a water trough');

    screen.unmount();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetApiBase();
});
