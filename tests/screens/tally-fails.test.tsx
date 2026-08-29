import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A tally that cannot be written must keep the count.
 *
 * `Tally` clears optimistically — the number goes to zero the instant somebody
 * commits, so the next tally can start and the queue carries the work — and it
 * puts the count back on a **rejection**. That restore is the whole reason the
 * optimism is safe.
 *
 * It could not fire. The three screens that use a tally wrapped their write in
 * `useSaver`, which catches, records the failure and **returns normally**; and
 * the call sites voided the promise on top of that, so even a rejecting commit
 * never reached `Tally`. A failed write therefore:
 *
 * - cleared the count, with nothing queued — `enqueue` aborts its transaction
 *   as a unit, so the record is simply gone;
 * - printed *"Logged 6 scoops"* under a success haptic;
 * - and showed an error panel beside it.
 *
 * Two contradictory sentences on one screen and a lost morning's work. Both
 * components were trying to own the outcome; `Tally` already holds the count,
 * shows the failure in an assertive live region and gives the haptics, so it
 * keeps the whole job and the error is let out rather than absorbed.
 *
 * Its own file because `vi.mock` is hoisted and file-scoped, following
 * `care-done-fails.test.tsx`, which needs the same refusing `enqueue`.
 */

const { enqueue } = vi.hoisted(() => ({ enqueue: vi.fn() }));

vi.mock('@homefarm/core/sync/queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@homefarm/core/sync/queue')>();
  return { ...actual, enqueue };
});

/** The unmocked module — a plain import here returns the mock and recurses. */
const real = await vi.importActual<typeof import('@homefarm/core/sync/queue')>(
  '@homefarm/core/sync/queue',
);

const { newId } = await import('@homefarm/contracts');
const { freshStore } = await import('../support/store');
const { mount } = await import('../support/screen');
const { routeProps } = await import('../support/screen');
const { FeedScreen } = await import('../../apps/mobile/src/screens/FeedScreen');
const { ProduceScreen } = await import('../../apps/mobile/src/screens/ProduceScreen');

const GOATS = newId();

beforeEach(async () => {
  await freshStore();
  enqueue.mockImplementation(real.enqueue);
  await real.enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GOATS,
    payload: { name: 'The goats', species: 'goat', count: 4, purposes: ['milk', 'meat'] },
  });
});

describe('a feed tally whose write is refused', () => {
  /**
   * The two renderings, side by side, because the first draft of this test
   * asserted on `'Could not'` and passed against the bug: that phrase is the
   * **trouble banner**, which `reportTrouble` puts up either way. What actually
   * separates them is the count and the sentence under it.
   *
   *   broken: `0 scoops … Five scoops logged.`
   *   fixed:  `5 scoops … That did not save. Your count is still here`
   */
  async function fiveScoopsRefused() {
    const screen = await mount(<FeedScreen {...routeProps({ groupId: GOATS })} />);
    await screen.press('tally-plus-5');
    enqueue.mockRejectedValueOnce(new Error('the disk is full'));
    await screen.press('tally-commit');
    return screen;
  }

  it('puts the count back rather than losing it', async () => {
    const screen = await fiveScoopsRefused();

    expect(screen.text()).toContain('5 scoops');
    expect(screen.text()).not.toContain('0 scoops');
    screen.unmount();
  });

  it('says it did not save, and does not also say it did', async () => {
    const screen = await fiveScoopsRefused();

    expect(screen.text()).toContain('Your count is still here');
    // The success sentence must not stand beside the failure.
    expect(screen.text()).not.toContain('scoops logged');
    screen.unmount();
  });

  /** Nothing queued, because enqueue aborts its transaction as a unit. */
  it('leaves nothing in the outbox', async () => {
    const screen = await fiveScoopsRefused();
    screen.unmount();

    const { localStore } = await import('@homefarm/core/db/store');
    expect(await localStore().readRecordsByEntity('feedLog')).toEqual([]);
  });
});

describe('a produce tally whose write is refused', () => {
  it('puts the milking back rather than losing it', async () => {
    const screen = await mount(<ProduceScreen {...routeProps({ groupId: GOATS })} />);
    // Milk in imperial, the default with no site record: 8 fl oz a tap.
    await screen.press('tally-plus-8');

    enqueue.mockRejectedValueOnce(new Error('the disk is full'));
    await screen.press('tally-commit');

    expect(screen.text()).toContain('Your count is still here');
    expect(screen.text()).toContain('8 fl oz');
    screen.unmount();
  });
});
