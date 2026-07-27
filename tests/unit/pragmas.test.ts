import { describe, expect, it, vi } from 'vitest';
import { applyPragmas, type PragmaTarget } from '@steading/app/db/capacitor-driver';

/**
 * Which plugin method a pragma goes through.
 *
 * `execute()` maps to Android's `SQLiteDatabase.execSQL`, which refuses any
 * statement returning rows: "Queries can be performed using SQLiteDatabase
 * query or rawQuery methods only". `PRAGMA journal_mode` returns the resulting
 * mode as a row. Sending it through `execute` threw, took down the entire
 * bootstrap on the first emulator run, and produced a blank screen — the only
 * trace was in the WebView console.
 *
 * Nothing in the plugin's types distinguishes the two cases, so the only thing
 * standing between this and a repeat is an assertion.
 */

function fake(mode = 'wal'): PragmaTarget & {
  executed: string[];
  queried: string[];
} {
  const executed: string[] = [];
  const queried: string[] = [];

  return {
    executed,
    queried,
    execute: vi.fn((statement: string) => {
      executed.push(statement);
      // What Android does when handed a row-returning statement.
      if (/journal_mode/i.test(statement)) {
        return Promise.reject(
          new Error(
            'Queries can be performed using SQLiteDatabase query or rawQuery methods only.',
          ),
        );
      }
      return Promise.resolve({});
    }),
    query: vi.fn((statement: string) => {
      queried.push(statement);
      return Promise.resolve({ values: [{ journal_mode: mode }] });
    }),
  };
}

describe('connection pragmas', () => {
  it('sets the journal mode through query, never execute', async () => {
    const db = fake();

    await applyPragmas(db);

    expect(db.queried.some((s) => /journal_mode/i.test(s))).toBe(true);
    expect(db.executed.some((s) => /journal_mode/i.test(s))).toBe(false);
  });

  it('asks for WAL', async () => {
    const db = fake();
    await applyPragmas(db);

    expect(db.queried[0]).toMatch(/journal_mode\s*=\s*WAL/i);
  });

  it('sets synchronous FULL, which returns nothing and so may use execute', async () => {
    const db = fake();
    await applyPragmas(db);

    expect(db.executed).toEqual(['PRAGMA synchronous = FULL;']);
  });

  /**
   * Android may already have chosen a journal mode, and `synchronous = FULL`
   * is what actually forces the fsync on commit. Refusing to start the app
   * over a journal mode would be the worse trade.
   */
  it('warns but carries on when WAL does not take', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = fake('delete');

    await expect(applyPragmas(db)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalled();
    // Still applied the setting that matters most for durability.
    expect(db.executed).toEqual(['PRAGMA synchronous = FULL;']);
    warn.mockRestore();
  });

  it('does not set foreign keys — the plugin does that when it opens', async () => {
    const db = fake();
    await applyPragmas(db);

    expect([...db.executed, ...db.queried].some((s) => /foreign_keys/i.test(s))).toBe(false);
  });
});
