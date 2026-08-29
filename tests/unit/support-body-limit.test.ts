import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { SupportBundle } from '@homefarm/contracts';
import { supportRoutes } from '@homefarm/api/routes/support';
import { resetFiling, type SupportConfig } from '@homefarm/api/support/github';
import type { Env } from '@homefarm/api/env';

/**
 * How big a ticket the server will take.
 *
 * `supportTicketSchema` allows `records` up to twenty million characters, and
 * **nothing raised Fastify's 1 MiB default on this route** — only the photos
 * scope sets a `bodyLimit`. So a farm that was asked whether to attach its
 * records and said yes got a 413, and the **lean bundle went with it**: the
 * diagnostics and the records travel in one request, so the report that could
 * not be sent was the whole report.
 *
 * It is not a large farm that crosses this. The bench figure this project uses
 * for a busy year is 1,540 records at 884 KB, so a second season is over the
 * default with room to spare — and the farm most in need of reporting is the
 * one whose sync is refusing it.
 *
 * ## Why this is a unit test and not an isolation one
 *
 * `/support` is unauthenticated and touches no database, so the route mounts on
 * a bare Fastify instance with a stubbed tracker. That keeps it runnable on a
 * machine that cannot reach a mongod — which, after a CI-only suite caught a
 * regression this session, is worth having where it is possible.
 */

const CONFIG: SupportConfig = {
  token: 'a-token',
  owner: 'a-farm',
  repo: 'homefarm',
  acceptRecords: true,
};

function bundle(): SupportBundle {
  return {
    v: 1,
    at: 1_786_477_273_151,
    app: { version: '0.1.0', build: 'abc1234', platform: 'android', os: '35' },
    store: { schemaVersion: 5 },
    sync: {
      queued: 0,
      rejected: 0,
      quarantined: 0,
      cleared: 28,
      lastSyncAt: null,
      lastError: null,
      online: true,
    },
    rejections: [],
    errors: [],
    fingerprint: '33sy8nj5q76s',
  };
}

/** A tracker that accepts anything, so the assertion is about the body size. */
function acceptEverything(): void {
  vi.stubGlobal('fetch', (url: string, init?: { method?: string }) => {
    if ((init?.method ?? 'GET') === 'GET') {
      return Promise.resolve(new Response('[]', { status: 200 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify({ number: 1, html_url: 'https://example.test/1' }), {
        status: 201,
      }),
    );
  });
}

async function server() {
  const app = Fastify();
  await supportRoutes(app, { supportConfig: CONFIG } as Env);
  await app.ready();
  return app;
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetFiling();
});

describe('a ticket with a farm’s records attached', () => {
  /** Two megabytes: past Fastify's default, nowhere near the contract's cap. */
  const RECORDS = 'x'.repeat(2 * 1024 * 1024);

  it('is not cut off at the 1 MiB default', async () => {
    acceptEverything();
    const app = await server();

    const res = await app.inject({
      method: 'POST',
      url: '/support',
      payload: { bundle: bundle(), records: RECORDS },
    });

    // Accepted, not merely "not 413" — a 400 from a malformed fixture would
    // have passed that, which is how a test proves nothing while looking green.
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  /** And the lean half still gets through on its own, as it always did. */
  it('still takes a report with no records at all', async () => {
    acceptEverything();
    const app = await server();

    const res = await app.inject({
      method: 'POST',
      url: '/support',
      payload: { bundle: bundle() },
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
