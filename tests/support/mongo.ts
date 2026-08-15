import { MongoClient, type Db } from 'mongodb';

/**
 * Test database harness.
 *
 * Prefers an explicit MONGODB_TEST_URI (a real server, a CI service container),
 * and falls back to mongodb-memory-server, which downloads a mongod binary on
 * first use.
 *
 * If neither is available the database-backed suites SKIP rather than pass, and
 * say so loudly. Set STEADING_REQUIRE_DB=1 — as CI does — to turn an
 * unavailable database into a hard failure, so the exit gate can never be met
 * by a suite that silently did not run.
 */

/**
 * The name a caller gets by not choosing one — and it is the production
 * database name, which is why `stop()` refuses to drop it.
 */
const DEFAULT_DB_NAME = 'steading';

export interface TestDb {
  db: Db;
  client: MongoClient;
  uri: string;
  stop: () => Promise<void>;
}

async function connect(uri: string, dbName: string, onStop: () => Promise<void>): Promise<TestDb> {
  const client = await new MongoClient(uri).connect();
  const db = client.db(dbName);

  return {
    client,
    uri,
    db,
    stop: async () => {
      /**
       * Taken away rather than left behind.
       *
       * Under `MONGODB_TEST_URI` the server outlives the run, so without this
       * every suite leaves a database on it for ever and a rerun starts on top
       * of whatever the last one left. The memory-server path does not need it
       * and is not harmed by it.
       *
       * **Guarded on the name**, and the guard is the whole reason this is safe
       * to do at all: `startTestDb`'s default is `steading`, which is the
       * *production* database name, so a call site that forgot to name its own
       * would otherwise drop the real one the moment somebody pointed
       * `MONGODB_TEST_URI` at a server that had it.
       */
      if (dbName !== DEFAULT_DB_NAME) {
        await db.dropDatabase().catch(() => undefined);
      }
      await client.close();
      await onStop();
    },
  };
}

/**
 * Database names are the app name, or the app name plus what the database
 * holds — never an environment. Nothing here is called test, dev, staging, or
 * prod: those labels drift from reality the moment someone points a staging
 * app at a production cluster, and then the name is actively misleading.
 *
 * **Every call site passes its own**, and that is a requirement rather than a
 * convention. Under `MONGODB_TEST_URI` all files share one mongod and pick a
 * database by name, and these suites wipe collections in `beforeEach` — so two
 * files on one name wipe each other's fixtures mid-test. Five of them shared
 * `steading_isolation` until B-3, which is what `vitest.config.ts`'s
 * `fileParallelism: false` was quietly holding together.
 */
export async function startTestDb(dbName = DEFAULT_DB_NAME): Promise<TestDb | null> {
  const explicit = process.env.MONGODB_TEST_URI;
  if (explicit) {
    return connect(explicit, dbName, async () => {});
  }

  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const server = await MongoMemoryServer.create();
    return await connect(server.getUri(), dbName, async () => {
      await server.stop();
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);

    if (process.env.STEADING_REQUIRE_DB === '1') {
      throw new Error(
        `STEADING_REQUIRE_DB=1 but no test database is available.\n${detail}`,
      );
    }

    console.warn(
      [
        '',
        '  ────────────────────────────────────────────────────────────────',
        '  SKIPPING database-backed suites: no mongod available.',
        '',
        `  ${detail.split('\n')[0]}`,
        '',
        '  Fix by either:',
        '    • setting MONGODB_TEST_URI to a reachable MongoDB, or',
        '    • allowing egress to fastdl.mongodb.org so mongodb-memory-server',
        '      can download a binary.',
        '',
        '  These suites are the Phase 1 exit gate. CI sets STEADING_REQUIRE_DB=1',
        '  so an unavailable database fails the build instead of skipping.',
        '  ────────────────────────────────────────────────────────────────',
        '',
      ].join('\n'),
    );
    return null;
  }
}
