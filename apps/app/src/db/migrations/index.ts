import type { SqlDriver } from '../driver';

/**
 * The storage migration ladder, tracked by SQLite's own `user_version`.
 *
 * Additive only. The outbox is an append-only audit trail and the duplicate
 * defence (invariant 7); a destructive migration would drop unsent work that
 * exists nowhere else, which is the one failure a second local store would
 * have covered (masterplan Q1). Add a step, never rewrite one — a device three
 * versions behind walks every rung in order.
 */

export const MIGRATIONS: readonly string[] = [
  // 1 — the offline engine's four stores.
  `
  CREATE TABLE IF NOT EXISTS outbox (
    id             TEXT PRIMARY KEY,
    schemaVersion  INTEGER NOT NULL,
    targetId       TEXT    NOT NULL,
    entity         TEXT    NOT NULL,
    op             TEXT    NOT NULL,
    payload        TEXT    NOT NULL,
    deviceId       TEXT    NOT NULL,
    clientSeq      INTEGER NOT NULL,
    clientTs       INTEGER NOT NULL,
    status         TEXT    NOT NULL,
    attempts       INTEGER NOT NULL DEFAULT 0,
    enqueuedAt     INTEGER NOT NULL,
    lastError      TEXT,
    rejectedReason TEXT,
    rejectedAt     INTEGER
  );

  -- Flush order (A4). Sequential, by clientSeq, never parallel.
  CREATE INDEX IF NOT EXISTS outbox_by_seq ON outbox (clientSeq);
  -- Queue depth and the rejected inbox both read by status; the trailing seq
  -- keeps those reads index-ordered rather than sorted in memory.
  CREATE INDEX IF NOT EXISTS outbox_by_status ON outbox (status, clientSeq);

  CREATE TABLE IF NOT EXISTS records (
    key       TEXT PRIMARY KEY,
    entity    TEXT    NOT NULL,
    targetId  TEXT    NOT NULL,
    value     TEXT    NOT NULL,
    updatedAt INTEGER NOT NULL,
    deleted   INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS records_by_entity ON records (entity, updatedAt);

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS quarantine (
    key           TEXT PRIMARY KEY,
    store         TEXT    NOT NULL,
    raw           TEXT    NOT NULL,
    reason        TEXT    NOT NULL,
    quarantinedAt INTEGER NOT NULL
  );
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

interface UserVersionRow {
  user_version: number;
}

/**
 * Applies every unapplied step, each in its own transaction.
 *
 * Per-step rather than one transaction for the lot: a device that dies partway
 * through resumes at the rung it reached instead of replaying from the start.
 * `user_version` advances inside the same transaction as the DDL, so the two
 * cannot disagree.
 */
export async function migrate(driver: SqlDriver): Promise<number> {
  const [row] = await driver.query<UserVersionRow>('PRAGMA user_version');
  const current = row?.user_version ?? 0;

  if (current > SCHEMA_VERSION) {
    // A newer build wrote this database. Guessing at a shape we do not know
    // would corrupt real work, so stop and say so.
    throw new Error(
      `This database was written by a newer version of Steading (schema v${current}). Update the app.`,
    );
  }

  for (let version = current; version < SCHEMA_VERSION; version++) {
    const step = MIGRATIONS[version];
    if (step === undefined) throw new Error(`Missing migration step ${version}.`);

    await driver.transaction(async (tx) => {
      for (const statement of splitStatements(step)) {
        await tx.run(statement);
      }
      // PRAGMA does not accept a bound parameter; the value is a loop counter,
      // never external input.
      await tx.run(`PRAGMA user_version = ${version + 1}`);
    });
  }

  return SCHEMA_VERSION;
}

/**
 * The plugin's multi-statement `execute` cannot run inside a transaction we
 * opened, so migration DDL is split and run statement by statement.
 *
 * Line comments are stripped before splitting, since a comment sitting above a
 * statement would otherwise be carried into it and parsed as SQL. Naive on
 * purpose beyond that — these strings are checked-in DDL with no semicolons or
 * `--` inside literals.
 */
function splitStatements(sql: string): string[] {
  return sql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}
