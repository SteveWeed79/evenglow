import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import type { SqlDriver } from '@steading/app/db/driver';
import type { LocalStore } from '@steading/app/db/port';
import { openSqliteStore } from '@steading/app/db/sqlite-store';
import { idbLocalStore } from '@/client/db/idb-store';
import { nodeSqlDriver } from '../support/sqlite';
import { freshDb } from '../support/idb';
import { db as idb } from '@/client/db/open';

/**
 * One suite, both stores.
 *
 * This is the migration's correctness oracle made executable rather than
 * asserted. `port.ts` describes what the storage layer must do; the IndexedDB
 * engine is the reference implementation that has passed the Phase 2 exit
 * gate; the SQLite one has to behave identically or the port is wrong, or it
 * is. Reading the two side by side would not settle that. Running them
 * against the same expectations does.
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
  /** Make the next write to `table` fail as a full device. Returns a restore. */
  failNextWriteTo(table: 'outbox' | 'records'): () => void;
}

let sqlite: SqlDriver | null = null;

const BACKINGS: Backing[] = [
  {
    name: 'sqlite',
    async open() {
      sqlite = nodeSqlDriver();
      return openSqliteStore(sqlite);
    },
    async loseSequenceCounter() {
      await sqlite!.run("DELETE FROM meta WHERE key = 'nextClientSeq'");
    },
    async emptyOutbox() {
      await sqlite!.run('DELETE FROM outbox');
    },
    async writeUnreadableOutboxRow(key) {
      await sqlite!.run(
        `INSERT INTO outbox (id, schemaVersion, targetId, entity, op, payload, deviceId,
           clientSeq, clientTs, status, attempts, enqueuedAt)
         VALUES (?, 1, 'x', 'eggLog', 'create', '{}', 'nope', 99, 1, 'queued', 0, 1)`,
        [key],
      );
    },
    failNextWriteTo(table) {
      const original = sqlite!.run.bind(sqlite!);
      const full = Object.assign(new Error('database or disk is full'), { code: 'SQLITE_FULL' });
      sqlite!.run = async (sql, params) => {
        if (sql.includes(`INSERT INTO ${table}`)) throw full;
        return original(sql, params);
      };
      return () => {
        sqlite!.run = original;
      };
    },
  },
  {
    name: 'indexeddb',
    async open() {
      await freshDb();
      return idbLocalStore();
    },
    async loseSequenceCounter() {
      await (await idb()).delete('meta', 'nextClientSeq');
    },
    async emptyOutbox() {
      await (await idb()).clear('outbox');
    },
    async writeUnreadableOutboxRow(key) {
      /**
       * Carries a clientSeq deliberately. IndexedDB omits a record from an
       * index when its key path is missing, so a corrupt row WITHOUT one is
       * invisible to the byClientSeq read entirely — never sent, never
       * quarantined, but still counted by checkIntegrity. That divergence is
       * real and is noted in the suite below; it is not what this test is
       * about, which is a row that IS found and cannot be parsed.
       */
      await (await idb()).put('outbox', { id: key, clientSeq: 99, nonsense: true } as never);
    },
    failNextWriteTo(table) {
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ): IDBRequest<IDBValidKey> {
        if (this.name === table) {
          throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        }
        return original.call(this, value, key);
      };
      return () => {
        IDBObjectStore.prototype.put = original;
      };
    },
  },
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

      expect(result).toEqual({ applied: 1, skipped: 0 });
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
      expect(result).toEqual({ applied: 0, skipped: 1 });
      const [record] = await store.readRecordsByEntity('flock');
      expect(record?.value).toMatchObject({ name: 'My name for it' });
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
