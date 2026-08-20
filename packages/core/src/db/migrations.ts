import type { SqlOps } from './driver';
import { DatabaseFromTheFutureError } from './errors';

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
  {
    version: 6,
    statements: [
      /**
       * Which hydration pass last wrote this record.
       *
       * Every device that synced before the server learned to withhold refused
       * commands applied some of them: an archive undone, a note somebody was
       * not allowed to edit, a meter reading the server refused. Filtering the
       * feed stops that happening again and repairs nothing already on disk, so
       * those devices replay the accepted log from zero once.
       *
       * A replay fixes every record the server still has a mutation for,
       * because a `create` replaces the value whole and the accepted history
       * lands on top. **It cannot fix a record the server has nothing for** —
       * a refused create that replicated leaves a row nothing will ever
       * overwrite. This column is what finds those: the repair stamps each row
       * it writes, and a row still carrying an older stamp when the replay
       * reaches the head of the feed has no server provenance.
       *
       * **A table rather than a column on `records`, and not only for taste.**
       * Every statement in this ladder is `IF NOT EXISTS`, because two starts
       * can race into `migrate` together and both read the old version before
       * either bumps it — `sqlite-schema.test.ts` pins that. SQLite has no
       * `ADD COLUMN IF NOT EXISTS`, so an `ALTER` here fails the second caller
       * with `duplicate column name`. Keeping the marker beside `records`
       * rather than inside it also means the table holding a farm's data is
       * never altered to fix a defect in something else.
       */
      `CREATE TABLE IF NOT EXISTS record_gen (
         key TEXT PRIMARY KEY NOT NULL,
         gen INTEGER NOT NULL
       )`,
    ],
  },
  {
    version: 7,
    statements: [
      /**
       * What a record looked like before a local `update` or `delete` touched
       * it — so discarding a refused one can put it back exactly (N-1).
       *
       * The residue was the open half of N-1. A refused `create` can be taken
       * back by deleting the row, because the target owes its whole local
       * existence to this device. A refused `update` cannot: its fields are
       * merged into a record that may have come from anywhere, and nothing on
       * disk remembered what they replaced. A refused `delete` leaves the
       * record hidden for the same reason. Neither is repaired by a later pull,
       * because the server has no mutation for a command it refused.
       *
       * **Replaying this device's outbox history is the wrong answer**, and
       * N-1 records why: it reconstructs the record from local mutations alone
       * and drops everything that arrived by pull. A pre-image has no such
       * flaw — it is the record itself, whatever produced it.
       *
       * `after` is what makes the restore safe. It holds the `updatedAt` this
       * device's optimistic write produced, and the restore only happens when
       * the record still carries it. Anything else means a pull or a later edit
       * has landed since, and newer wins — so the pre-image is dropped rather
       * than resurrecting a value the farm has moved past.
       *
       * One row per outstanding local update or delete, removed when the
       * mutation leaves the outbox in either direction. A table rather than
       * columns on `outbox` for the reason `record_gen` gives above: every
       * statement in this ladder must be `IF NOT EXISTS`, and SQLite has no
       * `ADD COLUMN IF NOT EXISTS`.
       */
      `CREATE TABLE IF NOT EXISTS record_undo (
         mutationId TEXT PRIMARY KEY NOT NULL,
         key TEXT NOT NULL,
         existed INTEGER NOT NULL,
         value TEXT,
         updatedAt INTEGER,
         deleted INTEGER,
         after INTEGER NOT NULL
       )`,
    ],
  },
  {
    version: 8,
    statements: [
      /**
       * How many times the server ANSWERED and the answer could not be read.
       *
       * `outbox.attempts` was doing this job and one other, and they are
       * different questions. It counts every failed flush — a dropped
       * connection, a 5xx, a batch the server could not parse — and exactly one
       * reader consults it: the poison ceiling in `rejectExhausted`,
       * `WHERE id = ? AND attempts >= ?`. So a farm that spent a morning out of
       * signal reaches the ceiling having done nothing wrong, and the first
       * unreadable answer sweeps the whole batch — up to a hundred good
       * mutations — into the rejected inbox. A captive portal answering a JSON
       * POST with an HTML login page is enough to do it.
       *
       * The 402 branch in `flush.ts` already names this hazard for its own
       * case: *"a farm running free for a year would otherwise cross the
       * ceiling and have its records swept into the inbox six flushes in"*. It
       * is the same argument, and it applies to the two statuses that still
       * count.
       *
       * Counting refusals apart keeps both numbers honest. `attempts` goes on
       * meaning "times this has been tried", which is what a diagnostic wants;
       * this means "times the server refused to read it", which is the only
       * thing a poison ceiling should ripen on.
       *
       * **A table rather than a column on `outbox`**, for the reason
       * `record_undo` gives above: every statement in this ladder must be
       * `IF NOT EXISTS` so two `migrate()` calls racing at startup cannot fail
       * each other, and SQLite has no `ADD COLUMN IF NOT EXISTS`.
       *
       * Sparse on purpose — a row appears the first time an answer cannot be
       * read, so an ordinary outbox carries none of these. It leaves with the
       * mutation it belongs to, in the same transaction, by whichever door that
       * mutation takes.
       */
      `CREATE TABLE IF NOT EXISTS outbox_unreadable (
         mutationId TEXT PRIMARY KEY NOT NULL,
         answers    INTEGER NOT NULL
       )`,
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
 *
 * **A database from the future is refused rather than opened.** This walk only
 * goes forward, so a file at a version above `SCHEMA_VERSION` used to fall
 * through every branch and return that higher number — reporting success and
 * handing back a store this build does not understand the shape of. It reads
 * tables whose columns a later migration may have moved and writes rows the
 * newer build will meet again, which is a corruption that surfaces long after
 * the downgrade that caused it and looks nothing like its cause.
 */
export async function migrate(driver: SqlOps): Promise<number> {
  const from = await currentVersion(driver);

  if (from > SCHEMA_VERSION) throw new DatabaseFromTheFutureError(from, SCHEMA_VERSION);

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
