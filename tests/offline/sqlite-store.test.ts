import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import type { SqlDriver } from '@steading/app/db/driver';
import type { LocalStore } from '@steading/app/db/port';
import { openSqliteStore, StorageFullError } from '@steading/app/db/sqlite-store';
import { nodeSqlDriver } from '../support/sqlite';

/**
 * The SQLite `LocalStore` against the guarantees `port.ts` documents.
 *
 * Every assertion here is a MUST from that file rather than an invention. The
 * IndexedDB engine already satisfies them — it is the reference — so a
 * disagreement means the port is wrong or the new store is, and either is
 * worth knowing before a device ever runs it.
 */

let driver: SqlDriver;
let store: LocalStore;

beforeEach(async () => {
  driver = nodeSqlDriver();
  store = await openSqliteStore(driver);
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

    await driver.run("DELETE FROM meta WHERE key = 'nextClientSeq'");

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
    await driver.run('DROP TABLE records');
    await expect(store.enqueue(eggLog())).rejects.toThrow();

    const seq = await driver.get<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'nextClientSeq'",
    );
    // Still 1, not 2: the failed enqueue left nothing behind (invariant 5).
    expect(seq?.value).toBe('1');
    expect(await driver.all('SELECT * FROM outbox')).toHaveLength(1);
  });

  it('surfaces a full device as StorageFullError', async () => {
    const full = Object.assign(new Error('database or disk is full'), { code: 'SQLITE_FULL' });
    const original = driver.run.bind(driver);
    driver.run = async (sql, params) => {
      if (sql.includes('INSERT INTO outbox')) throw full;
      return original(sql, params);
    };

    await expect(store.enqueue(eggLog())).rejects.toBeInstanceOf(StorageFullError);
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
    await driver.run(
      `INSERT INTO outbox (id, schemaVersion, targetId, entity, op, payload, deviceId,
         clientSeq, clientTs, status, attempts, enqueuedAt)
       VALUES ('not-a-ulid', 1, 'x', 'eggLog', 'create', '{}', 'nope', 99, 1, 'queued', 0, 1)`,
    );

    const readable = await store.readOutboxBySeq();

    expect(readable.map((m) => m.id)).toEqual([good.id]);
    expect(await store.quarantineCount()).toBe(1);
    // The raw value is kept: "never drop" applies to corruption too.
    expect((await store.listQuarantined())[0]?.key).toBe('not-a-ulid');
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
    await driver.run('DELETE FROM outbox');

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
