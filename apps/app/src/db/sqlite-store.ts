import {
  MUTATION_SCHEMA_VERSION,
  type MutationResult,
  mutationSchema,
  newId,
  type PulledMutation,
} from '@steading/contracts';
import type { SqlDriver, SqlValue } from './driver';
import { InvalidMutationError, StorageFullError } from './errors';
import { migrate } from './migrations';
import type {
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

export async function openSqliteStore(driver: SqlDriver): Promise<LocalStore> {
  await migrate(driver);

  // ── meta ───────────────────────────────────────────────────────────────────

  async function readMeta<K extends keyof typeof import('./schema').metaSchemas>(
    key: K,
  ): Promise<unknown> {
    const row = await driver.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
    return row === undefined ? undefined : readJson(row.value);
  }

  async function writeMeta(key: string, value: unknown): Promise<void> {
    await driver.run(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, JSON.stringify(value)],
    );
  }

  async function bumpCleared(by: number): Promise<void> {
    const current = parseMeta('clearedCount', await readMeta('clearedCount')) ?? 0;
    await writeMeta(META.clearedCount, current + by);
  }

  // ── quarantine ─────────────────────────────────────────────────────────────

  async function quarantine(
    store: string,
    key: string,
    raw: unknown,
    reason: string,
  ): Promise<void> {
    // Composite key, matching the IndexedDB engine. An outbox id and a record
    // key are drawn from different spaces and could otherwise collide here,
    // and a quarantine that overwrites a quarantined row defeats the point of
    // keeping the raw value at all.
    await driver.run(
      `INSERT INTO quarantine (key, store, raw, reason, quarantinedAt)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET raw = excluded.raw, reason = excluded.reason`,
      [`${store}:${key}`, store, JSON.stringify(raw ?? null), reason, Date.now()],
    );
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
        return await driver.transaction(async () => {
          // A corrupt or missing deviceId is safe to replace: it only groups a
          // device's own mutations for ordering.
          let deviceId = parseMeta('deviceId', await readMeta('deviceId'));
          if (deviceId === undefined) {
            deviceId = crypto.randomUUID();
            await writeMeta(META.deviceId, deviceId);
          }

          /**
           * A corrupt or missing counter is NOT safe to replace with zero —
           * that reuses sequence numbers and silently breaks ordering. Take
           * the highest seq still in the outbox as a floor, so monotonicity
           * survives losing the counter as long as the queue did.
           */
          const stored = parseMeta('nextClientSeq', await readMeta('nextClientSeq')) ?? 0;
          const highest = await driver.get<{ seq: number | null }>(
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

          await driver.run(
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

          await writeMeta(META.nextClientSeq, clientSeq + 1);

          await driver.run(
            `INSERT INTO records (key, entity, targetId, value, updatedAt, deleted)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET
               value = excluded.value, updatedAt = excluded.updatedAt, deleted = excluded.deleted`,
            [
              recordKey(request.entity, targetId),
              request.entity,
              targetId,
              JSON.stringify(request.payload ?? null),
              Date.now(),
              request.op === 'delete' ? 1 : 0,
            ],
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

      await driver.transaction(async () => {
        let cleared = 0;

        for (const mutation of batch) {
          const result: MutationResult | undefined = byId.get(mutation.id);
          if (!result) {
            // Answered without mentioning it. Stays queued — resending is safe
            // — but the attempt is counted so it cannot retry forever unseen.
            await driver.run('UPDATE outbox SET attempts = attempts + 1 WHERE id = ?', [
              mutation.id,
            ]);
            continue;
          }

          if (result.status === 'applied' || result.status === 'duplicate') {
            await driver.run('DELETE FROM outbox WHERE id = ?', [mutation.id]);
            cleared += 1;
            continue;
          }

          await driver.run(
            'UPDATE outbox SET status = ?, rejectedReason = ?, rejectedAt = ? WHERE id = ?',
            ['rejected', result.reason ?? 'The server refused that record.', Date.now(), mutation.id],
          );
        }

        if (cleared > 0) await bumpCleared(cleared);
      });
    },

    async markSynced(at): Promise<void> {
      await driver.transaction(async () => {
        await writeMeta(META.lastSyncAt, at);
        await driver.run('DELETE FROM meta WHERE key = ?', [META.lastError]);
      });
    },

    async recordAttempt(batch, error): Promise<void> {
      await driver.transaction(async () => {
        for (const mutation of batch) {
          await driver.run(
            'UPDATE outbox SET attempts = attempts + 1, lastError = ? WHERE id = ?',
            [error, mutation.id],
          );
        }
      });
    },

    async rejectExhausted(batch, maxAttempts, reason): Promise<void> {
      await driver.transaction(async () => {
        for (const mutation of batch) {
          await driver.run(
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
      await driver.transaction(async () => {
        if (payload !== undefined) {
          await driver.run('UPDATE outbox SET payload = ? WHERE id = ?', [
            JSON.stringify(payload),
            id,
          ]);
        }
        // A clean attempt count, or the retry inherits the ceiling that parked
        // it and is refused before it is sent.
        await driver.run(
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
     */
    async discardRejected(id): Promise<void> {
      await driver.transaction(async () => {
        // ONLY a rejected mutation. Without the status check a stray call
        // deletes queued work that has not been sent yet — the one thing the
        // outbox exists to make impossible.
        const existing = await driver.get<{ status: string }>(
          'SELECT status FROM outbox WHERE id = ?',
          [id],
        );
        if (!existing || existing.status !== 'rejected') return;

        await driver.run('DELETE FROM outbox WHERE id = ?', [id]);
        await bumpCleared(1);
      });
    },

    /**
     * Outbox entries in clientSeq order — the order they must be sent in.
     *
     * An unreadable row is quarantined rather than thrown past: one bad record
     * must not stop every mutation behind it from ever being sent.
     */
    async readOutboxBySeq(): Promise<QueuedMutation[]> {
      const rows = await driver.all<OutboxRow>('SELECT * FROM outbox ORDER BY clientSeq');

      const good: QueuedMutation[] = [];
      const corrupt: { key: string; raw: unknown; reason: string }[] = [];

      for (const row of rows) {
        const candidate = rowToMutation(row);
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
        await quarantine('outbox', bad.key, bad.raw, bad.reason);
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
          'records',
          row.key,
          rowToRecord(row),
          parsed.error.issues[0]?.message ?? 'unreadable',
        );
        await driver.run('DELETE FROM records WHERE key = ?', [row.key]);
      }
      return good;
    },

    async counts(): Promise<QueueCounts> {
      const row = await driver.get<{ queued: number; rejected: number; total: number }>(
        `SELECT
           SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END)   AS queued,
           SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
           COUNT(*)                                             AS total
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
      const everEnqueued = parseMeta('nextClientSeq', await readMeta('nextClientSeq')) ?? 0;
      const cleared = parseMeta('clearedCount', await readMeta('clearedCount')) ?? 0;
      const row = await driver.get<{ n: number }>('SELECT COUNT(*) AS n FROM outbox');
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
      return driver.transaction(async () => {
        // Anything this device still holds is newer than what the server can
        // say about it, so local optimistic state wins until it flushes.
        const pendingRows = await driver.all<{ targetId: string }>(
          'SELECT DISTINCT targetId FROM outbox',
        );
        const pending = new Set(pendingRows.map((r) => r.targetId));

        let applied = 0;
        let skipped = 0;

        for (const mutation of mutations) {
          if (pending.has(mutation.targetId)) {
            skipped += 1;
            continue;
          }

          await driver.run(
            `INSERT INTO records (key, entity, targetId, value, updatedAt, deleted)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET
               value = excluded.value, updatedAt = excluded.updatedAt, deleted = excluded.deleted`,
            [
              recordKey(mutation.entity, mutation.targetId),
              mutation.entity,
              mutation.targetId,
              JSON.stringify(mutation.payload ?? null),
              mutation.serverTs,
              mutation.op === 'delete' ? 1 : 0,
            ],
          );
          applied += 1;
        }

        await writeMeta(META.pulledThrough, cursor.through);
        if (cursor.throughId !== null) await writeMeta(META.pulledThroughId, cursor.throughId);

        return { applied, skipped };
      });
    },

    async pulledThrough(): Promise<SnapshotWatermark> {
      return {
        through: parseMeta('pulledThrough', await readMeta('pulledThrough')) ?? 0,
        throughId: parseMeta('pulledThroughId', await readMeta('pulledThroughId')) ?? null,
      };
    },

    async getLastSyncAt(): Promise<number | null> {
      return parseMeta('lastSyncAt', await readMeta('lastSyncAt')) ?? null;
    },

    async getLastError(): Promise<string | null> {
      return parseMeta('lastError', await readMeta('lastError')) ?? null;
    },

    async setLastError(message): Promise<void> {
      await writeMeta(META.lastError, message);
    },

    async getDeviceId(): Promise<string | null> {
      return parseMeta('deviceId', await readMeta('deviceId')) ?? null;
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
      await driver.transaction(async () => {
        for (const table of ['outbox', 'records', 'meta', 'quarantine']) {
          await driver.run(`DELETE FROM ${table}`);
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
