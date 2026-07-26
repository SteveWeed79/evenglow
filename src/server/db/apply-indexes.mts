/**
 * `pnpm db:indexes` — applies index definitions to the configured database.
 * Deliberately a script, not boot-time work on the request path.
 */
import { db } from './client.ts';
import { applyIndexes } from './indexes.ts';

const database = await db();
await applyIndexes(database);
console.log(`Indexes applied to "${database.databaseName}".`);
process.exit(0);
