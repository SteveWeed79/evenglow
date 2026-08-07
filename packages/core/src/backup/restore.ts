import {
  type BackupEntry,
  type BackupFile,
  backupFileSchema,
  backupRefusal,
  ENTITIES,
  isOpAllowed,
} from '@steading/contracts';
import { StorageFullError } from '../db/errors';
import { recordKey } from '../db/records';
import { localStore } from '../db/store';
import { enqueue } from '../sync/queue';

/**
 * Putting a backup back, and the rules that make it safe.
 *
 * ## One rule does all the work
 *
 * **A restore writes every record the file has and the device does not, and
 * refuses outright if the device holds any record the file does not.**
 *
 * That single sentence covers every case worth covering:
 *
 * - *A fresh install.* Nothing on the device, so everything is written.
 * - *A restore that was interrupted* — the app was killed, the battery went,
 *   the disk filled. Everything already there came from this file, so it is
 *   skipped and the rest goes in. Resuming is the same act as starting.
 * - *The same file twice.* Every entry is already there; nothing happens.
 * - *A farm that is already keeping records.* One record the file does not
 *   have is enough, and it refuses. This is the merge that `docs/ROADMAP.md`
 *   refuses CSV import over, and it is refused here for the same reason:
 *   there are no conflict rules that would be right.
 *
 * There is no flag anywhere saying "a restore is in progress". A stored flag
 * would have to survive the process death it exists to describe, and it can
 * disagree with the records — which is the drift the due engine refuses a
 * completion flag over. The records answer the question by themselves.
 *
 * ## Through `enqueue`, never around it
 *
 * Every entry becomes a real mutation. That is invariant 5 for free — the
 * projection write and the outbox row land in one transaction, per record —
 * and it is invariant 11 for free too, because `enqueue` parses each payload
 * against the same schema the server will use.
 *
 * It also means a restored farm that later signs up flushes with the original
 * ULIDs (D1), so its records arrive as the records they were rather than as
 * copies. And it is idempotent all the way to the server: a `create` at a
 * targetId that already exists is a `noop` in `sync/projections.ts`, so a farm
 * that restores a backup of records the server already holds does not double
 * them.
 *
 * The cost is one SQLite transaction per record. A restore is a deliberate,
 * once-in-the-life-of-a-handset act with a count on screen, so paying it is
 * right — a batch write would need a new port method whose whole purpose was
 * to weaken the guarantee above.
 */

export type RestorePlan =
  | {
      ok: true;
      /** Entries not already on the device, parents before children. */
      toWrite: BackupEntry[];
      /** Entries the device already has. Non-zero means this is a resume. */
      alreadyThere: number;
      /** When the file was written. Becomes this device's last-copy date. */
      writtenAt: number;
    }
  | { ok: false; message: string };

export interface RestoreConditions {
  /**
   * Whether this device holds a session.
   *
   * Required rather than optional, and read by the caller rather than here,
   * because `packages/core` has no business knowing where a token lives — but
   * a default would let a caller forget it, and forgetting it is the one
   * mistake that matters. See `planRestore` for what it guards.
   */
  signedIn: boolean;
}

/**
 * The order entries are written in.
 *
 * Today nothing depends on it: `records` has no foreign keys, and no server
 * applier checks that a `flockId` names a flock that exists
 * (`sync/projections.ts` looks only at whether the target already exists). So
 * this is not fixing a bug — it is removing a class of one, because the
 * referential correctness of a restore currently rests on the absence of a
 * check rather than on the order being right, and the first applier that
 * validates a parent would break every restore retroactively.
 *
 * Anything not named here follows, in the contract's own order. Costs one
 * sort over a list that is already in hand.
 */
const PARENTS_FIRST: readonly string[] = [
  'site',
  'bed',
  'variety',
  'flock',
  'animal',
  'equipment',
  'planting',
  'incubation',
];

export interface RestoreProgress {
  done: number;
  total: number;
}

export interface RestoreResult {
  written: number;
  /** Entries the file held that this app could not write, with the first reason. */
  refused: number;
  firstRefusal: string | null;
}

/**
 * Parses text off a filesystem into a file, or says why not.
 *
 * External data of the most hostile kind — it has been in a messaging app and
 * possibly through a text editor — so nothing here trusts anything
 * (invariant 11). A `JSON.parse` throw and a shape mismatch get the same
 * plain sentence, because to the person holding the phone they are the same
 * event: this is not the file.
 */
export function readBackup(text: string): { ok: true; file: BackupFile } | { ok: false; message: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: 'That file is not a Steading backup.' };
  }

  const parsed = backupFileSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: 'That file is not a Steading backup.' };
  }

  const refusal = backupRefusal(parsed.data);
  if (refusal !== null) return { ok: false, message: refusal };

  return { ok: true, file: parsed.data };
}

/**
 * What a restore would do, without doing any of it.
 *
 * Separate from running it so the screen can say how many records are about to
 * arrive before anybody commits to it. The read is the same either way, so
 * this costs nothing over checking inside the write.
 */
export async function planRestore(
  file: BackupFile,
  conditions: RestoreConditions,
): Promise<RestorePlan> {
  /**
   * Never onto a device that is signed in, and this is not a nicety.
   *
   * A signed-in device's queue flushes under the org in its token (invariant
   * 2), so restoring a file into a farm somebody is signed in to would push
   * one farm's records onto another farm's server — and a freshly signed-in
   * handset that has not pulled yet has an empty store, so the emptiness rule
   * below would have let it through.
   *
   * It is also the right answer for the person: a farm with an account should
   * sign in, which brings back everything including whatever was logged after
   * the file was written, and keeps doing it.
   */
  if (conditions.signedIn) {
    return {
      ok: false,
      message:
        'This phone is signed in to a farm. Signing in already brings the records back — a backup file is only for a phone with no account.',
    };
  }

  const store = localStore();
  const wanted = new Set(file.entries.map((e) => recordKey(e.entity, e.targetId)));

  /**
   * Every entity, not only the ones the file mentions.
   *
   * A backup holding no machines put back on a handset with three machines on
   * it is still two farms being mixed, and looking only at the entities in the
   * file would miss it entirely — which is the quiet version of exactly the
   * corruption this refuses to do.
   */
  const here = new Set<string>();
  for (const entity of ENTITIES) {
    for (const record of await store.readRecordsByEntity(entity)) {
      const key = recordKey(entity, record.targetId);
      if (!wanted.has(key)) {
        return {
          ok: false,
          message:
            'This phone already keeps records of its own. A backup can only go onto a phone with an empty farm.',
        };
      }
      here.add(key);
    }
  }

  const rank = (entity: string): number => {
    const at = PARENTS_FIRST.indexOf(entity);
    return at === -1 ? PARENTS_FIRST.length : at;
  };

  const toWrite = file.entries
    .filter((e) => !here.has(recordKey(e.entity, e.targetId)))
    // Stable within a rank: the file is already oldest-first, and a sort that
    // reshuffled equal ranks would make a resume write them in a new order
    // every time for no reason.
    .sort((a, b) => rank(a.entity) - rank(b.entity));

  return {
    ok: true,
    toWrite,
    alreadyThere: file.entries.length - toWrite.length,
    writtenAt: file.writtenAt,
  };
}

/**
 * Writes the plan.
 *
 * Failures are counted rather than thrown, with one exception: a full disk
 * stops everything, because every remaining record would fail the same way and
 * a thousand identical refusals is not a report. Everything else — a payload
 * this version cannot read, an op an entity does not allow — is one record
 * lost out of many, and stopping the restore over it would cost the farm the
 * rest.
 */
export async function runRestore(
  plan: Extract<RestorePlan, { ok: true }>,
  onProgress?: (progress: RestoreProgress) => void,
): Promise<RestoreResult> {
  const total = plan.toWrite.length;
  let written = 0;
  let refused = 0;
  let firstRefusal: string | null = null;

  for (const [index, entry] of plan.toWrite.entries()) {
    try {
      await enqueue({
        entity: entry.entity,
        op: 'create',
        targetId: entry.targetId,
        payload: entry.payload,
      });

      /**
       * An archived record comes back archived.
       *
       * Records are archived and never deleted (P13), so a retired group is
       * still history and its logs still name it. A restore that brought it
       * back live would resurrect something somebody deliberately put away —
       * on every screen at once, on the morning they set the new phone up.
       *
       * Two mutations rather than a flag on the create, because "archived" is
       * not a field any create schema has. It is the outcome of a delete, and
       * the delete is what produces it.
       */
      if (entry.archived === true && isOpAllowed(entry.entity, 'delete')) {
        await enqueue({
          entity: entry.entity,
          op: 'delete',
          targetId: entry.targetId,
          // No reason: the original one is not in the projection to carry
          // (`db/project.ts` keeps the record's value, not the delete's), and
          // inventing one would put words in somebody's mouth.
          payload: {},
        });
      }

      written += 1;
    } catch (error) {
      if (error instanceof StorageFullError) throw error;
      refused += 1;
      if (firstRefusal === null) {
        firstRefusal = error instanceof Error ? error.message : 'That record could not be read.';
      }
    }

    onProgress?.({ done: index + 1, total });
  }

  /**
   * The file this came from is a copy of these records, so this device has
   * one — dated when it was written rather than now.
   *
   * Without it a phone that has just put 1,500 records back meets the exposure
   * notice on its first morning, telling it its records exist nowhere else
   * while the file they came out of is sitting in somebody's email. That is
   * the app arguing with something it watched happen.
   *
   * `writtenAt` and not `Date.now()`, because the claim being recorded is
   * "a copy of these records exists, made then". Stamping today would give a
   * two-year-old backup a fresh ninety days.
   */
  if (written > 0) await localStore().setLastBackupAt(plan.writtenAt);

  return { written, refused, firstRefusal };
}
