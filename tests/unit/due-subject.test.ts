import { describe, expect, it } from 'vitest';
import {
  birthDue,
  concerns,
  type Due,
  duesFor,
  isVisible,
  taskDues,
  todayList,
  withdrawalDue,
} from '@homefarm/contracts';

/**
 * Which rows are about which records, and why that is not `subject`.
 *
 * `Due.subject` answers *where does tapping this go*. It has to: `birthDue`
 * carries that comment and the fault it records — an animal's id passed into a
 * `groupId` slot, rendering "That group — Missing" on a live row — is what made
 * it name the dam's group rather than the dam.
 *
 * A detail screen asks the other question, and three builders answer it
 * differently from `subject`:
 *
 * - a birth is about the dam and names her group;
 * - a withdrawal is about the group whose produce is held and names the
 *   medication, because that is where the arithmetic came from;
 * - a chore pinned to a group is about that group and names itself, because it
 *   clears on its own `completedAt`.
 *
 * `about` is the second answer. The same shape as `HistoryEvent.subjects` and
 * for the same reason: ULIDs are unique, so an entity beside the id would be a
 * second fact that could disagree with the first.
 */

const DAY = 86_400_000;
const now = Date.parse('2026-05-01T09:00:00Z');

/** A row far enough out that Today refuses it. */
function later(at: number): Due {
  return {
    key: 'far',
    kind: 'service',
    subject: { entity: 'equipment', id: 'MACHINE' },
    title: 'Oil and filter',
    at,
    atReading: null,
    projectedAt: null,
    noticeDays: 21,
  };
}

describe('a row that names where it opens', () => {
  it('is about its subject when there is nothing else to say', () => {
    const row = later(now + 300 * DAY);

    expect(concerns(row, 'MACHINE')).toBe(true);
    expect(concerns(row, 'SOMETHING-ELSE')).toBe(false);
  });

  it('names the dam’s group and is about the dam', () => {
    const row = birthDue(
      { id: 'BREEDING', species: 'goat', damId: 'BRAMBLE', bredAt: now - 10 * DAY },
      'Bramble',
      'THE-DOES',
    );

    // Where it opens — the fault this shape exists to prevent.
    expect(row?.subject).toEqual({ entity: 'flock', id: 'THE-DOES' });
    // Who it is about, which is how her own screen finds it.
    expect(concerns(row!, 'BRAMBLE')).toBe(true);
  });

  it('names the medication and is about the group holding produce', () => {
    const row = withdrawalDue(
      {
        kind: 'egg',
        medicationId: 'BAYTRIL',
        medication: 'Baytril',
        subjectId: 'THE-HENS',
        clearsAt: now + 3 * DAY,
      },
      'The hens',
    );

    expect(row?.subject.id).toBe('BAYTRIL');
    expect(concerns(row!, 'THE-HENS')).toBe(true);
  });

  it('names the chore and is about the group whose job it is', () => {
    const [row] = taskDues(
      {
        id: 'TASK',
        title: 'Move the fence',
        recurrence: 'none',
        dueAtDate: now + 14 * DAY,
        subjectId: 'THE-DOES',
      },
      'The does',
    );

    expect(row?.subject).toEqual({ entity: 'task', id: 'TASK' });
    expect(concerns(row!, 'THE-DOES')).toBe(true);
  });

  it('is about nothing extra when a chore is pinned to nothing', () => {
    const [row] = taskDues({
      id: 'TASK',
      title: 'Fix the gate',
      recurrence: 'none',
      dueAtDate: now + 14 * DAY,
    });

    expect(row?.about).toBeUndefined();
  });
});

describe('what a detail screen asks for', () => {
  /**
   * The difference from `todayList`, and the reason the panel exists. A
   * judgement about a morning's list is not a judgement about the row.
   */
  it('keeps the rows Today drops for being too far off', () => {
    const rows = [later(now + 300 * DAY)];

    expect(todayList(rows, now)).toEqual([]);
    expect(duesFor(rows, ['MACHINE'], now)).toHaveLength(1);
  });

  /** A machine with no meter reading has a target and no date at all. */
  it('keeps a row with no date, which Today cannot use', () => {
    const undated: Due = { ...later(0), at: null, atReading: 250 };

    expect(todayList([undated], now)).toEqual([]);
    expect(duesFor([undated], ['MACHINE'], now)).toHaveLength(1);
  });

  it('takes several ids, for a screen making a hop the engine does not', () => {
    const mine = later(now + 300 * DAY);
    const theirs: Due = { ...mine, key: 'other', subject: { entity: 'equipment', id: 'OTHER' } };

    expect(duesFor([mine, theirs], ['MACHINE', 'OTHER'], now)).toHaveLength(2);
    expect(duesFor([mine, theirs], ['MACHINE'], now)).toEqual([mine]);
  });

  it('orders them soonest first', () => {
    const soon = { ...later(now + 20 * DAY), key: 'soon' };
    const far = { ...later(now + 300 * DAY), key: 'far' };

    expect(duesFor([far, soon], ['MACHINE'], now).map((due) => due.key)).toEqual(['soon', 'far']);
  });

  it('says nothing about a record no row is for', () => {
    expect(duesFor([later(now + 300 * DAY)], ['NOTHING'], now)).toEqual([]);
  });
});

/**
 * What belongs in a morning's work, and what merely belongs.
 *
 * `isVisible` asks whether a row is inside its own notice window, and those
 * windows are long on purpose — six weeks for a clip or a birth, three for a
 * hatch. That is honestly when a farm should start *thinking* about the thing.
 * It is not when the thing is a job for today, and Today used to make no
 * distinction: a shearing owed in October sat on the screen every morning from
 * August and stayed until somebody shore the sheep.
 *
 * Reported off the tablet with four rows on it, none of them that morning's
 * work: *"most items are not due soon but are permanently on that screen until
 * complete."*
 */
describe('how far Today reaches', () => {
  const NOW = Date.parse('2026-08-18T08:00:00Z');
  const inDays = (n: number) => NOW + n * 86_400_000;

  const clip = (at: number, noticeDays: number): Due => ({
    key: `shearing:${at}`,
    kind: 'shearing',
    title: 'Shearing — Woolies',
    at,
    noticeDays,
    subject: { entity: 'flock', id: 'w1' },
    atReading: null,
    projectedAt: null,
  });

  it('keeps a job that lands this week', () => {
    expect(todayList([clip(inDays(4), 42)], NOW)).toHaveLength(1);
  });

  /**
   * The row this whole change is about. Three weeks out and well inside its own
   * six-week notice, so `isVisible` says yes and Today says no.
   */
  it('drops one three weeks out, however long its notice is', () => {
    const far = clip(inDays(21), 42);

    // Still visible — the notice window has not changed and other readers use it.
    expect(isVisible(far, NOW)).toBe(true);
    expect(todayList([far], NOW)).toEqual([]);
  });

  /** And it is on the screen that exists for exactly that question. */
  it('leaves it for the panel that is meant to reach further', () => {
    const far = clip(inDays(21), 42);

    expect(duesFor([far], ['w1'], NOW)).toHaveLength(1);
  });

  /**
   * Lateness outranks the horizon. Something overdue is overdue however
   * generous its notice was, and holding it back would be the opposite of the
   * fault being fixed.
   */
  it('never holds back something late', () => {
    expect(todayList([clip(inDays(-3), 42)], NOW)).toHaveLength(1);
  });

  it('keeps the boundary day itself', () => {
    expect(todayList([clip(inDays(7), 42)], NOW)).toHaveLength(1);
    expect(todayList([clip(inDays(8), 42)], NOW)).toEqual([]);
  });
});
