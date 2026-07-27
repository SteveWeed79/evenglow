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
  if (!uri) throw new Error('MONGODB_URI is not set');

  // Cached across HMR reloads in dev; a fresh pool per cold start in prod.
  const existing = globalThis.__steadingMongoClient;
  if (existing) return existing;

  const created = new MongoClient(uri).connect();
  if (process.env.NODE_ENV !== 'production') {
    globalThis.__steadingMongoClient = created;
  }
  return created;
}

export async function db(): Promise<Db> {
  const client = await connect();
  return client.db(process.env.MONGODB_DB ?? 'steading');
}
