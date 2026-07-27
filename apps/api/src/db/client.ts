import { MongoClient, type Db } from 'mongodb';

/**
 * The ONLY module permitted to import MongoClient (enforced by the
 * no-restricted-imports rule in eslint.config.mjs).
 *
 * Connection is lazy: the client is not constructed at module load, so
 * importing this file in a context without MONGODB_URI (a unit test, a
 * client-bundle trace) does not throw. It throws on first actual use.
 */

declare global {
  var __steadingMongoClient: Promise<MongoClient> | undefined;
}

function connect(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    // Naming the file matters: the usual cause is not a missing value but a
    // .env.local that nothing loaded, and "MONGODB_URI is not set" sends you
    // looking in the wrong place.
    throw new Error(
      'MONGODB_URI is not set. Copy .env.example to .env.local at the repo root and fill it in.',
    );
  }

  // Cached across HMR reloads in dev; a fresh pool per cold start in prod.
  const existing = globalThis.__steadingMongoClient;
  if (existing) return existing;

  /**
   * Five seconds, not the driver's default thirty.
   *
   * A request that hangs for half a minute is worse than one that fails: the
   * client queues offline work and retries with backoff, so a fast, clear
   * failure is something it already knows how to handle, while a stalled
   * connection just holds a socket and delays the retry that would have
   * worked.
   */
  const created = new MongoClient(uri, { serverSelectionTimeoutMS: 5_000 }).connect();
  if (process.env.NODE_ENV !== 'production') {
    globalThis.__steadingMongoClient = created;
  }
  return created;
}

export async function db(): Promise<Db> {
  const client = await connect();
  return client.db(process.env.MONGODB_DB ?? 'steading');
}
