import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import type { SqlDriver, SqlOps } from '@steading/core/db/driver';
import type { LocalStore } from '@steading/core/db/port';
import { openSqliteStore } from '@steading/core/db/sqlite-store';
import { createExpoDriver } from '@steading/mobile/db/expo-driver';
import { nodeIds, nodeSqlDriver } from '../support/sqlite';
import { fakeExpoConnection } from '../support/expo-sqlite';

/**
 * One suite, every driver.
 *
 * This was the migration's correctness oracle: `port.ts` describes what the
 * storage layer must do, and IndexedDB was the reference implementation the
 * SQLite one had to match. That job is finished — IndexedDB is gone with the
 * web client — and the suite keeps earning its place for a different reason.
 * Every driver underneath `openSqliteStore` is held to the same MUSTs, so a
 * new one is proven by the assertions that proved the last, rather than by a
 * handful of driver-shaped tests written beside it.
 *
 * Every assertion is a MUST from `port.ts`, not an invention for the occasion.
 *
 * What it does NOT settle is durability. Both run in this process, and D9
 * changed exactly the characteristics a force-stop exercises — that claim
 * belongs to the on-device gate (S6) and cannot be borrowed from here.
 */

/**
 * The faults are the interesting half, and each storage layer expresses them
 * differently — a dropped table is not a broken object store. So the BACKING
 * knows how to injure itself and the ASSERTIONS stay shared, rather than the
 * faults being dropped from the parameterised run for being awkward.
 */
interface Backing {
  readonly name: string;
  open(): Promise<LocalStore>;
  /** Lose the sequence counter, keeping the outbox. */
  loseSequenceCounter(): Promise<void>;
  /** Lose the queue itself — eviction, a failed migration, a hand-edit. */
  emptyOutbox(): Promise<void>;
  /** Put a row in the outbox that cannot be read back. */
  writeUnreadableOutboxRow(key: string): Promise<void>;
  /**
   * The raw row, past every reader.
   *
   * Invariant 7 is about what is in the table, and every reader in the store
   * deliberately hides an applied row — so asserting through them cannot tell
   * "marked" from "deleted", which is exactly the confusion that let a DELETE
   * live here.
   */
  rawOutboxRow(id: string): Promise<{ status: string } | undefined>;
  /** Make the next write to `table` fail as a full device. Returns a restore. */
  failNextWriteTo(table: 'outbox' | 'records'): () => void;
}

/**
 * Both SQL drivers get the same faults, so the shape is written once.
 *
 * The Expo driver joining here is the point of R2. It is not a second
 * implementation of the store — it is the same store over a different
 * connection — so the thing worth proving is that the connection is faithful,
 * and the way to prove that is the suite that already holds the store to
 * `port.ts`, not a handful of driver-shaped assertions beside it.
 */
function sqlBacking(name: string, make: () => SqlDriver): Backing {
  let driver: SqlDriver | null = null;

  return {
    name,
    async open() {
      driver = make();
      return openSqliteStore(driver, nodeIds());
    },
    async loseSequenceCounter() {
      await driver!.run("DELETE FROM meta WHERE key = 'nextClientSeq'");
    },
    async emptyOutbox() {
      await driver!.run('DELETE FROM outbox');
    },
    async writeUnreadableOutboxRow(key) {
      await driver!.run(
        `INSERT INTO outbox (id, schemaVersion, targetId, entity, op, payload, deviceId,
           clientSeq, clientTs, status, attempts, enqueuedAt)
         VALUES (?, 1, 'x', 'eggLog', 'create', '{}', 'nope', 99, 1, 'queued', 0, 1)`,
        [key],
      );
    },
    async rawOutboxRow(id) {
      return driver!.get<{ status: string }>('SELECT status FROM outbox WHERE id = ?', [id]);
    },
    /**
     * The fault has to be injected into the TRANSACTION'S handle, not only the
     * driver's own `run`.
     *
     * Since every statement inside a transaction goes through the handle the
     * body was given, patching `driver.run` alone injures nothing that enqueue
     * actually calls — which is the same reason the fix works: there is exactly
     * one object a transaction's statements can travel through.
     */
    failNextWriteTo(table) {
      const target = driver!;
      const originalRun = target.run.bind(target);
      const originalTransaction = target.transaction.bind(target);
      const full = Object.assign(new Error('database or disk is full'), { code: 'SQLITE_FULL' });

      const injure = (ops: SqlOps): SqlOps => ({
        run: async (sql, params) => {
          if (sql.includes(`INSERT INTO ${table}`)) throw full;
          return ops.run(sql, params);
        },
        all: (sql, params) => ops.all(sql, params),
        get: (sql, params) => ops.get(sql, params),
        transaction: (work) => ops.transaction(work),
      });

      target.run = async (sql, params) => {
        if (sql.includes(`INSERT INTO ${table}`)) throw full;
        return originalRun(sql, params);
      };
      target.transaction = (work) => originalTransaction((tx) => work(injure(tx)));

      return () => {
        target.run = originalRun;
        target.transaction = originalTransaction;
      };
    },
  };
}

const BACKINGS: Backing[] = [
  sqlBacking('sqlite', () => nodeSqlDriver()),
  sqlBacking('expo-sqlite', () => createExpoDriver(fakeExpoConnection())),
];

describe.each(BACKINGS)('LocalStore — $name', (backing) => {
  let store: LocalStore;

  beforeEach(async () => {
    store = await backing.open();
  });

  afterEach(async () => {
    await store.close();
  });

  const eggLog = (over: Partial<Parameters<LocalStore['enqueue']>[0]> = {}) => ({
    entity: 'eggLog' as const,
    op: 'create' as const,
    targetId: newId(),
    payload: { occurredAt: 1_700_000_000_000, flockId: newId(), count: 12 },
    ...over,
  });

  describe('enqueue', () => {
    it('writes the outbox row and the projection together', async () => {
      const queued = await store.enqueue(eggLog());

      expect(queued.status).toBe('queued');
      expect(await store.readOutboxBySeq()).toHaveLength(1);
      expect(await store.readRecordsByEntity('eggLog')).toHaveLength(1);
    });

    it('mints monotonic sequence numbers', async () => {
      for (let i = 0; i < 5; i++) await store.enqueue(eggLog());

      const seqs = (await store.readOutboxBySeq()).map((m) => m.clientSeq);
      expect(seqs).toEqual([0, 1, 2, 3, 4]);
    });

    /**
     * The MUST from port.ts: a lost counter floors from the outbox rather than
     * restarting at zero, which would reuse sequence numbers and break ordering
     * with nothing to report it.
     */
    it('floors the sequence from the outbox when the counter is lost', async () => {
      for (let i = 0; i < 3; i++) await store.enqueue(eggLog());

      await backing.loseSequenceCounter();

      const next = await store.enqueue(eggLog());
      expect(next.clientSeq).toBe(3);
    });

    it('reuses one deviceId across enqueues', async () => {
      const first = await store.enqueue(eggLog());
      const second = await store.enqueue(eggLog());

      expect(second.deviceId).toBe(first.deviceId);
      expect(await store.getDeviceId()).toBe(first.deviceId);
    });

    it('consumes no sequence number when the write fails', async () => {
      await store.enqueue(eggLog());

      // Break the projection write; the whole unit must roll back.
      const restore = backing.failNextWriteTo('records');
      await expect(store.enqueue(eggLog())).rejects.toThrow();
      restore();

      // Nothing partial survived, and the next enqueue takes seq 1 rather than
      // 2 — the failed attempt consumed no sequence number (invariant 5).
      expect(await store.readOutboxBySeq()).toHaveLength(1);
      const next = await store.enqueue(eggLog());
      expect(next.clientSeq).toBe(1);
    });

    it('surfaces a full device as StorageFullError', async () => {
      const restore = backing.failNextWriteTo('outbox');
      // Both stores map their own native full-disk error onto one type, so the
      // Tally can say "out of space" rather than showing a driver's words.
      await expect(store.enqueue(eggLog())).rejects.toMatchObject({
        name: 'StorageFullError',
      });
      restore();
    });
  });

  describe('resolveBatch', () => {
    it('clears applied and duplicate, and counts them', async () => {
      const a = await store.enqueue(eggLog());
      const b = await store.enqueue(eggLog());

      await store.resolveBatch(
        [a, b],
        [
          { id: a.id, status: 'applied' },
          { id: b.id, status: 'duplicate' },
        ],
      );

      expect((await store.counts()).total).toBe(0);
      expect((await store.checkIntegrity()).cleared).toBe(2);
    });

    /**
     * Hard invariant 7: never delete a mutation row on success, mark it
     * `applied`. History is the audit trail and the duplicate defence.
     *
     * This was a `DELETE`. Nothing above the store could tell the difference,
     * which is why it survived — "the row is gone" and "the row was never
     * written" look identical from every reader in the app.
     */
    it('marks an accepted mutation rather than deleting it (invariant 7)', async () => {
      const a = await store.enqueue(eggLog());

      await store.resolveBatch([a], [{ id: a.id, status: 'applied' }]);

      const row = await backing.rawOutboxRow(a.id);
      expect(row).toBeDefined();
      expect(row?.status).toBe('applied');
      // Still off the queue for every reader that means outstanding work.
      expect(await store.readOutboxBySeq()).toEqual([]);
      expect(await store.counts()).toEqual({ queued: 0, rejected: 0, total: 0 });
    });

    it('reports no loss once acknowledged rows stay in the table', async () => {
      const a = await store.enqueue(eggLog());
      const b = await store.enqueue(eggLog());

      await store.resolveBatch(
        [a, b],
        [
          { id: a.id, status: 'applied' },
          { id: b.id, status: 'duplicate' },
        ],
      );

      // everEnqueued 2, cleared 2, so nothing should be outstanding — and the
      // two marked rows must not read as an excess.
      const report = await store.checkIntegrity();
      expect(report.expectedInOutbox).toBe(0);
      expect(report.actualInOutbox).toBe(0);
    });

    /** An applied row is on the server already, so it can never hold hydration up. */
    it('does not let an applied row block that record hydrating', async () => {
      const a = await store.enqueue(eggLog());
      await store.resolveBatch([a], [{ id: a.id, status: 'applied' }]);

      const result = await store.applyPulled(
        [
          {
            schemaVersion: 1,
            id: newId(),
            targetId: a.targetId,
            entity: 'eggLog',
            op: 'create',
            payload: { occurredAt: 1, flockId: newId(), count: 4 },
            deviceId: '00000000-0000-4000-8000-0000000000ff',
            clientSeq: 0,
            clientTs: 1,
            serverTs: 5_000,
          },
        ],
        { through: 5_000, throughId: newId() },
      );

      expect(result.paused).toBe(false);
      expect(result.applied).toBe(1);
    });

    it('keeps a rejection, with its reason, and never drops it (A6)', async () => {
      const a = await store.enqueue(eggLog());

      await store.resolveBatch([a], [{ id: a.id, status: 'rejected', reason: 'Your role cannot.' }]);

      const rejected = await store.listRejected();
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.rejectedReason).toBe('Your role cannot.');
    });

    it('leaves a mutation the server did not mention queued', async () => {
      const a = await store.enqueue(eggLog());
      const b = await store.enqueue(eggLog());

      // Resending is safe, so silence must never be read as success.
      await store.resolveBatch([a, b], [{ id: a.id, status: 'applied' }]);

      const remaining = await store.readOutboxBySeq();
      expect(remaining.map((m) => m.id)).toEqual([b.id]);
      expect(remaining[0]?.status).toBe('queued');
    });
  });

  describe('attempts and the inbox', () => {
    it('counts attempts without changing status', async () => {
      const a = await store.enqueue(eggLog());

      await store.recordAttempt([a], 'Network error');
      await store.recordAttempt([a], 'Network error');

      const [row] = await store.readOutboxBySeq();
      expect(row?.attempts).toBe(2);
      expect(row?.status).toBe('queued');
      expect(row?.lastError).toBe('Network error');
    });

    it('parks only what has reached the ceiling', async () => {
      const a = await store.enqueue(eggLog());
      const b = await store.enqueue(eggLog());

      await store.recordAttempt([a], 'boom');
      for (let i = 0; i < 6; i++) await store.recordAttempt([b], 'boom');

      await store.rejectExhausted([a, b], 6, 'The server will not accept this.');

      const rejected = await store.listRejected();
      expect(rejected.map((m) => m.id)).toEqual([b.id]);
    });

    it('returns a retried mutation to the queue with a clean attempt count', async () => {
      const a = await store.enqueue(eggLog());
      await store.recordAttempt([a], 'boom');
      await store.resolveBatch([a], [{ id: a.id, status: 'rejected', reason: 'no' }]);

      await store.retryRejected(a.id);

      const [row] = await store.readOutboxBySeq();
      expect(row?.status).toBe('queued');
      // Or the retry inherits the ceiling that parked it and is refused unsent.
      expect(row?.attempts).toBe(0);
    });

    it('replaces the payload when the user edits before retrying', async () => {
      const a = await store.enqueue(eggLog());
      await store.resolveBatch([a], [{ id: a.id, status: 'rejected', reason: 'bad count' }]);

      await store.retryRejected(a.id, { occurredAt: 1, flockId: newId(), count: 99 });

      const [row] = await store.readOutboxBySeq();
      expect((row?.payload as { count: number }).count).toBe(99);
    });

    /**
     * A discard is a resolution. Skipping the counter makes checkIntegrity later
     * report data loss for something the user did on purpose.
     */
    it('counts a discard as cleared', async () => {
      const a = await store.enqueue(eggLog());
      await store.resolveBatch([a], [{ id: a.id, status: 'rejected', reason: 'no' }]);

      await store.discardRejected(a.id);

      expect(await store.listRejected()).toEqual([]);
      expect((await store.checkIntegrity()).missing).toBe(0);
    });
  });

  describe('reading', () => {
    it('returns the outbox in clientSeq order', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 4; i++) ids.push((await store.enqueue(eggLog())).id);

      expect((await store.readOutboxBySeq()).map((m) => m.id)).toEqual(ids);
    });

    /**
     * One unreadable row must not stop every mutation behind it from ever being
     * sent — the failure that made corruption able to wedge the whole queue.
     */
    it('quarantines an unreadable row instead of throwing past it', async () => {
      const good = await store.enqueue(eggLog());
      await backing.writeUnreadableOutboxRow('not-a-ulid');

      const readable = await store.readOutboxBySeq();

      expect(readable.map((m) => m.id)).toEqual([good.id]);
      expect(await store.quarantineCount()).toBe(1);
      // The raw value is kept: "never drop" applies to corruption too.
      expect((await store.listQuarantined())[0]?.key).toBe('outbox:not-a-ulid');
    });

    it('reads projections by entity', async () => {
      await store.enqueue(eggLog());
      await store.enqueue({
        entity: 'flock',
        op: 'create',
        targetId: newId(),
        payload: { name: 'The Dexters', species: 'cattle', count: 4 },
      });

      expect(await store.readRecordsByEntity('eggLog')).toHaveLength(1);
      expect(await store.readRecordsByEntity('flock')).toHaveLength(1);
      expect(await store.readRecordsByEntity('equipment')).toEqual([]);
    });

    /**
     * A different number from `counts()`, and the difference is the point.
     *
     * The outbox counts mutations; this counts what they made. A group created
     * and then edited is two of the first and one of the second, and the
     * exposure notice says "records" — see `backup/exposure.ts`.
     */
    it('counts records across every entity, not the mutations behind them', async () => {
      const flock = newId();
      await store.enqueue({
        entity: 'flock',
        op: 'create',
        targetId: flock,
        payload: { name: 'The Dexters', species: 'cattle', count: 4 },
      });
      await store.enqueue({ entity: 'flock', op: 'update', targetId: flock, payload: { count: 5 } });
      await store.enqueue(eggLog());

      expect((await store.counts()).total).toBe(3);
      expect(await store.countRecords()).toBe(2);
    });

    /**
     * Its own pair of methods rather than a flag, because a copy taken last
     * spring is not protection. See `backup/exposure.ts`.
     */
    it('remembers when a backup was last taken, and starts with none', async () => {
      expect(await store.getLastBackupAt()).toBeNull();

      await store.setLastBackupAt(1_700_000_000_000);
      expect(await store.getLastBackupAt()).toBe(1_700_000_000_000);

      await store.setLastBackupAt(1_800_000_000_000);
      expect(await store.getLastBackupAt()).toBe(1_800_000_000_000);
    });

    it('reports counts and integrity', async () => {
      const a = await store.enqueue(eggLog());
      await store.enqueue(eggLog());
      await store.resolveBatch([a], [{ id: a.id, status: 'applied' }]);

      expect(await store.counts()).toEqual({ queued: 1, rejected: 0, total: 1 });

      const report = await store.checkIntegrity();
      expect(report.everEnqueued).toBe(2);
      expect(report.cleared).toBe(1);
      expect(report.missing).toBe(0);
    });

    it('reports missing rows when storage loses work', async () => {
      await store.enqueue(eggLog());
      await store.enqueue(eggLog());

      // Eviction, a failed migration, a hand-edit.
      await backing.emptyOutbox();

      expect((await store.checkIntegrity()).missing).toBe(2);
    });
  });

  describe('hydration', () => {
    const pulled = (over: Record<string, unknown> = {}) => ({
      schemaVersion: 1,
      id: newId(),
      targetId: newId(),
      entity: 'flock' as const,
      op: 'create' as const,
      payload: { name: 'From the server', species: 'goat', count: 2 },
      deviceId: '00000000-0000-4000-8000-0000000000ff',
      clientSeq: 0,
      clientTs: 1,
      serverTs: 1_000,
      ...over,
    });

    it('applies a page and advances both halves of the watermark', async () => {
      const mutation = pulled();

      const result = await store.applyPulled([mutation], { through: 1_000, throughId: mutation.id });

      expect(result).toEqual({ applied: 1, skipped: 0, paused: false });
      // The ULID half is what stops a resume from re-reading a millisecond.
      expect(await store.pulledThrough()).toEqual({ through: 1_000, throughId: mutation.id });
    });

    it('never clobbers a record this device is still holding', async () => {
      const local = await store.enqueue({
        entity: 'flock',
        op: 'create',
        targetId: newId(),
        payload: { name: 'My name for it', species: 'goat', count: 9 },
      });

      const result = await store.applyPulled(
        [pulled({ targetId: local.targetId, payload: { name: 'Server name' } })],
        { through: 2_000, throughId: newId() },
      );

      // A queued edit visibly reverting is the most alarming thing an offline
      // app can do, so local optimistic state wins until it flushes.
      expect(result).toEqual({ applied: 0, skipped: 1, paused: true });
      const [record] = await store.readRecordsByEntity('flock');
      expect(record?.value).toMatchObject({ name: 'My name for it' });
    });

    /**
     * The silent, permanent half of that skip, which used to be missing.
     *
     * Holding the record back was always right. Advancing the watermark past
     * it in the same transaction was not: the server was never asked for that
     * row again, so a record edited on two phones lost one side outright, with
     * nothing on any screen to say so.
     */
    it('does not advance the watermark past a record it held back', async () => {
      const local = await store.enqueue({
        entity: 'flock',
        op: 'create',
        targetId: newId(),
        payload: { name: 'My name for it', species: 'goat', count: 9 },
      });

      await store.applyPulled([pulled({ targetId: local.targetId })], {
        through: 2_000,
        throughId: newId(),
      });

      // Untouched, so the next pull asks for that page again.
      expect(await store.pulledThrough()).toEqual({ through: 0, throughId: null });
    });

    it('advances only as far as the last row it actually wrote', async () => {
      const local = await store.enqueue({
        entity: 'flock',
        op: 'create',
        targetId: newId(),
        payload: { name: 'Mine', species: 'goat', count: 9 },
      });

      const first = pulled({ serverTs: 1_000 });
      const held = pulled({ targetId: local.targetId, serverTs: 1_500 });
      const behind = pulled({ serverTs: 2_000 });

      const result = await store.applyPulled([first, held, behind], {
        through: 2_000,
        throughId: behind.id,
      });

      // It stops AT the held row rather than stepping over it, so the row
      // behind it is still owed and is counted as such.
      expect(result).toEqual({ applied: 1, skipped: 2, paused: true });
      expect(await store.pulledThrough()).toEqual({ through: 1_000, throughId: first.id });
    });

    /**
     * A rejected mutation never flushes — it waits in the inbox for a person.
     * Treating it as pending meant the server's version of that record could
     * never arrive again on this device, for the life of the install.
     */
    it('hydrates a record whose local edit was rejected', async () => {
      const local = await store.enqueue({
        entity: 'flock',
        op: 'create',
        targetId: newId(),
        payload: { name: 'Refused', species: 'goat', count: 9 },
      });
      await store.rejectExhausted([local], 0, 'The server refused that record.');

      const mutation = pulled({
        targetId: local.targetId,
        payload: { name: 'Server name', species: 'goat', count: 2 },
      });
      const result = await store.applyPulled([mutation], {
        through: 3_000,
        throughId: mutation.id,
      });

      expect(result).toEqual({ applied: 1, skipped: 0, paused: false });
      const [record] = await store.readRecordsByEntity('flock');
      expect(record?.value).toMatchObject({ name: 'Server name' });
    });

    it('starts from nothing on a device that has never pulled', async () => {
      expect(await store.pulledThrough()).toEqual({ through: 0, throughId: null });
    });
  });

  describe('wipe (C5)', () => {
    it('clears every table and leaves the store usable', async () => {
      await store.enqueue(eggLog());
      await store.setLastError('something');

      await store.wipe();

      expect(await store.counts()).toEqual({ queued: 0, rejected: 0, total: 0 });
      expect(await store.readRecordsByEntity('eggLog')).toEqual([]);
      expect(await store.getDeviceId()).toBeNull();
      expect(await store.getLastError()).toBeNull();

      // On a shared barn tablet the next person to sign in must not read the
      // previous farm's records — and must still be able to log.
      await expect(store.enqueue(eggLog())).resolves.toBeTruthy();
    });
  });

});
