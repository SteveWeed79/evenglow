import { describe, expect, it } from 'vitest';
import {
  activeWithdrawals,
  daysUntilClear,
  longestWithdrawal,
  type ActiveWithdrawal,
  type TreatmentRecord,
  withdrawalMessage,
  withdrawalWindow,
} from '@steading/contracts';

/**
 * W2 is a compliance feature. These assertions are the reason it can be
 * trusted — selling produce inside a withdrawal window is a real failure, and
 * the arithmetic is easy to get subtly wrong.
 */

const DAY = 86_400_000;
const FLOCK = 'F'.repeat(26);
const OTHER_FLOCK = 'G'.repeat(26);
const BIRD = 'B'.repeat(26);

const START = new Date('2026-07-01T08:00:00Z').getTime();

function treatment(over: Partial<TreatmentRecord> = {}): TreatmentRecord {
  return {
    id: 'M'.repeat(26),
    name: 'Amprolium',
    flockId: FLOCK,
    administeredAt: START,
    // A single dose, recorded as one: given and finished on the same day.
    //
    // The fixture used to omit this, which read as "a single dose" and now
    // reads as "a course nobody has closed" — the two the module was
    // conflating. Every test that wants the open case says so explicitly.
    treatmentEndsAt: START,
    withdrawalDays: { egg: 7 },
    ...over,
  };
}

describe('withdrawalWindow', () => {
  it('counts from the last day of treatment, not the first dose', () => {
    // A five-day course with a seven-day withdrawal clears twelve days after
    // it started. Counting from the first dose sells produce five days early.
    const course = treatment({ treatmentEndsAt: START + 5 * DAY });

    expect(withdrawalWindow(course, 'egg')).toEqual({ state: 'clears', at: START + 12 * DAY });
  });

  it('counts from administration when the course is a single dose', () => {
    expect(withdrawalWindow(treatment(), 'egg')).toEqual({ state: 'clears', at: START + 7 * DAY });
  });

  it('imposes nothing for a kind the medication does not cover', () => {
    // A topical spray with an egg withdrawal does not stop meat sales.
    expect(withdrawalWindow(treatment(), 'meat')).toEqual({ state: 'none' });
    expect(withdrawalWindow(treatment(), 'milk')).toEqual({ state: 'none' });
  });

  it('handles a zero-day withdrawal as immediately clear', () => {
    const none = treatment({ withdrawalDays: { egg: 0 } });
    expect(withdrawalWindow(none, 'egg')).toEqual({ state: 'clears', at: START });
    expect(activeWithdrawals([none], 'egg', [FLOCK], START)).toEqual([]);
  });

  it('errs long when the end date precedes the start', () => {
    // Bad data must not shorten a window.
    const backwards = treatment({ administeredAt: START, treatmentEndsAt: START - 10 * DAY });
    expect(withdrawalWindow(backwards, 'egg')).toEqual({ state: 'clears', at: START + 7 * DAY });
  });
});

/**
 * The course that has not ended yet — the defect this module was shipped with.
 *
 * With no end date the window used to be counted from the first dose, which is
 * the same answer as a single dose given that morning. A ten-day course logged
 * on day one therefore said the eggs were clear on day eight, while the bird
 * was still being dosed.
 *
 * It was known: `read/withdrawals.ts` described it in full, and the screens
 * carried a `running` warning about it. The produce cleared anyway. A warning
 * is not a hold.
 *
 * **No legacy record is caught out by the change**, which is what makes it safe
 * to apply to farms that already have data. The entry screen's toggle defaulted
 * to off and stamped an end date on every save, so the only stored records
 * lacking one are the courses somebody deliberately marked as running — the
 * exact set that should hold.
 */
describe('a course that is still running', () => {
  const running = (): TreatmentRecord => treatment({ treatmentEndsAt: undefined });

  it('is open rather than clearing on a date', () => {
    expect(withdrawalWindow(running(), 'egg')).toEqual({ state: 'open' });
  });

  it('still holds the produce a year later', () => {
    const active = activeWithdrawals([running()], 'egg', [FLOCK], START + 365 * DAY);

    expect(active).toHaveLength(1);
    expect(active[0]?.clearsAt).toBeNull();
  });

  it('would have cleared on the old arithmetic, which is the whole point', () => {
    // Day eight of a course nobody has closed. The old code counted from the
    // first dose and reported nothing held.
    expect(activeWithdrawals([running()], 'egg', [FLOCK], START + 8 * DAY)).toHaveLength(1);
  });

  it('imposes nothing for a kind the medication does not cover', () => {
    // Being open is not a reason to hold produce the medicine never touched.
    expect(withdrawalWindow(running(), 'meat')).toEqual({ state: 'none' });
    expect(activeWithdrawals([running()], 'meat', [FLOCK], START + DAY)).toEqual([]);
  });

  it('clears normally the moment a last dose is recorded', () => {
    const closed = treatment({ treatmentEndsAt: START + 5 * DAY });

    expect(activeWithdrawals([closed], 'egg', [FLOCK], START + 13 * DAY)).toEqual([]);
  });

  it('sorts last, so it is the binding one', () => {
    const long = treatment({ id: 'C'.repeat(26), name: 'Long', withdrawalDays: { egg: 21 } });
    const open = treatment({ id: 'A'.repeat(26), name: 'Open', treatmentEndsAt: undefined });

    const active = activeWithdrawals([long, open], 'egg', [FLOCK], START + DAY);
    expect(active.map((a) => a.medication)).toEqual(['Long', 'Open']);
    expect(longestWithdrawal(active)?.medication).toBe('Open');
  });

  it('says what ends it, and names no date', () => {
    const active = activeWithdrawals([running()], 'egg', [FLOCK], START + DAY);
    const message = withdrawalMessage(active[0] as ActiveWithdrawal, START + DAY);

    expect(message).toContain('Still being given');
    expect(message).toContain('record the last dose');
    expect(message).not.toContain('Clear');
  });
});

describe('activeWithdrawals', () => {
  it('reports a window that is still open', () => {
    const active = activeWithdrawals([treatment()], 'egg', [FLOCK], START + 3 * DAY);

    expect(active).toHaveLength(1);
    expect(active[0]?.medication).toBe('Amprolium');
  });

  it('stops reporting once the window has passed', () => {
    expect(activeWithdrawals([treatment()], 'egg', [FLOCK], START + 8 * DAY)).toEqual([]);
  });

  it('treats the clearing instant as clear', () => {
    expect(activeWithdrawals([treatment()], 'egg', [FLOCK], START + 7 * DAY)).toEqual([]);
  });

  it('does not leak a treatment from another group', () => {
    const active = activeWithdrawals(
      [treatment({ flockId: OTHER_FLOCK })],
      'egg',
      [FLOCK],
      START + DAY,
    );
    expect(active).toEqual([]);
  });

  it('covers an individual animal treated on its own', () => {
    const perBird = treatment({ flockId: undefined, animalId: BIRD });

    expect(activeWithdrawals([perBird], 'egg', [BIRD], START + DAY)).toHaveLength(1);
    // Treating one hen does not withhold the whole flock's eggs.
    expect(activeWithdrawals([perBird], 'egg', [FLOCK], START + DAY)).toEqual([]);
  });

  it('reports only the kind asked about', () => {
    const meatOnly = treatment({ withdrawalDays: { meat: 30 } });

    expect(activeWithdrawals([meatOnly], 'egg', [FLOCK], START + DAY)).toEqual([]);
    expect(activeWithdrawals([meatOnly], 'meat', [FLOCK], START + DAY)).toHaveLength(1);
  });

  it('orders soonest first', () => {
    const short = treatment({ id: 'A'.repeat(26), name: 'Short', withdrawalDays: { egg: 3 } });
    const long = treatment({ id: 'C'.repeat(26), name: 'Long', withdrawalDays: { egg: 21 } });

    const active = activeWithdrawals([long, short], 'egg', [FLOCK], START + DAY);
    expect(active.map((a) => a.medication)).toEqual(['Short', 'Long']);
  });
});

describe('longestWithdrawal', () => {
  it('picks the one that clears last, since that is the binding one', () => {
    const short = treatment({ id: 'A'.repeat(26), name: 'Short', withdrawalDays: { egg: 3 } });
    const long = treatment({ id: 'C'.repeat(26), name: 'Long', withdrawalDays: { egg: 21 } });

    const active = activeWithdrawals([short, long], 'egg', [FLOCK], START + DAY);
    expect(longestWithdrawal(active)?.medication).toBe('Long');
  });

  it('returns null when nothing is active', () => {
    expect(longestWithdrawal([])).toBeNull();
  });
});

describe('days remaining', () => {
  it('rounds up, so a part-day still reads as a day', () => {
    // Rounding down would say "clear today" with hours left on the window.
    expect(daysUntilClear(START + DAY + 1, START)).toBe(2);
    expect(daysUntilClear(START + DAY, START)).toBe(1);
  });

  it('never goes negative', () => {
    expect(daysUntilClear(START, START + 10 * DAY)).toBe(0);
  });
});

describe('the message', () => {
  it('names the medication and stays plain', () => {
    const [active] = activeWithdrawals([treatment()], 'egg', [FLOCK], START + DAY);
    const message = withdrawalMessage(active!, START + DAY);

    expect(message).toContain('Amprolium');
    expect(message).toContain('Eggs withheld');
    // Errors and warnings are literal — charm here would be an insult.
    expect(message).not.toMatch(/sorry|oops|!/i);
  });

  it('uses the right noun per kind', () => {
    const milk = treatment({ withdrawalDays: { milk: 4 } });
    const [active] = activeWithdrawals([milk], 'milk', [FLOCK], START + DAY);

    expect(withdrawalMessage(active!, START + DAY)).toContain('Milk withheld');
  });
});
