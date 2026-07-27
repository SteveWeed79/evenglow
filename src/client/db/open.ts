import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import type { z } from 'zod';
import { migrateEnvelope } from './migrate';
import {
  DB_NAME,
  DB_VERSION,
  type LocalRecord,
  localRecordSchema,
  META,
  type metaSchemas,
  parseMeta,
  type Quarantined,
  quarantinedSchema,
  type QueuedMutation,
  queuedMutationSchema,
  STORES,
} from './schema';

export interface SteadingDB extends DBSchema {
  outbox: {
    key: string;
    value: QueuedMutation;
    indexes: { byClientSeq: number; byStatus: string };
  };
  records: {
    key: string;
    value: LocalRecord;
    indexes: { byEntity: string };
  };
  meta: {
    key: string;
    value: unknown;
  };
  quarantine: {
    key: string;
    value: Quarantined;
  };
}

export type SteadingDatabase = IDBPDatabase<SteadingDB>;

let handle: Promise<SteadingDatabase> | undefined;

/**
 * Opens (and memoises) the database.
 *
 * Migrations are additive: each version block only creates what it introduces,
 * so upgrading a device that has been offline across two deploys never
 * rewrites queued work.
 */
export function db(): Promise<SteadingDatabase> {
  handle ??= openDB<SteadingDB>(DB_NAME, DB_VERSION, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        const outbox = database.createObjectStore(STORES.outbox, { keyPath: 'id' });
        // Flush order is by clientSeq, so that index is on the hot path.
        outbox.createIndex('byClientSeq', 'clientSeq');
        outbox.createIndex('byStatus', 'status');

        const records = database.createObjectStore(STORES.records, { keyPath: 'key' });
        records.createIndex('byEntity', 'entity');

        database.createObjectStore(STORES.meta);
      }

      // v2 — corruption quarantine. Additive: existing queued work is
      // untouched, which is the whole point of never destructively migrating
      // an append-only outbox.
      if (oldVersion < 2) {
        database.createObjectStore(STORES.quarantine, { keyPath: 'key' });
      }
    },

    blocked() {
      console.warn('Steading: another tab is holding an older database version open.');
    },

    terminated() {
      // The browser killed the connection (eviction, crash). Drop the handle so
      // the next call reopens rather than using a dead one.
      handle = undefined;
    },
  });

  return handle;
}

/** Test seam: forget the memoised handle without closing other users' connections. */
export function resetDbHandle(): void {
  handle = undefined;
}

/**
 * Closes the connection and forgets the handle. Used on sign-out, and by
 * tests to simulate the app being killed — reopening from scratch is exactly
 * what the restart-survival gate exercises.
 */
export async function closeDb(): Promise<void> {
  if (!handle) return;
  const current = handle;
  handle = undefined;
  (await current).close();
}

// ── Parsed reads ─────────────────────────────────────────────────────────────
// Nothing below returns a raw IndexedDB value, and nothing throws on a bad
// one. A record that fails its schema is quarantined: it stays recoverable,
// it is counted in diagnostics, and — critically — it does not stop the rows
// behind it from being read.

export class CorruptRecordError extends Error {
  constructor(store: string, key: string, issue: string) {
    super(`Corrupt ${store} record "${key}": ${issue}`);
    this.name = 'CorruptRecordError';
  }
}

/**
 * Moves an unreadable row out of the way, keeping its raw value.
 *
 * Deliberately not a delete. "Never drop" applies to corruption too — the row
 * cannot be sent, but a user is entitled to know it existed, and the raw value
 * is the only chance of ever recovering what it said.
 */
export async function quarantine(
  store: string,
  key: string,
  raw: unknown,
  reason: string,
): Promise<void> {
  const record: Quarantined = {
    key: `${store}:${key}`,
    store,
    raw,
    reason,
    quarantinedAt: Date.now(),
  };
  await (await db()).put(STORES.quarantine, record);
}

export async function quarantineCount(): Promise<number> {
  return (await db()).count(STORES.quarantine);
}

export async function listQuarantined(): Promise<Quarantined[]> {
  const raw = await (await db()).getAll(STORES.quarantine);
  return raw.flatMap((value) => {
    const parsed = quarantinedSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * Meta reads return undefined when absent or unreadable rather than throwing.
 * These are single scalars with sensible defaults, and a corrupt one must not
 * be able to stop the app from opening — unlike a corrupt queued mutation,
 * which is real work and is surfaced.
 */
export async function getMeta<K extends keyof typeof metaSchemas>(
  key: K,
): Promise<z.infer<(typeof metaSchemas)[K]> | undefined> {
  return parseMeta(key, await (await db()).get(STORES.meta, META[key]));
}

export async function setMeta<K extends keyof typeof metaSchemas>(
  key: K,
  value: z.infer<(typeof metaSchemas)[K]>,
): Promise<void> {
  await (await db()).put(STORES.meta, value, META[key]);
}

/**
 * Outbox entries ordered by clientSeq — the order they must be sent in (A4).
 *
 * An unreadable row is quarantined rather than thrown, so one bad record
 * cannot stop every other mutation behind it from ever being sent.
 */
export async function readOutboxBySeq(limit?: number): Promise<QueuedMutation[]> {
  const database = await db();
  const raw = await database.getAllFromIndex(STORES.outbox, 'byClientSeq');

  const parsed: QueuedMutation[] = [];
  const corrupt: { key: string; value: unknown; reason: string }[] = [];
  const migrated: QueuedMutation[] = [];

  for (const value of raw) {
    // Envelope migration (A7) runs before validation: a mutation written by an
    // older build is walked up to the current version rather than being
    // condemned as corrupt for having an old shape.
    let candidate: unknown = value;
    let wasMigrated = false;

    if (typeof value === 'object' && value !== null) {
      try {
        const upgraded = migrateEnvelope(value as Record<string, unknown>);
        wasMigrated = upgraded !== value;
        candidate = upgraded;
      } catch {
        // Falls through to the corrupt path below with its raw value intact.
      }
    }

    const result = queuedMutationSchema.safeParse(candidate);
    if (result.success) {
      parsed.push(result.data);
      if (wasMigrated) migrated.push(result.data);
      continue;
    }

    // The id is the store's keyPath; if even that is unreadable, fall back to
    // something stable enough to quarantine under.
    const key =
      typeof (value as { id?: unknown }).id === 'string'
        ? (value as { id: string }).id
        : `unknown-${corrupt.length}`;

    corrupt.push({
      key,
      value,
      reason: result.error.issues[0]?.message ?? 'unreadable',
    });
  }

  // Persist the upgrade, so the walk happens once rather than on every read.
  for (const record of migrated) {
    await database.put(STORES.outbox, record).catch(() => undefined);
  }

  for (const bad of corrupt) {
    await quarantine(STORES.outbox, bad.key, bad.value, bad.reason);
    await database.delete(STORES.outbox, bad.key).catch(() => undefined);
  }

  return limit === undefined ? parsed : parsed.slice(0, limit);
}

export async function readRecord(key: string): Promise<LocalRecord | undefined> {
  const raw = await (await db()).get(STORES.records, key);
  if (raw === undefined) return undefined;

  const parsed = localRecordSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  await quarantine(STORES.records, key, raw, parsed.error.issues[0]?.message ?? 'unreadable');
  return undefined;
}

/** Parses a batch of projections, quarantining any that no longer read. */
async function parseRecords(raw: unknown[]): Promise<LocalRecord[]> {
  const good: LocalRecord[] = [];
  const bad: { key: string; value: unknown; reason: string }[] = [];

  for (const value of raw) {
    const parsed = localRecordSchema.safeParse(value);
    if (parsed.success) {
      good.push(parsed.data);
      continue;
    }
    const key =
      typeof (value as { key?: unknown }).key === 'string'
        ? (value as { key: string }).key
        : `unknown-${bad.length}`;
    bad.push({ key, value, reason: parsed.error.issues[0]?.message ?? 'unreadable' });
  }

  const database = await db();
  for (const entry of bad) {
    await quarantine(STORES.records, entry.key, entry.value, entry.reason);
    await database.delete(STORES.records, entry.key).catch(() => undefined);
  }

  return good;
}

/**
 * Projections for one entity kind.
 *
 * Indexed rather than a full scan: the read path runs on every sync publish,
 * and parsing every record in the database to find the groups would get slower
 * with each day's logging — exactly the wrong shape for a screen that has to
 * be up in five seconds from cold.
 */
export async function readRecordsByEntity(entity: string): Promise<LocalRecord[]> {
  const raw = await (await db()).getAllFromIndex(STORES.records, 'byEntity', entity);
  return parseRecords(raw);
}

export async function readAllRecords(): Promise<LocalRecord[]> {
  return parseRecords(await (await db()).getAll(STORES.records));
}

/**
 * Wipes every store. Called on sign-out and on org switch (C5) — cached
 * tenant data must not outlive the session that fetched it.
 */
export async function wipeLocalData(): Promise<void> {
  const database = await db();
  const tx = database.transaction(
    [STORES.outbox, STORES.records, STORES.meta, STORES.quarantine],
    'readwrite',
  );
  await Promise.all([
    tx.objectStore(STORES.outbox).clear(),
    tx.objectStore(STORES.records).clear(),
    tx.objectStore(STORES.meta).clear(),
    tx.objectStore(STORES.quarantine).clear(),
    tx.done,
  ]);
}
