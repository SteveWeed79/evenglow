import { afterEach, describe, expect, it } from 'vitest';
import type { SqlDriver } from '@steading/core/db/driver';
import { currentVersion, migrate, MIGRATIONS, SCHEMA_VERSION } from '@steading/core/db/migrations';
import { DatabaseFromTheFutureError } from '@steading/core/db/errors';
import { nodeSqlDriver } from '../support/sqlite';

/**
 * The SQLite schema and its migration ladder (D9).
 *
 * Runs against real SQLite in Node rather than a fake, because the properties
 * worth asserting here — that a transaction is atomic, that a failed migration
 * does not bump the version — are exactly the ones a fake would grant for
 * free.
 */

let driver: SqlDriver | null = null;

function open(): SqlDriver {
  driver = nodeSqlDriver();
  return driver;
}

afterEach(async () => {
  await driver?.close();
  driver = null;
});

async function tableNames(db: SqlDriver): Promise<string[]> {
  const rows = await db.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  );
  return rows.map((r) => r.name).filter((n) => !n.startsWith('sqlite_'));
}

describe('migration ladder', () => {
  it('brings a fresh database to the current version', async () => {
    const db = open();
    expect(await currentVersion(db)).toBe(0);

    expect(await migrate(db)).toBe(SCHEMA_VERSION);
  });

  it('creates the stores the engine expects', async () => {
    const db = open();
    await migrate(db);

    /**
     * The four IndexedDB used, plus the three weather caches and the ticket
     * queue.
     *
     * `forecast`, `observation`, `alerts` and `tickets` are deliberately NOT
     * the engine's stores: they hold no records, never enter the outbox and
     * never reach the wire as mutations. They are here because they are in the
     * same file, not because they are part of the same system — see the
     * migrations' notes, `contracts/weather.ts` and
     * `docs/SUPPORT-LOOP.md` S6.
     *
     * The weather three are three rather than one because they go out of date
     * at three different rates: a forecast run is regenerated hourly and is
     * stale after two days; an airfield thermometer reading is worthless
     * within the hour; an official alert is issued and cancelled on a scale of
     * minutes, and is the one where showing a lapsed value is dangerous rather
     * than merely wrong.
     */
    expect(await tableNames(db)).toEqual([
      'alerts',
      'forecast',
      'meta',
      'observation',
      'outbox',
      'quarantine',
      'record_gen',
      'record_undo',
      'records',
      'tickets',
    ]);
  });

  it('is idempotent', async () => {
    const db = open();
    await migrate(db);
    const before = await tableNames(db);

    // Re-running on an already-current database must do nothing at all —
    // every app start calls this.
    expect(await migrate(db)).toBe(SCHEMA_VERSION);
    expect(await tableNames(db)).toEqual(before);
  });

  it('applies nothing twice when run concurrently at startup', async () => {
    const db = open();
    await Promise.all([migrate(db), migrate(db)]);

    expect(await currentVersion(db)).toBe(SCHEMA_VERSION);
    expect(await tableNames(db)).toHaveLength(10);
  });

  /**
   * A version bumped separately from the statements it describes produces a
   * database that claims to be migrated and is not — which fails much later
   * and much less legibly than failing here.
   */
  it('leaves the version untouched when a migration fails part-way', async () => {
    const db = open();
    await migrate(db);
    const good = await currentVersion(db);

    await expect(
      db.transaction(async (tx) => {
        await tx.run('CREATE TABLE later (x TEXT)');
        await tx.run(`PRAGMA user_version = ${good + 1}`);
        throw new Error('migration failed half way');
      }),
    ).rejects.toThrow(/half way/);

    expect(await currentVersion(db)).toBe(good);
    expect(await tableNames(db)).not.toContain('later');
  });

  /**
   * A downgrade is the one way this happens on a farm — a sideloaded APK
   * installed over a newer one, which is the only route back from a bad
   * release. The walk goes forward only, so before this guard the loop skipped
   * every branch, reported the higher version as a success, and handed back a
   * store built to a schema this build has never seen.
   */
  describe('a database from the future', () => {
    it('refuses to open rather than running against a schema it does not know', async () => {
      const db = open();
      await migrate(db);
      await db.run(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);

      await expect(migrate(db)).rejects.toThrow(DatabaseFromTheFutureError);
    });

    it('says nothing that reads as an instruction to clear app data', async () => {
      const db = open();
      await migrate(db);
      await db.run(`PRAGMA user_version = ${SCHEMA_VERSION + 3}`);

      const error = await migrate(db).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(DatabaseFromTheFutureError);
      const message = (error as Error).message;

      // Clearing app data is the one action that turns a temporary refusal
      // into the loss it exists to prevent.
      expect(message).not.toMatch(/delete|clear|reinstall|uninstall|reset/i);
      expect(message).toContain('Nothing is lost');
      expect(message).toContain(`v${SCHEMA_VERSION}`);
    });

    it('leaves the file exactly as it found it', async () => {
      const db = open();
      await migrate(db);
      const before = await tableNames(db);
      await db.run(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);

      await expect(migrate(db)).rejects.toThrow();

      expect(await currentVersion(db)).toBe(SCHEMA_VERSION + 1);
      expect(await tableNames(db)).toEqual(before);
    });

    it('opens normally at exactly the current version', async () => {
      const db = open();
      await migrate(db);

      // The boundary, because `>` and `>=` are one keystroke apart and the
      // wrong one refuses every device on the current build.
      expect(await migrate(db)).toBe(SCHEMA_VERSION);
    });
  });

  it('never contains a destructive statement', async () => {
    // Additive only, and enforced rather than remembered: the outbox holds
    // work that exists nowhere else until it flushes, so a DROP or a DELETE in
    // a migration discards a farm's records with no server copy to restore
    // from.
    const forbidden = /\b(DROP\s+TABLE|DELETE\s+FROM|TRUNCATE|DROP\s+COLUMN)\b/i;

    for (const migration of MIGRATIONS) {
      for (const statement of migration.statements) {
        expect(statement).not.toMatch(forbidden);
      }
    }
  });

  it('numbers migrations in strictly ascending order', async () => {
    const versions = MIGRATIONS.map((m) => m.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
  });
});

describe('transactions (invariant 5)', () => {
  it('commits every write in the unit, or none', async () => {
    const db = open();
    await migrate(db);

    await expect(
      db.transaction(async (tx) => {
        await tx.run("INSERT INTO meta (key, value) VALUES ('deviceId', 'abc')");
        await tx.run("INSERT INTO meta (key, value) VALUES ('nextClientSeq', '1')");
        throw new Error('failed after two writes');
      }),
    ).rejects.toThrow(/after two writes/);

    // The enqueue path writes the outbox row, the counter and the projection
    // together. A partial application of that set is the exact state the whole
    // design exists to make impossible.
    expect(await db.all('SELECT * FROM meta')).toEqual([]);
  });

  it('keeps the writes when the unit succeeds', async () => {
    const db = open();
    await migrate(db);

    await db.transaction(async (tx) => {
      await tx.run("INSERT INTO meta (key, value) VALUES ('deviceId', 'abc')");
    });

    expect(await db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'deviceId'")).toEqual(
      { value: 'abc' },
    );
  });

  /**
   * Two taps on the Tally in quick succession is enough to reach this. A
   * connection holds one transaction, so unserialised callers would share it —
   * each able to roll back the other's writes, which for enqueue means a
   * committed half-write: a sequence number consumed with no outbox row, or a
   * projection updated for a mutation that is not queued.
   */
  it('serialises concurrent transactions rather than interleaving them', async () => {
    const db = open();
    await migrate(db);

    const order: string[] = [];
    await Promise.all(
      ['a', 'b', 'c'].map((key) =>
        db.transaction(async (tx) => {
          order.push(`${key}:start`);
          await tx.run('INSERT INTO meta (key, value) VALUES (?, ?)', [key, '1']);
          // Yield inside the transaction — the point at which an unserialised
          // driver lets the next caller in.
          await Promise.resolve();
          order.push(`${key}:end`);
        }),
      ),
    );

    // Every transaction closes before the next opens.
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
    expect(await db.all('SELECT key FROM meta')).toHaveLength(3);
  });

  it('does not strand queued callers when one rolls back', async () => {
    const db = open();
    await migrate(db);

    const failed = db.transaction(async (tx) => {
      await tx.run("INSERT INTO meta (key, value) VALUES ('doomed', '1')");
      throw new Error('rolled back');
    });
    const after = db.transaction(async (tx) => {
      await tx.run("INSERT INTO meta (key, value) VALUES ('after', '1')");
    });

    await expect(failed).rejects.toThrow(/rolled back/);
    await after;

    const rows = await db.all<{ key: string }>('SELECT key FROM meta ORDER BY key');
    expect(rows.map((r) => r.key)).toEqual(['after']);
  });

  it('refuses a nested transaction rather than deadlocking', async () => {
    const db = open();
    await migrate(db);

    await expect(
      db.transaction(async (tx) => {
        await tx.transaction(async () => undefined);
      }),
    ).rejects.toThrow(/Nested transactions are not supported/);

    // And the connection is usable afterwards, not left mid-transaction.
    await db.transaction(async (tx) => {
      await tx.run("INSERT INTO meta (key, value) VALUES ('ok', '1')");
    });
    expect(await db.all('SELECT key FROM meta')).toHaveLength(1);
  });

  it('returns the value the unit produced', async () => {
    const db = open();
    await migrate(db);

    expect(await db.transaction(async () => 'done')).toBe('done');
  });
});

describe('the schema itself', () => {
  it('rejects a second outbox row with the same mutation id', async () => {
    const db = open();
    await migrate(db);

    const insert = `INSERT INTO outbox
      (id, schemaVersion, targetId, entity, op, payload, deviceId, clientSeq, clientTs, status, enqueuedAt)
      VALUES (?, 1, ?, 'eggLog', 'create', '{}', ?, ?, 1, 'queued', 1)`;
    const args = ['01JABCDEFGHJKMNPQRSTVWXYZ0', '01JZYXWVUTSRQPNMKJHGFEDCB0', 'dev', 0];

    await db.run(insert, args);

    // The ULID is the idempotency key the server upserts on (D1). Two local
    // rows sharing one would flush as a duplicate and confuse the clearing
    // logic, so the storage layer refuses it rather than the flush loop
    // having to remember.
    await expect(db.run(insert, args)).rejects.toThrow();
  });

  it('indexes the reads the engine actually makes', async () => {
    const db = open();
    await migrate(db);

    const indexes = await db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );

    // Flush reads in clientSeq order, the chip and inbox read by status,
    // every projection read is per-entity, and the support screen asks for
    // the unsent tickets oldest first.
    expect(indexes.map((i) => i.name)).toEqual([
      'outbox_by_seq',
      'outbox_by_status',
      'records_by_entity',
      'tickets_unsent',
    ]);
  });
});
