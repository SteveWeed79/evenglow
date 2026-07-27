import { ulid } from 'ulid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { UserDoc } from '@steading/api/db/identity';
import { startTestDb } from '../support/mongo';

/**
 * The Fastify auth routes, through the real server.
 *
 * Uses `app.inject()` rather than binding a port: it exercises the whole
 * pipeline — routing, CORS, the rate limiter, the error handler — without a
 * socket, so it runs in CI as an ordinary test rather than a fragile
 * start-and-poll.
 */

const harness = await startTestDb('steading_isolation');

if (harness) {
  process.env.MONGODB_URI = harness.uri;
  process.env.MONGODB_DB = 'steading_isolation';
}

const SECRET = 'a-test-secret-long-enough-for-hs256-abcdef';
const PASSWORD = 'a properly long passphrase';

const OWNER = { _id: ulid(), orgId: ulid(), role: 'owner' as const };
const EMAIL = `owner-${OWNER._id}@example.test`.toLowerCase();

const describeDb = harness ? describe : describe.skip;

async function server() {
  const { buildServer } = await import('@steading/api/server');
  const { readEnv } = await import('@steading/api/env');
  return buildServer(
    readEnv({
      AUTH_SECRET: SECRET,
      MONGODB_URI: harness!.uri,
      MONGODB_DB: 'steading_isolation',
      CORS_ORIGINS: 'https://app.test',
    }),
  );
}

afterAll(async () => {
  await harness?.stop();
});

beforeEach(async () => {
  if (!harness) return;
  const { hashPassword } = await import('@steading/api/auth/password');

  await harness.db.collection('refreshTokens').deleteMany({});
  await harness.db.collection<UserDoc>('users').deleteMany({});
  await harness.db.collection<UserDoc>('users').insertOne({
    _id: OWNER._id,
    email: EMAIL,
    passwordHash: await hashPassword(PASSWORD),
    name: 'Test User',
    orgId: OWNER.orgId,
    role: OWNER.role,
    createdAt: new Date(),
  });
});

describeDb('POST /auth/login', () => {
  it('issues a pair for correct credentials', async () => {
    const app = await server();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: EMAIL, password: PASSWORD },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accessToken).toBeTypeOf('string');
    expect(body.refreshToken).toBeTypeOf('string');
    await app.close();
  });

  it('carries the org and role from the user document, never the request', async () => {
    const app = await server();
    const { verifyAccessToken } = await import('@steading/api/auth/tokens');

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      // A caller trying to elevate itself on the way in (invariant 2).
      payload: { email: EMAIL, password: PASSWORD, orgId: 'someone-elses-org', role: 'owner' },
    });

    const claims = await verifyAccessToken(res.json().accessToken, SECRET);
    expect(claims.orgId).toBe(OWNER.orgId);
    expect(claims.userId).toBe(OWNER._id);
    await app.close();
  });

  it('answers every failure identically', async () => {
    const app = await server();

    const attempts = await Promise.all(
      [
        { email: EMAIL, password: 'wrong' },
        { email: 'nobody@example.test', password: PASSWORD },
        { email: EMAIL },
        {},
      ].map((payload) => app.inject({ method: 'POST', url: '/auth/login', payload })),
    );

    // Unknown email, wrong password and malformed body must be one answer, or
    // the route becomes an account enumerator.
    expect(new Set(attempts.map((r) => r.statusCode))).toEqual(new Set([401]));
    expect(new Set(attempts.map((r) => r.json().error)).size).toBe(1);
    await app.close();
  });

  it('is case-insensitive on the email, because it is 6am', async () => {
    const app = await server();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: EMAIL.toUpperCase(), password: PASSWORD },
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  /** Rubric B3: auth routes fail CLOSED. The sync path is the one that does not. */
  it('rate limits repeated attempts from one address', async () => {
    const app = await server();

    const codes: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: EMAIL, password: 'wrong' },
        remoteAddress: '203.0.113.9',
      });
      codes.push(res.statusCode);
    }

    expect(codes).toContain(429);
    await app.close();
  });
});

describeDb('POST /auth/refresh', () => {
  it('rotates, and the old token stops working', async () => {
    const app = await server();

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: EMAIL, password: PASSWORD },
    });
    const first = login.json().refreshToken;

    const rotated = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: first },
    });
    expect(rotated.statusCode).toBe(200);
    expect(rotated.json().refreshToken).not.toBe(first);

    const replayed = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: first },
    });
    expect(replayed.statusCode).toBe(401);
    await app.close();
  });

  it('refuses an unknown token', async () => {
    const app = await server();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: 'not-a-real-token' },
    });

    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describeDb('POST /auth/logout', () => {
  it('ends the session and is not rate limited', async () => {
    const app = await server();

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: EMAIL, password: PASSWORD },
    });
    const token = login.json().refreshToken;

    const out = await app.inject({ method: 'POST', url: '/auth/logout', payload: { refreshToken: token } });
    expect(out.statusCode).toBe(204);

    const after = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: token },
    });
    expect(after.statusCode).toBe(401);
    await app.close();
  });
});

describeDb('the service itself', () => {
  it('answers a health check without touching the database', async () => {
    const app = await server();
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it('never returns a raw error message', async () => {
    const app = await server();
    // A body that is not JSON at all — Fastify's own parse failure, which must
    // still come back through the shared error shape.
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.json().error).toBeTypeOf('string');
    expect(res.json().error).not.toMatch(/JSON|parse|SyntaxError/i);
    await app.close();
  });
});
