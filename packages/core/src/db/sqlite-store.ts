import {
  MUTATION_SCHEMA_VERSION,
  type MutationResult,
  mutationSchema,
  newId,
  type PulledMutation,
  type SyncRefusal,
} from '@homefarm/contracts';
import type { SqlDriver, SqlOps, SqlValue } from './driver';
import type { StoredTicket } from './port';
import { InvalidMutationError, StorageFullError } from './errors';
import { migrate } from './migrations';
import { migrateEnvelope } from './migrate';
import { nextRecordValue } from './project';
import type {
  CachedForecast,
  CachedAlerts,
  CachedObservation,
  EnqueueRequest,
  IntegrityReport,
  LocalStore,
  PullResult,
  QueueCounts,
  SnapshotWatermark,
} from './port';
import {
  type LocalRecord,
  META,
  parseMeta,
  PROJECTION_REPAIR,
  type QueuedMutation,
  type Quarantined,
  quarantinedSchema,
  queuedMutationSchema,
  localRecordSchema,
  recordKey,
} from './schema';

/**
 * `LocalStore` on SQLite (D9).
 *
 * Written against `SqlDriver`, so the same code runs on the Capacitor plugin
 * on device and on `node:sqlite` under test. Correct exactly when it passes
 * the same suite as the IndexedDB engine — that is the whole reason `port.ts`
 * exists, and why the old engine is not deleted until it has.
 */


/** SQLite reports a full disk and a full database differently. Both are full. */
function isFullError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /SQLITE_FULL|database or disk is full|disk I\/O error/i.test(text);
}

interface OutboxRow {
  id: string;
  schemaVersion: number;
  targetId: string;
  entity: string;
  op: string;
  payload: string;
  deviceId: string;
  clientSeq: number;
  clientTs: number;
  status: string;
  attempts: number;
  enqueuedAt: number;
  lastError: string | null;
  rejectedReason: string | null;
  rejectedAt: number | null;
}

interface RecordRow {
  key: string;
  entity: string;
  targetId: string;
  value: string;
  updatedAt: number;
  deleted: number;
}

/**
 * A JSON column read back, or the fact that it could not be.
 *
 * **The distinction has to be representable, and it was not.** `readJson`
 * answered an unparseable column with `undefined`, and both row mappers put
 * that answer under a key the schema declares `z.unknown()` — which accepts a
 * key that is *present and undefined*, and only rejects one that is absent. So
 * `queuedMutationSchema.safeParse` succeeded on a row whose payload text was
 * corrupt, the quarantine below was never reached, and `toEnvelope` copied the
 * `undefined` through to `JSON.stringify`, which drops the key entirely.
 *
 * The wire object then had no `payload` at all. The server parses a batch as a
 * unit, so it answered 400 for all of it, and the client's unreadable-response
 * branch eventually marked **every mutation in that batch — up to a hundred
 * good ones — rejected.** One corrupt byte on disk, and a farm's morning is in
 * the inbox.
 *
 * Absent and undefined being different to Zod but identical to
 * `JSON.stringify` is what made it invisible; a shape that cannot express
 * "unreadable" is what let it happen.
 */
type JsonRead = { ok: true; value: unknown } | { ok: false };

function tryReadJson(text: string): JsonRead {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/**
 * The lenient form, for the callers where unreadable genuinely means absent:
 * `meta`, whose keys each fall back to a default, and the previous value in an
 * update merge. Neither has a quarantine to take, and neither is a row a
 * schema is about to be asked to vouch for.
 */
function readJson(text: string): unknown {
  const read = tryReadJson(text);
  return read.ok ? read.value : undefined;
}

/**
 * A row mapped for parsing, or the reason it cannot be.
 *
 * `raw` is the row as it sits on disk — corrupt column and all — because that
 * is what a quarantined row is worth keeping: the mapped object would have the
 * unreadable column silently missing, which is the very thing that hid this.
 */
type Mapped =
  | { ok: true; value: unknown }
  | { ok: false; raw: unknown; reason: string };

function rowToMutation(row: OutboxRow): Mapped {
  const payload = tryReadJson(row.payload);
  if (!payload.ok) {
    return { ok: false, raw: { ...row }, reason: 'payload is not readable JSON' };
  }

  return {
    ok: true,
    value: {
      schemaVersion: row.schemaVersion,
      id: row.id,
      targetId: row.targetId,
      entity: row.entity,
      op: row.op,
      payload: payload.value,
      deviceId: row.deviceId,
      clientSeq: row.clientSeq,
      clientTs: row.clientTs,
      status: row.status,
      attempts: row.attempts,
      enqueuedAt: row.enqueuedAt,
      ...(row.lastError === null ? {} : { lastError: row.lastError }),
      ...(row.rejectedReason === null ? {} : { rejectedReason: row.rejectedReason }),
      ...(row.rejectedAt === null ? {} : { rejectedAt: row.rejectedAt }),
    },
  };
}

function rowToRecord(row: RecordRow): Mapped {
  const value = tryReadJson(row.value);
  if (!value.ok) {
    return { ok: false, raw: { ...row }, reason: 'value is not readable JSON' };
  }

  return {
    ok: true,
    value: {
      key: row.key,
      entity: row.entity,
      targetId: row.targetId,
      value: value.value,
      updatedAt: row.updatedAt,
      deleted: row.deleted === 1,
    },
  };
}

/**
 * What the store needs from the platform that it cannot get itself.
 *
 * One entry so far, and it earns the shape: `deviceId` is declared `z.uuid()`
 * by `schema.ts` and by the mutation envelope, so a ULID will not do.
 */
export interface StoreDeps {
  /**
   * A v4 UUID for this device.
   *
   * Handed in rather than taken from a global, and this is the bug that made
   * the rule. `enqueue` called bare `crypto.randomUUID()`. Node has that
   * global; React Native does not, and Expo's runtime polyfills `fetch`,
   * `URL`, `TextDecoder`, `FormData` and `AbortSignal` — not `crypto`. On a
   * handset the line was a ReferenceError.
   *
   * The shape of the failure is what made it so hard to see. It sat in the
   * `deviceId === undefined` branch, which runs on the FIRST enqueue ever. The
   * throw rolled the transaction back, so the id was never persisted — so the
   * next save took the identical branch and failed identically, forever.
   * Every write on the device, from the first one, with ~900 tests green over
   * a line that cannot execute there.
   */
  randomUUID: () => string;
}

/**
 * No default, and that is the fix rather than an inconvenience.
 *
 * It used to default to `crypto.randomUUID()`, on the reasoning that Node and
 * the browser both have it and only the handset does not. That reasoning is
 * exactly backwards: **the platform that lacks it is the only one that ships
 * to a farm.** The default meant every test took a path the device could not,
 * and the app worked everywhere except where it mattered.
 *
 * Requiring it costs each caller one line and buys the guarantee that nobody
 * can reach a Node-only global by forgetting to look. `apps/mobile/src/db/`
 * passes `expo-crypto`; the tests pass Node's.
 */
export async function openSqliteStore(
  driver: SqlDriver,
  deps: StoreDeps,
): Promise<LocalStore> {
  await migrate(driver);

  // ── support tickets ────────────────────────────────────────────────────────

  /** The row as SQLite hands it back: nullable columns are null, not absent. */
  interface TicketRow {
    id: string;
    at: number;
    fingerprint: string;
    bundle: string;
    records: string | null;
    attempts: number;
    lastError: string | null;
    sentAt: number | null;
    url: string | null;
  }

  /**
   * Null becomes absent, because `exactOptionalPropertyTypes` is on and the
   * port says these fields are optional rather than nullable — a distinction
   * the rest of the codebase keeps and this is not the place to break it.
   */
  function toTicket(row: TicketRow): StoredTicket {
    return {
      id: row.id,
      at: row.at,
      fingerprint: row.fingerprint,
      bundle: row.bundle,
      attempts: row.attempts,
      ...(row.records === null ? {} : { records: row.records }),
      ...(row.lastError === null ? {} : { lastError: row.lastError }),
      ...(row.sentAt === null ? {} : { sentAt: row.sentAt }),
      ...(row.url === null ? {} : { url: row.url }),
    };
  }

  // ── meta ───────────────────────────────────────────────────────────────────

  /**
   * Every helper below takes the handle to run on rather than closing over
   * `driver`.
   *
   * That is the whole discipline of the fix. A transaction body is handed its
   * own `SqlOps`, and a helper that reached past it to `driver` would queue
   * behind the transaction that is waiting for it. Making the handle a
   * parameter means the mistake is visible at the call site instead of being
   * invisible in a closure.
   */
  async function readMeta<K extends keyof typeof import('./schema').metaSchemas>(
    db: SqlOps,
    key: K,
  ): Promise<unknown> {
    const row = await db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
    return row === undefined ? undefined : readJson(row.value);
  }

  async function writeMeta(db: SqlOps, key: string, value: unknown): Promise<void> {
    await db.run(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, JSON.stringify(value)],
    );
  }

  async function bumpCleared(db: SqlOps, by: number): Promise<void> {
    const current = parseMeta('clearedCount', await readMeta(db, 'clearedCount')) ?? 0;
    await writeMeta(db, META.clearedCount, current + by);
  }

  // ── quarantine ─────────────────────────────────────────────────────────────

  async function quarantine(
    db: SqlOps,
    store: string,
    key: string,
    raw: unknown,
    reason: string,
  ): Promise<void> {
    // Composite key, matching the IndexedDB engine. An outbox id and a record
    // key are drawn from different spaces and could otherwise collide here,
    // and a quarantine that overwrites a quarantined row defeats the point of
    // keeping the raw value at all.
    await db.run(
      `INSERT INTO quarantine (key, store, raw, reason, quarantinedAt)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET raw = excluded.raw, reason = excluded.reason`,
      [`${store}:${key}`, store, JSON.stringify(raw ?? null), reason, Date.now()],
    );
  }

  // ── the projection ─────────────────────────────────────────────────────────

  /**
   * Writes one mutation's effect onto the local record.
   *
   * Shared by enqueue and by hydration on purpose. They used to hold two
   * copies of the same INSERT … ON CONFLICT, which is how they came to share a
   * bug — both replaced the whole value on an update, while the server merged.
   * One function means a device's own writes and the same writes arriving back
   * from the server cannot disagree.
   *
   * **Called only from inside a transaction.** The read of the previous value
   * and the write that depends on it are not atomic on their own, and enqueue
   * has to be one unit anyway (invariant 5).
   */
  async function projectOne(
    db: SqlOps,
    entity: string,
    targetId: string,
    op: 'create' | 'update' | 'delete',
    payload: unknown,
    updatedAt: number,
    /**
     * The repair generation to stamp, when this write came from the server.
     *
     * Left undefined by enqueue, and that is the distinction the sweep needs:
     * a row this device wrote optimistically has an outbox row vouching for it,
     * so it does not need a stamp and must not get one it has not earned.
     */
    gen?: number,
  ): Promise<void> {
    const key = recordKey(entity, targetId);

    let previous: unknown;
    if (op !== 'create') {
      const row = await db.get<{ value: string }>(
        'SELECT value FROM records WHERE key = ?',
        [key],
      );
      previous = row === undefined ? undefined : readJson(row.value);
    }

    await db.run(
      `INSERT INTO records (key, entity, targetId, value, updatedAt, deleted)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value, updatedAt = excluded.updatedAt, deleted = excluded.deleted`,
      [
        key,
        entity,
        targetId,
        JSON.stringify(nextRecordValue(op, previous, payload) ?? null),
        updatedAt,
        op === 'delete' ? 1 : 0,
      ],
    );

    // Marked in the same transaction as the row it vouches for, or a crash
    // between the two leaves a repaired record looking like an orphan.
    if (gen !== undefined) {
      await db.run(
        `INSERT INTO record_gen (key, gen) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET gen = excluded.gen`,
        [key, gen],
      );
    }
  }

  /**
   * Whether this device still owes the projection repair `PROJECTION_REPAIR`
   * describes. Read inside the caller's transaction, never cached — the answer
   * changes exactly once and a stale `true` would replay a farm's history for
   * nothing.
   */
  async function repairInProgress(db: SqlOps): Promise<boolean> {
    const done = parseMeta('repairDone', await readMeta(db, 'repairDone')) ?? 0;
    return done < PROJECTION_REPAIR;
  }

  /**
   * Removes a record that only ever existed because of a create the server
   * refused.
   *
   * **A rejected mutation is not a resolved one, and until this the projection
   * could not tell the difference.** Enqueue writes the record optimistically —
   * correctly, that is the whole point of offline-first — but nothing ever took
   * it back. Marking the outbox row `rejected` and later discarding it left the
   * record exactly where the optimistic write put it, and no later pull could
   * repair it: hydration only overwrites a target the server has a mutation
   * for, and for a create the server refused there is no such mutation and
   * never will be. So a Farm Hand whose group was refused on the role check
   * kept that group in their list for good, and could go on logging egg tallies
   * against a record no other device had ever heard of.
   *
   * It is the mirror of the server-side outcome filter: that one stops a
   * refused command reaching OTHER devices, and this one stops it staying on
   * the device that issued it. No server change reaches this half.
   *
   * **Only a create, and only unconfirmed.** A create is the one op whose
   * target owes its whole local existence to this device — the ULID is minted
   * here, so nothing else can have put that record on this phone. An update or
   * a delete lands on a record that may have arrived from another device by
   * pull, and reverting those needs a base value this table does not keep; see
   * the note in `docs/SYNC-INTEGRITY-TODO.md` under N-1. An `applied` row for
   * the same target means the server accepted something for it after all, so
   * the record is real and stays.
   */
  async function dropRefusedCreate(db: SqlOps, entity: string, targetId: string): Promise<void> {
    const confirmed = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM outbox WHERE targetId = ? AND status = 'applied'",
      [targetId],
    );
    if ((confirmed?.n ?? 0) > 0) return;

    await db.run('DELETE FROM records WHERE key = ?', [recordKey(entity, targetId)]);
  }

  /** The record as it stands, or nothing, for the undo table. */
  interface UndoRow {
    mutationId: string;
    key: string;
    existed: number;
    value: string | null;
    updatedAt: number | null;
    deleted: number | null;
    after: number;
  }

  /**
   * Remembers what a record looked like before a local `update` or `delete`.
   *
   * Only for those two ops: a `create` is taken back by `dropRefusedCreate`,
   * which needs no pre-image because the target owes its whole local existence
   * to this device.
   *
   * `existed` is kept separately from a null `value`, because "there was no
   * record" and "there was a record whose value is null" are different states
   * and restoring the wrong one is how a row nobody asked for appears.
   */
  async function rememberBefore(
    db: SqlOps,
    mutationId: string,
    key: string,
    after: number,
  ): Promise<void> {
    const before = await db.get<RecordRow>('SELECT * FROM records WHERE key = ?', [key]);

    await db.run(
      `INSERT INTO record_undo (mutationId, key, existed, value, updatedAt, deleted, after)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(mutationId) DO NOTHING`,
      [
        mutationId,
        key,
        before === undefined ? 0 : 1,
        before?.value ?? null,
        before?.updatedAt ?? null,
        before?.deleted ?? null,
        after,
      ],
    );
  }

  /** Same value by content, for comparing one field against what was written. */
  function sameValue(a: unknown, b: unknown): boolean {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }

  /** A record's value as a bag of fields, or not one this can reason about. */
  function isFields(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  /**
   * Puts a record back the way a refused command found it.
   *
   * ## Per field, because the whole-record test threw the evidence away
   *
   * **This compared `updatedAt` against the value this device's optimistic
   * write produced, and skipped the restore entirely when it had moved** —
   * "newer wins", which is right whenever the newer write touched the same
   * field, and wrong the rest of the time. An `update` arriving from a pull
   * MERGES (`nextRecordValue`), so a second device editing `count` moves
   * `updatedAt` while leaving this device's refused `name` exactly where the
   * optimistic write put it.
   *
   * The discard then restored nothing **and deleted the pre-image anyway**, so
   * the record kept a value the server had refused, no other device had, and
   * nothing could ever repair. Permanent, silent, and on the record a farm
   * reads.
   *
   * So the question is asked per field instead: *is what this command wrote
   * still standing?* If it is, that field goes back to the pre-image. If it is
   * not, something newer has replaced it and is left alone — which is the same
   * "newer wins" rule, applied where it can actually tell.
   *
   * The two cases the old test conflated now separate cleanly. A record nothing
   * has touched has every written field still standing, so all of them revert:
   * the whole-record restore, unchanged. A record something has merged into
   * reverts only the residue.
   *
   * `updatedAt` is deliberately NOT moved. This removes a value that was never
   * real rather than making a new version, and bumping it would make the device
   * look newer than the server and suppress the pull that carries the truth.
   *
   * The pre-image is dropped either way. It describes a mutation that is no
   * longer in the outbox, and keeping it would leave the table growing a row
   * per discarded edit for ever.
   */
  async function restoreBefore(
    db: SqlOps,
    mutationId: string,
    refused: { op: string; payload: unknown },
  ): Promise<void> {
    const undo = await db.get<UndoRow>('SELECT * FROM record_undo WHERE mutationId = ?', [
      mutationId,
    ]);
    if (undo === undefined) return;

    await db.run('DELETE FROM record_undo WHERE mutationId = ?', [mutationId]);

    const now = await db.get<{ value: string; updatedAt: number; deleted: number }>(
      'SELECT value, updatedAt, deleted FROM records WHERE key = ?',
      [undo.key],
    );
    // Gone entirely. Nothing of the refused command is left to take back.
    if (now === undefined) return;

    /**
     * A refused `delete` set the flag and left the value alone, so the flag is
     * the only thing to ask about: still hidden means still this command's
     * doing, and a record somebody has since deleted for real stays deleted.
     */
    if (refused.op === 'delete') {
      if (now.deleted !== 1) return;
      await db.run('UPDATE records SET deleted = ? WHERE key = ?', [undo.deleted ?? 0, undo.key]);
      return;
    }

    const wrote = refused.payload;
    const current = readJson(now.value);
    // Either side unreadable means the question cannot be answered, and a
    // record left alone is the honest outcome — the same call `readJson`'s own
    // note makes about a merge's previous value.
    if (!isFields(wrote) || !isFields(current)) return;

    const before = undo.value === null ? {} : readJson(undo.value);
    const previous = isFields(before) ? before : {};

    const next: Record<string, unknown> = { ...current };
    let changed = false;

    for (const [field, written] of Object.entries(wrote)) {
      // `null` on the wire is a clear (`contracts/clearing.ts`), so what the
      // command produced for that field is its absence.
      const produced = written === null ? undefined : written;
      if (!sameValue(current[field], produced)) continue;

      const had = previous[field];
      if (had === undefined) delete next[field];
      else next[field] = had;
      changed = true;
    }

    if (!changed) return;

    /**
     * A record this device invented and nothing has since confirmed leaves
     * altogether — reverting its fields one by one would leave an empty object
     * where there should be no row. Only when nothing else has arrived: a
     * create landing from a pull fills the same key, and that record is real.
     */
    if (undo.existed === 0) {
      if (Object.keys(next).length === 0) await db.run('DELETE FROM records WHERE key = ?', [undo.key]);
      return;
    }

    await db.run('UPDATE records SET value = ? WHERE key = ?', [JSON.stringify(next), undo.key]);
  }

  /** A mutation that has left the outbox owns no pre-image. */
  async function forgetBefore(db: SqlOps, mutationIds: readonly string[]): Promise<void> {
    for (const id of mutationIds) {
      await db.run('DELETE FROM record_undo WHERE mutationId = ?', [id]);
    }
  }

  /**
   * One more answer that did not decide this mutation.
   *
   * **Separate from `attempts` because they measure different things and one
   * of them is a poison ceiling.** `attempts` counts deliveries that did not
   * land — a network failure, a 5xx, a week in a valley with no signal — and
   * a farm that spends a fortnight offline arrives at the ceiling having done
   * nothing wrong. Ripening the inbox on that number meant the first answer
   * the client could not read swept the whole batch, up to a hundred good
   * mutations, into the rejected inbox. A captive portal answering a JSON POST
   * with an HTML login page is enough.
   *
   * This counts only the answers the server actually gave that left the
   * mutation undecided — an unreadable body, or a well-formed one that omitted
   * it — which is the only evidence that resending will never work.
   *
   * Sparse: a row appears the first time it happens, so an ordinary outbox
   * carries none. It leaves with the mutation, in the same transaction, by
   * whichever door that mutation takes.
   */
  async function bumpUndecided(db: SqlOps, mutationIds: readonly string[]): Promise<void> {
    for (const id of mutationIds) {
      await db.run(
        `INSERT INTO outbox_unreadable (mutationId, answers) VALUES (?, 1)
         ON CONFLICT(mutationId) DO UPDATE SET answers = answers + 1`,
        [id],
      );
    }
  }

  /** The tally goes when the mutation it belongs to is decided or leaves. */
  async function forgetUndecided(db: SqlOps, mutationIds: readonly string[]): Promise<void> {
    for (const id of mutationIds) {
      await db.run('DELETE FROM outbox_unreadable WHERE mutationId = ?', [id]);
    }
  }

  /**
   * Every mutation in `requests`, in one transaction, or none of them.
   *
   * `enqueue` is this with a list of one. Written the other way round —
   * `enqueueAll` looping over `enqueue` — it would be one transaction per
   * mutation, which is the defect rather than the fix.
   */
  async function enqueueTransactionally(
    requests: readonly EnqueueRequest[],
  ): Promise<QueuedMutation[]> {
    if (requests.length === 0) return [];

    try {
      return await driver.transaction(async (tx) => {
        // A corrupt or missing deviceId is safe to replace: it only groups a
        // device's own mutations for ordering.
        let deviceId = parseMeta('deviceId', await readMeta(tx, 'deviceId'));
        if (deviceId === undefined) {
          deviceId = deps.randomUUID();
          await writeMeta(tx, META.deviceId, deviceId);
        }

        /**
         * A corrupt or missing counter is NOT safe to replace with zero —
         * that reuses sequence numbers and silently breaks ordering. Take the
         * highest seq still in the outbox as a floor, so monotonicity survives
         * losing the counter as long as the queue did.
         */
        const stored = parseMeta('nextClientSeq', await readMeta(tx, 'nextClientSeq')) ?? 0;
        const highest = await tx.get<{ seq: number | null }>(
          'SELECT MAX(clientSeq) AS seq FROM outbox',
        );
        const floor = highest?.seq === null || highest?.seq === undefined ? 0 : highest.seq + 1;
        let clientSeq = Math.max(stored, floor);

        const written: QueuedMutation[] = [];

        for (const request of requests) {
          const envelope = {
            schemaVersion: MUTATION_SCHEMA_VERSION,
            id: newId(),
            targetId: request.targetId,
            entity: request.entity,
            op: request.op,
            payload: request.payload,
            deviceId,
            clientSeq,
            clientTs: Date.now(), // recorded, never trusted for ordering (D6)
          };

          // Validated before it can reach storage, so a bug upstream cannot
          // create a malformed record.
          const checked = mutationSchema.safeParse(envelope);
          if (!checked.success) {
            throw new InvalidMutationError('Could not build a valid mutation.');
          }

          const queued: QueuedMutation = {
            ...checked.data,
            status: 'queued',
            attempts: 0,
            enqueuedAt: Date.now(),
          };

          await tx.run(
            `INSERT INTO outbox
               (id, schemaVersion, targetId, entity, op, payload, deviceId,
                clientSeq, clientTs, status, attempts, enqueuedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              queued.id,
              queued.schemaVersion,
              queued.targetId,
              queued.entity,
              queued.op,
              JSON.stringify(queued.payload ?? null),
              queued.deviceId,
              queued.clientSeq,
              queued.clientTs,
              queued.status,
              queued.attempts,
              queued.enqueuedAt,
            ],
          );

          /**
           * Projected inside the loop, not after it, because a later request
           * may depend on an earlier one's projection — a restore's `delete`
           * archives the record its own `create` has just made. Writing all
           * the rows first and projecting afterwards would work today and
           * break the first time somebody relied on the order.
           */
          const at = Date.now();

          // Before the projection, or there is nothing left to remember. Only
          // for the two ops whose refusal cannot be undone by deleting the row.
          if (request.op !== 'create') {
            await rememberBefore(tx, queued.id, recordKey(request.entity, request.targetId), at);
          }

          await projectOne(
            tx,
            request.entity,
            request.targetId,
            request.op,
            request.payload,
            at,
          );

          written.push(queued);
          clientSeq += 1;
        }

        await writeMeta(tx, META.nextClientSeq, clientSeq);

        return written;
      });
    } catch (error) {
      // The transaction aborts as a unit, so no sequence number is consumed
      // and nothing partial is left behind — for one mutation or for five.
      if (isFullError(error)) throw new StorageFullError();
      throw error;
    }
  }

  return {
    /**
     * ONE transaction: mint the sequence number, write the outbox row, advance
     * the counter, update the projection (invariant 5).
     *
     * Assigning clientSeq outside the transaction is the classic way to end up
     * with two mutations holding the same sequence number after a crash
     * mid-write, at which point ordering is quietly broken and nothing reports
     * it.
     */
    async enqueue(request: EnqueueRequest): Promise<QueuedMutation> {
      const [only] = await enqueueTransactionally([request]);
      // One request in, one mutation out. Checked rather than asserted with
      // `!`: an empty result would mean the mutation had gone quietly, which
      // is the one outcome this whole file exists to make impossible.
      if (only === undefined) throw new InvalidMutationError('Could not build a valid mutation.');
      return only;
    },

    enqueueAll: enqueueTransactionally,

    /**
     * Applied and duplicate leave the outbox and count as cleared; anything
     * else is marked rejected and KEPT (A6). A mutation absent from `results`
     * stays queued — resending is safe, so silence must never read as success.
     */
    async resolveBatch(batch, results): Promise<void> {
      const byId = new Map(results.map((r) => [r.id, r] as const));

      await driver.transaction(async (tx) => {
        let cleared = 0;

        for (const mutation of batch) {
          const result: MutationResult | undefined = byId.get(mutation.id);
          if (!result) {
            /**
             * Answered without mentioning it. Stays queued — resending is safe
             * — but it is counted so it cannot retry forever unseen.
             *
             * **Counted twice now, in two columns that mean different things.**
             * `attempts` goes on meaning "times this has been tried", which is
             * what the diagnostics sheet shows and what a farmer is reading
             * when they ask why a record is still waiting. `outbox_unreadable`
             * means "times the server answered and said nothing about this",
             * and it is the only one the poison ceiling ripens on — because a
             * week in a valley with no signal fills the first column and is
             * evidence of nothing at all.
             *
             * `attempts` is deliberately not reset here. It could be — an
             * answer proves the server was reached — but the number a
             * diagnostic wants is how often this has been tried, and zeroing
             * it would make a row that has been going nowhere for a fortnight
             * read as untouched.
             */
            await tx.run('UPDATE outbox SET attempts = attempts + 1 WHERE id = ?', [
              mutation.id,
            ]);
            await bumpUndecided(tx, [mutation.id]);
            continue;
          }

          if (result.status === 'applied' || result.status === 'duplicate') {
            /**
             * Marked, not deleted — hard invariant 7.
             *
             * This was a DELETE, which threw away the audit trail the
             * invariant exists to keep and left "it was sent" and "it never
             * existed" looking identical on a device. `clearedCount` still
             * counts it, so the integrity check is unchanged; what changes is
             * that the row survives to be counted against.
             *
             * Every reader that means "work still outstanding" filters this
             * status out — see `readOutboxBySeq`, `counts` and `applyPulled`.
             */
            await tx.run(
              'UPDATE outbox SET status = ?, lastError = NULL WHERE id = ?',
              ['applied', mutation.id],
            );
            // The server took it, so there is nothing left to undo. Kept for a
            // *rejected* row, because that one is still a decision the person
            // has not made — `retryRejected` may put it back on the wire.
            await forgetBefore(tx, [mutation.id]);
            await forgetUndecided(tx, [mutation.id]);
            cleared += 1;
            continue;
          }

          await tx.run(
            'UPDATE outbox SET status = ?, rejectedReason = ?, rejectedAt = ? WHERE id = ?',
            ['rejected', result.reason ?? 'The server refused that record.', Date.now(), mutation.id],
          );
          // Decided, so the count of answers that did not decide it is spent.
          // A `retryRejected` must start from nothing, not from the tally that
          // parked it.
          await forgetUndecided(tx, [mutation.id]);
        }

        if (cleared > 0) await bumpCleared(tx, cleared);
      });
    },

    async markSynced(at): Promise<void> {
      await driver.transaction(async (tx) => {
        await writeMeta(tx, META.lastSyncAt, at);
        await tx.run('DELETE FROM meta WHERE key = ?', [META.lastError]);
      });
    },

    async recordAttempt(batch, error): Promise<void> {
      await driver.transaction(async (tx) => {
        for (const mutation of batch) {
          await tx.run(
            'UPDATE outbox SET attempts = attempts + 1, lastError = ? WHERE id = ?',
            [error, mutation.id],
          );
        }
      });
    },

    async recordUndecided(batch): Promise<void> {
      await driver.transaction(async (tx) => {
        await bumpUndecided(tx, batch.map((mutation) => mutation.id));
      });
    },

    async rejectExhausted(batch, maxAnswers, reason): Promise<void> {
      await driver.transaction(async (tx) => {
        for (const mutation of batch) {
          await tx.run(
            `UPDATE outbox SET status = 'rejected', rejectedReason = ?, rejectedAt = ?
             WHERE id = ?
               AND (SELECT COALESCE(MAX(answers), 0) FROM outbox_unreadable
                    WHERE mutationId = outbox.id) >= ?`,
            [reason, Date.now(), mutation.id, maxAnswers],
          );
        }
      });
    },

    async listRejected(): Promise<QueuedMutation[]> {
      const rows = await driver.all<OutboxRow>(
        "SELECT * FROM outbox WHERE status = 'rejected' ORDER BY clientSeq",
      );
      /**
       * An unreadable row is left out rather than quarantined here: this is a
       * listing a screen is reading, and deleting rows out from under it is
       * `readOutboxBySeq`'s job — which covers `rejected` too, since it reads
       * everything that is not `applied`. So a corrupt rejected row is gone by
       * the next flush and visible in quarantine, not lost.
       */
      return rows
        .map((row) => rowToMutation(row))
        .flatMap((mapped) => (mapped.ok ? [queuedMutationSchema.safeParse(mapped.value)] : []))
        .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
    },

    /**
     * ── "Send it again" needs a new idempotency key ──────────────────────────
     *
     * **This kept the mutation's id, and that id is the server's idempotency
     * key — so the retry could not be decided afresh.** `sync/apply.ts` upserts
     * the envelope FIRST and stamps the outcome after, so any refusal reached
     * after the log write is stored against that id. A second send finds
     * `upsertedCount === 0`, `replayFromLog` answers `decided`, and
     * `decidedResult` returns the identical refusal — for ever, by design:
     * *"a refusal stays a refusal. Reporting `duplicate` instead would tell the
     * device its rejected-inbox entry had somehow been accepted."*
     *
     * That is right for a **replay** — a client resending because it never got
     * the answer — and wrong for this, which is not a replay. The two refusals
     * whose own messages tell the farmer to try again are the ones that could
     * never work: a mistyped hour meter reading, corrected and resent, and an
     * archived-record conflict reviewed and resent. Both arrive with a
     * `payload` the server has never seen, under a key that says it has.
     *
     * So a retry goes out as a new mutation. The server keeps the original and
     * its refusal, which is where that history belongs; this row carries on as
     * the same piece of work under a key that has not been decided.
     *
     * **`record_undo` moves with it.** The pre-image is keyed by mutation id and
     * is what `discardRejected` restores from — leaving it behind would mean a
     * retry that is refused again can no longer be undone, which is the failure
     * this fix exists to stop, one step later.
     *
     * `clientSeq` is deliberately unchanged. It is this device's ordering, and
     * the work still belongs where it was made: re-stamping it would move an
     * edit after mutations that were enqueued expecting to follow it.
     */
    async retryRejected(id, payload): Promise<void> {
      await driver.transaction(async (tx) => {
        if (payload !== undefined) {
          await tx.run('UPDATE outbox SET payload = ? WHERE id = ?', [
            JSON.stringify(payload),
            id,
          ]);
        }
        // A clean slate on both counters, or the retry inherits the ceiling
        // that parked it and is refused before it is sent. `attempts` was the
        // only one of the two before there were two.
        await forgetUndecided(tx, [id]);

        const fresh = newId();
        await tx.run('UPDATE record_undo SET mutationId = ? WHERE mutationId = ?', [fresh, id]);
        await tx.run(
          `UPDATE outbox SET id = ?, status = 'queued', attempts = 0,
             lastError = NULL, rejectedReason = NULL, rejectedAt = NULL
           WHERE id = ?`,
          [fresh, id],
        );
      });
    },

    /**
     * Bumps the cleared counter. A discard is a resolution, and skipping it
     * makes the integrity check later report data loss for something the user
     * did on purpose.
     *
     * **It also takes the optimistic projection back**, in the same
     * transaction, which is what stops a refused create becoming a permanent
     * phantom record — see `dropRefusedCreate`.
     *
     * The revert is here and NOT at rejection time, deliberately. A rejected
     * mutation is a decision the user has not made yet: the inbox says "needs a
     * look", and "Send it again" has to have something to send. Hiding the
     * record the moment the server refused it would leave them reading about a
     * group they can no longer see, and would make a retry re-project from
     * nothing. Discard is the point at which they have decided.
     */
    async discardRejected(id): Promise<void> {
      await driver.transaction(async (tx) => {
        // ONLY a rejected mutation. Without the status check a stray call
        // deletes queued work that has not been sent yet — the one thing the
        // outbox exists to make impossible.
        const existing = await tx.get<{
          status: string;
          op: string;
          entity: string;
          targetId: string;
          payload: string;
        }>('SELECT status, op, entity, targetId, payload FROM outbox WHERE id = ?', [id]);
        if (!existing || existing.status !== 'rejected') return;

        // Deleted first, so it cannot count itself as the confirmation that
        // keeps the record alive.
        await tx.run('DELETE FROM outbox WHERE id = ?', [id]);
        await bumpCleared(tx, 1);

        /**
         * A refused command leaves nothing of itself behind.
         *
         * `create` is the one op whose target owes its whole local existence
         * to this device, so it is taken back by deleting the row. `update`
         * and `delete` merged into a record that may have come from anywhere,
         * so they are taken back from the pre-image recorded at enqueue — and
         * only when nothing has touched the record since. See `restoreBefore`.
         */
        if (existing.op === 'create') {
          await dropRefusedCreate(tx, existing.entity, existing.targetId);
        } else {
          // The payload as well as the op: the restore asks, per field, whether
          // what this command wrote is still standing.
          await restoreBefore(tx, id, { op: existing.op, payload: readJson(existing.payload) });
        }
      });
    },

    /**
     * Outbox entries in clientSeq order — the order they must be sent in.
     *
     * An unreadable row is quarantined rather than thrown past: one bad record
     * must not stop every mutation behind it from ever being sent.
     */
    async readOutboxBySeq(): Promise<QueuedMutation[]> {
      // Work still outstanding, in the order it must be sent. Applied rows stay
      // in the table as the audit trail (invariant 7) but are not work — and
      // parsing every mutation a farm has ever made, on every flush, would make
      // the loop slower every morning it ran.
      const rows = await driver.all<OutboxRow>(
        "SELECT * FROM outbox WHERE status != 'applied' ORDER BY clientSeq",
      );

      const good: QueuedMutation[] = [];
      const corrupt: { key: string; raw: unknown; reason: string }[] = [];

      for (const row of rows) {
        /**
         * Migrated before it is parsed (A7).
         *
         * A device offline for three weeks across two deploys reopens holding
         * envelopes an older build wrote. Without this the parse fails and the
         * row is quarantined — a farm's unsent morning routed to the rejected
         * inbox for the crime of having been written last week.
         *
         * The IndexedDB store did this on the way out of its own read path,
         * and the SQLite store did not: the ladder was left behind in the web
         * client and nothing carried it over. Found while retiring that client.
         */
        const mapped = rowToMutation(row);
        if (!mapped.ok) {
          // Corrupt JSON on disk, caught before the schema is asked — the
          // schema cannot tell an unreadable payload from an absent one.
          corrupt.push({ key: row.id, raw: mapped.raw, reason: mapped.reason });
          continue;
        }

        let candidate: unknown;
        try {
          candidate = migrateEnvelope(mapped.value as Record<string, unknown>);
        } catch {
          // Unmigratable: an envelope from a version this build has no step
          // for. Quarantine is right — it is unreadable, not merely old.
          candidate = mapped.value;
        }
        const parsed = queuedMutationSchema.safeParse(candidate);
        if (parsed.success) {
          good.push(parsed.data);
          continue;
        }
        corrupt.push({
          key: row.id,
          raw: candidate,
          reason: parsed.error.issues[0]?.message ?? 'unreadable',
        });
      }

      for (const bad of corrupt) {
        await quarantine(driver, 'outbox', bad.key, bad.raw, bad.reason);
        await driver.run('DELETE FROM outbox WHERE id = ?', [bad.key]);
        // By whichever door: a quarantined row is gone from the outbox, so its
        // tally has nothing left to be about.
        await driver.run('DELETE FROM outbox_unreadable WHERE mutationId = ?', [bad.key]);
      }

      return good;
    },

    async readRecordsByEntity(entity): Promise<LocalRecord[]> {
      const rows = await driver.all<RecordRow>('SELECT * FROM records WHERE entity = ?', [entity]);

      const good: LocalRecord[] = [];
      for (const row of rows) {
        const mapped = rowToRecord(row);
        if (!mapped.ok) {
          await quarantine(driver, 'records', row.key, mapped.raw, mapped.reason);
          await driver.run('DELETE FROM records WHERE key = ?', [row.key]);
          continue;
        }

        const parsed = localRecordSchema.safeParse(mapped.value);
        if (parsed.success) {
          good.push(parsed.data);
          continue;
        }
        await quarantine(
          driver,
          'records',
          row.key,
          mapped.value,
          parsed.error.issues[0]?.message ?? 'unreadable',
        );
        await driver.run('DELETE FROM records WHERE key = ?', [row.key]);
      }
      return good;
    },

    async countRecords(): Promise<number> {
      const row = await driver.get<{ n: number }>('SELECT COUNT(*) AS n FROM records');
      return row?.n ?? 0;
    },

    async counts(): Promise<QueueCounts> {
      // `total` is outstanding work, not rows in the table. Applied rows are
      // the audit trail and counting them would make the chip say a farm has
      // 1,400 things waiting when it has none.
      const row = await driver.get<{ queued: number; rejected: number; total: number }>(
        `SELECT
           SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END)    AS queued,
           SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END)  AS rejected,
           SUM(CASE WHEN status != 'applied' THEN 1 ELSE 0 END)  AS total
         FROM outbox`,
      );
      return {
        queued: row?.queued ?? 0,
        rejected: row?.rejected ?? 0,
        total: row?.total ?? 0,
      };
    },

    /**
     * Loss detection from two integers rather than a duplicate store
     * (masterplan Q1). clientSeq increments exactly once per enqueue, so
     * nextClientSeq is also the lifetime enqueue count; subtract what was
     * acknowledged and the result is what the outbox should still hold.
     */
    async checkIntegrity(): Promise<IntegrityReport> {
      const everEnqueued = parseMeta('nextClientSeq', await readMeta(driver, 'nextClientSeq')) ?? 0;
      const cleared = parseMeta('clearedCount', await readMeta(driver, 'clearedCount')) ?? 0;
      // Outstanding rows only. `cleared` counts acknowledgements, and since
      // invariant 7 those rows stay in the table marked `applied` — counting
      // them here would report every acknowledged mutation as an excess.
      const row = await driver.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM outbox WHERE status != 'applied'",
      );
      const actualInOutbox = row?.n ?? 0;
      const expectedInOutbox = everEnqueued - cleared;

      return {
        everEnqueued,
        cleared,
        expectedInOutbox,
        actualInOutbox,
        missing: Math.max(0, expectedInOutbox - actualInOutbox),
      };
    },

    /**
     * Applies a page and advances BOTH halves of the watermark in the same
     * transaction as the records they cover. A timestamp persisted without its
     * ULID resumes from the start of a millisecond and re-applies rows already
     * written.
     */
    async applyPulled(mutations: readonly PulledMutation[], cursor): Promise<PullResult> {
      return driver.transaction(async (tx) => {
        /**
         * Records this device still owes the server, and only those.
         *
         * Anything genuinely on its way out is newer than what the server can
         * say about it, so local optimistic state wins until it flushes.
         *
         * **`rejected` and `applied` are deliberately not in that set, and
         * leaving them in was a silent, permanent hydration failure.** A
         * rejected mutation never flushes — it sits in the inbox until a
         * person deals with it — so treating it as pending meant one refused
         * edit froze that record's hydration for the life of the install: the
         * server's version of it could never arrive again, on any device,
         * ever. An applied row is already on the server, so skipping it would
         * have done the same thing to every record a farm had ever synced the
         * moment invariant 7 stopped deleting them.
         */
        const pendingRows = await tx.all<{ targetId: string }>(
          "SELECT DISTINCT targetId FROM outbox WHERE status IN ('queued', 'sending')",
        );
        const pending = new Set(pendingRows.map((r) => r.targetId));

        const repairing = await repairInProgress(tx);

        let applied = 0;
        let paused = false;
        /** The last row actually written, which is how far it is safe to claim. */
        let committed: { through: number; throughId: string } | null = null;

        for (const mutation of mutations) {
          /**
           * Stop here rather than skipping past it.
           *
           * Skipping used to advance the watermark over the skipped row in the
           * same transaction, so the server was never asked for it again — a
           * record edited on this phone and also on another one lost the other
           * one's version outright, silently and permanently. Pausing costs a
           * round trip: the queue drains on the next flush, this row stops
           * being pending, and the following pull delivers it.
           */
          if (pending.has(mutation.targetId)) {
            paused = true;
            break;
          }

          await projectOne(
            tx,
            mutation.entity,
            mutation.targetId,
            mutation.op,
            mutation.payload,
            mutation.serverTs,
            // Stamped only while a repair is outstanding, so the sweep can tell
            // a row the server vouched for from one nothing did.
            repairing ? PROJECTION_REPAIR : undefined,
          );
          applied += 1;
          committed = { through: mutation.serverTs, throughId: mutation.id };
        }

        // Paused before the first row: the watermark does not move at all, so
        // the same page is asked for again once the queue has drained.
        const advanceTo = paused ? committed : cursor;
        if (advanceTo !== null) {
          await writeMeta(tx, META.pulledThrough, advanceTo.through);
          if (advanceTo.throughId !== null) {
            await writeMeta(tx, META.pulledThroughId, advanceTo.throughId);
          }
        }

        return { applied, skipped: mutations.length - applied, paused };
      });
    },

    async pulledThrough(): Promise<SnapshotWatermark> {
      return {
        through: parseMeta('pulledThrough', await readMeta(driver, 'pulledThrough')) ?? 0,
        throughId: parseMeta('pulledThroughId', await readMeta(driver, 'pulledThroughId')) ?? null,
      };
    },

    /**
     * Winds the watermark back to zero, once, so the next pull replays the
     * accepted log over whatever a refused command left behind.
     *
     * Idempotent by the `started` marker rather than by the watermark, because
     * the watermark moves the moment the replay begins — checking it would
     * restart the replay on every pull and the device would never finish.
     *
     * The outbox is deliberately untouched. Nothing unsent is at risk here: the
     * queue is the only copy of work that has not reached the server, and this
     * rebuilds the projection, which is derived by definition.
     */
    async startProjectionRepair(): Promise<boolean> {
      return driver.transaction(async (tx) => {
        const started = parseMeta('repairStarted', await readMeta(tx, 'repairStarted')) ?? 0;
        if (started >= PROJECTION_REPAIR) return false;

        await writeMeta(tx, META.repairStarted, PROJECTION_REPAIR);
        await writeMeta(tx, META.pulledThrough, 0);
        await tx.run('DELETE FROM meta WHERE key = ?', [META.pulledThroughId]);

        // Same reasoning as the marks below: the replay reads every row again,
        // so a running count that survived it would double.
        await tx.run('DELETE FROM meta WHERE key = ?', [META.unmodelableRows]);

        // Marks are only meaningful within one run. Left over from an earlier
        // one they would vouch for rows this replay never reaches, and the
        // sweep would spare exactly the orphans it exists to find.
        await tx.run('DELETE FROM record_gen');
        return true;
      });
    },

    /**
     * Sweeps what the replay never accounted for, and closes the repair.
     *
     * **Only called once the feed has actually run out**, which is what makes
     * the deletion safe: a row still carrying an older stamp after the device
     * has read every accepted mutation is a row the server has nothing for.
     *
     * A record is legitimate exactly when the server has a mutation for it or
     * this device has an outbox row for it — those are the only two things that
     * write `records` at all. So the sweep keeps anything with any outbox row,
     * `rejected` included: on the device that issued a refused create the
     * record stays visible until the user discards it from the inbox, which is
     * the same call `discardRejected` makes. On every OTHER device there is no
     * outbox row and nothing on the server, and the row goes.
     */
    async finishProjectionRepair(): Promise<number> {
      return driver.transaction(async (tx) => {
        const done = parseMeta('repairDone', await readMeta(tx, 'repairDone')) ?? 0;
        if (done >= PROJECTION_REPAIR) return 0;

        const orphans = await tx.all<{ key: string }>(
          `SELECT key FROM records
             WHERE key NOT IN (SELECT key FROM record_gen WHERE gen >= ?)
               AND targetId NOT IN (SELECT targetId FROM outbox)`,
          [PROJECTION_REPAIR],
        );

        for (const row of orphans) {
          await tx.run('DELETE FROM records WHERE key = ?', [row.key]);
        }

        // The marks have done their job, and the next generation clears them
        // again on the way in — so nothing is kept and the table does not grow
        // a row per record for ever.
        await tx.run('DELETE FROM record_gen');
        await writeMeta(tx, META.repairDone, PROJECTION_REPAIR);
        // Kept, so the diagnostics sheet can say what was taken away. A record
        // vanishing from a farm's screens is a thing somebody deserves a
        // sentence about, even when removing it was right.
        await writeMeta(tx, META.repairedRecords, orphans.length);
        return orphans.length;
      });
    },

    async projectionRepairDone(): Promise<boolean> {
      return !(await repairInProgress(driver));
    },

    /**
     * Adds to the running total of rows this build could not model.
     *
     * Read-then-write rather than a SQL increment because `meta` stores JSON
     * text, and the whole point of `parseMeta` is that nothing here trusts what
     * it reads. Called once per pull pass, from a loop that is already doing a
     * round trip.
     */
    async noteUnmodelable(rows: number): Promise<void> {
      if (rows <= 0) return;
      await driver.transaction(async (tx) => {
        const soFar = parseMeta('unmodelableRows', await readMeta(tx, 'unmodelableRows')) ?? 0;
        await writeMeta(tx, META.unmodelableRows, soFar + rows);
      });
    },

    async unmodelableRows(): Promise<number> {
      return parseMeta('unmodelableRows', await readMeta(driver, 'unmodelableRows')) ?? 0;
    },

    async repairedRecords(): Promise<number> {
      return parseMeta('repairedRecords', await readMeta(driver, 'repairedRecords')) ?? 0;
    },

    async getLastSyncAt(): Promise<number | null> {
      return parseMeta('lastSyncAt', await readMeta(driver, 'lastSyncAt')) ?? null;
    },

    async getLastError(): Promise<string | null> {
      return parseMeta('lastError', await readMeta(driver, 'lastError')) ?? null;
    },

    async setLastError(message): Promise<void> {
      await writeMeta(driver, META.lastError, message);
    },

    // ── support tickets ───────────────────────────────────────────────────

    async enqueueTicket(ticket): Promise<void> {
      await driver.run(
        `INSERT INTO tickets (id, at, fingerprint, bundle, records, attempts)
         VALUES (?, ?, ?, ?, ?, 0)`,
        [
          ticket.id,
          ticket.at,
          ticket.fingerprint,
          ticket.bundle,
          ticket.records ?? null,
        ],
      );
    },

    async pendingTickets(): Promise<StoredTicket[]> {
      const rows = await driver.all<TicketRow>(
        'SELECT * FROM tickets WHERE sentAt IS NULL ORDER BY at ASC',
      );
      return rows.map(toTicket);
    },

    async listTickets(limit = 20): Promise<StoredTicket[]> {
      const rows = await driver.all<TicketRow>(
        'SELECT * FROM tickets ORDER BY at DESC LIMIT ?',
        [limit],
      );
      return rows.map(toTicket);
    },

    async markTicketSent(id, at, url): Promise<void> {
      /**
       * The row stays, marked — the same reasoning as invariant 7.
       *
       * The records go, though, and that is deliberate: a farm's whole
       * database sitting on the handset a second time, indefinitely, after it
       * has already reached where it was going, is a copy nobody asked to
       * keep. The bundle stays because it is small and is the record of what
       * was reported.
       */
      await driver.run(
        'UPDATE tickets SET sentAt = ?, url = ?, records = NULL, lastError = NULL WHERE id = ?',
        [at, url, id],
      );
    },

    async recordTicketAttempt(id, error): Promise<void> {
      await driver.run(
        'UPDATE tickets SET attempts = attempts + 1, lastError = ? WHERE id = ?',
        [error.slice(0, 300), id],
      );
    },

    async dropTicket(id): Promise<void> {
      await driver.run('DELETE FROM tickets WHERE id = ?', [id]);
    },

    async getSyncHeld(): Promise<SyncRefusal | null> {
      return parseMeta('syncHeld', await readMeta(driver, 'syncHeld')) ?? null;
    },

    async setSyncHeld(refusal): Promise<void> {
      /**
       * Cleared by deletion rather than by writing a sentinel, so "no row"
       * and "not held" are the same fact. A device that has never been held
       * and one that was released look identical, which is correct — neither
       * is being held now.
       */
      if (refusal === null) {
        await driver.run('DELETE FROM meta WHERE key = ?', [META.syncHeld]);
        return;
      }
      await writeMeta(driver, META.syncHeld, refusal);
    },

    async getDeviceId(): Promise<string | null> {
      return parseMeta('deviceId', await readMeta(driver, 'deviceId')) ?? null;
    },

    async getLastBackupAt(): Promise<number | null> {
      return parseMeta('lastBackupAt', await readMeta(driver, 'lastBackupAt')) ?? null;
    },

    async setLastBackupAt(at): Promise<void> {
      await writeMeta(driver, META.lastBackupAt, at);
    },

    async getPendingPhoto() {
      return parseMeta('pendingPhoto', await readMeta(driver, 'pendingPhoto')) ?? null;
    },

    async setPendingPhoto(pending): Promise<void> {
      if (pending === null) {
        await driver.run('DELETE FROM meta WHERE key = ?', [META.pendingPhoto]);
        return;
      }
      await writeMeta(driver, META.pendingPhoto, pending);
    },

    async getSessionEnd() {
      return parseMeta('sessionEnd', await readMeta(driver, 'sessionEnd')) ?? null;
    },

    async recordSessionEnd(end): Promise<void> {
      // Cleared by deletion, like `syncHeld`: "never ended" and "ended and then
      // signed back in" are the same fact, which is that nothing is wrong now.
      if (end === null) {
        await driver.run('DELETE FROM meta WHERE key = ?', [META.sessionEnd]);
        return;
      }
      await writeMeta(driver, META.sessionEnd, end);
    },

    async getReadAlerts(): Promise<string[]> {
      return parseMeta('readAlerts', await readMeta(driver, 'readAlerts')) ?? [];
    },

    async markAlertRead(id, live): Promise<void> {
      const held = parseMeta('readAlerts', await readMeta(driver, 'readAlerts')) ?? [];
      /**
       * Kept to what is still in force, so the list cannot grow for ever.
       *
       * An alert the service has withdrawn will never be drawn again, so
       * remembering that somebody read it is dead weight — and the schema caps
       * the array, so dead weight would eventually push out a live id and
       * silently un-acknowledge something.
       */
      const stillReal = new Set(live);
      const next = [...new Set([...held.filter((seen) => stillReal.has(seen)), id])];
      await writeMeta(driver, META.readAlerts, next);
    },

    /**
     * The forecast cache. Outside the record system entirely — see the port.
     *
     * Read and written on the outer handle rather than in a transaction: it is
     * one row, it is a cache, and nothing else is consistent with it. Invariant
     * 5 is about a projection and its mutation, and there is no mutation here.
     */
    async readForecast(): Promise<CachedForecast | null> {
      const row = await driver.get<{ issuedAt: number; fetchedAt: number; value: string }>(
        'SELECT issuedAt, fetchedAt, value FROM forecast WHERE id = 1',
      );
      return row ?? null;
    },

    async writeForecast(entry): Promise<void> {
      // Replaced wholesale. A farm has one position and therefore one
      // forecast; the CHECK on the table makes a second one impossible.
      await driver.run(
        `INSERT INTO forecast (id, issuedAt, fetchedAt, value) VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET issuedAt = excluded.issuedAt,
                                       fetchedAt = excluded.fetchedAt,
                                       value = excluded.value`,
        [entry.issuedAt, entry.fetchedAt, entry.value],
      );
    },

    /**
     * The last measured reading. Same category as the forecast — a cache, not
     * a record — and the same one-row treatment.
     */
    async readObservation(): Promise<CachedObservation | null> {
      const row = await driver.get<{ observedAt: number; fetchedAt: number; value: string }>(
        'SELECT observedAt, fetchedAt, value FROM observation WHERE id = 1',
      );
      return row ?? null;
    },

    async writeObservation(entry): Promise<void> {
      await driver.run(
        `INSERT INTO observation (id, observedAt, fetchedAt, value) VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET observedAt = excluded.observedAt,
                                       fetchedAt = excluded.fetchedAt,
                                       value = excluded.value`,
        [entry.observedAt, entry.fetchedAt, entry.value],
      );
    },

    async readAlerts(): Promise<CachedAlerts | null> {
      const row = await driver.get<{ fetchedAt: number; value: string }>(
        'SELECT fetchedAt, value FROM alerts WHERE id = 1',
      );
      return row ?? null;
    },

    async writeAlerts(entry): Promise<void> {
      await driver.run(
        `INSERT INTO alerts (id, fetchedAt, value) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET fetchedAt = excluded.fetchedAt,
                                       value = excluded.value`,
        [entry.fetchedAt, entry.value],
      );
    },

    async quarantineCount(): Promise<number> {
      const row = await driver.get<{ n: number }>('SELECT COUNT(*) AS n FROM quarantine');
      return row?.n ?? 0;
    },

    async listQuarantined(): Promise<Quarantined[]> {
      const rows = await driver.all<{
        key: string;
        store: string;
        raw: string;
        reason: string;
        quarantinedAt: number;
      }>('SELECT * FROM quarantine ORDER BY quarantinedAt');

      return rows.flatMap((row) => {
        /**
         * The raw text stands in for itself when it will not parse.
         *
         * `raw` is `z.unknown()`, so an unreadable column would otherwise be
         * handed over as `undefined` and the row would list with nothing in
         * it — an entry in the corruption list whose evidence is missing,
         * which is the same shape of loss this file's mappers were fixed for.
         */
        const raw = tryReadJson(row.raw);
        const parsed = quarantinedSchema.safeParse({
          ...row,
          raw: raw.ok ? raw.value : row.raw,
        });
        return parsed.success ? [parsed.data] : [];
      });
    },

    /**
     * Clears every table on sign-out and org switch (C5). Cached tenant data
     * must not outlive the session that fetched it — on a shared barn tablet,
     * the next person to sign in would otherwise read the previous farm's
     * records.
     *
     * DELETE rather than DROP: the schema stays, so the store is usable
     * immediately afterwards without re-running the ladder.
     */
    async wipe(): Promise<void> {
      await driver.transaction(async (tx) => {
        /**
         * The weather tables belong on this list and were missing from it.
         *
         * They arrived after the wipe was written and nobody added them, so a
         * sign-out left the forecast, the station reading and now the alerts
         * behind. That is not a stale-data annoyance: a cached forecast is
         * *for a position*, and the position is the farm's own — the thing
         * `roundPosition` exists to be careful with. Leaving it for whoever
         * signs in next is the exact failure C5 is about.
         */
        for (const table of [
          'outbox',
          // With `outbox`, because it is only ever about a row in it — and on
          // this list from the change that first wrote to it, which is the
          // lesson the comment above draws.
          'outbox_unreadable',
          'records',
          'meta',
          // Added to this list in the same change that created it, which is the
          // whole lesson of the comment above.
          'record_gen',
          // And this one, for the same reason at the same time. It holds a
          // farm's own record values — the pre-image of an edit — so leaving
          // it behind on a handed-on tablet would leave that farm's data on it.
          'record_undo',
          /**
           * **`tickets` was missed for the same reason the weather tables
           * were**, and it is the one on this list that holds a farm's records
           * rather than a cache of somebody else's data: `tickets.records` is
           * the opt-in export a support report carries (S2). A barn tablet
           * handed to the next farm would keep the previous one's export,
           * invisibly, because the wipe appears to have run.
           *
           * Latent until now — nothing called `clearSession` — which is
           * precisely why it had to be fixed before sign-out started using it.
           */
          'tickets',
          'quarantine',
          'forecast',
          'observation',
          'alerts',
        ]) {
          await tx.run(`DELETE FROM ${table}`);
        }
      });
    },

    async close(): Promise<void> {
      await driver.close();
    },
  };
}

/** Kept for the parameterised suite: `SqlValue` is part of the driver contract. */
export type { SqlValue };
