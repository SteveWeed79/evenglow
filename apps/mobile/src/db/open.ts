import * as SQLite from 'expo-sqlite';
import type { SqlDriver } from '@steading/app/db/driver';
import { applyPragmas, createExpoDriver, type SqliteConnection } from './expo-driver';

/**
 * The only file that names `expo-sqlite`.
 *
 * Same rule the Capacitor build kept, and for the same reason: a native module
 * imported from thirty places is a native module that cannot be swapped, faked
 * or reasoned about. Everything above this talks to `SqlDriver`.
 */

export const DATABASE_NAME = 'steading.db';

export async function openExpoSqlDriver(databaseName = DATABASE_NAME): Promise<SqlDriver> {
  // Assigned to the narrow interface with no cast. That is the check: if a
  // future expo-sqlite changes one of the six methods this driver leans on,
  // the failure is a compile error here rather than a runtime one on a handset.
  const connection: SqliteConnection = await SQLite.openDatabaseAsync(databaseName);
  await applyPragmas(connection);
  return createExpoDriver(connection);
}
