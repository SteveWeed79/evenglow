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

export interface TestDb {
  db: Db;
  client: MongoClient;
  uri: string;
  stop: () => Promise<void>;
}

async function connect(uri: string, dbName: string, onStop: () => Promise<void>): Promise<TestDb> {
  const client = await new MongoClient(uri).connect();
  return {
    client,
    uri,
    db: client.db(dbName),
    stop: async () => {
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
 */
export async function startTestDb(dbName = 'steading'): Promise<TestDb | null> {
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
