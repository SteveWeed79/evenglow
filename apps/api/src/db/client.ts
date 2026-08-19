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
  var __homefarmMongoClient: Promise<MongoClient> | undefined;
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

  /**
   * One client for the life of the process, in every environment.
   *
   * **This used to be cached only when `NODE_ENV !== 'production'`**, with a
   * comment about "a fresh pool per cold start" — reasoning inherited from the
   * deleted Next deployment, where each invocation really was a cold start and
   * the global existed to survive HMR. Under the Fastify service (D10) the
   * process is long-lived and `db()` is called on *every request*, so in
   * production it built a new `MongoClient` and a new connection pool per
   * request and never closed any of them. Development was fine, which is the
   * worst shape a bug of this kind can have.
   */
  const existing = globalThis.__homefarmMongoClient;
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
  globalThis.__homefarmMongoClient = created;

  /**
   * A failed connect must not be cached, or the first request while Mongo is
   * still starting poisons every request after it with the same rejected
   * promise and the service never recovers without a restart.
   */
  void created.catch(() => {
    if (globalThis.__homefarmMongoClient === created) {
      globalThis.__homefarmMongoClient = undefined;
    }
  });

  return created;
}

/**
 * Which database, and why an empty string is not the same as unset.
 *
 * **`??` is the wrong operator here and it silently sends a whole farm to the
 * wrong place.** It falls back only on null and undefined, so an env file line
 * reading `MONGODB_DB=` — which is what systemd's `EnvironmentFile` produces
 * from a key with nothing after it, and what a commented-out setting becomes
 * the moment somebody uncomments it and does not fill it in — arrives as `''`
 * and passes straight through.
 *
 * The driver then does not reject it. `client.db('')` returns the connection's
 * default database, which for a URI with no path is **`test`** — created on
 * first write, empty, and perfectly healthy-looking. The server answers every
 * request, `/health` is green, and a farm's records are somewhere nobody is
 * reading from.
 *
 * Found while pointing the first real deployment at an Atlas cluster whose
 * database is `homefarm` rather than the default. The name does NOT come from
 * the connection string — a URI ending `/homefarm` is connected to and then
 * ignored, because this line is the only thing that chooses.
 */
export function databaseName(source: Record<string, string | undefined> = process.env): string {
  const configured = source.MONGODB_DB?.trim();
  return configured === undefined || configured === '' ? 'homefarm' : configured;
}

export async function db(): Promise<Db> {
  const client = await connect();
  return client.db(databaseName());
}

/**
 * One round trip to the database, for readiness (`/ready`).
 *
 * **What it proves and what it does not.** It opens the connection, which is
 * where the driver performs the handshake and authenticates — so an
 * unreachable host, a wrong replica set, and credentials the server rejects all
 * surface here. The `ping` command itself needs no privilege, so this does
 * *not* prove the app's role can read the collections it will read. That is a
 * deliberate stop: readiness gets polled, and a check that costs a real query
 * every thirty seconds is a check somebody eventually turns off.
 *
 * **No result caching, and none is needed.** `/ready` is unauthenticated and on
 * the open internet, so the cost of a flood matters — but `connect()` above
 * already caches the client promise, so concurrent callers share one connection
 * attempt and one five-second server selection rather than each starting their
 * own. What is left is a single pooled round trip per request. Caching the
 * *answer* would be actively wrong: a poll a second after `systemctl restart`
 * has to see this process's state, not the one the last process gave, and that
 * poll is the whole reason this exists.
 */
export async function ping(): Promise<void> {
  const client = await connect();
  // Against the database `databaseName()` chose rather than `admin`, so the
  // setting most likely to be wrong is the one exercised.
  await client.db(databaseName()).command({ ping: 1 });
}
