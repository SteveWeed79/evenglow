import {
  MUTATION_SCHEMA_VERSION,
  type Mutation,
  type MutationResult,
  mutationSchema,
  newId,
  type PulledMutation,
} from '@steading/contracts';
import type { SqlDriver, SqlTx, SqlValue } from './driver';
import { migrateEnvelope } from './migrate';
import type {
  EnqueueRequest,
  IntegrityReport,
  LocalStore,
  PullResult,
  QueueCounts,
} from './port';
import { toLocalRecord } from './project';
import {
  type LocalRecord,
  localRecordSchema,
  META,
  parseMeta,
  type Quarantined,
  quarantinedSchema,
  type QueuedMutation,
  queuedMutationSchema,
  recordKey,
} from './schema';

/**
 * The SQLite implementation of the storage port.
 *
 * Every method that touches more than one table does so inside a single
 * `driver.transaction` — invariant 5, made structural rather than remembered.
 * The sync engine above has no way to open a transaction of its own, so it has
 * no way to write half of one.
 */

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

interface MetaRow {
  value: string;
}

interface CountRow {
  n: number;
}

interface MaxSeqRow {
  seq: number | null;
}

const OUTBOX_COLUMNS =
  'id, schemaVersion, targetId, entity, op, payload, deviceId, clientSeq, clientTs, ' +
  'status, attempts, enqueuedAt, lastError, rejectedReason, rejectedAt';

const OUTBOX_PLACEHOLDERS = '?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?';

function outboxValues(m: QueuedMutation): SqlValue[] {
  return [
    m.id,
    m.schemaVersion,
    m.targetId,
    m.entity,
    m.op,
    JSON.stringify(m.payload ?? null),
    m.deviceId,
    m.clientSeq,
    m.clientTs,
    m.status,
    m.attempts,
    m.enqueuedAt,
    m.lastError ?? null,
    m.rejectedReason ?? null,
    m.rejectedAt ?? null,
  ];
}

/**
 * Raw row → envelope-shaped object, without validating it.
 *
 * Kept separate from parsing because a row that fails validation still has to
 * be quarantined with its original content intact; throwing here would leave
 * nothing to quarantine.
 */
function rowToEnvelope(row: OutboxRow): Record<string, unknown> {
  return {
    schemaVersion: row.schemaVersion,
    id: row.id,
    targetId: row.targetId,
    entity: row.entity,
    op: row.op,
    payload: safeJson(row.payload),
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

/** Storage is external data (invariant 11): a hand-edited row must not throw. */
function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function rowToRecord(row: RecordRow): LocalRecord | null {
  const parsed = localRecordSchema.safeParse({
    key: row.key,
    entity: row.entity,
    targetId: row.targetId,
    value: safeJson(row.value),
    updatedAt: row.updatedAt,
    deleted: row.deleted !== 0,
  });
  return parsed.success ? parsed.data : null;
}

export class SqliteStore implements LocalStore {
  #driver: SqlDriver;

  constructor(driver: SqlDriver) {
    this.#driver = driver;
  }

  // ── Meta helpers ──────────────────────────────────────────────────────────

  async #readMeta(tx: SqlTx, key: string): Promise<unknown> {
    const [row] = await tx.query<MetaRow>('SELECT value FROM meta WHERE key = ?', [key]);
    return row === undefined ? undefined : safeJson(row.value);
  }

  async #writeMeta(tx: SqlTx, key: string, value: unknown): Promise<void> {
    await tx.run(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, JSON.stringify(value)],
    );
  }

  async #clearMeta(tx: SqlTx, key: string): Promise<void> {
    await tx.run('DELETE FROM meta WHERE key = ?', [key]);
  }

  // ── Writing ───────────────────────────────────────────────────────────────

  /**
   * One transaction: mint the sequence number, write the outbox row, advance
   * the counter, and update the projection.
   *
   * Assigning clientSeq outside the transaction is the classic way to end up
   * with two mutations holding the same sequence number after a crash
   * mid-write — at which point ordering (A4) is quietly broken and nothing
   * reports it.
   */
  async enqueue(request: EnqueueRequest): Promise<QueuedMutation> {
    return this.#driver.transaction(async (tx) => {
      // A corrupt or missing deviceId is safe to replace: it only groups a
      // device's own mutations for ordering, and a new one starts a new group.
      let deviceId = parseMeta('deviceId', await this.#readMeta(tx, META.deviceId));
      if (deviceId === undefined) {
        deviceId = crypto.randomUUID();
        await this.#writeMeta(tx, META.deviceId, deviceId);
      }

      // A corrupt or missing nextClientSeq is NOT safe to replace with zero —
      // that reuses sequence numbers and silently breaks ordering. Take the
      // highest seq still in the outbox as a floor, so monotonicity survives
      // losing the counter as long as the queue itself survived.
      const stored = parseMeta('nextClientSeq', await this.#readMeta(tx, META.nextClientSeq)) ?? 0;
      const [max] = await tx.query<MaxSeqRow>('SELECT MAX(clientSeq) AS seq FROM outbox');
      const floor = max?.seq === null || max?.seq === undefined ? 0 : max.seq + 1;
      const clientSeq = Math.max(stored, floor);

      const now = Date.now();
      const envelope: Mutation = {
        schemaVersion: MUTATION_SCHEMA_VERSION,
        // The id is the idempotency key, so like every entity id it is minted
        // here with the radio off (D1).
        id: newId(),
        targetId: request.targetId,
        entity: request.entity,
        op: request.op,
        payload: request.payload,
        deviceId,
        clientSeq,
        clientTs: now, // recorded, never trusted for ordering (D6)
      };

      // Belt and braces: the envelope is validated before it can reach storage,
      // so a malformed record cannot be created by a bug upstream of here.
      const checked = mutationSchema.safeParse(envelope);
      if (!checked.success) throw new Error('Could not build a valid mutation.');

      const queued: QueuedMutation = { ...envelope, status: 'queued', attempts: 0, enqueuedAt: now };

      await tx.run(
        `INSERT INTO outbox (${OUTBOX_COLUMNS}) VALUES (${OUTBOX_PLACEHOLDERS})`,
        outboxValues(queued),
      );
      await this.#writeMeta(tx, META.nextClientSeq, clientSeq + 1);

      // Same builder hydration uses, so a device's own writes and the same
      // writes arriving back from the server cannot disagree.
      await this.#putRecord(
        tx,
        toLocalRecord(request.entity, request.targetId, request.op, request.payload, now),
      );

      return queued;
    });
  }

  async #putRecord(tx: SqlTx, record: LocalRecord): Promise<void> {
    await tx.run(
      `INSERT INTO records (key, entity, targetId, value, updatedAt, deleted)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value, updatedAt = excluded.updatedAt, deleted = excluded.deleted`,
      [
        record.key,
        record.entity,
        record.targetId,
        JSON.stringify(record.value ?? null),
        record.updatedAt,
        record.deleted ? 1 : 0,
      ],
    );
  }

  /**
   * Applies a batch's server results as one unit.
   *
   * A mutation absent from `results` stays queued and burns an attempt: the
   * server answered without mentioning it, and resending is safe (D1 plus
   * `$setOnInsert`), so silence must never be read as success.
   */
  async resolveBatch(
    batch: readonly QueuedMutation[],
    results: readonly MutationResult[],
  ): Promise<void> {
    const byId = new Map(results.map((r) => [r.id, r]));

    await this.#driver.transaction(async (tx) => {
      let cleared = parseMeta('clearedCount', await this.#readMeta(tx, META.clearedCount)) ?? 0;

      for (const queued of batch) {
        const result = byId.get(queued.id);

        if (!result) {
          await tx.run('UPDATE outbox SET attempts = attempts + 1 WHERE id = ?', [queued.id]);
          continue;
        }

        if (result.status === 'applied' || result.status === 'duplicate') {
          await tx.run('DELETE FROM outbox WHERE id = ?', [queued.id]);
          cleared += 1;
          continue;
        }

        // rejected | conflict → the inbox. Never deleted (A6, invariant 9).
        await tx.run(
          `UPDATE outbox
             SET status = 'rejected', attempts = attempts + 1, rejectedReason = ?, rejectedAt = ?
           WHERE id = ?`,
          [result.reason ?? 'The server would not accept that.', Date.now(), queued.id],
        );
      }

      await this.#writeMeta(tx, META.clearedCount, cleared);
      await this.#writeMeta(tx, META.lastSyncAt, Date.now());
      await this.#clearMeta(tx, META.lastError);
    });
  }

  async recordAttempt(batch: readonly QueuedMutation[], error: string): Promise<void> {
    await this.#driver.transaction(async (tx) => {
      for (const queued of batch) {
        await tx.run('UPDATE outbox SET attempts = attempts + 1, lastError = ? WHERE id = ?', [
          error,
          queued.id,
        ]);
      }
      await this.#writeMeta(tx, META.lastError, error);
    });
  }

  /** Routes mutations past the attempt ceiling to the inbox so the queue can drain. */
  async rejectExhausted(
    batch: readonly QueuedMutation[],
    maxAttempts: number,
    reason: string,
  ): Promise<void> {
    await this.#driver.transaction(async (tx) => {
      for (const queued of batch) {
        await tx.run(
          `UPDATE outbox
             SET status = 'rejected', rejectedReason = ?, rejectedAt = ?
           WHERE id = ? AND status != 'rejected' AND attempts >= ?`,
          [reason, Date.now(), queued.id, maxAttempts],
        );
      }
    });
  }

  // ── The inbox ─────────────────────────────────────────────────────────────

  async listRejected(): Promise<QueuedMutation[]> {
    return (await this.readOutboxBySeq()).filter((m) => m.status === 'rejected');
  }

  /**
   * Puts a rejected mutation back in the queue, optionally with a corrected
   * payload. Attempts reset: the user changed something, so the previous
   * failures are not evidence about this one.
   */
  async retryRejected(id: string, payload?: unknown): Promise<void> {
    await this.#driver.transaction(async (tx) => {
      if (payload === undefined) {
        await tx.run(
          `UPDATE outbox
             SET status = 'queued', attempts = 0,
                 rejectedReason = NULL, rejectedAt = NULL, lastError = NULL
           WHERE id = ?`,
          [id],
        );
        return;
      }

      await tx.run(
        `UPDATE outbox
           SET status = 'queued', attempts = 0, payload = ?,
               rejectedReason = NULL, rejectedAt = NULL, lastError = NULL
         WHERE id = ?`,
        [JSON.stringify(payload ?? null), id],
      );

      // The projection has to follow the corrected payload, or the screen keeps
      // showing the value the server refused.
      const [row] = await tx.query<OutboxRow>('SELECT * FROM outbox WHERE id = ?', [id]);
      if (row) {
        await tx.run('UPDATE records SET value = ?, updatedAt = ? WHERE key = ?', [
          JSON.stringify(payload ?? null),
          Date.now(),
          recordKey(row.entity, row.targetId),
        ]);
      }
    });
  }

  /**
   * Discards a rejected mutation. Explicit user action only.
   *
   * Bumps the cleared counter alongside the delete: the integrity check derives
   * expected queue depth from enqueued-minus-cleared, so a discard that skipped
   * this would later be reported as data loss.
   */
  async discardRejected(id: string): Promise<void> {
    await this.#driver.transaction(async (tx) => {
      const [row] = await tx.query<OutboxRow>(
        "SELECT * FROM outbox WHERE id = ? AND status = 'rejected'",
        [id],
      );
      if (!row) return;

      await tx.run('DELETE FROM outbox WHERE id = ?', [id]);
      const cleared = parseMeta('clearedCount', await this.#readMeta(tx, META.clearedCount)) ?? 0;
      await this.#writeMeta(tx, META.clearedCount, cleared + 1);
    });
  }

  // ── Reading ───────────────────────────────────────────────────────────────

  /**
   * Outbox entries in clientSeq order — the order they must be sent in.
   *
   * Migrates old envelopes up to the current schema version, and quarantines
   * an unreadable row rather than throwing: one bad record must not stop every
   * mutation behind it from ever being sent.
   */
  async readOutboxBySeq(): Promise<QueuedMutation[]> {
    const rows = await this.#driver.query<OutboxRow>(
      'SELECT * FROM outbox ORDER BY clientSeq ASC, id ASC',
    );

    const good: QueuedMutation[] = [];
    const bad: { key: string; raw: unknown; reason: string }[] = [];

    for (const row of rows) {
      const raw = rowToEnvelope(row);
      try {
        const parsed = queuedMutationSchema.safeParse(migrateEnvelope(raw));
        if (parsed.success) good.push(parsed.data);
        else {
          bad.push({
            key: row.id,
            raw,
            reason: parsed.error.issues[0]?.message ?? 'Unreadable mutation.',
          });
        }
      } catch (error) {
        bad.push({
          key: row.id,
          raw,
          reason: error instanceof Error ? error.message : 'Unmigratable envelope.',
        });
      }
    }

    if (bad.length > 0) await this.#quarantine('outbox', 'id', bad);
    return good;
  }

  /**
   * Moves unreadable rows out of the way, keeping their raw content verbatim
   * so nothing is silently destroyed and a future build can still recover them.
   *
   * `table` is a checked-in identifier, never user input — it cannot be bound
   * as a parameter, so it must not become one.
   */
  async #quarantine(
    table: 'outbox' | 'records',
    idColumn: 'id' | 'key',
    bad: readonly { key: string; raw: unknown; reason: string }[],
  ): Promise<void> {
    await this.#driver.transaction(async (tx) => {
      for (const { key, raw, reason } of bad) {
        await tx.run(
          `INSERT INTO quarantine (key, store, raw, reason, quarantinedAt)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(key) DO NOTHING`,
          [key, table, JSON.stringify(raw), reason, Date.now()],
        );
        await tx.run(`DELETE FROM ${table} WHERE ${idColumn} = ?`, [key]);
      }
    });
  }

  /**
   * A projection row that will not parse is quarantined like a bad outbox row.
   *
   * It could simply be skipped — the mutation log it was derived from is still
   * intact — but then every read would re-parse and re-skip it, and nothing
   * would ever tell the user their local view is incomplete.
   */
  async #readRecords(rows: readonly RecordRow[]): Promise<LocalRecord[]> {
    const good: LocalRecord[] = [];
    const bad: { key: string; raw: unknown; reason: string }[] = [];

    for (const row of rows) {
      const parsed = rowToRecord(row);
      if (parsed) good.push(parsed);
      else bad.push({ key: row.key, raw: row, reason: 'Unreadable local record.' });
    }

    if (bad.length > 0) await this.#quarantine('records', 'key', bad);
    return good;
  }

  /** Local projections for one entity kind. Indexed, not a full scan. */
  async readRecordsByEntity(entity: string): Promise<LocalRecord[]> {
    return this.#readRecords(
      await this.#driver.query<RecordRow>(
        'SELECT * FROM records WHERE entity = ? ORDER BY updatedAt DESC',
        [entity],
      ),
    );
  }

  async readAllRecords(): Promise<LocalRecord[]> {
    return this.#readRecords(await this.#driver.query<RecordRow>('SELECT * FROM records'));
  }

  async counts(): Promise<QueueCounts> {
    const [queued] = await this.#driver.query<CountRow>(
      "SELECT COUNT(*) AS n FROM outbox WHERE status = 'queued'",
    );
    const [rejected] = await this.#driver.query<CountRow>(
      "SELECT COUNT(*) AS n FROM outbox WHERE status = 'rejected'",
    );
    const [total] = await this.#driver.query<CountRow>('SELECT COUNT(*) AS n FROM outbox');

    return { queued: queued?.n ?? 0, rejected: rejected?.n ?? 0, total: total?.n ?? 0 };
  }

  /**
   * Cheap loss detection (masterplan Q1).
   *
   * clientSeq increments exactly once per enqueue, so nextClientSeq is also the
   * lifetime enqueue count. Subtract what the server acknowledged, and what was
   * quarantined, and the result is how many entries the outbox should still
   * hold. A shortfall means rows disappeared — eviction, a failed migration, a
   * hand-edited database.
   *
   * Detects what comparing two local copies would have detected, using three
   * integers instead of a duplicate of the entire store.
   */
  async checkIntegrity(): Promise<IntegrityReport> {
    const everEnqueued =
      parseMeta('nextClientSeq', await this.#readMeta(this.#driver, META.nextClientSeq)) ?? 0;
    const cleared =
      parseMeta('clearedCount', await this.#readMeta(this.#driver, META.clearedCount)) ?? 0;

    const [actual] = await this.#driver.query<CountRow>('SELECT COUNT(*) AS n FROM outbox');
    const [quarantined] = await this.#driver.query<CountRow>(
      "SELECT COUNT(*) AS n FROM quarantine WHERE store = 'outbox'",
    );

    const actualInOutbox = actual?.n ?? 0;
    // Quarantined rows left the outbox on purpose and are still recoverable, so
    // they are not loss — counting them as missing would cry wolf.
    const expectedInOutbox = everEnqueued - cleared - (quarantined?.n ?? 0);

    return {
      everEnqueued,
      cleared,
      expectedInOutbox,
      actualInOutbox,
      missing: Math.max(0, expectedInOutbox - actualInOutbox),
    };
  }

  // ── Hydration ─────────────────────────────────────────────────────────────

  /**
   * Applies a page of pulled mutations and advances the watermark, atomically.
   *
   * Anything this device is still holding is newer than what the server can
   * tell us about it, so local optimistic state wins until it flushes.
   * Overwriting here would make a queued edit visibly revert — the single most
   * alarming thing an offline app can do.
   */
  async applyPulled(mutations: readonly PulledMutation[], through: number): Promise<PullResult> {
    return this.#driver.transaction(async (tx) => {
      const pendingRows = await tx.query<{ targetId: string }>('SELECT targetId FROM outbox');
      const pending = new Set(pendingRows.map((r) => r.targetId));

      let applied = 0;
      let skipped = 0;

      for (const mutation of mutations) {
        if (pending.has(mutation.targetId)) {
          skipped += 1;
          continue;
        }

        await this.#putRecord(
          tx,
          toLocalRecord(
            mutation.entity,
            mutation.targetId,
            mutation.op,
            mutation.payload,
            mutation.serverTs,
          ),
        );
        applied += 1;
      }

      await this.#writeMeta(tx, META.pulledThrough, through);
      return { applied, skipped };
    });
  }

  async pulledThrough(): Promise<number> {
    return parseMeta('pulledThrough', await this.#readMeta(this.#driver, META.pulledThrough)) ?? 0;
  }

  // ── Bookkeeping ───────────────────────────────────────────────────────────

  async getLastSyncAt(): Promise<number | null> {
    return parseMeta('lastSyncAt', await this.#readMeta(this.#driver, META.lastSyncAt)) ?? null;
  }

  async getLastError(): Promise<string | null> {
    return parseMeta('lastError', await this.#readMeta(this.#driver, META.lastError)) ?? null;
  }

  async setLastError(message: string): Promise<void> {
    await this.#driver.transaction((tx) => this.#writeMeta(tx, META.lastError, message));
  }

  async getDeviceId(): Promise<string | null> {
    return parseMeta('deviceId', await this.#readMeta(this.#driver, META.deviceId)) ?? null;
  }

  async quarantineCount(): Promise<number> {
    const [row] = await this.#driver.query<CountRow>('SELECT COUNT(*) AS n FROM quarantine');
    return row?.n ?? 0;
  }

  async listQuarantined(): Promise<Quarantined[]> {
    const rows = await this.#driver.query<{
      key: string;
      store: string;
      raw: string;
      reason: string;
      quarantinedAt: number;
    }>('SELECT * FROM quarantine ORDER BY quarantinedAt DESC');

    return rows
      .map((row) =>
        quarantinedSchema.safeParse({
          key: row.key,
          store: row.store,
          raw: safeJson(row.raw),
          reason: row.reason,
          quarantinedAt: row.quarantinedAt,
        }),
      )
      .filter((parsed) => parsed.success)
      .map((parsed) => parsed.data as Quarantined);
  }

  /**
   * Clears every table. Called on sign-out and org switch (C5) — cached tenant
   * data must not outlive the session that fetched it.
   *
   * DELETE rather than DROP so the schema and its `user_version` survive: a
   * wipe is a sign-out, not a downgrade, and re-running migrations on the next
   * open would be a slower path to the same place.
   */
  async wipe(): Promise<void> {
    await this.#driver.transaction(async (tx) => {
      await tx.run('DELETE FROM outbox');
      await tx.run('DELETE FROM records');
      await tx.run('DELETE FROM meta');
      await tx.run('DELETE FROM quarantine');
    });
  }

  async close(): Promise<void> {
    await this.#driver.close();
  }
}
