import type { ProjectionDecision } from './projections';

/**
 * What the log says happened to a mutation, and which of those replicate.
 *
 * The `mutations` collection carries three meanings at once — the audit log,
 * the thing that decides domain state, and the replication feed — and they are
 * not the same set of rows. A refused command belongs in the first and must
 * stay out of the third: it was attempted, it was correctly denied, and a
 * second device replaying it would invent state the server rejected.
 *
 * This module owns the vocabulary for that distinction. It is deliberately the
 * projection's OWN decision kind rather than a parallel enum, plus `pending`
 * for "logged, not decided yet" — inventing a second vocabulary here is how
 * the wire status and the log outcome drift apart, and `MutationResult` is a
 * contract that cannot absorb a new value without breaking every client
 * (see P1-1).
 */

/**
 * Stamped with the envelope, before `project()` has decided anything.
 *
 * The whole reason the field is written on insert rather than after the
 * projection: a row that carries no outcome is ambiguous — applied and
 * unstamped, or refused and unstamped — and the two need opposite treatment in
 * the feed. `pending` means precisely one thing, and it self-heals, because the
 * client that never got a response resends and the duplicate branch re-projects
 * from the stored envelope.
 */
export const PENDING = 'pending';

/**
 * Looked at, and this build could not read it back.
 *
 * **Not a projection decision**, which is why it is here rather than in
 * `ProjectionDecision`: nothing was projected, and nothing was refused. The
 * envelope on disk no longer parses — a schema tightened under it — or the log
 * row names no author this build can use. It is the server failing to read its
 * own record, and an operator reading the log should be able to tell that from
 * a refusal the server issued on purpose.
 *
 * **Decided for the feed, unsettled for the sweeper**, and it has to be both.
 * `sweepOne` used to leave these rows `pending` on purpose, so a newer build
 * could read them — and `readSnapshotPage` *stops* at a `pending` row rather
 * than skipping it, so one row a schema tightening made unreadable was a
 * permanent full stop for every device on that farm, while each client was
 * told `duplicate`, cleared its outbox row, and reported itself up to date.
 * The intent was right and the state was wrong: the feed has to move past it,
 * and a later build still has to be allowed to decide it properly.
 */
export const UNREADABLE = 'unreadable';

export type StoredOutcome =
  | ProjectionDecision['kind']
  | typeof PENDING
  | typeof UNREADABLE;

/**
 * Every outcome, classified exactly once.
 *
 * A `Record` rather than two arrays because the compiler then REQUIRES a
 * decision for each: adding a kind to `ProjectionDecision` without classifying
 * it here fails `pnpm typecheck`, and so does classifying one that does not
 * exist. An exclusion filter fails open by default — this is what converts that
 * into a compile-time guarantee rather than a thing somebody remembers.
 */
const REPLICATES: Record<StoredOutcome, boolean> = {
  // Changed the projection, so another device has to replay it to agree.
  insert: true,
  update: true,
  archive: true,

  // Never touched the projection. `noop` is a replay that was already in the
  // desired state; `conflict` and `rejected` are refusals the server issued on
  // purpose; `pending` has not been decided.
  noop: false,
  conflict: false,
  rejected: false,
  [PENDING]: false,
  // Nothing was read, so there is nothing to replay. Withheld, and — unlike
  // `pending` — moved past rather than stopped at.
  [UNREADABLE]: false,
};

export const OUTCOMES = Object.keys(REPLICATES) as StoredOutcome[];

/**
 * Every outcome that is final — the ones `stampOutcome` must never overwrite.
 *
 * The complement is `pending`, `unreadable`, a null, and a field that was never
 * written, and matching it by exclusion is how one filter covers all four
 * without naming the two that are not values.
 *
 * **`unreadable` is in the complement deliberately.** It is a decision as far
 * as the feed is concerned — the page moves past it — and not a decision as
 * far as the sweeper is concerned, because the whole reason for recording it
 * rather than refusing outright is that a later build may be able to read the
 * envelope and decide it properly. A row this build cannot parse is a statement
 * about this build.
 *
 * It was `DECIDED_OUTCOMES`, and the rename is the point: "decided" is the
 * question the feed asks, "final" is the question this answers, and they gave
 * the same answer only while `unreadable` did not exist.
 */
export const FINAL_OUTCOMES = OUTCOMES.filter((o) => o !== PENDING && o !== UNREADABLE);

/** Exported for the feed's own test, which asserts the split is total. */
export const REPLICATED_OUTCOMES = OUTCOMES.filter((o) => REPLICATES[o]);
export const WITHHELD_OUTCOMES = OUTCOMES.filter((o) => !REPLICATES[o]);

export function isStoredOutcome(raw: unknown): raw is StoredOutcome {
  return typeof raw === 'string' && Object.prototype.hasOwnProperty.call(REPLICATES, raw);
}

/**
 * Whether a logged row belongs in the replication feed.
 *
 * Reads `unknown` because this is a database boundary (invariant 11): the value
 * is whatever is on disk, not whatever the type says.
 *
 * **A missing field replicates, and that is why no backfill is needed.** Rows
 * written before this field existed were written when every logged row shipped,
 * so letting them through is current behaviour rather than a regression.
 * Excluding them instead would drop a farm's entire history from every new
 * device — the one migration decision here that cannot be taken back.
 *
 * An outcome this build does not recognise is withheld rather than shipped. It
 * can only come from a newer deploy that has since been rolled back, and the
 * safe direction for a row we cannot classify is the one that does not write
 * unexplained state onto somebody's phone.
 */
export function shouldReplicate(raw: unknown): boolean {
  if (raw === undefined || raw === null) return true;
  if (!isStoredOutcome(raw)) return false;
  return REPLICATES[raw];
}

/**
 * Whether a withheld row might still become a replicating one.
 *
 * **The distinction the feed was missing.** `readSnapshotPage` skips three
 * kinds of row and used to advance the watermark past all three alike, with the
 * reasoning written on it: a query filter *"would leave the cursor parked
 * before a run of refused rows and rescan them on every pull"*. That is right
 * for two of the three. A refusal is a decision the server has taken and will
 * not retake, and an entity this build cannot model is one it will never model,
 * so skipping either is permanent and moving past it loses nothing.
 *
 * `pending` is the one that changes its mind. It means *logged, not decided
 * yet*, and the sweeper exists precisely to decide it later — so a watermark
 * that moved past it has moved past a row that is about to start replicating,
 * and a cursor never looks back. The record is then repaired on the server and
 * reaches no other device on the farm, for ever, which is the exact harm P0-2's
 * last box was closing.
 *
 * An outcome this build does not recognise is deliberately NOT undecided. It
 * can only come from a newer deploy that has since been rolled back, and
 * treating it as pending would stall a farm's feed behind a row this build will
 * never be able to classify. Withheld and moved past, as before.
 *
 * `unreadable` is not undecided either, for that same reason applied to this
 * build's own failure: the sweeper may come back to it on a newer build, but a
 * farm's whole feed must not wait behind a row nobody can currently read. See
 * `UNREADABLE`.
 */
export function isUndecided(raw: unknown): boolean {
  return raw === PENDING;
}

/**
 * Whether a stored outcome may still be replaced by a real decision.
 *
 * **The third question, and leaving it out made the second half of the
 * `unreadable` fix inert.** `replayFromLog` treats anything that is not
 * absent, null or `pending` as decided, and stamping `unreadable` therefore
 * put the row beyond every path that could ever re-decide it: the sweeper's
 * later pass selected the row and then walked straight past it, so the "a
 * newer build can read this" half — the whole reason for recording the state
 * rather than refusing outright — never happened. Found by CI, on a test
 * written for exactly that behaviour.
 *
 * Not `!FINAL_OUTCOMES.includes(raw)`, which would also be true of an outcome
 * from a newer deploy this build cannot name. Those are deliberately left
 * alone rather than re-decided by an older applier, and that is a different
 * answer to a question that only looks the same.
 */
export function isOpenToDecision(raw: unknown): boolean {
  return raw === undefined || raw === null || raw === PENDING || raw === UNREADABLE;
}

/**
 * What may be written onto a log row: what the projection decided, or that the
 * row could not be read at all. The second is not a projection outcome and
 * `ProjectionDecision` should not learn to pretend it is.
 */
export type StampedOutcome =
  | ProjectionDecision
  | { kind: typeof UNREADABLE; reason: string };
