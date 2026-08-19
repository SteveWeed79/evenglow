import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@homefarm/contracts';
import { enqueue } from '@homefarm/core/sync/queue';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { seedSecureStore } from '../support/native/modules';
import { TodayScreen } from '../../apps/mobile/src/screens/TodayScreen';

/**
 * Whose farm this is, at the top of the screen they open first.
 *
 * The app has collected a farm name since the first signup screen and did not
 * show it anywhere — the whole of the "it feels impersonal" complaint, in one
 * missing read. It went under the title first, which was half a fix: the name
 * was finally said and still said second.
 *
 * **"Today" was the word with nothing to say.** The tab bar labels this screen
 * "Today" in the focused state and the status row already carries the date, so
 * one fact was stated three ways in a single viewport. Every other tab
 * diverges from its label rather than echoing it — History's tab says History
 * and its hero says "What happened" — and Today was the only one repeating
 * itself word for word.
 */

const ORG = newId();

async function aFarm(): Promise<void> {
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: newId(),
    payload: { name: 'The hens', species: 'chicken', count: 6, purposes: ['eggs'] },
  });
}

beforeEach(async () => {
  await freshStore();
  seedSecureStore({});
});

describe('the heading on Today', () => {
  it('is the farm’s own name', async () => {
    seedSecureStore({
      'homefarm.claims': JSON.stringify({
        userId: 'u1',
        orgId: ORG,
        role: 'owner',
        orgName: 'Hollow Farm',
      }),
    });
    await aFarm();

    const screen = await mount(<TodayScreen />);

    expect(screen.text()).toContain('Hollow Farm');
    screen.unmount();
  });

  it('does not also say the word the tab bar is already saying', async () => {
    seedSecureStore({
      'homefarm.claims': JSON.stringify({
        userId: 'u1',
        orgId: ORG,
        role: 'owner',
        orgName: 'Hollow Farm',
      }),
    });
    await aFarm();

    const screen = await mount(<TodayScreen />);

    // The tab bar names this screen and the status row dates it. A third
    // saying of the same fact is what pushed the farm's name into second place.
    expect(screen.text()).not.toContain('Today');
    screen.unmount();
  });

  /**
   * D14: the app opens with no account, no network and no server address, and
   * that is a supported permanent state rather than a setup step somebody has
   * not finished. There is no name to say, so the word earns its place.
   */
  it('falls back to Today for a farm that never signed in', async () => {
    await aFarm();

    const screen = await mount(<TodayScreen />);

    expect(screen.text()).toContain('Today');
    screen.unmount();
  });

  it('says nothing about a name it has not read yet', async () => {
    // A farm named "My farm" by the Google path is still a name somebody
    // accepted, so it is said like one rather than treated as absent.
    seedSecureStore({
      'homefarm.claims': JSON.stringify({
        userId: 'u1',
        orgId: ORG,
        role: 'owner',
        orgName: 'My farm',
      }),
    });
    await aFarm();

    const screen = await mount(<TodayScreen />);

    expect(screen.text()).toContain('My farm');
    screen.unmount();
  });
});
