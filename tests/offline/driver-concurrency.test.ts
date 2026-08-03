import { describe, expect, it } from 'vitest';
import type { SqlOps } from '@steading/core/db/driver';
import { type CancelTimer, createGate, SqlStalledError } from '@steading/core/db/gate';
import { createExpoDriver } from '@steading/mobile/db/expo-driver';
import { fakeExpoConnection, tracingExpoConnection } from '../support/expo-sqlite';

/**
 * The crash this file exists for.
 *
 * On an emulator, Today's list died with
 *
 *   Call to function 'NativeDatabase.prepareAsync' has been rejected.
 *   -> Caused by: Cannot use shared object that was already released
 *
 * `useDues.refresh` issues eleven reads in one burst on every engine publish,
 * and the sync engine opens transactions from a timer. The driver decided
 * which connection a statement used from ambient state — "is a transaction
 * open right now?" — so those reads were routed onto the transaction's second
 * connection, which `withExclusiveTransactionAsync` closes in a `finally` the
 * moment the body returns. A read still in flight was then preparing a
 * statement against a released native object.
 *
 * Every test below is written against the connection interface, so all of it
 * runs in Node. That is deliberate: the previous driver could only be
 * exercised on a handset, and this class of bug is exactly what that costs.
 */

/** A scheduler the test drives by hand, so the stall guard needs no waiting. */
function manualClock(): { schedule: (ms: number, fire: () => void) => CancelTimer; tick: () => void } {
  let pending: (() => void) | null = null;
  return {
    schedule: (_ms, fire) => {
      pending = fire;
      return () => {
        pending = null;
      };
    },
    tick: () => {
      const fire = pending;
      pending = null;
      fire?.();
    },
  };
}

describe('a read that overlaps a transaction', () => {
  /**
   * The regression itself. The read is issued while the transaction body is
   * mid-flight — the exact interleaving `useDues` produces against the engine's
   * `recordAttempt` — and it must not go near the transaction's connection.
   */
  it('never runs on the transaction connection', async () => {
    const connection = tracingExpoConnection();
    const driver = createExpoDriver(connection);
    await driver.run('CREATE TABLE t (v INTEGER)');

    let strayResult: unknown;
    let insideTransaction: (() => void) | null = null;
    const bodyReached = new Promise<void>((resolve) => {
      insideTransaction = resolve;
    });

    const transaction = driver.transaction(async (tx) => {
      await tx.run('INSERT INTO t (v) VALUES (1)');
      insideTransaction?.();
      // Long enough that the stray read below is unambiguously concurrent.
      await new Promise((resolve) => setTimeout(resolve, 20));
      await tx.run('INSERT INTO t (v) VALUES (2)');
    });

    await bodyReached;
    const stray = driver.all<{ v: number }>('SELECT v FROM t').then((rows) => {
      strayResult = rows;
    });

    await Promise.all([transaction, stray]);

    /**
     * Nothing but the transaction's own statements touched its connection.
     *
     * The busy_timeout PRAGMA is the driver's own and is filtered out here: it
     * is set ON that connection deliberately, because expo opens it itself and
     * `applyPragmas` never reaches it. What this asserts is that no statement
     * from ELSEWHERE landed there — which is the crash this whole file exists
     * for.
     */
    const onTxn = connection.where
      .filter((entry) => entry.on === 'txn')
      .map((e) => e.sql)
      .filter((sql) => !sql.includes('busy_timeout'));
    expect(onTxn).toEqual(['INSERT INTO t (v) VALUES (1)', 'INSERT INTO t (v) VALUES (2)']);
    expect(connection.where.some((e) => e.on === 'txn' && e.sql.startsWith('SELECT'))).toBe(false);

    // And it returned, rather than failing against a released object.
    expect(strayResult).toEqual([{ v: 1 }, { v: 2 }]);
  });

  /**
   * The reported crash, exactly.
   *
   * The statement is in flight — issued, not yet landed — when the
   * transaction's connection is released. Under the old driver it had been
   * routed onto that connection and prepared against a dead native object;
   * `tracingExpoConnection`'s latency argument is what makes that window
   * reachable in Node at all.
   */
  it('completes a read still in flight when the transaction connection is released', async () => {
    const connection = tracingExpoConnection(30);
    const driver = createExpoDriver(connection);
    await driver.run('CREATE TABLE t (v INTEGER)');

    let open: (() => void) | null = null;
    const inside = new Promise<void>((resolve) => {
      open = resolve;
    });

    const transaction = driver.transaction(async (tx) => {
      await tx.run('INSERT INTO t (v) VALUES (1)');
      open?.();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    await inside;
    const stray = driver.all<{ v: number }>('SELECT v FROM t');

    await transaction;
    await expect(stray).resolves.toEqual([{ v: 1 }]);
  });

  /**
   * The same shape as `useDues.refresh`: a burst of concurrent reads, issued
   * while a transaction is open. Eleven of them, because that is the number
   * the hook actually issues.
   */
  it('survives a burst of eleven reads issued during a transaction', async () => {
    const connection = tracingExpoConnection();
    const driver = createExpoDriver(connection);
    await driver.run('CREATE TABLE t (v INTEGER)');

    let open: (() => void) | null = null;
    const inside = new Promise<void>((resolve) => {
      open = resolve;
    });

    const transaction = driver.transaction(async (tx) => {
      await tx.run('INSERT INTO t (v) VALUES (1)');
      open?.();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    await inside;
    const burst = await Promise.all(
      Array.from({ length: 11 }, () => driver.all<{ v: number }>('SELECT v FROM t')),
    );
    await transaction;

    expect(burst).toHaveLength(11);
    for (const rows of burst) expect(rows).toEqual([{ v: 1 }]);
    expect(connection.where.some((e) => e.on === 'txn' && e.sql.startsWith('SELECT'))).toBe(false);
  });

  /**
   * A read must not be able to see, or be rolled back with, a transaction it
   * did not ask to join. Under the old driver it joined silently, so a
   * refresh could render uncommitted rows that then vanished.
   */
  it('does not observe a transaction that later rolls back', async () => {
    const driver = createExpoDriver(tracingExpoConnection());
    await driver.run('CREATE TABLE t (v INTEGER)');

    let open: (() => void) | null = null;
    const inside = new Promise<void>((resolve) => {
      open = resolve;
    });

    const doomed = driver.transaction(async (tx) => {
      await tx.run('INSERT INTO t (v) VALUES (99)');
      open?.();
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error('rolled back');
    });

    await inside;
    const read = driver.all<{ v: number }>('SELECT v FROM t');

    await expect(doomed).rejects.toThrow(/rolled back/);
    expect(await read).toEqual([]);
  });
});

describe('two writes that overlap', () => {
  /**
   * "That did not save."
   *
   * The old driver refused any `transaction()` that arrived while another was
   * inside its body — it read the same ambient flag it used for routing, so a
   * genuinely concurrent second transaction looked identical to a nested one.
   * The engine's timer opening `recordAttempt` while a hand's `enqueue` is
   * mid-flight is exactly that, and the enqueue was lost.
   *
   * Note the shape: the second call is made AFTER the first has entered its
   * body. The existing serialisation test launches both in the same tick,
   * which passes on the broken driver.
   */
  it('queues a transaction that arrives after another has begun', async () => {
    const driver = createExpoDriver(fakeExpoConnection());
    await driver.run('CREATE TABLE t (v INTEGER)');

    let open: (() => void) | null = null;
    const inside = new Promise<void>((resolve) => {
      open = resolve;
    });

    const first = driver.transaction(async (tx) => {
      await tx.run('INSERT INTO t (v) VALUES (1)');
      open?.();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    await inside;
    const second = driver.transaction(async (tx) => {
      await tx.run('INSERT INTO t (v) VALUES (2)');
    });

    await Promise.all([first, second]);

    expect(await driver.all<{ v: number }>('SELECT v FROM t ORDER BY v')).toEqual([
      { v: 1 },
      { v: 2 },
    ]);
  });
});

/**
 * What SQLite itself does when two connections meet, asserted against SQLite
 * rather than against a boolean.
 *
 * These drive the raw connection on purpose. Through the driver none of it is
 * reachable — `gate.ts` holds every statement back for as long as a transaction
 * is open, which is the point. What they pin down is the cost of that gate ever
 * being removed, and the shape of the failure if it is.
 */
describe('the lock, when something does reach past the gate', () => {
  it('refuses a write issued outside the transaction that holds it', async () => {
    const db = fakeExpoConnection();
    await db.execAsync('CREATE TABLE t (v INTEGER)');

    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.runAsync('INSERT INTO t (v) VALUES (1)', []);

      // SQLite's own error, raised by SQLite. The default busy_timeout is 0,
      // so it does not even wait — see BUSY_TIMEOUT_MS in the driver.
      await expect(db.runAsync('INSERT INTO t (v) VALUES (2)', [])).rejects.toThrow(
        /database is locked/,
      );
    });

    expect(await db.getAllAsync('SELECT v FROM t', [])).toEqual([{ v: 1 }]);
  });

  /**
   * A read, however, succeeds — and that is the thing the old one-connection
   * fake got backwards.
   *
   * Under WAL a reader takes the snapshot as of the last commit and never
   * blocks on a writer. The fake used to throw here, which asserted a stricter
   * world than the device's; a driver could have been written to depend on
   * reads failing during a transaction and passed every test.
   */
  it('serves a read the snapshot from before the transaction', async () => {
    const db = fakeExpoConnection();
    await db.execAsync('CREATE TABLE t (v INTEGER)');

    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.runAsync('INSERT INTO t (v) VALUES (1)', []);

      // Not a throw, and not the uncommitted row either.
      expect(await db.getAllAsync('SELECT v FROM t', [])).toEqual([]);
    });

    expect(await db.getAllAsync('SELECT v FROM t', [])).toEqual([{ v: 1 }]);

    // And the overlap was counted. This is the only place in the suite that
    // deliberately reaches past the gate, so it is also the only proof that an
    // empty `strays` anywhere else means something.
    expect(db.strays).toEqual(['SELECT v FROM t']);
  });
});

/**
 * The rule the boolean used to stand in for, now observed rather than enforced
 * by the fake: nothing but the transaction's own statements may be issued
 * while it is open, because expo closes that connection the moment the body
 * returns.
 */
describe('the outer connection during a transaction', () => {
  it('is left completely alone, even under a burst of reads', async () => {
    const connection = fakeExpoConnection();
    const driver = createExpoDriver(connection);
    await driver.run('CREATE TABLE t (v INTEGER)');

    let open: (() => void) | null = null;
    const inside = new Promise<void>((resolve) => {
      open = resolve;
    });

    const transaction = driver.transaction(async (tx) => {
      await tx.run('INSERT INTO t (v) VALUES (1)');
      open?.();
      await new Promise((resolve) => setTimeout(resolve, 20));
      await tx.run('INSERT INTO t (v) VALUES (2)');
    });

    await inside;
    // The `useDues.refresh` shape: eleven reads in one burst, mid-transaction.
    const burst = Promise.all(
      Array.from({ length: 11 }, () => driver.all<{ v: number }>('SELECT v FROM t')),
    );

    await Promise.all([transaction, burst]);

    expect(connection.strays).toEqual([]);
  });
});

describe('nesting', () => {
  /** Through the handle — the only route a transaction body should have. */
  it('is refused at once, naming the rule', async () => {
    const driver = createExpoDriver(fakeExpoConnection());

    await expect(
      driver.transaction(async (tx) => {
        await tx.transaction(async () => undefined);
      }),
    ).rejects.toThrow(/Nested transactions are not supported/);

    // Usable afterwards, not left mid-transaction.
    await driver.run('CREATE TABLE t (v INTEGER)');
    await driver.transaction(async (tx) => tx.run('INSERT INTO t (v) VALUES (1)'));
    expect(await driver.all('SELECT v FROM t')).toHaveLength(1);
  });

  /**
   * Through the outer driver — the mistake the handle cannot prevent, because
   * `driver` is still in scope in every transaction body.
   *
   * It deadlocks: the call queues behind the transaction that is awaiting it.
   * The guard turns that into a named error rather than the silent hang this
   * project has paid for twice, and the transaction then rolls back cleanly.
   */
  it('is failed by the stall guard when it reaches past the handle', async () => {
    const clock = manualClock();
    const driver = createExpoDriver(fakeExpoConnection(), { stallMs: 1, schedule: clock.schedule });
    await driver.run('CREATE TABLE t (v INTEGER)');

    const leaked = driver.transaction(async (tx) => {
      await tx.run('INSERT INTO t (v) VALUES (1)');
      // The bug: `driver`, not `tx`.
      await driver.run('INSERT INTO t (v) VALUES (2)');
    });

    /**
     * Drain the microtask queue before ticking, rather than counting awaits.
     *
     * This used to be two `await Promise.resolve()`, which is a count of how
     * many microtasks the driver happened to take to reach the body. Adding one
     * statement inside the transaction — the busy_timeout PRAGMA — changed that
     * count, the tick landed before anything was queued, the guard never fired
     * and the test hung for two minutes. A macrotask drains whatever is
     * pending, however many that is.
     */
    await new Promise((resolve) => setTimeout(resolve, 0));
    clock.tick();

    await expect(leaked).rejects.toBeInstanceOf(SqlStalledError);

    // Rolled back as a unit, and the lane is free again.
    expect(await driver.all('SELECT v FROM t')).toEqual([]);
    await driver.transaction(async (tx) => tx.run('INSERT INTO t (v) VALUES (3)'));
    expect(await driver.all<{ v: number }>('SELECT v FROM t')).toEqual([{ v: 3 }]);
  });
});

describe('the lane', () => {
  it('runs operations in the order they were requested', async () => {
    const gate = createGate();
    const order: number[] = [];

    await Promise.all(
      Array.from({ length: 20 }, (_unused, i) =>
        gate.enter(async () => {
          await new Promise((resolve) => setTimeout(resolve, (20 - i) % 3));
          order.push(i);
        }),
      ),
    );

    expect(order).toEqual(Array.from({ length: 20 }, (_unused, i) => i));
  });

  it('lets the next operation through when one throws', async () => {
    const gate = createGate();

    await expect(gate.enter(async () => Promise.reject(new Error('nope')))).rejects.toThrow('nope');
    await expect(gate.enter(async () => 'after')).resolves.toBe('after');
  });

  /** A slow single statement is slow, not stuck: only transactions are guarded. */
  it('does not fail work queued behind an unguarded operation', async () => {
    const clock = manualClock();
    const gate = createGate({ stallMs: 1, schedule: clock.schedule });

    const box: { release?: () => void } = {};
    const held = gate.enter(
      () =>
        new Promise<void>((resolve) => {
          box.release = resolve;
        }),
    );
    const behind = gate.enter(async () => 'ran');

    clock.tick();
    box.release?.();

    await held;
    await expect(behind).resolves.toBe('ran');
  });

  /** A guarded holder that keeps issuing statements is working, not stalled. */
  it('re-arms on every statement a transaction issues', async () => {
    const clock = manualClock();
    const gate = createGate({ stallMs: 1, schedule: clock.schedule });

    const box: { release?: () => void } = {};
    const held = gate.enter<void>((beat) => {
      beat();
      return new Promise<void>((resolve) => {
        box.release = resolve;
      });
    }, true);
    const behind = gate.enter(async () => 'ran');

    box.release?.();
    await held;
    await expect(behind).resolves.toBe('ran');
  });
});

/**
 * The store's helpers take the handle as a parameter rather than closing over
 * the driver, so this is the shape a reviewer should expect to see.
 */
describe('the handle', () => {
  it('is the same shape as the driver, so helpers need one signature', async () => {
    const driver = createExpoDriver(fakeExpoConnection());
    await driver.run('CREATE TABLE t (v INTEGER)');

    const insert = async (db: SqlOps, v: number): Promise<void> => {
      await db.run('INSERT INTO t (v) VALUES (?)', [v]);
    };

    await insert(driver, 1);
    await driver.transaction(async (tx) => insert(tx, 2));

    expect(await driver.all<{ v: number }>('SELECT v FROM t ORDER BY v')).toEqual([
      { v: 1 },
      { v: 2 },
    ]);
  });
});
