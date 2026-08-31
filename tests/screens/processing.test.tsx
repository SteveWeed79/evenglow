import { beforeEach, describe, expect, it } from 'vitest';
import { massEntryToUg, newId, processingDue } from '@homefarm/contracts';
import { lastHarvestByGroup, listGroups, processedByGroup } from '@homefarm/core/read/groups';
import { localStore } from '@homefarm/core/db/store';
import { enqueue } from '@homefarm/core/sync/queue';
import { dueDestination } from '../../apps/mobile/src/hooks/useDueActions';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { ProcessingScreen } from '../../apps/mobile/src/screens/ProcessingScreen';

/**
 * Taking a group for meat, which the app counted down to and could not record.
 *
 * ## The gap, in three parts
 *
 * The grow-out clock puts "Roasters reach processing weight" on Today. Tapping
 * it opened **`Weigh`** — and weighing does not discharge a processing row.
 * `processingDue` clears on a cull and nothing else, so the row was still there
 * the next morning with nothing to say why.
 *
 * The only screen that wrote that cull was `LossScreen`: headed **"Record a
 * loss"**, opening *"the record nobody wants to make"*, counting on a
 * **negative** stepper, with a button reading "Record 25 lost". Twenty-five
 * broilers reaching the freezer at eight weeks is the point of having raised
 * them.
 *
 * And `cullWeightGrams` — added to the schema for meat-yield math, an open
 * request in competitor reviews — was collected by no screen at all, so the
 * export had a column that was always empty and nothing summed it.
 *
 * ## What is asserted
 *
 * That the row leads somewhere that ends it, that the record written is the
 * same `mortality` the loss screen writes rather than a second kind, and that
 * the yield is captured and adds up.
 */

const GROUP = newId();

/** Meat birds old enough to be due, which is what makes the row exist at all. */
async function theRoasters(over: Record<string, unknown> = {}): Promise<void> {
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: {
      name: 'The roasters',
      species: 'chicken',
      count: 25,
      purposes: ['meat'],
      bornAt: Date.now() - 70 * 86_400_000,
      processAtWeeks: 8,
      ...over,
    },
  });
}

beforeEach(async () => {
  await freshStore();
});

describe('where a processing row leads', () => {
  /**
   * The row asks "have you taken them", and the scale cannot answer that. It
   * used to go to `Weigh`, which reads as an answer and is not one — the row
   * survives the visit.
   */
  it('opens the screen that discharges it, not the scale', () => {
    const due = processingDue({
      id: GROUP,
      name: 'The roasters',
      purposes: ['meat'],
      bornAt: Date.now() - 70 * 86_400_000,
      processAtWeeks: 8,
    });

    expect(due).not.toBeNull();
    expect(dueDestination(due!)).toEqual({
      screen: 'Processing',
      params: { groupId: GROUP },
    });
  });
});

describe('recording that they were taken', () => {
  it('writes the cull that clears the row', async () => {
    await theRoasters();

    const screen = await mount(<ProcessingScreen {...routeProps({ groupId: GROUP })} />);
    await screen.press('taken-plus-1');
    await screen.press('save-processing');
    screen.unmount();

    // The same record the loss screen writes, deliberately: two kinds meaning
    // "these are no longer alive" would need reconciling in five read paths.
    const culled = await lastHarvestByGroup();
    expect(culled.get(GROUP)).toBeGreaterThan(0);

    const group = (await listGroups()).find((g) => g.id === GROUP);
    const due = processingDue({
      id: GROUP,
      name: 'The roasters',
      purposes: ['meat'],
      bornAt: group?.bornAt,
      processAtWeeks: 8,
      lastCulledAt: culled.get(GROUP),
    });

    // The whole point: the row is gone because the thing it asked for was done.
    expect(due).toBeNull();
  });

  /**
   * The number the schema has wanted since it was written, and which nothing
   * ever collected.
   */
  it('records what came off', async () => {
    await theRoasters();

    const screen = await mount(<ProcessingScreen {...routeProps({ groupId: GROUP })} />);
    await screen.press('taken-plus-1');
    await screen.type('processing-mass', '50');
    await screen.press('save-processing');
    screen.unmount();

    const done = await processedByGroup();
    expect(done.get(GROUP)?.count).toBe(1);
    /**
     * Exactly 50 lb in micrograms, not merely "more than zero".
     *
     * The canonical store is the whole point of using micrograms here — a farm
     * that switches to metric later reads this record back exactly rather than
     * approximately — and an assertion that only checked the sign would pass a
     * screen that recorded the typed digits as grams.
     *
     * Imperial because that is what `MASS_ENTRY_CHOICES` puts first, and the
     * test farm has no site row to say otherwise.
     */
    expect(done.get(GROUP)?.massUg).toBe(massEntryToUg(50, 'lb'));
  });

  /**
   * A farm that processes at home without a scale has still processed. The
   * count is the fact that clears the row; a zero would be a yield figure
   * nobody measured, and it would sum.
   */
  it('records the taking without a weight rather than recording a zero', async () => {
    await theRoasters();

    const screen = await mount(<ProcessingScreen {...routeProps({ groupId: GROUP })} />);
    await screen.press('taken-plus-1');
    await screen.press('save-processing');
    screen.unmount();

    const done = await processedByGroup();
    expect(done.get(GROUP)?.count).toBe(1);
    expect(done.get(GROUP)?.massUg).toBe(0);
  });

  /**
   * The loss screen's rule, kept — and said on this screen too, because a
   * keeper who has just processed the whole batch is the likeliest person to
   * expect the head count to move.
   */
  it('leaves the head count alone', async () => {
    await theRoasters();

    const screen = await mount(<ProcessingScreen {...routeProps({ groupId: GROUP })} />);
    await screen.press('taken-plus-1');
    await screen.press('save-processing');
    screen.unmount();

    expect((await listGroups()).find((g) => g.id === GROUP)?.count).toBe(25);
  });

  /** Nothing is recorded from a screen nobody has counted on. */
  it('refuses to record nothing', async () => {
    await theRoasters();

    const screen = await mount(<ProcessingScreen {...routeProps({ groupId: GROUP })} />);
    await screen.press('save-processing');
    screen.unmount();

    expect((await processedByGroup()).get(GROUP)).toBeUndefined();
  });
});

describe('what the totals mean', () => {
  /**
   * Count and mass are summed and neither is divided. A farm that weighed one
   * batch and not the next has a count larger than the weight accounts for, and
   * a mean over that would understate the birds it did weigh.
   */
  it('keeps a batch that was not weighed visible in the count', async () => {
    await theRoasters();

    for (const grams of ['20', '']) {
      const screen = await mount(<ProcessingScreen {...routeProps({ groupId: GROUP })} />);
      await screen.press('taken-plus-1');
      if (grams !== '') await screen.type('processing-mass', grams);
      await screen.press('save-processing');
      screen.unmount();
    }

    const done = await processedByGroup();
    expect(done.get(GROUP)?.count).toBe(2);
    // One weight, two head — the discrepancy stays visible rather than being
    // averaged away.
    expect(done.get(GROUP)?.massUg).toBeGreaterThan(0);
  });

  /**
   * A record struck out stops counting, on both halves.
   *
   * `mortality` is append-only, so a mistyped batch is corrected by deleting it
   * and logging again — there is no update. The totals are a fresh read over
   * every row each time, so a deleted one that still summed would be a yield
   * the farm could see and could not remove, and the row it discharged would
   * stay discharged on the strength of a record that no longer exists.
   *
   * The two are asserted together because they are read from the same rows by
   * two different functions, and only one of them being right is the bug.
   */
  it('drops a cull that was struck out', async () => {
    await theRoasters();

    const screen = await mount(<ProcessingScreen {...routeProps({ groupId: GROUP })} />);
    await screen.press('taken-plus-1');
    await screen.type('processing-mass', '50');
    await screen.press('save-processing');
    screen.unmount();

    const written = (await localStore().readRecordsByEntity('mortality')).filter(
      (record) => !record.deleted,
    );
    expect(written).toHaveLength(1);

    await enqueue({
      entity: 'mortality',
      op: 'delete',
      targetId: written[0]!.targetId,
      payload: {},
    });

    expect((await processedByGroup()).get(GROUP)).toBeUndefined();
    expect((await lastHarvestByGroup()).get(GROUP)).toBeUndefined();
  });

  /** A fox is not a harvest. Every other cause is a loss and stays one. */
  it('counts only culls, never a predator', async () => {
    await theRoasters();
    await enqueue({
      entity: 'mortality',
      op: 'create',
      payload: {
        occurredAt: Date.now(),
        flockId: GROUP,
        count: 3,
        cause: 'predator',
      },
    });

    expect((await processedByGroup()).get(GROUP)).toBeUndefined();
  });
});
