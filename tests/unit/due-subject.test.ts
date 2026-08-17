import { describe, expect, it } from 'vitest';
import {
  birthDue,
  concerns,
  type Due,
  duesFor,
  taskDues,
  todayList,
  withdrawalDue,
} from '@steading/contracts';

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
