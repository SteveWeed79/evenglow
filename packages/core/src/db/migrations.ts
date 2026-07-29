import type { SqlDriver } from './driver';

/**
 * The SQLite schema, as an additive ladder.
 *
 * Additive only, and that is a hard rule rather than a preference: the outbox
 * holds work that exists nowhere else until it flushes. A destructive
 * migration on a device that has been in a barn for three weeks discards a
 * farm's records with no server copy to restore from — which is the single
 * failure mode the masterplan's rejected "second local store" idea was
 * reaching for (Q1). The cheap answer is to never write a migration that can
 * lose a row.
 *
 * Mirrors the IndexedDB stores it replaces, deliberately. The engine above is
 * unchanged, so the shapes it reads and writes must be too — and the port is
 * proven by running the same suite against both.
 */

export interface Migration {
  readonly version: number;
  readonly statements: readonly string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    statements: [
      /**
       * The outbox. `id` is the client-minted ULID (D1), which is also the
       * idempotency key the server upserts on, so it is the natural key here
       * too — no surrogate, nothing to keep in sync.
       *
       * `payload` is JSON text. SQLite would happily hold it in a typed
       * column, but the envelope is validated by Zod on the way out anyway
       * (invariant 11), and a column per field would have to change every time
       * an entity gains one.
       */
      `CREATE TABLE IF NOT EXISTS outbox (
         id             TEXT PRIMARY KEY NOT NULL,
         schemaVersion  INTEGER NOT NULL,
         targetId       TEXT NOT NULL,
         entity         TEXT NOT NULL,
         op             TEXT NOT NULL,
         payload        TEXT NOT NULL,
         deviceId       TEXT NOT NULL,
         clientSeq      INTEGER NOT NULL,
         clientTs       INTEGER NOT NULL,
         status         TEXT NOT NULL,
         attempts       INTEGER NOT NULL DEFAULT 0,
         enqueuedAt     INTEGER NOT NULL,
         lastError      TEXT,
         rejectedReason TEXT,
         rejectedAt     INTEGER
       )`,

      // Flush reads in clientSeq order; the inbox and the chip read by status.
      `CREATE INDEX IF NOT EXISTS outbox_by_seq ON outbox (clientSeq)`,
      `CREATE INDEX IF NOT EXISTS outbox_by_status ON outbox (status)`,

      /** The optimistic projection. Keyed `${entity}:${targetId}`, as before. */
      `CREATE TABLE IF NOT EXISTS records (
         key       TEXT PRIMARY KEY NOT NULL,
         entity    TEXT NOT NULL,
         targetId  TEXT NOT NULL,
         value     TEXT NOT NULL,
         updatedAt INTEGER NOT NULL,
         deleted   INTEGER NOT NULL DEFAULT 0
       )`,

      // Every read path is per-entity; a full scan got slower with each day's
      // logging, which is the wrong shape for a screen that must be up in five
      // seconds from cold.
      `CREATE INDEX IF NOT EXISTS records_by_entity ON records (entity)`,

      `CREATE TABLE IF NOT EXISTS meta (
         key   TEXT PRIMARY KEY NOT NULL,
         value TEXT NOT NULL
       )`,

      /**
       * Corruption must not be able to wedge the queue: one unreadable row
       * would otherwise fail every flush and stop everything behind it. Rows
       * move here with their raw value — "never drop" applies to corruption
       * too, and the raw text is the only chance of recovering what it said.
       */
      `CREATE TABLE IF NOT EXISTS quarantine (
         key           TEXT PRIMARY KEY NOT NULL,
         store         TEXT NOT NULL,
         raw           TEXT NOT NULL,
         reason        TEXT NOT NULL,
         quarantinedAt INTEGER NOT NULL
       )`,
    ],
  },
];

/** The version a fresh database is brought to. */
export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

export async function currentVersion(driver: SqlDriver): Promise<number> {
  const row = await driver.get<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

/**
 * Brings a database up to `SCHEMA_VERSION`, applying only what it is missing.
 *
 * Each migration runs inside its own transaction together with the version
 * bump, so a failure part-way leaves the database at the previous version with
 * none of that migration applied. The alternative — bumping the version
 * separately — produces a database that claims to be migrated and is not,
 * which then fails much later and much less legibly.
 *
 * `user_version` cannot be parameterised, so it is interpolated. The value is
 * a number from this module's own constant list, never from input.
 */
export async function migrate(driver: SqlDriver): Promise<number> {
  const from = await currentVersion(driver);

  for (const migration of MIGRATIONS) {
    if (migration.version <= from) continue;

    await driver.transaction(async () => {
      for (const statement of migration.statements) {
        await driver.run(statement);
      }
      await driver.run(`PRAGMA user_version = ${migration.version}`);
    });
  }

  return currentVersion(driver);
}
