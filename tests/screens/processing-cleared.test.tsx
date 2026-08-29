import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@homefarm/contracts';
import { lastCullByGroup } from '@homefarm/core/read/groups';
import { enqueue } from '@homefarm/core/sync/queue';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { TodayScreen } from '../../apps/mobile/src/screens/TodayScreen';

/**
 * The row that could not be answered.
 *
 * `processingDue` read fields of the group and nothing else, so nothing a
 * keeper *did* cleared it. A meat flock went `overdue` a day after its window
 * opened, sorted first on Today — `URGENCY_ORDER.overdue = 0` — in the alert
 * tint, and stayed there for ever. Processing the birds and recording the cull
 * changed nothing at all. The only escapes were lying about the group or
 * archiving it.
 *
 * `due/types.ts` states the rule it broke outright: *"a list with a permanent
 * resident on it is a list people stop reading."* Every other builder obeys it,
 * `careDues` counting from `careLog` and `shearingDues` from `shearing`; this
 * one had no record to count from, so it never got one.
 *
 * Mounted rather than unit-tested because the builder was only half the bug.
 * `useDues` never passed the field once it existed — the same shape as
 * `careIntervals`, which that hook's own comment calls *a feature that exists
 * only in the test suite*. A test that only called the builder would have
 * passed against a handset that still shouted.
 */

const GROUP = newId();
const DAY = 86_400_000;
const WEEK = 7 * DAY;

/**
 * Hatched twelve weeks ago. A Cornish cross is a 6-to-9-week bird, so the
 * window opened three weeks back and the row is well past `overdue`.
 */
const HATCHED = Date.now() - 12 * WEEK;

beforeEach(async () => {
  await freshStore();
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: {
      name: 'The broilers',
      species: 'chicken',
      count: 40,
      purposes: ['meat'],
      breedId: 'chicken-cornish-cross',
      bornAt: HATCHED,
    },
  });
});

/** What the loss screen writes when a keeper says the birds were processed. */
async function cull(count: number, occurredAt: number): Promise<void> {
  await enqueue({
    entity: 'mortality',
    op: 'create',
    targetId: newId(),
    payload: { flockId: GROUP, count, cause: 'cull', occurredAt },
  });
}

describe('a meat flock past its window', () => {
  it('says so on Today', async () => {
    const today = await mount(<TodayScreen />);

    expect(today.text()).toContain('The broilers reach processing weight');
    today.unmount();
  });

  /** The whole finding: this is what used to change nothing. */
  it('stops saying so once the birds are processed', async () => {
    await cull(40, Date.now() - DAY);

    const today = await mount(<TodayScreen />);

    expect(today.text()).not.toContain('reach processing weight');
    today.unmount();
  });

  /**
   * A bird lost to a fox is not a flock that has been processed. Every cause on
   * `MORTALITY_CAUSES` except `cull` is a loss, and the row has to survive one.
   */
  it('is not answered by a loss', async () => {
    await enqueue({
      entity: 'mortality',
      op: 'create',
      targetId: newId(),
      payload: { flockId: GROUP, count: 1, cause: 'predator', occurredAt: Date.now() - DAY },
    });

    const today = await mount(<TodayScreen />);

    expect(today.text()).toContain('The broilers reach processing weight');
    today.unmount();
  });

  /**
   * A cull before the window opened is a loss during the grow-out — a bad leg
   * in week four — and silencing the row on it would mean the prompt to book a
   * processor never appeared at all.
   */
  it('is not answered by a cull from earlier in the grow-out', async () => {
    await cull(1, HATCHED + 4 * WEEK);

    const today = await mount(<TodayScreen />);

    expect(today.text()).toContain('The broilers reach processing weight');
    today.unmount();
  });
});

describe('what the reader picks out', () => {
  /** The newest, so a farm processing in two batches is answered by the latest. */
  it('takes the most recent cull, not the first', async () => {
    const first = HATCHED + 7 * WEEK;
    const second = HATCHED + 8 * WEEK;
    await cull(20, second);
    await cull(20, first);

    expect(await lastCullByGroup()).toEqual(new Map([[GROUP, second]]));
  });

  it('ignores every cause that is not a cull', async () => {
    await enqueue({
      entity: 'mortality',
      op: 'create',
      targetId: newId(),
      payload: { flockId: GROUP, count: 2, cause: 'illness', occurredAt: Date.now() },
    });

    expect(await lastCullByGroup()).toEqual(new Map());
  });
});
