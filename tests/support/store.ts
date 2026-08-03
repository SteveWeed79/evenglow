import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SqlDriver } from '@steading/core/db/driver';
import { openSqliteStore } from '@steading/core/db/sqlite-store';
import { localStore, resetLocalStore, setLocalStore } from '@steading/core/db/store';
import { ENTITIES } from '@steading/contracts';
import { nodeIds, nodeSqlDriver } from './sqlite';

/**
 * A fresh local store for each test, on SQLite.
 *
 * Replaces the IndexedDB harness this used to be. The engine suites were
 * written against IndexedDB because that was the only implementation when they
 * were written; the store is now one implementation with one contract, so
 * running them on anything else would be testing a backing the app does not
 * ship.
 *
 * **On a file, not in memory**, and that is what `simulateRestart` needs: an
 * in-memory database dies with its handle, so a restart against one would
 * always look like data loss whether or not the commit reached disk.
 */

let driver: SqlDriver | null = null;
let file: string | null = null;

export async function freshStore(): Promise<void> {
  resetLocalStore();
  if (driver) await driver.close().catch(() => undefined);

  file = join(mkdtempSync(join(tmpdir(), 'steading-')), 'store.db');
  driver = nodeSqlDriver(file);
  setLocalStore(await openSqliteStore(driver, nodeIds()));
}

/**
 * Simulates a hard restart: the process dies without a graceful close, and the
 * next access reopens from whatever actually reached disk.
 *
 * The old handle is abandoned rather than closed, deliberately — closing would
 * flush, which is exactly the thing a force-stop does not do.
 */
export async function simulateRestart(): Promise<void> {
  if (file === null) throw new Error('simulateRestart before freshStore');

  driver = nodeSqlDriver(file);
  resetLocalStore();
  setLocalStore(await openSqliteStore(driver, nodeIds()));
}

/** The current driver, for suites that need to injure the storage layer. */
export function currentDriver(): SqlDriver {
  if (driver === null) throw new Error('No driver; call freshStore first');
  return driver;
}

// ── readers, through the port ────────────────────────────────────────────────

/**
 * The suites used to read IndexedDB directly. They read the port now, which is
 * the only surface the app has — so a test asserting "the row is on disk" is
 * asserting the same thing the app would see rather than a layer beneath it.
 */

export async function readOutboxBySeq() {
  return localStore().readOutboxBySeq();
}

/** Every projected record, across every entity. */
export async function readAllRecords() {
  const all = await Promise.all(ENTITIES.map((e) => localStore().readRecordsByEntity(e)));
  return all.flat();
}

export async function readRecordsByEntity(entity: string) {
  return localStore().readRecordsByEntity(entity);
}

export async function listQuarantined() {
  return localStore().listQuarantined();
}

export async function quarantineCount(): Promise<number> {
  return (await localStore().listQuarantined()).length;
}

export async function wipeLocalData(): Promise<void> {
  await localStore().wipe();
}

/** Writes a row straight into the outbox, bypassing every guard. */
export async function corruptRow(overrides: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    id: 'corrupt',
    schemaVersion: 1,
    targetId: 'x',
    entity: 'eggLog',
    op: 'create',
    payload: '{}',
    deviceId: 'nope',
    clientSeq: 99,
    clientTs: 1,
    status: 'queued',
    attempts: 0,
    enqueuedAt: 1,
    ...overrides,
  };
  await currentDriver().run(
    `INSERT INTO outbox (id, schemaVersion, targetId, entity, op, payload, deviceId,
       clientSeq, clientTs, status, attempts, enqueuedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id, row.schemaVersion, row.targetId, row.entity, row.op, row.payload,
      row.deviceId, row.clientSeq, row.clientTs, row.status, row.attempts, row.enqueuedAt,
    ] as never,
  );
}

/**
 * Writes an unreadable row into the projection, bypassing every guard.
 *
 * SQLite is loosely typed, so a string in an INTEGER column is stored as
 * written — which is exactly the corruption these suites need: a row that is
 * on disk, is found by the read, and cannot be parsed.
 */
export async function corruptRecordRow(key: string, entity = 'flock') {
  await currentDriver().run(
    'INSERT INTO records (key, entity, targetId, value, updatedAt, deleted) VALUES (?, ?, ?, ?, ?, ?)',
    [key, entity, 'x', 'not json', 'not a number', 0] as never,
  );
}

/** Deletes a row from the outbox behind the store's back. */
export async function deleteOutboxRow(id: string): Promise<void> {
  await currentDriver().run('DELETE FROM outbox WHERE id = ?', [id] as never);
}

/** Deletes a meta key behind the store's back — a corrupted counter. */
export async function deleteMetaKey(key: string): Promise<void> {
  await currentDriver().run('DELETE FROM meta WHERE key = ?', [key] as never);
}

/** How many meta rows survive. A wipe must leave none. */
export async function metaCount(): Promise<number> {
  const row = await currentDriver().get<{ n: number }>('SELECT COUNT(*) AS n FROM meta');
  return row?.n ?? 0;
}
