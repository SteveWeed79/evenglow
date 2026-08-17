import type { Entity } from '../mutation';

/**
 * The due engine.
 *
 * A withdrawal window closing, a hatch date, a sow window opening after last
 * frost, a 250-hour service and a doe due to kid look like five features and
 * are one:
 *
 * > Something becomes **due** at a date or at a meter reading, it appears on
 * > **Today** when it is near, and it stops appearing because the event it was
 * > waiting for was logged.
 *
 * Build this once and each domain is mostly a table of intervals. Build it
 * three times and the app is three apps sharing a tab bar.
 *
 * ## Three properties, and each is a lesson from something already built
 *
 * **1. Derived, not authored.** A due row is computed from the records that
 * imply it — a treatment implies a withdrawal, an hour reading implies a
 * service, a planting implies a sow date. Nobody types a reminder in.
 * Reminders people have to enter are reminders people stop entering, and an
 * app whose alerts are only as good as its data entry is an app that quietly
 * stops warning about anything.
 *
 * **2. Recomputed locally, never pushed.** No notification server, no cloud
 * scheduler. The device knows the last hour reading and the interval, and it
 * can do arithmetic with the radio off. That is the feature, not a limitation.
 *
 * **3. Nothing is "marked done".** A due row has no completion flag and no
 * `clearedBy` field, and that is a correction to the first sketch of this
 * design. You do not tick off a service — you log the service, and the next
 * recomputation simply does not produce that row, because the record it was
 * waiting for now exists. A stored completion flag is a second source of
 * truth about whether something happened, and the two drift.
 *
 * Which is why `Due` is a projection and not a syncable entity. It never
 * crosses the wire, so it cannot conflict, cannot be rejected, and needs no
 * schema on the envelope.
 */

export const DUE_KINDS = [
  /** Produce is inside a withdrawal window and clears on this date (W2). */
  'withdrawal',
  /** A machine service, by date or by hour meter. */
  'service',
  /** Seasonal put-away: winterising, fuel stabiliser, blades off. */
  'storage',
  'start-indoors',
  'sow',
  'transplant',
  'harvest',
  /** A doe, ewe, cow or sow due to give birth. */
  'birth',
  /** Eggs set, and the day they are due to hatch. */
  'hatch',
  /** Candling, roughly a week into an incubation. */
  'candle',
  /** Meat stock reaching processing weight or age. */
  'processing',
  /** A fleece owed, from the breed's own interval. */
  'shearing',
  /** A chore the farm entered itself. The one authored kind. */
  'task',
] as const;

export type DueKind = (typeof DUE_KINDS)[number];

/**
 * How close a due row is, once notice has been taken into account.
 *
 * Four steps rather than a boolean because they carry different instructions.
 * `soon` is "order the filter"; `now` is "do it today"; `overdue` is "this
 * did not happen." A single is-it-due flag collapses the first two, which is
 * exactly where a farm loses a week waiting on a part.
 */
export const URGENCIES = ['later', 'soon', 'now', 'overdue'] as const;
export type Urgency = (typeof URGENCIES)[number];

/**
 * Everything needed to write the record that clears one row.
 *
 * Carried on the due rather than reconstructed by the screen from the `key`.
 * The key's shape is an implementation detail of whichever builder made it,
 * and a screen parsing it would break silently the first time a builder
 * changed one — which is the sort of failure that reaches a handset.
 */
export interface DueDone {
  /** See the note on `Due.done` for why the list is this short. */
  entity: 'careLog' | 'task';
  op: 'create' | 'update';
  /** The row to change. Absent on a create, where the id is minted. */
  targetId?: string;
  /**
   * The payload, minus the moment.
   *
   * Loosely typed on purpose: `enqueue` validates every payload against the
   * same contract the server does, so a wrong shape is refused at the point
   * of the mistake rather than being caught twice, differently, here.
   */
  payload: Record<string, unknown>;
  /**
   * Which field carries the moment the button was pressed.
   *
   * `occurredAt` on an observation, `completedAt` on a chore — the same press
   * meaning "now" in two vocabularies, and the difference belongs with the
   * builder that knows which it is writing.
   */
  stampAs: 'occurredAt' | 'completedAt';
  /** What the button says. "Trimmed feet", not "Done". */
  label: string;
}

export interface Due {
  /**
   * Stable across recomputations for the same underlying fact.
   *
   * Not an ID — there is nothing to store. It exists so a list rendered every
   * few seconds keeps its order and its React keys, and so two builders
   * cannot silently produce the same row twice.
   */
  key: string;
  kind: DueKind;
  subject: { entity: Entity; id: string };
  /** One line, already in the farm's words. "Sow Sungold in Bed 3." */
  title: string;

  /**
   * Exactly one of these two is set.
   *
   * A service is by date or by hours, never both — a machine with an hour
   * meter is serviced on hours, and one without is serviced on dates. Carrying
   * both would mean every consumer branches, and the branch would be wrong
   * half the time because nobody would know which took precedence.
   */
  at: number | null;
  atReading: number | null;

  /**
   * When `atReading` is set and usage is known, the date that reading is
   * expected to arrive. This is what lets an hours-based service sort into the
   * same list as a date-based one.
   */
  projectedAt: number | null;

  /**
   * The other records this row is about, when `subject` is not one of them.
   *
   * ## `subject` means two things, and this is the second one
   *
   * `birthDue` says it outright: *"`subject` is what opens the row, not merely
   * what the row is about."* It names the dam's **group**, because the group is
   * where a birth is discharged and an animal id in a `groupId` slot rendered
   * "That group — Missing" on a live row. That is the right call for Today,
   * where a row is a door.
   *
   * It is the wrong call for a panel that asks *what is coming for this thing*.
   * Three rows are about something they do not name:
   *
   * - a **birth** is about the dam, and names her group;
   * - a **withdrawal** is about the group whose produce is held, and names the
   *   medication, because that is what the arithmetic came from;
   * - a **task** pinned to a group is about that group, and names itself,
   *   because a chore is the one authored kind and clears on its own record.
   *
   * Filtering on `subject` alone would give Bramble's screen no row about
   * Bramble while "Bramble due" sat on Today, which is precisely the sort of
   * near-miss the app is supposed to close.
   *
   * ## Ids, with no entity beside them
   *
   * The same shape and the same reason as `HistoryEvent.subjects`: ids are
   * ULIDs and globally unique, so the entity would be a second fact that could
   * disagree with the first. Nothing routes from this — `subject` still does
   * all the opening — so an entity here would be decoration.
   *
   * Optional, and absent on every row whose `subject` already is what it is
   * about. A service is about its machine and opens its machine; there is
   * nothing to add.
   */
  about?: readonly string[];

  /**
   * The record one press would write, when a press is honestly enough.
   *
   * **This is not the completion flag property 3 refuses**, and the difference
   * is the whole reason it is allowed to exist. Pressing it writes the *real
   * record* — a `careLog`, the same one the form would have written. The row
   * then disappears on the next recomputation for exactly the reason every
   * other row disappears: the thing it was waiting for now exists. Nothing is
   * marked. There is still no `done` boolean and no `clearedBy` anywhere.
   *
   * The test for whether that is a shortcut or a lie is simple: **does the
   * record it writes contain everything the form would have collected?** For a
   * look-over it does — a health check is a date and a subject, and the form
   * adds an optional note. For everything else it does not, which is why this
   * is absent on almost every row:
   *
   * - a **service** needs its hours and what was changed;
   * - a **hatch** needs how many hatched, which is the entire point of it;
   * - a **withdrawal** is not a job at all, it is a date passing.
   *
   * A one-tap Done on any of those would write a record that says something
   * nobody checked, and a record nobody checked is worse than a row still
   * sitting there.
   *
   * It also means the job lands in What happened, which a flag never would.
   */
  done?: DueDone;

  /**
   * How far ahead this starts appearing on Today.
   *
   * Per-row, because the right answer differs by an order of magnitude. A
   * withdrawal wants the day it clears and not before — it is not actionable
   * early. A sow window wants a fortnight, because seed has to be to hand. A
   * kidding wants six weeks, because someone has to build a pen.
   */
  noticeDays: number;
}

const DAY_MS = 86_400_000;

/** The effective date: the real one, or the projection for a meter row. */
export function dueDate(due: Due): number | null {
  return due.at ?? due.projectedAt;
}

/**
 * How close this is, right now.
 *
 * A row with a meter target and no usage estimate is `later`, never `now`.
 * Guessing that an unknown-usage machine is due today would put a row on
 * Today that nothing can clear, and a list with a permanent resident on it is
 * a list people stop reading.
 */
export function urgencyOf(due: Due, now: number): Urgency {
  const at = dueDate(due);
  if (at === null) return 'later';

  if (now >= at) {
    // The day it lands is 'now'; the day after is 'overdue'. A due row that
    // flips to overdue at one minute past midnight on the day it is due would
    // call a farmer late for something they are about to do after breakfast.
    return now >= at + DAY_MS ? 'overdue' : 'now';
  }

  return now >= at - due.noticeDays * DAY_MS ? 'soon' : 'later';
}

/** Whether this belongs on Today at all. */
export function isVisible(due: Due, now: number): boolean {
  return urgencyOf(due, now) !== 'later';
}

const URGENCY_ORDER: Record<Urgency, number> = { overdue: 0, now: 1, soon: 2, later: 3 };

/**
 * Overdue first, then soonest.
 *
 * The tie-break is the key rather than the title, so a list cannot reorder
 * itself between renders when two things fall on the same day — which looks,
 * to someone glancing at a phone in a barn, exactly like something changed.
 */
export function compareDues(a: Due, b: Due, now: number): number {
  const byUrgency = URGENCY_ORDER[urgencyOf(a, now)] - URGENCY_ORDER[urgencyOf(b, now)];
  if (byUrgency !== 0) return byUrgency;

  const at = dueDate(a);
  const bt = dueDate(b);
  if (at !== null && bt !== null && at !== bt) return at - bt;
  if (at === null && bt !== null) return 1;
  if (bt === null && at !== null) return -1;

  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** What Today shows: visible rows, most pressing first. */
export function todayList(dues: readonly Due[], now: number): Due[] {
  return dues.filter((d) => isVisible(d, now)).sort((a, b) => compareDues(a, b, now));
}

/** Whether this row is about a particular record — see `Due.about`. */
export function concerns(due: Due, id: string): boolean {
  return due.subject.id === id || (due.about?.includes(id) ?? false);
}

/**
 * Everything coming for one set of records, soonest first.
 *
 * ## Not filtered by visibility, and that is the whole difference from Today
 *
 * `todayList` drops `later` rows because Today is a morning's work and a list
 * that reaches into November is one nobody finishes. A detail screen is the
 * opposite question — somebody has opened the tractor *to find out about the
 * tractor* — and the 250-hour service six weeks out is exactly what they came
 * for. Hiding it there would leave the screen saying nothing on most days.
 *
 * So a row with no date at all survives too. "At 250 hours" on a machine
 * nobody has read twice is a permanent resident on Today and refused there;
 * on the machine's own screen it is the schedule, stated honestly.
 *
 * ## Several ids, because a screen may make a hop the engine does not
 *
 * A bed passes itself and its plantings — nothing is due for a bed, and
 * *"Sungold in Bed 3 wants sowing"* is plainly about the bed. The same hop
 * `listHistory` takes, made by the screen that means it rather than by a
 * hierarchy walk every panel would inherit.
 */
export function duesFor(dues: readonly Due[], ids: readonly string[], now: number): Due[] {
  const wanted = new Set(ids);

  return dues
    .filter(
      (due) =>
        wanted.has(due.subject.id) || (due.about?.some((id) => wanted.has(id)) ?? false),
    )
    .sort((a, b) => compareDues(a, b, now));
}

/**
 * The same list, with a group's husbandry gathered into one row.
 *
 * ## Why this exists
 *
 * A farm with two groups and the ordinary intervals gets this on a Tuesday
 * morning: "Look over — Chickens", "Check for parasites — Chickens",
 * "Vaccinations — Chickens", "Worm check — Chickens", then the same four for
 * the goats. Nine rows, none of them wrong, and a list nobody reads. `careDues`
 * emits one row per care kind per group by design — it has to, because each
 * clears separately — but that is a fact about the engine, not about the
 * morning.
 *
 * A bundle keeps every row and shows one. Nothing is dropped, nothing is
 * merged: `dues` still has all four, and logging any one of them clears that
 * one.
 *
 * ## What is bundled, and what is deliberately not
 *
 * Only `task` — the husbandry rows, which are the ones that multiply. A
 * withdrawal closing and a hatch date are one-of-a-kind facts about the same
 * animals and must never be folded together: they mean different things, they
 * clear differently, and the whole point of Today is that a withdrawal is
 * visible.
 *
 * Urgency is part of the bundling key for the same reason. An overdue worming
 * and a mineral check due next week are not one row, however much they share a
 * subject — collapsing them would hide the overdue one behind the count.
 *
 * ## Screen-reader note
 *
 * Android's accessibility guidance asks that each item in a list carry a
 * different description; nine rows differing by one word read as a list where
 * focus never moved. This is the fix for that as much as for the eye.
 */
export interface DueBundle {
  /** Stable across recomputations, like `Due.key`, and for the same reason. */
  key: string;
  subject: Due['subject'];
  kind: DueKind;
  /** Every row this stands for, most pressing first. Never empty. */
  dues: Due[];
  /** The row that decides where the bundle sorts and what it says. */
  lead: Due;
}

/** Whether a kind is one that repeats per subject and is worth gathering. */
function bundles(kind: DueKind): boolean {
  return kind === 'task';
}

export function todayBundles(dues: readonly Due[], now: number): DueBundle[] {
  const ordered = todayList(dues, now);
  const byKey = new Map<string, Due[]>();
  const order: string[] = [];

  for (const due of ordered) {
    // A row that does not bundle still gets a bundle of one, so the caller has
    // a single shape to render rather than two.
    const key = bundles(due.kind)
      ? `${due.kind}:${due.subject.entity}:${due.subject.id}:${urgencyOf(due, now)}`
      : `one:${due.key}`;

    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, [due]);
      order.push(key);
    } else {
      existing.push(due);
    }
  }

  // `order` preserves the sorted order of each bundle's FIRST row, which is
  // its most pressing one — so the bundles come out in the same order the flat
  // list would have.
  return order.map((key) => {
    const group = byKey.get(key) ?? [];
    const lead = group[0]!;
    return { key, subject: lead.subject, kind: lead.kind, dues: group, lead };
  });
}

/**
 * When a machine is expected to reach a meter reading.
 *
 * Returns null rather than a guess when usage is unknown or non-positive. A
 * machine nobody has recorded twice has no usage rate, and a projection built
 * on one reading is a straight line through a single point.
 */
export function projectReading(
  currentReading: number,
  perDay: number | null,
  target: number,
  now: number,
): number | null {
  if (perDay === null || perDay <= 0) return null;
  if (currentReading >= target) return now;
  return now + ((target - currentReading) / perDay) * DAY_MS;
}
