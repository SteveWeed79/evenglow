import { CARE_KIND_LABELS, type CareIntervals, type CareKind } from '../entities/care';
import { SPECIES_TRAITS, type Species } from '../entities/livestock';
import type { Due } from './types';

/**
 * Routine husbandry, as intervals.
 *
 * The whole feature is this table plus twenty lines. That is the point the
 * scope doc was making: worming and hoof trimming are not a subsystem, they
 * are dates, and the due engine already knows what to do with a date.
 *
 * ## Why these are keyed by species group, not species
 *
 * Hooves grow at roughly the same rate on a goat and a sheep, and neither is a
 * chicken. Keying per species would be fifty rows repeating five answers, and
 * every new species would need someone to fill in a column they have no
 * opinion about — so the default falls out of the group and a farm overrides
 * what it disagrees with.
 *
 * ## These are defaults and they are conservative
 *
 * Every one of them is a "sooner than most farms need" figure, because the
 * cost of the two directions is not symmetric: an early reminder is dismissed
 * in a tap, and a late one is a lame goat. A farm that trims every twelve
 * weeks sets twelve and stops thinking about it.
 *
 * Worming especially. The interval below is a *reminder to assess*, not a
 * schedule to dose on — blanket worming on a calendar is how resistance is
 * built, and the honest thing an app can do is prompt a look rather than
 * prescribe a drench.
 */

type Group = (typeof SPECIES_TRAITS)[Species]['group'];

/** Days. `null` means the job does not apply to this kind of animal. */
type Intervals = Partial<Record<CareKind, number | null>>;

/**
 * ## `health-check` is off everywhere, and that is the biggest change here
 *
 * It was 30 days on every group, and it was the single largest source of rows
 * in the app: a three-group farm owed roughly a hundred confirmations a year
 * across all the routine jobs, and forty of them were this one. What it bought
 * for each of those taps was a record that somebody looked at animals they see
 * every morning anyway.
 *
 * "Look at your stock" is not a job an app schedules. It is the thing a farm
 * is already doing while it logs the eggs, and a monthly prompt to confirm it
 * is a chore this app invented for itself.
 *
 * **The record is untouched.** `health-check` is still a `CareKind`, still
 * offered on the care form, still shown in history, and can still be turned
 * back on per group by a farm that wants it — which is the case worth keeping:
 * a group in a rented field two valleys over is genuinely worth a prompt, and
 * that farm can now ask for one. Only the automatic nag is gone.
 *
 * ## Poultry were charged twice for one walk-round
 *
 * `parasite-check` at 30 days sat beside `health-check` at 30 days, and on a
 * chicken those are the same act — you look at the bird, you look at the bird
 * for mites. It is 90 days now, which is a real and distinct job rather than
 * a duplicate: red mite lives in the coop and not on the bird, it explodes in
 * warm weather, and finding it means going out after dark with a torch. That
 * is worth asking about quarterly and is not what "look them over" covers.
 *
 * For a ruminant the two never overlapped — a faecal egg count or a FAMACHA
 * score is nothing like a general look — so those intervals are unchanged.
 */
const POULTRY: Intervals = {
  'parasite-check': 90,
  'health-check': null,
  vaccination: 365,
  worming: 120,
  'hoof-trim': null,
  mineral: null,
  dental: null,
};

const RUMINANT: Intervals = {
  'hoof-trim': 56,
  mineral: 30,
  worming: 90,
  'parasite-check': 60,
  'health-check': null,
  vaccination: 365,
  dental: null,
};

const RATITE: Intervals = {
  'health-check': null,
  'parasite-check': 60,
  worming: 120,
  'hoof-trim': null,
  mineral: null,
  vaccination: null,
  dental: null,
};

const OTHER: Intervals = {
  'health-check': null,
  worming: 90,
  'parasite-check': 60,
  vaccination: 365,
  'hoof-trim': null,
  mineral: null,
  dental: null,
};

export const CARE_INTERVALS: Record<Group, Intervals> = {
  poultry: POULTRY,
  ruminant: RUMINANT,
  ratite: RATITE,
  other: OTHER,
};

/**
 * Species that want a job their group does not, or want it at a different
 * interval. Kept small on purpose — a long list here means the grouping is
 * wrong and should be fixed rather than papered over.
 */
const BY_SPECIES: Partial<Record<Species, Intervals>> = {
  // Feet grow fast and a horse that is not trimmed goes lame quickly. Teeth
  // are an annual job no other species on the list has.
  horse: { 'hoof-trim': 42, dental: 365, worming: 90, 'health-check': null, vaccination: 365 },
  donkey: { 'hoof-trim': 56, dental: 365, worming: 90, 'health-check': null, vaccination: 365 },
  // Cattle feet are trimmed far less often than a goat's.
  cattle: { 'hoof-trim': 182, mineral: 30, worming: 90, 'parasite-check': 60, 'health-check': null, vaccination: 365 },
  // Camelids: toenails rather than hooves, and shorter than a cow.
  alpaca: { 'hoof-trim': 90, mineral: 60, worming: 90, 'health-check': null, dental: 365 },
  llama: { 'hoof-trim': 90, mineral: 60, worming: 90, 'health-check': null, dental: 365 },
};

/**
 * Jobs that are about an animal's **body**, and therefore genuinely do not
 * exist for some of them.
 *
 * This is the distinction `null` was quietly doing two jobs for. A default of
 * `null` means "not on a schedule", and that covers two completely different
 * situations:
 *
 *  - **Off by default, but real.** `health-check` on any animal, `vaccination`
 *    on a ratite, `mineral` on poultry — grit and oyster shell are a thing a
 *    layer flock genuinely needs. A farm can sensibly turn any of these on.
 *  - **Does not exist.** A chicken has no hooves and no teeth that need doing.
 *    Offering seven interval chips for a chicken's teeth is not a setting, it
 *    is a category error taking up a screen.
 *
 * Only anatomy makes a job impossible. Worming, parasites, vaccination and a
 * look-over apply to anything with a pulse; minerals apply to anything that
 * eats. Hooves and teeth do not.
 */
const ANATOMICAL: readonly CareKind[] = ['hoof-trim', 'dental'];

/**
 * Which of those the animal genuinely has not got.
 *
 * ## Asked directly, because inferring it was the bug
 *
 * `careApplies` used to answer this by checking whether the default interval
 * was null — **the exact conflation the note above says must not be made**. A
 * null default means "off by default", and the whole point of that paragraph is
 * that it covers two unrelated situations.
 *
 * The `other` group is where the two came apart. It defaults everything to
 * null, and it holds pigs, rabbits, horses, donkeys and the catch-all `other`
 * species. Horses and donkeys are rescued by `BY_SPECIES`; the rest were told
 * they have **neither feet nor teeth**, with no way to switch the chips on:
 *
 *  - a pig's feet are trimmed, and a boar's tusks are a real job;
 *  - a rabbit's nails are clipped and its incisors are the classic thing that
 *    goes wrong with a rabbit;
 *  - and `other` means *this app does not know what this animal is*, which is
 *    the one case where asserting an anatomical impossibility is indefensible.
 *
 * So absence is stated rather than derived. A group listed here cannot have the
 * job at all; everything else may, whether or not it is on a schedule.
 *
 * **Ratites keep `dental` and lose the hoof exclusion.** A bird has no teeth,
 * which is settled; an emu in a pen grows its toenails long and they are
 * trimmed, so refusing the setting was wrong for the same reason it was wrong
 * for a pig. It stays off by default — the interval is still null — and a farm
 * that wants it can now say so.
 *
 * Poultry keep both exclusions, which is the decision this file already made
 * and is not being reversed here: a chicken has no teeth, and a laying flock's
 * claws are not a scheduled job in the way a hoof is.
 */
const ABSENT: Record<Group, readonly CareKind[]> = {
  poultry: ['hoof-trim', 'dental'],
  ratite: ['dental'],
  // Hooves yes; teeth are not a job on a goat or a cow the way they are on a
  // horse. The camelids sit in this group and ARE floated — see below for why
  // a species override outranks the group.
  ruminant: ['dental'],
  // Pigs, rabbits, horses, donkeys, and anything the app has not got a word
  // for. Every one of them has feet, and none of them is known to have no
  // teeth.
  other: [],
};

/**
 * Whether this job could ever apply to this kind of animal.
 *
 * Distinct from `careIntervalDays` returning null, which only says it is not
 * on a schedule by default. A screen offering to change intervals asks this
 * one: a farm should be able to switch on a look-over for a group it rarely
 * visits, and should never be asked how often to do a chicken's teeth.
 */
export function careApplies(species: Species, kind: CareKind): boolean {
  if (!ANATOMICAL.includes(kind)) return true;

  /**
   * A species carrying its own interval for a body job plainly has the body
   * part, and that outranks its group.
   *
   * This is what `BY_SPECIES` is for, and it is load-bearing here rather than
   * tidy: alpacas and llamas are in the **ruminant** group, which does not do
   * teeth — and camelids are floated yearly. A group-only table would take a
   * llama's teeth away while its own interval said 365.
   *
   * `!= null` rather than `!== undefined`: an override may be an explicit
   * `null` to silence a job, which is a schedule saying "off", not anatomy
   * saying "never".
   */
  if (BY_SPECIES[species]?.[kind] != null) return true;

  return !ABSENT[SPECIES_TRAITS[species].group].includes(kind);
}

/** How often a job comes round for this species, or null if it does not apply. */
export function careIntervalDays(species: Species, kind: CareKind): number | null {
  const specific = BY_SPECIES[species]?.[kind];
  if (specific !== undefined) return specific;

  const traits = SPECIES_TRAITS[species];
  return CARE_INTERVALS[traits.group][kind] ?? null;
}

const DAY_MS = 86_400_000;

/**
 * Two weeks' notice on everything here.
 *
 * Long enough to buy wormer or book the trimmer, short enough that a screen
 * read at 6am is not mostly things due next month. Overridable per farm; the
 * scope doc's per-kind notice table covers the *kinds*, and every one of these
 * is the same kind of job.
 */
const NOTICE_DAYS = 14;

export interface CareGroup {
  id: string;
  name: string;
  species: Species;
  /** When each job was last done. Absent means never. */
  lastDone: Partial<Record<CareKind, number>>;
  /**
   * Per-farm overrides, in days. `null` silences a job entirely.
   *
   * The contract's own type rather than a restatement of it — a second
   * `Partial<Record<CareKind, …>>` here would drift from the schema the record
   * is actually stored against.
   */
  intervals?: CareIntervals | undefined;
  /**
   * When this farm added the group, from the ULID in its id.
   *
   * Absent falls back to `now`, which is the old behaviour: every job for a
   * never-recorded group due this instant.
   */
  since?: number | undefined;
}

/**
 * How long a brand-new group gets before its never-done jobs start asking.
 *
 * A farm that adds three groups on a Sunday afternoon used to get twelve red
 * rows on Monday morning, because "never done" meant "due now" for every job
 * at once. That is a wall, and a wall is the thing people close an app to get
 * away from.
 *
 * The obvious alternative was worse and this codebase already rejected it:
 * starting the clock at one full interval would tell somebody their overdue
 * herd is fine for another eight weeks, which is the argument the original
 * comment makes and it is right. So this is a week — long enough that setting
 * the farm up is not a scolding, short enough that a genuine backlog surfaces
 * in the first week rather than the first season.
 */
const GRACE_DAYS = 7;

const TITLES: Record<CareKind, string> = {
  worming: 'Worm check',
  'hoof-trim': 'Trim feet',
  mineral: 'Check minerals',
  vaccination: 'Vaccinations',
  'parasite-check': 'Check for parasites',
  dental: 'Teeth',
  'health-check': 'Look over',
};

/**
 * The husbandry due on one group.
 *
 * A job never done is due **now**, not one interval from today. A farm that
 * has never recorded trimming a goat's feet either has not been trimming them
 * or has not been recording it, and both are worth a row — starting the clock
 * from the moment the app was installed would tell someone their overdue herd
 * is fine for another eight weeks.
 */
export function careDues(group: CareGroup, now: number): Due[] {
  const dues: Due[] = [];

  for (const kind of Object.keys(TITLES) as CareKind[]) {
    const override = group.intervals?.[kind];
    // `null` silences; `undefined` means "no opinion", so fall through.
    const days = override === undefined ? careIntervalDays(group.species, kind) : override;
    if (days === null || days <= 0) continue;

    const last = group.lastDone[kind];

    /**
     * A never-done job is due a week after the group was added, not one
     * interval after — see GRACE_DAYS. A group that has been on the app for
     * longer than the grace is already past it, so this reduces to "due now"
     * for every farm that is not setting up today.
     */
    const never = (group.since ?? now) + GRACE_DAYS * DAY_MS;

    dues.push({
      key: `${group.id}:care:${kind}`,
      kind: 'task',
      subject: { entity: 'flock', id: group.id },
      title: `${TITLES[kind]} — ${group.name}`,
      at: last === undefined ? never : last + days * DAY_MS,
      atReading: null,
      projectedAt: null,
      noticeDays: NOTICE_DAYS,
      /**
       * Husbandry is the one family where one press is the honest whole of it.
       *
       * A look-over, a foot trim, a mineral check: the record is a date and a
       * subject, and the form's only other field is an optional note. So the
       * button writes the same `careLog` the form would, and the row clears
       * because that record now exists — not because anything was ticked.
       *
       * The past-tense label is deliberate. "Done" beside four rows is four
       * identical buttons; "Trimmed feet" says what is about to be written,
       * which is what makes it safe to press without opening anything.
       */
      done: {
        entity: 'careLog',
        op: 'create',
        payload: { kind, flockId: group.id },
        stampAs: 'occurredAt',
        label: CARE_KIND_LABELS[kind],
      },
    });
  }

  return dues;
}
