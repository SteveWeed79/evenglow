/**
 * The SQL surface the store is written against.
 *
 * Narrow on purpose. Two implementations exist — the Capacitor plugin on a
 * device (`client.ts`) and `node:sqlite` under vitest (`tests/support/sqlite`)
 * — and the store must not be able to tell them apart. Anything richer than
 * this (prepared-statement handles, cursors, driver-specific batch helpers)
 * would leak one of them into the other's path.
 *
 * `transaction` is the load-bearing member. Invariant 5 — one BEGIN, both
 * writes, one COMMIT — is only enforceable if the store never sees a bare
 * connection to write through.
 */

export type SqlValue = string | number | null;

export interface SqlTx {
  run(sql: string, params?: readonly SqlValue[]): Promise<void>;
  query<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
}

export interface SqlDriver extends SqlTx {
  /** Multiple statements, no parameters. Migrations only. */
  execute(sql: string): Promise<void>;

  /**
   * Runs `fn` inside BEGIN/COMMIT, rolling back on any throw.
   *
   * Implementations MUST NOT nest. SQLite has no nested transactions, and a
   * silently-flattened inner "transaction" would commit an outer one early —
   * exactly the divergence between queue and projection that invariant 5
   * exists to prevent.
   */
  transaction<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T>;

  close(): Promise<void>;
}

/**
 * The device is out of space.
 *
 * Raised by the driver, not the store, because only the driver can recognise
 * SQLITE_FULL. The store re-throws it unchanged so the log path can offer the
 * one piece of advice that helps (sync, then retry) rather than a stack trace.
 */
export class StorageFullError extends Error {
  constructor() {
    super('This device is out of space. Sync to free room, then try again.');
    this.name = 'StorageFullError';
  }
}

/** SQLITE_FULL (13) and SQLITE_IOERR variants that mean the same thing in practice. */
export function isDiskFull(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /SQLITE_FULL|database or disk is full|disk I\/O error|ENOSPC/i.test(message);
}
