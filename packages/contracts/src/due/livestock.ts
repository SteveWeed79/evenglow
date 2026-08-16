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
): Due | null {
  /**
   * A course still being dosed raises no row, and the refusal is deliberate
   * rather than a consequence.
   *
   * `clearsAt` is null while a course is open, and a `Due` with no date and no
   * reading is `later`, which `isVisible` filters off Today — so this would
   * have happened anyway, silently, as a side effect of two unrelated rules
   * meeting. Stating it is the difference between a decision and an accident
   * somebody later "fixes".
   *
   * The decision itself follows this file's own reasoning. A withdrawal row
   * says when produce comes *back*, with zero notice, because the holding is
   * already visible on the screen where the produce is logged. An open course
   * has no date to come back on, so a row for it could only repeat the banner —
   * every morning, for as long as the course runs. That is the permanent
   * resident `DOMAIN-SCOPE.md` §0 builds every builder against.
   *
   * The hold itself is not softened by this. `activeWithdrawals` keeps the
   * withdrawal in force and `withdrawalMessage` says what ends it.
   */
  if (withdrawal.clearsAt === null) return null;

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

/**
 * The day turning stops and the lid stays shut.
 *
 * Three days before the hatch, which is the rule for every bird in
 * `INCUBATION_DAYS` — a chicken's day 18 of 21 is the one everybody knows, and
 * it is the same three days for a duck's 28 and a quail's 18. The interval is
 * the constant, not the day number, which is why this is arithmetic rather
 * than a second table to keep in step with the first.
 */
export function lockdownDay(incubationDays: number): number {
  return Math.max(1, incubationDays - 3);
}

export type IncubationPhase = 'ahead' | 'turning' | 'candling' | 'lockdown' | 'hatching' | 'late';

export interface IncubationStage {
  /** 1 on the day they went under. Zero or less means they are not under yet. */
  day: number;
  /** The species' full term. */
  of: number;
  phase: IncubationPhase;
  /** "Day 18 of 21" — the line a keeper reads first. */
  title: string;
  /** One sentence of what to do about it. Never a humidity figure; see below. */
  guidance: string;
}

/**
 * Where a set of eggs has got to, derived from two things already recorded.
 *
 * The set date and the species are enough to say "day 18 of 21, lockdown", and
 * a keeper counting on their fingers every morning is a keeper who will one
 * day turn eggs on day nineteen. Nothing new is stored — this is a read over
 * `setAt` and `INCUBATION_DAYS`, in the same file as the numbers it needs so
 * the two cannot drift apart.
 *
 * **Not a `Due`, deliberately.** A due is a row that arrives on Today and
 * leaves when its event is recorded; this is a description of a thing already
 * on screen. Candling and the hatch are the two rows worth interrupting a
 * morning for and `incubationDues` already produces both — a third row saying
 * "still incubating" every day for three weeks is how a list stops being read.
 *
 * **No humidity, and that is a decision rather than an omission.** Dry
 * incubation, 45%, 55%, run-it-by-weight-loss — the schools genuinely
 * disagree, they disagree by more than the difference this app could measure,
 * and a keeper with a hygrometer and a hatch behind them knows their own
 * machine better than a constant compiled into a phone. Saying *what* the
 * lockdown days are for is honest; naming a number to hold them at is not.
 *
 * Null when the species is not one this app knows a term for, because a stage
 * derived from a guessed term is worse than no stage at all.
 */
export function incubationStage(
  species: string,
  setAt: number,
  now: number,
): IncubationStage | null {
  const of = INCUBATION_DAYS[species];
  if (of === undefined) return null;

  // Day 1 is the day they went under, so the count is inclusive at both ends
  // and reads the way a keeper says it out loud.
  const day = Math.floor((now - setAt) / DAY_MS) + 1;
  const candle = candlingDay(of);
  const lockdown = lockdownDay(of);

  // Days until they go under, for a set dated forward.
  const away = 1 - day;
  const title =
    day >= 1 ? `Day ${day} of ${of}` : away === 1 ? 'Under from tomorrow' : `Under in ${away} days`;

  const stage = (phase: IncubationPhase, guidance: string): IncubationStage => ({
    day,
    of,
    phase,
    title,
    guidance,
  });

  if (day < 1) {
    return stage('ahead', 'Set for a date still to come — nothing to do yet.');
  }

  if (day > of) {
    /**
     * Late, and said without a deadline this app has no business setting.
     *
     * A day or two past the date is ordinary — a cool incubator runs slow, and
     * eggs set over an evening do not all start together. What a keeper needs
     * here is permission to wait, not a number telling them when to give up on
     * something that might still be alive.
     */
    const over = day - of;
    return stage(
      'late',
      `${over === 1 ? 'A day' : `${over} days`} past the date. Late hatches are ordinary — a cool run adds days — so give them a while yet before deciding a set is done.`,
    );
  }

  if (day === of) {
    return stage(
      'hatching',
      'Hatch day. Leave them in until they are dry and fluffed up; a lid opened for a look costs the ones still working at the shell.',
    );
  }

  if (day >= lockdown) {
    return stage(
      'lockdown',
      `Lockdown — stop turning and keep the lid shut. The last ${of - lockdown + 1} days are when a chick moves into position and needs the air inside left alone.`,
    );
  }

  if (day === candle) {
    return stage(
      'candling',
      'Candling day. Hold each one to a light and take the clears out — the space is worth more than the hope.',
    );
  }

  return stage(
    'turning',
    `Turning days, an odd number of times a day so they do not spend every night the same way up. Lockdown on day ${lockdown}.`,
  );
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
export function birthDue(
  breeding: BreedingRecord,
  damName: string,
  /**
   * The dam's group, when the caller knows it — and it always does.
   *
   * **`subject` is what opens the row**, not merely what the row is about:
   * `TodayScreen` navigates from it and nothing else. This due named the dam
   * (`entity: 'animal'`), and the screen's animal branch passes that id
   * straight into `Animals` as a `groupId` — so tapping "Bramble due" looked
   * up a group whose id is an animal's, found none, and rendered **"That group
   * — Missing"**. A dead end on a live row, reachable the moment any farm
   * records a breeding.
   *
   * The dam's group is where a birth is actually discharged: the Breeding
   * screen hangs off it, and the title already carries the dam's name, so
   * nothing is lost by pointing the subject at something the app can open.
   */
  damFlockId?: string,
): Due | null {
  const days = GESTATION_DAYS[breeding.species];
  if (days === undefined || breeding.bornAt !== undefined) return null;

  return {
    key: `${breeding.id}:birth`,
    kind: 'birth',
    subject:
      damFlockId === undefined
        ? { entity: 'animal', id: breeding.damId }
        : { entity: 'flock', id: damFlockId },
    title: `${damName} due`,
    at: breeding.bredAt + days * DAY_MS,
    atReading: null,
    projectedAt: null,
    noticeDays: DEFAULT_NOTICE_DAYS.birth,
  };
}
