import { z } from 'zod';

/**
 * Saying "there is no value here any more", on a wire that cannot say it.
 *
 * ## The hole this closes
 *
 * An update MERGES on both sides — `{ ...previous, ...payload }` in the
 * client's `db/project.ts`, `$set` on the server — so a field left out of an
 * edit keeps whatever it had. That is right: a partial payload is how one
 * screen changes a head count without resending a flock's whole record.
 *
 * It leaves no way to say *remove this*, and the fix that looked obvious is
 * worse than the bug. Naming the field with `undefined` beside it — the
 * pattern `TreatmentScreen` established and commented — clears the local
 * projection and **never leaves the handset**: `JSON.stringify` drops an
 * `undefined` value, so the mutation reaches the server without the key, its
 * `$set` leaves the old value standing, and the next snapshot puts it back.
 * The device reads cleared, the farm's other devices read unchanged, and
 * nothing anywhere reports a disagreement.
 *
 * So a cleared field is `null` on the wire. JSON carries it, every store keeps
 * it, and both sides of the merge know what it means.
 *
 * ## Only the top level, and only in an update
 *
 * `null` means *clear* when it is the value of a key in an update payload. It
 * means nothing of the sort one level down: `flock.careIntervals` is
 * `{ worming: null }` for *"never ask about worming"*, which is a value the
 * farm chose and not an absence. The two live side by side without ambiguity
 * because this rule stops at the first level — `careIntervals: null` clears the
 * farm's whole opinion, `careIntervals: { worming: null }` records one.
 *
 * A create payload may not carry `null` at all. There is nothing to clear on a
 * record that does not exist yet, and every create schema stays strict about
 * it, so a screen that means "leave it out" cannot say "remove it" by accident.
 *
 * ## What may be cleared
 *
 * Exactly the fields a create may omit, worked out from the create shape rather
 * than listed by hand — a hand-kept list is a second place to add a field and
 * the first place to forget one.
 *
 * Two kinds of field are deliberately NOT clearable:
 *
 * - **Required ones.** Clearing `flock.name` or `medication.name` leaves a
 *   record that no reader can parse, which the client drops from every list —
 *   indistinguishable, to the person who just edited it, from the app losing
 *   their animals.
 * - **Ones with a default.** `task.recurrence` is never absent: a reader
 *   applies the default the moment it parses. "Clear it" and "set it to the
 *   default" are the same act, and the second one already works, so admitting
 *   the first would be a second way to spell one thing.
 *
 * The probe below distinguishes those three cases by asking the field itself
 * rather than by inspecting zod's class names, which change between major
 * versions and would fail silently when they did.
 */

/** Optional fields — and only those — also accept `null`. */
type Clearable<S extends z.ZodRawShape> = {
  [K in keyof S]: undefined extends z.output<S[K]> ? z.ZodNullable<S[K]> : S[K];
};

/**
 * True when a field may be left out entirely and reads back as absent.
 *
 * `.optional()` parses `undefined` and returns it. `.default(x)` also parses
 * `undefined` — and returns `x`, which is why the returned value is checked
 * rather than merely the success. A required field fails outright.
 */
function isOmittable(field: z.ZodType): boolean {
  const probe = field.safeParse(undefined);
  return probe.success && probe.data === undefined;
}

export function clearableShape<S extends z.ZodRawShape>(shape: S): Clearable<S> {
  const entries = Object.entries(shape).map(([key, field]) => {
    const typed = field as z.ZodType;
    return [key, isOmittable(typed) ? typed.nullable() : typed];
  });

  return Object.fromEntries(entries) as Clearable<S>;
}

/**
 * The update schema for an entity, built from its create shape.
 *
 * `.partial()` because an update names only what changed; `.strict()` because a
 * key nobody modelled is a client bug and should be loud. Both were already
 * true of every update schema in this package — the clearable step is what is
 * new, and going through one function is what keeps a new entity from quietly
 * arriving without it.
 */
export function updateSchemaOf<S extends z.ZodRawShape>(
  shape: S,
): z.ZodObject<{ [K in keyof Clearable<S>]: z.ZodOptional<Clearable<S>[K]> }, z.core.$strict> {
  return z.object(clearableShape(shape)).partial().strict();
}

/**
 * The same shape as a merged record on disk: every field optional, none of them
 * clearable.
 *
 * **A stored record never holds a clear marker**, and this is the type that
 * says so. `db/project.ts` removes a cleared key rather than writing a null
 * into it, and the server `$unset`s it, so what a reader meets is a record with
 * the field or a record without it — never one with a null in it.
 *
 * Readers used to borrow the update schema for this, which was true when the
 * two were the same object and stopped being true the moment updates learned to
 * carry nulls. Borrowing it now would widen every reader's types with a value
 * that cannot reach them, and the first thing anybody would do about that is
 * write a null check that can never fire.
 */
export function mergedSchemaOf<S extends z.ZodRawShape>(
  shape: S,
): z.ZodObject<{ [K in keyof S]: z.ZodOptional<S[K]> }, z.core.$strict> {
  return z.object(shape).partial().strict();
}

export interface ClearSplit {
  /** Fields carrying a new value. */
  set: Record<string, unknown>;
  /** Field names to remove. Empty is the ordinary case. */
  clear: string[];
}

/**
 * Splits an update payload into what it sets and what it removes.
 *
 * One function for both sides on purpose. The server turns this into
 * `$set`/`$unset` and the client into a merge-then-delete, and if the two ever
 * disagreed about which keys were being cleared the difference would show up
 * only after a reinstall — the same argument `db/project.ts` makes for sharing
 * a projection between enqueue and hydration.
 */
export function partitionClears(payload: Record<string, unknown>): ClearSplit {
  const set: Record<string, unknown> = {};
  const clear: string[] = [];

  for (const [key, value] of Object.entries(payload)) {
    if (value === null) clear.push(key);
    else set[key] = value;
  }

  return { set, clear };
}
