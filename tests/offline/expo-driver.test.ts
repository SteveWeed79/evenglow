import { describe, expect, it, vi } from 'vitest';
import {
  applyPragmas,
  createExpoDriver,
  type SqliteConnection,
} from '@steading/mobile/db/expo-driver';
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
