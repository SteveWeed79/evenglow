import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { localStore } from '@steading/core/db/store';
import { intoDays, listHistory } from '@steading/core/read/history';
import { enqueue } from '@steading/core/sync/queue';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { ExportScreen } from '../../apps/mobile/src/screens/ExportScreen';
import { HistoryScreen } from '../../apps/mobile/src/screens/HistoryScreen';
import { files, shared } from '../support/native/modules';

/**
 * "We need a history tab. Or somewhere that old data is visible for the user
 * in a nice easy format WITH a detailed option available."
 *
 * The records were write-only. Everything went in and the only way back out
 * was whichever screen happened to summarise it — today's tally, this group's
 * last feed. "What did we do last Tuesday" had no answer at all.
 */

const GROUP = newId();
const DAY = 86_400_000;

/** A fixed hour, so a test near midnight cannot land two days apart. */
function at(daysAgo: number, hour: number): number {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date.getTime() - daysAgo * DAY;
}

async function theHens(): Promise<void> {
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: { name: 'The hens', species: 'chicken', count: 6, purposes: ['eggs'] },
  });
}

beforeEach(async () => {
  await freshStore();
});

describe('a day reads as one line', () => {
  it('adds up what adds up and counts what does not', async () => {
    await theHens();
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: at(0, 8), flockId: GROUP, count: 7 },
    });
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: at(0, 17), flockId: GROUP, count: 5 },
    });
    await enqueue({
      entity: 'feedLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: at(0, 8), flockId: GROUP, amountGrams: 900 },
    });
    await enqueue({
      entity: 'feedLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: at(0, 17), flockId: GROUP, amountGrams: 900 },
    });

    const [today] = await listHistory();

    // Twelve eggs, because two tallies of one thing are one number. Two feeds,
    // because a feed is an occurrence and 1800 g would answer nobody.
    expect(today?.summary).toContain('12 eggs');
    expect(today?.summary).toContain('2 feeds');
  });

  /** A day of things that decline to tally still happened. */
  it('says how many when nothing in it adds up', async () => {
    await theHens();
    await enqueue({
      entity: 'predator',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: at(1, 22), species: 'Fox', lossCount: 0 },
    });

    const days = await listHistory();
    expect(days[0]?.summary).toBe('1 record');
  });
});

describe('the order', () => {
  it('is newest day first, newest record first inside it', async () => {
    await theHens();
    for (const [daysAgo, hour, count] of [
      [2, 9, 1],
      [0, 9, 2],
      [0, 18, 3],
    ] as const) {
      await enqueue({
        entity: 'eggLog',
        op: 'create',
        targetId: newId(),
        payload: { occurredAt: at(daysAgo, hour), flockId: GROUP, count },
      });
    }

    const days = await listHistory();

    expect(days).toHaveLength(2);
    expect(days[0]!.day).toBeGreaterThan(days[1]!.day);
    // 3 eggs at 18:00 before 2 eggs at 09:00.
    expect(days[0]!.events[0]?.title).toContain('3 eggs');
    expect(days[0]!.events[1]?.title).toContain('2 eggs');
  });

  /**
   * `occurredAt`, not when it synced and not `clientTs` — invariant 4 says
   * never trust that one. Backdating a feed you forgot to log is an ordinary
   * thing to do, and a history sorted by arrival would file it under today and
   * be wrong about the only thing it is for.
   */
  it('files a backdated record under the day it happened', async () => {
    await theHens();
    await enqueue({
      entity: 'feedLog',
      op: 'create',
      targetId: newId(),
      // Enqueued now, said to have happened three days ago.
      payload: { occurredAt: at(3, 7), flockId: GROUP, amountGrams: 900 },
    });

    const days = await listHistory();

    expect(days).toHaveLength(1);
    expect(days[0]!.day).toBeLessThan(Date.now() - 2 * DAY);
  });
});

describe('what is in it', () => {
  it('names the group rather than showing an id', async () => {
    await theHens();
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: at(0, 8), flockId: GROUP, count: 6 },
    });

    const days = await listHistory();
    expect(days[0]!.events[0]?.title).toBe('6 eggs — The hens');
  });

  /**
   * Invariant 13 reaching the read layer: hiding a group must not silently
   * rewrite what happened while it was here.
   */
  it('keeps the records of a group that has been archived', async () => {
    await theHens();
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: at(0, 8), flockId: GROUP, count: 6 },
    });
    await enqueue({ entity: 'flock', op: 'delete', targetId: GROUP, payload: {} });

    const days = await listHistory();

    expect(days[0]!.events).toHaveLength(1);
    expect(days[0]!.events[0]?.title).toContain('6 eggs');
  });

  /**
   * Mutable entities are not events. A flock is not something that happened,
   * it is something that is — and a history filling up with "you changed the
   * head count" would bury the morning somebody lost four birds.
   */
  it('leaves out the things that are not events', async () => {
    await theHens();

    // A group and nothing logged against it.
    expect(await listHistory()).toEqual([]);
  });

  it('carries the detail a day only wants once it is open', async () => {
    await theHens();
    await enqueue({
      entity: 'mortality',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: at(0, 12), flockId: GROUP, count: 2, cause: 'predator' },
    });

    const days = await listHistory();
    expect(days[0]!.events[0]?.title).toBe('Lost 2 — The hens');
    expect(days[0]!.events[0]?.detail).toContain('predator');
  });
});

describe('the summarising itself', () => {
  /** Driven directly, because it is arithmetic rather than a store question. */
  it('holds its order as records arrive', () => {
    const [day] = intoDays([
      { id: 'a', entity: 'eggLog', at: 1, title: 'a', tally: { key: 'eggs', amount: 1, unit: 'egg' } },
      { id: 'b', entity: 'feedLog', at: 2, title: 'b', tally: { key: 'feeds', amount: 1, unit: 'feed' } },
      { id: 'c', entity: 'eggLog', at: 3, title: 'c', tally: { key: 'eggs', amount: 5, unit: 'egg' } },
    ]);

    // Eggs first because eggs appeared first — a day that reorders itself
    // between renders looks, on a phone, exactly like something changed.
    expect(day?.summary).toBe('6 eggs · 1 feed');
  });

  it('says one egg, not 1 eggs', () => {
    const [day] = intoDays([
      { id: 'a', entity: 'eggLog', at: 1, title: 'a', tally: { key: 'eggs', amount: 1, unit: 'egg' } },
    ]);
    expect(day?.summary).toBe('1 egg');
  });
});

describe('the screen', () => {
  it('opens the newest day so it says something without a tap', async () => {
    await theHens();
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: at(0, 8), flockId: GROUP, count: 6 },
    });
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: at(4, 8), flockId: GROUP, count: 4 },
    });

    const screen = await mount(<HistoryScreen />);

    // Today's rows are showing; the older day is a closed summary.
    expect(screen.text()).toContain('6 eggs — The hens');
    expect(screen.text()).toContain('4 eggs');
    expect(screen.text()).not.toContain('4 eggs — The hens');
    screen.unmount();
  });

  it('invites rather than showing an empty page', async () => {
    const screen = await mount(<HistoryScreen />);

    expect(screen.text()).toContain('Nothing logged yet');
    screen.unmount();
  });
});

/**
 * "how do users remove produce (eggs/milk/etc) placed in the wrong group. Not
 * just eggs mind you" — and then, on the exception this nearly shipped with:
 * *"i feel like a system that doesn't understand that accidents/mistypes
 * happen with counts of any kind is incorrect for this type of application."*
 *
 * Both are right. Counts are typed one-handed, in the dark, wearing gloves.
 * This is the only screen that shows an individual record, so it is the only
 * place a person can point at the wrong one — everywhere else shows the total
 * it landed in.
 */
describe('taking one back', () => {
  const wrong = newId();

  async function twoTallies(): Promise<void> {
    await theHens();
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: at(0, 8), flockId: GROUP, count: 7 },
    });
    // The one that went against the wrong group.
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: wrong,
      payload: { occurredAt: at(0, 17), flockId: GROUP, count: 5 },
    });
  }

  it('takes two taps, and the row is not one of them', async () => {
    await twoTallies();
    const screen = await mount(<HistoryScreen />);

    // A list where one tap destroys a record is a list nobody scrolls with
    // gloves on. Opening the row offers; it does not act.
    expect(screen.has(`event-remove-${wrong}`)).toBe(false);
    await screen.press(`event-${wrong}`);
    expect(screen.has(`event-remove-${wrong}`)).toBe(true);

    // Armed, not fired.
    await screen.press(`event-remove-${wrong}`);
    expect(screen.text()).toContain('5 eggs');
    expect((await listHistory())[0]?.events).toHaveLength(2);

    screen.unmount();
  });

  it('removes the record and re-adds the day without it', async () => {
    await twoTallies();
    const screen = await mount(<HistoryScreen />);

    const [before] = await listHistory();
    expect(before?.summary).toContain('12 eggs');

    await screen.press(`event-${wrong}`);
    await screen.press(`event-remove-${wrong}`);
    await screen.press(`event-remove-${wrong}`);

    // The row is gone from the screen and the readout above it re-added.
    expect(screen.text()).not.toContain('5 eggs');
    expect(screen.text()).toContain('7 eggs');

    const [after] = await listHistory();
    expect(after?.events).toHaveLength(1);
    expect(after?.summary).toContain('7 eggs');
    expect(after?.summary).not.toContain('12 eggs');

    screen.unmount();
  });

  /**
   * The record is archived, never deleted (P13) — so what actually goes out is
   * a `delete` mutation the server will apply, not a row vanishing from the
   * device with nothing to say for itself.
   */
  it('queues the removal for the server rather than only forgetting locally', async () => {
    await twoTallies();
    const screen = await mount(<HistoryScreen />);

    await screen.press(`event-${wrong}`);
    await screen.press(`event-remove-${wrong}`);
    await screen.press(`event-remove-${wrong}`);

    const queued = await localStore().readOutboxBySeq();
    const removal = queued.find((mutation) => mutation.op === 'delete');

    expect(removal).toBeDefined();
    expect(removal?.entity).toBe('eggLog');
    expect(removal?.targetId).toBe(wrong);

    screen.unmount();
  });

  /**
   * Not just eggs. Every append-only record a person can enter, they can take
   * back — including the hour meter, whose own monotonic rule makes a typo
   * uncorrectable by any other route (see `tests/unit/projections.test.ts`).
   */
  it('works on produce, feed, weights and the hour meter alike', async () => {
    await theHens();
    const machine = newId();
    await enqueue({
      entity: 'equipment',
      op: 'create',
      targetId: machine,
      payload: { name: 'The tractor' },
    });

    const ids = {
      productionLog: newId(),
      feedLog: newId(),
      weight: newId(),
      hourReading: newId(),
    };

    await enqueue({
      entity: 'productionLog',
      op: 'create',
      targetId: ids.productionLog,
      payload: { occurredAt: at(0, 6), flockId: GROUP, kind: 'milk', amount: 4000, unit: 'ml' },
    });
    await enqueue({
      entity: 'feedLog',
      op: 'create',
      targetId: ids.feedLog,
      payload: { occurredAt: at(0, 7), flockId: GROUP, amountGrams: 900 },
    });
    await enqueue({
      entity: 'weight',
      op: 'create',
      targetId: ids.weight,
      payload: { occurredAt: at(0, 8), flockId: GROUP, massUg: 2_000_000_000 },
    });
    await enqueue({
      entity: 'hourReading',
      op: 'create',
      targetId: ids.hourReading,
      // The fat-fingered one. Left alone, every true reading afterwards is
      // below it and the machine can never be logged again.
      payload: { occurredAt: at(0, 9), equipmentId: machine, hours: 9999 },
    });

    const screen = await mount(<HistoryScreen />);
    expect((await listHistory())[0]?.events).toHaveLength(4);

    for (const id of Object.values(ids)) {
      await screen.press(`event-${id}`);
      await screen.press(`event-remove-${id}`);
      await screen.press(`event-remove-${id}`);
    }

    expect(await listHistory()).toHaveLength(0);
    screen.unmount();
  });
});

/**
 * The share itself.
 *
 * The CSV is settled by `tests/unit/export.test.ts`; what is left is the part
 * that suite cannot see — that a file is written, that what reaches it is what
 * the builder produced, and that something is actually offered to the OS
 * rather than the screen quietly succeeding.
 */
describe('sending records out', () => {
  beforeEach(() => {
    files.clear();
    shared.length = 0;
  });

  it('writes the CSV and offers the file, not the text', async () => {
    await theHens();
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: at(0, 8), flockId: GROUP, count: 6 },
    });

    const screen = await mount(<ExportScreen />);
    await screen.press('export-eggs');
    screen.unmount();

    expect(shared).toHaveLength(1);
    const written = files.get(shared[0]!);
    expect(written).toContain('The hens');
    expect(written).toContain('6');
  });

  /** It has to say what it is from the outside of an inbox. */
  it('names the file for the record and the day', async () => {
    await theHens();
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: at(0, 8), flockId: GROUP, count: 6 },
    });

    const screen = await mount(<ExportScreen />);
    await screen.press('export-eggs');
    screen.unmount();

    expect(shared[0]).toMatch(/steading-eggs-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  /**
   * The promise on the screen: sending changes nothing on this device. It is
   * the sentence that makes the feature safe to press, so it is worth a test
   * rather than trust.
   */
  it('leaves every record exactly where it was', async () => {
    await theHens();
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: at(0, 8), flockId: GROUP, count: 6 },
    });

    const screen = await mount(<ExportScreen />);
    await screen.press('export-eggs');
    screen.unmount();

    const days = await listHistory();
    expect(days[0]?.events).toHaveLength(1);
  });

  it('offers only the kinds of record the farm has', async () => {
    await theHens();
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: at(0, 8), flockId: GROUP, count: 6 },
    });

    const screen = await mount(<ExportScreen />);

    expect(screen.has('export-eggs')).toBe(true);
    // No harvests on this farm, so no empty harvests file to be puzzled by.
    expect(screen.has('export-harvests')).toBe(false);
    screen.unmount();
  });

  it('invites rather than showing an empty page', async () => {
    const screen = await mount(<ExportScreen />);
    expect(screen.text()).toContain('Nothing to send yet');
    screen.unmount();
  });
});
