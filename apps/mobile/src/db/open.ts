import { Directory, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import type { SqlDriver } from '@steading/core/db/driver';
import { reportEngineError } from '@steading/core/sync/report';
import {
  applyPragmas,
  createExpoDriver,
  integrityProblem,
  type SqliteConnection,
} from './expo-driver';

/**
 * The only file that names `expo-sqlite`.
 *
 * Same rule the Capacitor build kept, and for the same reason: a native module
 * imported from thirty places is a native module that cannot be swapped, faked
 * or reasoned about. Everything above this talks to `SqlDriver`.
 */

/**
 * One database file per farm, not one per device and not one per person.
 *
 * **The tenancy boundary is the org, not the user.** Two hands on the same
 * farm are entitled to the same animals, so partitioning per user would
 * duplicate the whole farm's records for each of them and make every new
 * hand's first sync a full pull over farm signal. Partitioning per org gives
 * the isolation that actually matters — a second farm on a shared tablet
 * cannot see the first one's records, because it is not the same file — and
 * costs nothing.
 *
 * That also makes cross-farm leakage impossible by construction rather than
 * by remembering to wipe on sign-out, which is the same defence-in-depth
 * argument the server side makes for `scoped(orgId)`.
 */
export function databaseNameFor(orgId: string): string {
  // ULIDs only, and asserted rather than assumed: this string becomes a
  // filename, and an orgId carrying a slash would be a path traversal into
  // the app sandbox.
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(orgId)) {
    throw new Error('An org id must be a ULID before it can name a database file.');
  }
  return `steading-${orgId}.db`;
}

export async function openExpoSqlDriver(databaseName: string): Promise<SqlDriver> {
  // Assigned to the narrow interface with no cast. That is the check: if a
  // future expo-sqlite changes one of the six methods this driver leans on,
  // the failure is a compile error here rather than a runtime one on a handset.
  const connection: SqliteConnection = await SQLite.openDatabaseAsync(databaseName);
  await applyPragmas(connection);

  /**
   * Asked as the file opens, reported rather than acted on ([37]).
   *
   * The store opens either way — see `integrityProblem` for why refusing would
   * be the wrong call — so this is a report and the app carries on. It goes
   * through the engine reporter, which puts it in the trouble history where a
   * support bundle will carry it, rather than in front of somebody who cannot
   * act on the words "malformed database page".
   */
  const problem = await integrityProblem(connection);
  if (problem !== null) {
    reportEngineError(
      'checking the records file',
      new Error(`SQLite reports damage in ${databaseName}: ${problem}`),
    );
  }

  return createExpoDriver(connection);
}

/**
 * Deletes a farm's database file.
 *
 * Sign-out does NOT call this — see `auth/session.ts`. It is the explicit
 * "this tablet is going to someone else" action, and it is destructive in a
 * way sign-out must not be: anything still queued is unsent work, and a hand
 * who signs out at the end of a shift in a barn with no signal has a queue
 * that is the entire point of the app.
 */
export async function forgetDatabase(orgId: string): Promise<void> {
  await SQLite.deleteDatabaseAsync(databaseNameFor(orgId));
}

/**
 * Every farm this device has a database for.
 *
 * **The one question nothing could ask.** A farm's id lives in secure storage
 * and its records live in `steading-{orgId}.db`, so the id is the only pointer
 * to the file — and when the pointer goes, `ensureLocalOrgId` mints a fresh
 * one and the app opens an empty farm beside a full one, silently. That is a
 * loss with no error, no warning and nothing on any screen, which is the worst
 * shape a loss can take.
 *
 * It cannot be repaired from here — picking one of several files would be the
 * app guessing which farm somebody meant. What it can do is refuse to pretend
 * there is nothing there, which is what `boot/start.ts` uses this for.
 *
 * Returns the org ids, not the filenames, so callers never parse a path.
 */
export async function knownFarmIds(): Promise<string[]> {
  const directory = new Directory(Paths.document, 'SQLite');
  if (!directory.exists) return [];

  return directory
    .list()
    .map((entry) => /^steading-([0-9A-HJKMNP-TV-Z]{26})\.db$/.exec(entry.name)?.[1])
    .filter((id): id is string => id !== undefined);
}
