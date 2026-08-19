import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readEnv } from '@homefarm/api/env';
import { buildServer } from '@homefarm/api/server';
import { startTestDb } from '../support/mongo';

/**
 * Liveness and readiness, and the gap between them that a deploy gate fell
 * into (P2-4).
 *
 * Mongo connects lazily, so `MONGODB_URI` is only ever dialled by a request
 * that needs a record. `env.ts` requires the variable to be non-empty, which
 * catches a *missing* one at boot — but a *wrong* one starts perfectly well.
 * The process comes up, `/health` returns `{ok:true}`, `deploy.sh` reads that
 * as success, and every data route fails at a five-second server-selection
 * timeout. The script's own comment said its poll existed to catch a bad
 * `MONGODB_URI`; it asked the one endpoint that could not.
 *
 * The unreachable half needs no database, which is the point — the failure it
 * covers is precisely the one where there isn't one. The reachable half needs
 * a real mongod and skips without one, as every database-backed suite here
 * does.
 */

const SECRET = 'a-test-secret-long-enough-for-hs256-abcdef';

/** Fails at the driver's scheme check, so the test costs no timeout. */
const NO_SUCH_DATABASE = 'mongo://farmer@cluster.example.invalid/homefarm';

function env(uri: string, dbName?: string) {
  return readEnv({
    AUTH_SECRET: SECRET,
    MONGODB_URI: uri,
    ...(dbName === undefined ? {} : { MONGODB_DB: dbName }),
    CORS_ORIGINS: 'https://app.test',
  });
}

/**
 * `client.ts` reads `process.env` rather than the parsed Env, as every caller
 * of `db()` does — so that, not the argument to `buildServer`, is the value
 * under test. Saved and restored around each case because the ambient one is
 * real in CI and other suites depend on it.
 */
function useDatabaseUri(uri: string, dbName?: string): void {
  let savedUri: string | undefined;
  let savedName: string | undefined;

  beforeEach(() => {
    savedUri = process.env.MONGODB_URI;
    savedName = process.env.MONGODB_DB;
    process.env.MONGODB_URI = uri;
    if (dbName !== undefined) process.env.MONGODB_DB = dbName;
    globalThis.__homefarmMongoClient = undefined;
  });

  afterEach(() => {
    restore('MONGODB_URI', savedUri);
    restore('MONGODB_DB', savedName);
    globalThis.__homefarmMongoClient = undefined;
  });
}

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe('a process that cannot reach its database', () => {
  useDatabaseUri(NO_SUCH_DATABASE);

  it('still answers /health, because it is running', async () => {
    const app = await buildServer(env(NO_SUCH_DATABASE));

    const res = await app.inject({ method: 'GET', url: '/health' });

    // Not a bug to fix — this is what liveness means, and `fly.toml` restarts
    // a machine on it. The bug was having nothing else to ask.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it('refuses /ready', async () => {
    const app = await buildServer(env(NO_SUCH_DATABASE));

    const res = await app.inject({ method: 'GET', url: '/ready' });

    expect(res.statusCode).toBe(503);
    await app.close();
  });

  /**
   * `toEqual` against the exact object, so this fails the moment anyone adds
   * the driver's message to the body. It is a tempting thing to add while
   * debugging: the endpoint needs no token and is reachable from the internet,
   * and a Mongo connection error names the host, the replica set and often the
   * user. The reason belongs in the journal.
   */
  it('does not say why', async () => {
    const app = await buildServer(env(NO_SUCH_DATABASE));

    const res = await app.inject({ method: 'GET', url: '/ready' });

    expect(res.json()).toEqual({ ok: false, database: 'unreachable' });
    await app.close();
  });
});

/** Its own database name, so nothing here can collide with another suite's. */
const harness = await startTestDb('homefarm_readiness');
const describeDb = harness ? describe : describe.skip;

afterAll(async () => {
  await harness?.stop();
});

describeDb('a process that can', () => {
  useDatabaseUri(harness?.uri ?? '', 'homefarm_readiness');

  it('answers /ready once the connection opens', async () => {
    const app = await buildServer(env(harness!.uri, 'homefarm_readiness'));

    const res = await app.inject({ method: 'GET', url: '/ready' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, database: 'reachable' });
    await app.close();
  });
});
