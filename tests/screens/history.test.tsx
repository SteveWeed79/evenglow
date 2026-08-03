import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { intoDays, listHistory } from '@steading/core/read/history';
import { enqueue } from '@steading/core/sync/queue';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { HistoryScreen } from '../../apps/mobile/src/screens/HistoryScreen';

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
