import { describe, expect, it, vi } from 'vitest';
import {
  applyPragmas,
  createExpoDriver,
  integrityProblem,
  type SqliteConnection,
} from '@homefarm/mobile/db/expo-driver';
import { fakeExpoConnection, tracingExpoConnection } from '../support/expo-sqlite';

/**
 * The Expo driver's own contract.
 *
 * The store's behaviour over this driver is settled by the LocalStore suite,
 * which runs its full set of MUSTs against it. What is left here is the part
 * that suite cannot see: how the driver talks to the connection underneath.
 *
 * Both cases below are bugs the Capacitor driver actually shipped. Neither was
 * catchable, because that driver imported its native module directly and so
 * could only ever run on a handset. This one is written against an interface,
 * which is the whole reason these tests can exist.
 */

/** Records how each statement was sent, which is the thing under test. */
function recordingConnection(
  journalMode: string | null = 'wal',
): SqliteConnection & { calls: { method: string; sql: string }[] } {
  const calls: { method: string; sql: string }[] = [];

  return {
    calls,
    async runAsync(sql) {
      calls.push({ method: 'runAsync', sql });
      return undefined;
    },
    async getAllAsync<T>(sql: string) {
      calls.push({ method: 'getAllAsync', sql });
      return [] as T[];
    },
    async getFirstAsync<T>(sql: string) {
      calls.push({ method: 'getFirstAsync', sql });
      return (journalMode === null ? null : { journal_mode: journalMode }) as T;
    },
    async execAsync(sql) {
      calls.push({ method: 'execAsync', sql });
    },
    async withExclusiveTransactionAsync(task) {
      calls.push({ method: 'withExclusiveTransactionAsync', sql: '' });
      await task(this);
    },
    async closeAsync() {
      calls.push({ method: 'closeAsync', sql: '' });
    },
  };
}

describe('applyPragmas', () => {
  /**
   * The bug this exists for: `PRAGMA journal_mode` RETURNS a row, and Android's
   * execSQL refuses row-returning statements outright. Sent down the exec path
   * it does not set WAL — it throws, at startup, on a device, with a message
   * about rawQuery that names nothing to do with journalling.
   */
  it('asks for journal_mode through the query path, never exec', async () => {
    const db = recordingConnection();

    await applyPragmas(db);

    const journal = db.calls.filter((c) => c.sql.includes('journal_mode'));
    expect(journal).toHaveLength(1);
    expect(journal[0]?.method).toBe('getFirstAsync');
  });

  /**
   * SQLite's default `busy_timeout` is 0 — not "a moment", zero. A statement
   * that meets a lock fails at once with `database is locked` rather than
   * waiting for the other writer to finish.
   *
   * Contention is structural here rather than hypothetical:
   * `withExclusiveTransactionAsync` opens a SECOND connection to the same
   * file, so every write is two connections to one database. PowerSync sets
   * this on every connection it opens, for exactly this reason.
   */
  it('sets a busy timeout, because the default is zero', async () => {
    const db = recordingConnection();

    await applyPragmas(db);

    const busy = db.calls.filter((c) => c.sql.includes('busy_timeout'));
    expect(busy).toHaveLength(1);
    expect(busy[0]?.sql).toMatch(/busy_timeout\s*=\s*\d{4,}/);
  });

  it('sets the busy timeout before anything that could meet a lock', async () => {
    const db = recordingConnection();

    await applyPragmas(db);

    // It governs how every statement after it behaves, so it has to be first.
    expect(db.calls[0]?.sql).toContain('busy_timeout');
  });

  it('sets synchronous to FULL', async () => {
    const db = recordingConnection();

    await applyPragmas(db);

    expect(db.calls.some((c) => c.sql.includes('synchronous = FULL'))).toBe(true);
  });

  /**
   * SQLite silently declines WAL where the shared-memory file cannot be
   * created. Records opening in a slower journal mode is enormously better
   * than records not opening, so this warns and carries on — but it must warn,
   * because the exit gate's durability claim assumes WAL.
   */
  it('warns rather than throws when WAL was declined', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = recordingConnection('delete');

    await expect(applyPragmas(db)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('journal_mode'));
    warn.mockRestore();
  });
});

describe('createExpoDriver', () => {
  /**
   * Nesting is refused rather than supported via savepoints. Calls are
   * serialised, so a nested call would wait on the transaction it is already
   * inside — and a hang on a handset is far harder to diagnose than a thrown
   * error naming the rule.
   */
  it('refuses a nested transaction', async () => {
    const driver = createExpoDriver(fakeExpoConnection());

    await expect(
      driver.transaction(async (tx) => {
        await tx.transaction(async () => undefined);
      }),
    ).rejects.toThrow(/nested/i);
  });

  /**
   * Two taps on the Tally in quick succession is enough to reach this. A
   * connection holds one transaction, so overlapping callers would share it,
   * each able to roll back the other's writes.
   */
  it('serialises concurrent transactions rather than interleaving them', async () => {
    const driver = createExpoDriver(fakeExpoConnection());
    const order: string[] = [];

    const slow = driver.transaction(async () => {
      order.push('a:start');
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push('a:end');
    });
    const quick = driver.transaction(async () => {
      order.push('b:start');
      order.push('b:end');
    });

    await Promise.all([slow, quick]);

    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  /** One caller's rollback must not strand everyone queued behind it. */
  it('runs the next transaction after one rolls back', async () => {
    const driver = createExpoDriver(fakeExpoConnection());
    await driver.run('CREATE TABLE t (v INTEGER)');

    const failed = driver.transaction(async (tx) => {
      await tx.run('INSERT INTO t (v) VALUES (1)');
      throw new Error('nope');
    });
    const after = driver.transaction(async (tx) => {
      await tx.run('INSERT INTO t (v) VALUES (2)');
    });

    await expect(failed).rejects.toThrow('nope');
    await after;

    expect(await driver.all<{ v: number }>('SELECT v FROM t')).toEqual([{ v: 2 }]);
  });

  /** The port's contract is undefined for "no row"; expo-sqlite reports null. */
  /**
   * The connection that actually writes had never had a PRAGMA applied to it.
   *
   * `applyPragmas` runs against the handle `open.ts` opened.
   * `withExclusiveTransactionAsync` opens its OWN connection
   * (`useNewConnection: true`, verified in expo-sqlite's source), and these
   * settings are per-connection — so every write this app has ever made ran on
   * a connection that had seen none of them.
   *
   * Most of them cannot be fixed from inside the transaction: SQLite refuses
   * `PRAGMA synchronous` mid-transaction outright, and `foreign_keys` is a
   * documented no-op there. `busy_timeout` is the exception, and it is also the
   * one that matters most on a writer — without it a write that meets a lock
   * gives up instantly instead of waiting.
   */
  it('sets the busy timeout on the transaction connection too', async () => {
    const db = tracingExpoConnection();
    const driver = createExpoDriver(db);

    await driver.transaction(async (tx) => {
      await tx.run('CREATE TABLE t (a)');
    });

    const onTxn = db.where.filter((w) => w.on === 'txn');
    expect(onTxn[0]?.sql).toContain('busy_timeout');
  });

  it('sets it before the transaction body runs, not after', async () => {
    const db = tracingExpoConnection();
    const driver = createExpoDriver(db);

    await driver.transaction(async (tx) => {
      await tx.run('CREATE TABLE t (a)');
    });

    const onTxn = db.where.filter((w) => w.on === 'txn');
    const timeout = onTxn.findIndex((w) => w.sql.includes('busy_timeout'));
    const work = onTxn.findIndex((w) => w.sql.includes('CREATE TABLE'));

    // A timeout set after the statement it was meant to protect is decoration.
    expect(timeout).toBeGreaterThanOrEqual(0);
    expect(timeout).toBeLessThan(work);
  });

  it('reports a missing row as undefined, not null', async () => {
    const driver = createExpoDriver(fakeExpoConnection());
    await driver.run('CREATE TABLE t (v INTEGER)');

    expect(await driver.get('SELECT v FROM t')).toBeUndefined();
  });
});

/**
 * The two connections, and what does and does not cross between them.
 *
 * Everything here was unprovable until the fake stopped being one connection
 * with a boolean pretending to be a lock. The driver's doc has asserted these
 * facts for months on the strength of expo's source alone; these read the
 * values back out of SQLite.
 */
describe('the connection a transaction actually runs on', () => {
  /**
   * `applyPragmas` runs against the handle `open.ts` opened.
   * `withExclusiveTransactionAsync` opens its OWN connection, and these
   * settings are per-connection — so every write this app makes runs on a
   * connection that has seen none of them.
   *
   * Asserted through the raw connection rather than the driver, because the
   * driver deliberately repairs the one setting it can.
   */
  it('inherits none of the pragmas applyPragmas set', async () => {
    const db = fakeExpoConnection();
    await applyPragmas(db);

    const outerBusy = await db.getFirstAsync<{ timeout: number }>('PRAGMA busy_timeout;', []);
    const outerKeys = await db.getFirstAsync<{ foreign_keys: number }>('PRAGMA foreign_keys;', []);
    expect(outerBusy?.timeout).toBeGreaterThanOrEqual(5_000);
    expect(outerKeys?.foreign_keys).toBe(1);

    const inner: { busy?: number | undefined; keys?: number | undefined } = {};
    await db.withExclusiveTransactionAsync(async (txn) => {
      inner.busy = (await txn.getFirstAsync<{ timeout: number }>('PRAGMA busy_timeout;', []))?.timeout;
      inner.keys = (await txn.getFirstAsync<{ foreign_keys: number }>('PRAGMA foreign_keys;', []))
        ?.foreign_keys;
    });

    expect(inner.busy).toBe(0);

    /**
     * The trap this exists to leave a marker for.
     *
     * No table declares a foreign key today, so an unenforced constraint costs
     * nothing yet. Whoever adds the first one will find it enforced in every
     * test and ignored on every device write, and this is the line that says
     * so. Fixing it means owning the write connection and driving
     * `BEGIN IMMEDIATE` on it, not moving the PRAGMA inside the transaction —
     * SQLite documents it as a no-op there.
     */
    expect(inner.keys).toBe(0);
  });

  /**
   * WAL is the exception, and the reason it is the exception matters: it is
   * recorded in the database file header rather than on the handle, so it is
   * the one thing `applyPragmas` sets that reaches the connection that writes.
   *
   * Against a real file, so this is SQLite reporting what it settled on rather
   * than a stub returning what it was handed.
   */
  it('inherits WAL, because WAL belongs to the file', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = fakeExpoConnection();

    await applyPragmas(db);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();

    const inner: { mode?: string | undefined } = {};
    await db.withExclusiveTransactionAsync(async (txn) => {
      inner.mode = (await txn.getFirstAsync<{ journal_mode: string }>('PRAGMA journal_mode;', []))
        ?.journal_mode;
    });

    expect(inner.mode).toBe('wal');
  });

  /**
   * And so the driver repairs the one it can, which is the one that matters
   * most on a writer: without it a write that meets a lock gives up instantly
   * rather than waiting for a lock that would clear in a millisecond.
   *
   * This reads the value back through the handle the body was given, so it
   * fails if the PRAGMA is dropped, misspelled, or sent to the wrong
   * connection — none of which a traced SQL string can tell apart.
   */
  it('is given a busy timeout by the driver, and SQLite keeps it', async () => {
    const driver = createExpoDriver(fakeExpoConnection());

    const inside = await driver.transaction((tx) =>
      tx.get<{ timeout: number }>('PRAGMA busy_timeout;'),
    );

    expect(inside?.timeout).toBeGreaterThanOrEqual(5_000);
  });
});

/**
 * Whether the file is sound, asked once as it opens.
 *
 * `[37]`. SQLite corruption had no path back and, worse, no way to know: a
 * damaged page announces itself as a query returning nothing, which this app
 * renders as a farm with no animals — the single most dangerous thing it can
 * say, and it would be saying it about a fixable problem.
 */
describe('the integrity check', () => {
  it('says nothing is wrong with a sound database', async () => {
    const connection = fakeExpoConnection();
    await applyPragmas(connection);
    await connection.execAsync('CREATE TABLE records (key TEXT PRIMARY KEY, value TEXT)');
    await connection.runAsync("INSERT INTO records VALUES ('a', '1')", []);

    expect(await integrityProblem(connection)).toBeNull();
  });

  /**
   * The answer SQLite gives when it is unhappy, which is one row per problem
   * rather than the single word "ok". Driven through a stub rather than by
   * damaging a file, because corrupting a page portably is not something a
   * test can do — and what is being asserted is the reading of the answer.
   */
  it('reports what SQLite said when it is not "ok"', async () => {
    const damaged: SqliteConnection = {
      ...fakeExpoConnection(),
      getFirstAsync: async <T,>() =>
        ({ integrity_check: '*** in database main *** Page 4 is never used' }) as T,
    };

    expect(await integrityProblem(damaged)).toContain('Page 4 is never used');
  });

  it('treats an unanswerable check as sound rather than inventing damage', async () => {
    const mute: SqliteConnection = {
      ...fakeExpoConnection(),
      getFirstAsync: async () => {
        throw new Error('this build does not support that pragma');
      },
    };

    // A pragma that will not run is not evidence of corruption, and a false
    // report would send a farm looking for a problem it does not have.
    expect(await integrityProblem(mute)).toBeNull();
  });

  it('asks the quick check rather than the full one', async () => {
    // `integrity_check` cross-checks every index against its table, which is
    // O(database) on the cold start of every launch. The cheap half catches
    // the corruption that actually happens: torn pages, a truncated file.
    const seen: string[] = [];
    const traced: SqliteConnection = {
      ...fakeExpoConnection(),
      getFirstAsync: async <T,>(sql: string) => {
        seen.push(sql);
        return { integrity_check: 'ok' } as T;
      },
    };

    await integrityProblem(traced);

    expect(seen.join(' ')).toContain('quick_check');
    expect(seen.join(' ')).not.toContain('PRAGMA integrity_check');
  });
});
