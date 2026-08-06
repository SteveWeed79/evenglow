import type { SqlOps } from './driver';

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

  {
    version: 2,
    statements: [
      /**
       * The forecast, cached — **not** a record, and the distinction is the
       * whole design.
       *
       * Nobody authors a forecast. It cannot conflict, it is not something the
       * farm did, and two devices fetching the same site would mint two ULIDs
       * for one fact. So it is not an entity: it never enters the outbox,
       * never reaches `records`, and never crosses the wire. The same category
       * the codebase already grants the bundled zone lookup, and the same
       * reasoning that keeps `Due` off the wire.
       *
       * One row, enforced by the CHECK: a farm has one position and therefore
       * one forecast, and a table that could hold two would invite a bug about
       * which is current. Each fetch replaces it.
       *
       * `fetchedAt` is when this device asked and `issuedAt` is when the
       * provider made the run — staleness is judged on the second, because a
       * device asleep for a day did not make the forecast older, it just
       * stopped hearing about it.
       */
      `CREATE TABLE IF NOT EXISTS forecast (
         id         INTEGER PRIMARY KEY CHECK (id = 1),
         issuedAt   INTEGER NOT NULL,
         fetchedAt  INTEGER NOT NULL,
         value      TEXT NOT NULL
       )`,
    ],
  },

  {
    version: 3,
    statements: [
      /**
       * What it is doing **now**, measured — as opposed to forecast.
       *
       * Its own table rather than a column on `forecast`, because the two have
       * genuinely different lifetimes and conflating them would force the
       * slower one to govern.
       *
       * A forecast run is regenerated about hourly and is stale after two
       * days. An observation is a reading from a real thermometer at an
       * airfield, reported every ten to twenty minutes — and on a fast-moving
       * afternoon more often than that, because ASOS files a SPECI report when
       * conditions change sharply. It is worthless within the hour.
       *
       * That difference is the whole reason this exists. The row on Today used
       * to show the hourly forecast's figure for the current hour and call it
       * "now". A Kansas summer afternoon can climb ten degrees in half an hour,
       * so that number could be badly wrong while the app displayed it with
       * confidence — on the one screen this app asks people to trust.
       *
       * One row, like the forecast, for the same reason: one farm, one
       * position, one nearest station.
       */
      `CREATE TABLE IF NOT EXISTS observation (
         id         INTEGER PRIMARY KEY CHECK (id = 1),
         observedAt INTEGER NOT NULL,
         fetchedAt  INTEGER NOT NULL,
         value      TEXT NOT NULL
       )`,
    ],
  },

  {
    version: 4,
    statements: [
      /**
       * Official watches and warnings, whole.
       *
       * A third table for a third rate. The forecast is regenerated hourly and
       * lives two days; a station reading is worthless within the hour; an
       * alert is issued and cancelled on a scale of minutes. Sharing a row
       * with either would let the slower govern the fastest, and this is the
       * one where showing a lapsed value is dangerous rather than merely
       * wrong — a tornado warning still on screen an hour after it expired
       * teaches a farm that the row does not mean anything.
       *
       * The whole active SET in one blob, rather than a row per alert. That is
       * what the service answers with: a cancelled alert is simply absent from
       * the next response, and rows kept individually would need a
       * reconciliation pass to notice its absence. Replacing the blob cannot
       * leave one behind.
       *
       * No `issuedAt` column beside `fetchedAt`, unlike `observation`. A set
       * has no single issue time — the alerts in it were issued at different
       * moments and each carries its own — so a column here would be a number
       * with no honest value to put in it.
       */
      `CREATE TABLE IF NOT EXISTS alerts (
         id        INTEGER PRIMARY KEY CHECK (id = 1),
         fetchedAt INTEGER NOT NULL,
         value     TEXT NOT NULL
       )`,
    ],
  },

  {
    version: 5,
    statements: [
      /**
       * Support tickets, held until they can be sent
       * (`docs/SUPPORT-LOOP.md` S6).
       *
       * **Not in the outbox, and the distinction matters as much as it did for
       * the forecast.** A ticket is not a farm record: it does not sync between
       * a farm's devices, it does not belong to the org's history, and it must
       * never be replayed onto the server as a mutation. Putting it in
       * `records` would make it all three.
       *
       * Many rows rather than one, unlike the caches above: two problems on one
       * morning are two reports, and a table that could hold one would silently
       * discard the first — which is the failure the whole loop exists to
       * prevent.
       *
       * `records` is the opt-in half (S2) and is NULL on almost every row. It
       * is stored beside the bundle rather than regenerated at send time
       * because consent was given about *this* moment's data: a farm that says
       * yes on Tuesday and sends on Thursday agreed to Tuesday's records, and
       * re-reading the database at send would quietly widen that.
       *
       * `sentAt` rather than a delete, for the same reason a mutation is marked
       * applied rather than removed (invariant 7): the history is how somebody
       * can tell whether the report they filed ever left the phone.
       */
      `CREATE TABLE IF NOT EXISTS tickets (
         id          TEXT PRIMARY KEY,
         at          INTEGER NOT NULL,
         fingerprint TEXT NOT NULL,
         bundle      TEXT NOT NULL,
         records     TEXT,
         attempts    INTEGER NOT NULL DEFAULT 0,
         lastError   TEXT,
         sentAt      INTEGER,
         url         TEXT
       )`,

      // The send loop asks for the unsent, oldest first — the only query this
      // table has.
      `CREATE INDEX IF NOT EXISTS tickets_unsent ON tickets (sentAt, at)`,
    ],
  },
];

/** The version a fresh database is brought to. */
export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

export async function currentVersion(driver: SqlOps): Promise<number> {
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
export async function migrate(driver: SqlOps): Promise<number> {
  const from = await currentVersion(driver);

  for (const migration of MIGRATIONS) {
    if (migration.version <= from) continue;

    await driver.transaction(async (tx) => {
      for (const statement of migration.statements) {
        await tx.run(statement);
      }
      await tx.run(`PRAGMA user_version = ${migration.version}`);
    });
  }

  return currentVersion(driver);
}
