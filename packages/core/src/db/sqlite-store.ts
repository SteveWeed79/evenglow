import {
  MUTATION_SCHEMA_VERSION,
  type MutationResult,
  mutationSchema,
  newId,
  type PulledMutation,
  type SyncRefusal,
} from '@steading/contracts';
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

/** JSON text in, structured out. Anything unparseable is caller-quarantined. */
function readJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function rowToMutation(row: OutboxRow): unknown {
  return {
    schemaVersion: row.schemaVersion,
    id: row.id,
    targetId: row.targetId,
    entity: row.entity,
    op: row.op,
    payload: readJson(row.payload),
    deviceId: row.deviceId,
    clientSeq: row.clientSeq,
    clientTs: row.clientTs,
    status: row.status,
    attempts: row.attempts,
    enqueuedAt: row.enqueuedAt,
    ...(row.lastError === null ? {} : { lastError: row.lastError }),
    ...(row.rejectedReason === null ? {} : { rejectedReason: row.rejectedReason }),
    ...(row.rejectedAt === null ? {} : { rejectedAt: row.rejectedAt }),
  };
}

function rowToRecord(row: RecordRow): unknown {
  return {
    key: row.key,
    entity: row.entity,
    targetId: row.targetId,
    value: readJson(row.value),
    updatedAt: row.updatedAt,
    deleted: row.deleted === 1,
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
      const targetId = request.targetId;

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
           * that reuses sequence numbers and silently breaks ordering. Take
           * the highest seq still in the outbox as a floor, so monotonicity
           * survives losing the counter as long as the queue did.
           */
          const stored = parseMeta('nextClientSeq', await readMeta(tx, 'nextClientSeq')) ?? 0;
          const highest = await tx.get<{ seq: number | null }>(
            'SELECT MAX(clientSeq) AS seq FROM outbox',
          );
          const floor = highest?.seq === null || highest?.seq === undefined ? 0 : highest.seq + 1;
          const clientSeq = Math.max(stored, floor);

          const envelope = {
            schemaVersion: MUTATION_SCHEMA_VERSION,
            id: newId(),
            targetId,
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

          await writeMeta(tx, META.nextClientSeq, clientSeq + 1);

          await projectOne(
            tx,
            request.entity,
            targetId,
            request.op,
            request.payload,
            Date.now(),
          );

          return queued;
        });
      } catch (error) {
        // The transaction aborts as a unit, so no sequence number is consumed
        // and nothing partial is left behind.
        if (isFullError(error)) throw new StorageFullError();
        throw error;
      }
    },

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
            // Answered without mentioning it. Stays queued — resending is safe
            // — but the attempt is counted so it cannot retry forever unseen.
            await tx.run('UPDATE outbox SET attempts = attempts + 1 WHERE id = ?', [
              mutation.id,
            ]);
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
            cleared += 1;
            continue;
          }

          await tx.run(
            'UPDATE outbox SET status = ?, rejectedReason = ?, rejectedAt = ? WHERE id = ?',
            ['rejected', result.reason ?? 'The server refused that record.', Date.now(), mutation.id],
          );
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

    async rejectExhausted(batch, maxAttempts, reason): Promise<void> {
      await driver.transaction(async (tx) => {
        for (const mutation of batch) {
          await tx.run(
            `UPDATE outbox SET status = 'rejected', rejectedReason = ?, rejectedAt = ?
             WHERE id = ? AND attempts >= ?`,
            [reason, Date.now(), mutation.id, maxAttempts],
          );
        }
      });
    },

    async listRejected(): Promise<QueuedMutation[]> {
      const rows = await driver.all<OutboxRow>(
        "SELECT * FROM outbox WHERE status = 'rejected' ORDER BY clientSeq",
      );
      return rows
        .map((row) => queuedMutationSchema.safeParse(rowToMutation(row)))
        .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
    },

    async retryRejected(id, payload): Promise<void> {
      await driver.transaction(async (tx) => {
        if (payload !== undefined) {
          await tx.run('UPDATE outbox SET payload = ? WHERE id = ?', [
            JSON.stringify(payload),
            id,
          ]);
        }
        // A clean attempt count, or the retry inherits the ceiling that parked
        // it and is refused before it is sent.
        await tx.run(
          `UPDATE outbox SET status = 'queued', attempts = 0,
             lastError = NULL, rejectedReason = NULL, rejectedAt = NULL
           WHERE id = ?`,
          [id],
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
        const existing = await tx.get<{ status: string; op: string; entity: string; targetId: string }>(
          'SELECT status, op, entity, targetId FROM outbox WHERE id = ?',
          [id],
        );
        if (!existing || existing.status !== 'rejected') return;

        // Deleted first, so it cannot count itself as the confirmation that
        // keeps the record alive.
        await tx.run('DELETE FROM outbox WHERE id = ?', [id]);
        await bumpCleared(tx, 1);

        if (existing.op === 'create') {
          await dropRefusedCreate(tx, existing.entity, existing.targetId);
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
        let candidate: unknown;
        try {
          candidate = migrateEnvelope(rowToMutation(row) as Record<string, unknown>);
        } catch {
          // Unmigratable: an envelope from a version this build has no step
          // for. Quarantine is right — it is unreadable, not merely old.
          candidate = rowToMutation(row);
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
      }

      return good;
    },

    async readRecordsByEntity(entity): Promise<LocalRecord[]> {
      const rows = await driver.all<RecordRow>('SELECT * FROM records WHERE entity = ?', [entity]);

      const good: LocalRecord[] = [];
      for (const row of rows) {
        const parsed = localRecordSchema.safeParse(rowToRecord(row));
        if (parsed.success) {
          good.push(parsed.data);
          continue;
        }
        await quarantine(
          driver,
          'records',
          row.key,
          rowToRecord(row),
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
        const parsed = quarantinedSchema.safeParse({ ...row, raw: readJson(row.raw) });
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
          'records',
          'meta',
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
