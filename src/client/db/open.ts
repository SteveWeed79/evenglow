import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import type { z } from 'zod';
import {
  DB_NAME,
  DB_VERSION,
  type LocalRecord,
  localRecordSchema,
  META,
  type metaSchemas,
  parseMeta,
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
// Nothing below returns a raw IndexedDB value. A record that fails its schema
// is treated as corrupt and reported, never silently coerced.

export class CorruptRecordError extends Error {
  constructor(store: string, key: string, issue: string) {
    super(`Corrupt ${store} record "${key}": ${issue}`);
    this.name = 'CorruptRecordError';
  }
}

function parseOrThrow<T>(schema: z.ZodType<T>, store: string, key: string, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new CorruptRecordError(store, key, parsed.error.issues[0]?.message ?? 'unknown');
  }
  return parsed.data;
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

/** Outbox entries ordered by clientSeq — the order they must be sent in (A4). */
export async function readOutboxBySeq(limit?: number): Promise<QueuedMutation[]> {
  const raw = await (await db()).getAllFromIndex(STORES.outbox, 'byClientSeq');
  const parsed = raw.map((value, index) =>
    parseOrThrow(queuedMutationSchema, STORES.outbox, String(index), value),
  );
  return limit === undefined ? parsed : parsed.slice(0, limit);
}

export async function readRecord(key: string): Promise<LocalRecord | undefined> {
  const raw = await (await db()).get(STORES.records, key);
  if (raw === undefined) return undefined;
  return parseOrThrow(localRecordSchema, STORES.records, key, raw);
}

export async function readAllRecords(): Promise<LocalRecord[]> {
  const raw = await (await db()).getAll(STORES.records);
  return raw.map((value, index) =>
    parseOrThrow(localRecordSchema, STORES.records, String(index), value),
  );
}

/**
 * Wipes every store. Called on sign-out and on org switch (C5) — cached
 * tenant data must not outlive the session that fetched it.
 */
export async function wipeLocalData(): Promise<void> {
  const database = await db();
  const tx = database.transaction([STORES.outbox, STORES.records, STORES.meta], 'readwrite');
  await Promise.all([
    tx.objectStore(STORES.outbox).clear(),
    tx.objectStore(STORES.records).clear(),
    tx.objectStore(STORES.meta).clear(),
    tx.done,
  ]);
}
