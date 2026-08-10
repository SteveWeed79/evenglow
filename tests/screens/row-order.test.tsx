import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { enqueue } from '@steading/core/sync/queue';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { FarmScreen } from '../../apps/mobile/src/screens/FarmScreen';
import { GroupScreen } from '../../apps/mobile/src/screens/GroupScreen';
import { QuickAddScreen } from '../../apps/mobile/src/screens/QuickAddScreen';

/**
 * What a farm does most often is nearest its thumb.
 *
 * `GroupScreen` states the rule — *"the split is by how often a thing is done,
 * not by what module it belongs to"* — and then stopped following it. Reference
 * rows drifted in among the acts one at a time, each defensible on its own
 * because it sat beside the thing it related to, and the sum put **"Log a
 * feed" fifth**: the row a farm taps twice a day, below three it taps monthly.
 * Reported from a handset in exactly those words.
 *
 * **Drift is why this is a test rather than a comment.** No single edit that
 * produced it was wrong; the order was simply never the thing being checked.
 * A rule nothing asserts is a rule that holds until the next reasonable-looking
 * commit.
 */

const GROUP = newId();

/** The order of the row titles a screen renders, top to bottom. */
function order(screen: Awaited<ReturnType<typeof mount>>, titles: readonly string[]): string[] {
  const shown = screen.text();
  return [...titles]
    .filter((title) => shown.includes(title))
    .sort((a, b) => shown.indexOf(a) - shown.indexOf(b));
}

beforeEach(async () => {
  await freshStore();
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: { name: 'The hens', species: 'chicken', count: 6, purposes: ['eggs'] },
  });
});

/** The four acts, in the order a week actually contains them. */
const ACTS = ['Log a feed', 'Log a job done', 'Record a treatment', 'Record a loss'];

describe('the group hub', () => {
  it('leads with feeding, which is what happens most', async () => {
    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);

    expect(order(screen, ACTS)).toEqual(ACTS);
    screen.unmount();
  });

  it('puts every act above every thing you only read', async () => {
    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);
    const shown = screen.text();

    // A lookup that climbs above an act is the exact drift that happened.
    const lastAct = Math.max(...ACTS.map((title) => shown.indexOf(title)));
    for (const reading of ['What they have had', 'The numbers', 'Routine jobs']) {
      expect(shown.indexOf(reading)).toBeGreaterThan(lastAct);
    }
    screen.unmount();
  });

  it('keeps the setting last of the three', async () => {
    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);
    const shown = screen.text();

    // Intervals are chosen once and revisited about yearly.
    expect(shown.indexOf('Routine jobs')).toBeGreaterThan(shown.indexOf('The numbers'));
    screen.unmount();
  });
});

describe('the fast path', () => {
  /**
   * The same order, and that is a requirement rather than tidiness: these are
   * the two surfaces the same records are logged from, and a hand that learns
   * "feed is first" in one must not have to unlearn it in the other.
   */
  it('offers the acts in the same order as the group hub', async () => {
    const screen = await mount(<QuickAddScreen />);

    expect(order(screen, ACTS)).toEqual(ACTS);
    screen.unmount();
  });
});

describe('the farm hub', () => {
  it('puts the two year-round rows above the seasonal one', async () => {
    const screen = await mount(<FarmScreen />);
    const shown = screen.text();

    // A set is under for three weeks, once or twice a spring. The shelf is
    // read whenever a sack runs low, and Jobs is written in continuously.
    expect(shown.indexOf('Jobs')).toBeLessThan(shown.indexOf('Eggs under'));
    expect(shown.indexOf('The shelf')).toBeLessThan(shown.indexOf('Eggs under'));
    screen.unmount();
  });

  it('keeps the setting last', async () => {
    const screen = await mount(<FarmScreen />);
    const shown = screen.text();

    expect(shown.indexOf('What you run')).toBeGreaterThan(shown.indexOf('The shelf'));
    screen.unmount();
  });

  /**
   * A market gardener with animals switched off was shown a row about broody
   * hens, above the two rows they use every week, on every visit.
   */
  it('does not offer eggs under to a farm that keeps no stock', async () => {
    await enqueue({
      entity: 'site',
      op: 'create',
      targetId: newId(),
      payload: { name: 'The farm', enterprises: ['growing'] },
    });

    const screen = await mount(<FarmScreen />);
    expect(screen.text()).not.toContain('Eggs under');
    screen.unmount();
  });
});
