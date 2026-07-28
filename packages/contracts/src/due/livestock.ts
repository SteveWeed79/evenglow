import { DEFAULT_NOTICE_DAYS } from './notice';
import type { Due } from './types';
import type { ActiveWithdrawal } from '../withdrawal';

/**
 * Livestock dues — withdrawals clearing, and (once the entities exist)
 * births, hatches and candling.
 *
 * The withdrawal half is a thin adapter rather than new arithmetic: `W2` is
 * already computed and already tested, and re-deriving it here would give the
 * banner and the Today list two chances to disagree about whether eggs are
 * safe to sell.
 */

/**
 * A withdrawal, as a row that says when it *ends*.
 *
 * Zero notice by default, and that is the interesting choice. Knowing on
 * Tuesday that eggs clear on Friday changes nothing anyone does on Tuesday —
 * the produce is already being held, and the banner on the group says so. A
 * row that sat on Today for three days would be the app repeating itself,
 * which is how a list stops being read.
 */
export function withdrawalDue(
  withdrawal: ActiveWithdrawal,
  subjectName: string,
  noticeDays = DEFAULT_NOTICE_DAYS.withdrawal,
): Due {
  return {
    key: `${withdrawal.medicationId}:withdrawal:${withdrawal.kind}`,
    kind: 'withdrawal',
    subject: { entity: 'medication', id: withdrawal.medicationId },
    title: `${subjectName}: ${withdrawal.kind} clear again after ${withdrawal.medication}`,
    at: withdrawal.clearsAt,
    atReading: null,
    projectedAt: null,
    noticeDays,
  };
}

/**
 * Gestation and incubation, in days.
 *
 * Averages, and treated as such — every one of these varies by several days
 * across breeds and conditions, which is exactly why the due row carries six
 * weeks of notice for a birth. The date is when to be ready, not a promise.
 *
 * Sourced from standard husbandry references and rounded to the day.
 */
export const GESTATION_DAYS: Record<string, number> = {
  goat: 150,
  sheep: 147,
  cattle: 283,
  pig: 114,
  rabbit: 31,
  alpaca: 335,
  llama: 350,
  donkey: 365,
  horse: 340,
};

export const INCUBATION_DAYS: Record<string, number> = {
  chicken: 21,
  duck: 28,
  goose: 30,
  turkey: 28,
  quail: 18,
  guineafowl: 27,
  pigeon: 18,
  emu: 52,
  ostrich: 42,
  rhea: 38,
};

/**
 * Day of an incubation when candling is worth doing.
 *
 * Day 7 for a chicken, later for the longer sitters. The point is culling
 * clears that were never fertile, which is what frees incubator space for the
 * next set — so it is due once, and only if it has not been done.
 */
export function candlingDay(incubationDays: number): number {
  return Math.max(5, Math.round(incubationDays / 3));
}

const DAY_MS = 86_400_000;

export interface IncubationRecord {
  id: string;
  species: string;
  setAt: number;
  candledAt?: number | undefined;
  hatchedAt?: number | undefined;
}

/**
 * The two rows a set of eggs produces: candle it, then expect a hatch.
 *
 * Both disappear because their event was logged — `candledAt` clears the
 * first, `hatchedAt` the second. Nothing is ticked off.
 */
export function incubationDues(incubation: IncubationRecord, label: string): Due[] {
  const days = INCUBATION_DAYS[incubation.species];
  if (days === undefined || incubation.hatchedAt !== undefined) return [];

  const subject = { entity: 'flock' as const, id: incubation.id };
  const dues: Due[] = [];

  if (incubation.candledAt === undefined) {
    dues.push({
      key: `${incubation.id}:candle`,
      kind: 'candle',
      subject,
      title: `Candle the ${label} eggs`,
      at: incubation.setAt + candlingDay(days) * DAY_MS,
      atReading: null,
      projectedAt: null,
      noticeDays: DEFAULT_NOTICE_DAYS.candle,
    });
  }

  dues.push({
    key: `${incubation.id}:hatch`,
    kind: 'hatch',
    subject,
    title: `${label} eggs due to hatch`,
    at: incubation.setAt + days * DAY_MS,
    atReading: null,
    projectedAt: null,
    noticeDays: DEFAULT_NOTICE_DAYS.hatch,
  });

  return dues;
}

export interface BreedingRecord {
  id: string;
  species: string;
  damId: string;
  bredAt: number;
  bornAt?: number | undefined;
}

/**
 * When an animal is due to give birth.
 *
 * Six weeks of notice, because the preparation is real: a pen to build, an
 * animal to move, and someone who needs to be around. A row that appeared the
 * week before would be information arriving after it was useful.
 */
export function birthDue(breeding: BreedingRecord, damName: string): Due | null {
  const days = GESTATION_DAYS[breeding.species];
  if (days === undefined || breeding.bornAt !== undefined) return null;

  return {
    key: `${breeding.id}:birth`,
    kind: 'birth',
    subject: { entity: 'animal', id: breeding.damId },
    title: `${damName} due`,
    at: breeding.bredAt + days * DAY_MS,
    atReading: null,
    projectedAt: null,
    noticeDays: DEFAULT_NOTICE_DAYS.birth,
  };
}
