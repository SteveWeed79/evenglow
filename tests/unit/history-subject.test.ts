import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { listHistory } from '@steading/core/read/history';
import { enqueue } from '@steading/core/sync/queue';
import { freshStore } from '../support/store';

/**
 * What has happened to *this* animal — a question nothing could ask.
 *
 * `listHistory` was farm-wide and `HistoryEvent` carried the record's own id
 * and its entity but nothing about what the record was *about*. So the screens
 * that wanted a timeline for one thing filtered a single entity's records by
 * hand — `WeighScreen` sorts and slices the weight list itself for the context
 * pane beside its form — and no screen could show a mixed one at all.
 *
 * This is the precondition for the reusable detail-and-timeline screen: one
 * read that answers the question, rather than seven screens each answering a
 * seventh of it.
 */

const GROUP = newId();
const OTHER = newId();
const ANIMAL = newId();
const MACHINE = newId();

const DAY = 86_400_000;
const T0 = new Date('2026-07-01T08:00:00Z').getTime();

async function aFarmWithTwoGroups(): Promise<void> {
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: { name: 'The hens', species: 'chicken', count: 6, purposes: ['eggs'] },
  });
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: OTHER,
    payload: { name: 'The goats', species: 'goat', count: 3 },
  });
  await enqueue({
    entity: 'animal',
    op: 'create',
    targetId: ANIMAL,
    payload: { flockId: GROUP, name: 'Speckle', species: 'chicken' },
  });

  await enqueue({
    entity: 'eggLog',
    op: 'create',
    targetId: newId(),
    payload: { occurredAt: T0, flockId: GROUP, count: 12 },
  });
  await enqueue({
    entity: 'feedLog',
    op: 'create',
    targetId: newId(),
    payload: { occurredAt: T0 - DAY, flockId: OTHER, amountGrams: 2_000 },
  });
  await enqueue({
    entity: 'weight',
    op: 'create',
    targetId: newId(),
    payload: { occurredAt: T0 - 2 * DAY, animalId: ANIMAL, massUg: 2_400_000_000 },
  });
}

function titlesIn(days: Awaited<ReturnType<typeof listHistory>>): string[] {
  return days.flatMap((day) => day.events.map((event) => event.title));
}

beforeEach(async () => {
  await freshStore();
});

describe('the whole farm, which is what it always did', () => {
  it('is unchanged when nothing is asked for', async () => {
    await aFarmWithTwoGroups();

    const titles = titlesIn(await listHistory('metric'));

    expect(titles).toHaveLength(3);
    expect(titles.join(' ')).toContain('12 eggs');
    expect(titles.join(' ')).toContain('Fed');
    expect(titles.join(' ')).toContain('Weighed');
  });
});

describe('one thing at a time', () => {
  it('shows what was recorded against a group and nothing else', async () => {
    await aFarmWithTwoGroups();

    const titles = titlesIn(await listHistory('metric', { subject: GROUP }));

    expect(titles).toHaveLength(1);
    expect(titles[0]).toContain('12 eggs');
  });

  it('shows what was recorded against an animal', async () => {
    await aFarmWithTwoGroups();

    const titles = titlesIn(await listHistory('metric', { subject: ANIMAL }));

    expect(titles).toHaveLength(1);
    expect(titles[0]).toContain('Weighed');
  });

  /**
   * The plural earning its keep. A death names the group it came out of and,
   * when somebody said which, the animal — so a per-animal timeline that picked
   * one subject would omit the animal's own death, which is the single event
   * that timeline most needs to carry.
   */
  it('puts a loss on both timelines when it names both', async () => {
    await aFarmWithTwoGroups();
    await enqueue({
      entity: 'mortality',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: T0, flockId: GROUP, animalId: ANIMAL, count: 1, cause: 'predator' },
    });

    expect(titlesIn(await listHistory('metric', { subject: GROUP })).join(' ')).toContain('Lost 1');
    expect(titlesIn(await listHistory('metric', { subject: ANIMAL })).join(' ')).toContain('Lost 1');
  });

  /**
   * Named, not inferred. A group's timeline does not sweep up its animals'
   * weights — walking the hierarchy is a different question, and this asserts
   * the answer rather than leaving it to be discovered.
   */
  it('does not climb from an animal to its group', async () => {
    await aFarmWithTwoGroups();

    const forTheGroup = titlesIn(await listHistory('metric', { subject: GROUP }));

    expect(forTheGroup.join(' ')).not.toContain('Weighed');
  });

  it('answers an id with nothing recorded against it with an empty history', async () => {
    await aFarmWithTwoGroups();

    expect(await listHistory('metric', { subject: newId() })).toEqual([]);
  });

  /**
   * A row about the farm at large stays out of every subject's timeline: a fox
   * at the fence line is not something that happened to the hens unless it took
   * one, and if it took one there is a `mortality` that says so.
   */
  it('leaves a row about nothing in particular out of every timeline', async () => {
    await aFarmWithTwoGroups();
    await enqueue({
      entity: 'predator',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: T0, species: 'Fox', lossCount: 0 },
    });

    expect(titlesIn(await listHistory('metric')).join(' ')).toContain('Fox seen');
    expect(titlesIn(await listHistory('metric', { subject: GROUP })).join(' ')).not.toContain('Fox');
  });

  it('keeps the days and their summaries, so a timeline reads like the screen', async () => {
    await aFarmWithTwoGroups();
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: T0 + 60_000, flockId: GROUP, count: 3 },
    });

    const days = await listHistory('metric', { subject: GROUP });

    expect(days).toHaveLength(1);
    expect(days[0]?.events).toHaveLength(2);
    // Summarised over what the timeline shows, not over the farm.
    expect(days[0]?.summary).toContain('15 eggs');
  });
});

describe('what every row carries', () => {
  /**
   * The machine and the shelf, because a service record and a sack's history
   * are two of the things the detail screen is for and neither is an animal.
   */
  it('names a machine on its own readings and services', async () => {
    await enqueue({
      entity: 'equipment',
      op: 'create',
      targetId: MACHINE,
      payload: { name: 'The tractor' },
    });
    await enqueue({
      entity: 'hourReading',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: T0, equipmentId: MACHINE, hours: 240 },
    });

    const titles = titlesIn(await listHistory('metric', { subject: MACHINE }));

    expect(titles).toHaveLength(1);
    expect(titles[0]).toContain('240 hours');
  });

  it('names the sack a stock adjustment moved', async () => {
    const item = newId();
    await enqueue({
      entity: 'inventory',
      op: 'create',
      targetId: item,
      payload: { name: 'Layers pellets', kind: 'feed', quantity: 10, unit: 'bag' },
    });
    await enqueue({
      entity: 'stockAdjustment',
      op: 'create',
      targetId: newId(),
      payload: { itemId: item, delta: -2, reason: 'spoiled', occurredAt: T0 },
    });

    const titles = titlesIn(await listHistory('metric', { subject: item }));

    expect(titles).toHaveLength(1);
    expect(titles[0]).toContain('Spoiled 2');
  });
});
