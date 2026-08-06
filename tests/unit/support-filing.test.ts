import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SUPPORT_BUNDLE_VERSION, type SupportBundle } from '@steading/contracts';
import { readEnv } from '@steading/api/env';
import { buildServer } from '@steading/api/server';

/** Fastify is a dependency of the API workspace, not of the test root. */
type Server = Awaited<ReturnType<typeof buildServer>>;

/**
 * Where a ticket lands (`docs/SUPPORT-LOOP.md` S3, S4 and S5).
 *
 * Through the real server with `app.inject()` — routing, the rate limiter and
 * the error handler included — but no database: **the support route must not
 * need one.** A report about a farm whose sync is refusing it cannot be gated
 * behind the credential the farm cannot renew, which is why this route is
 * unauthenticated and why this suite runs in ordinary CI rather than behind
 * `STEADING_REQUIRE_DB`.
 *
 * GitHub is stubbed at `fetch`. The three calls are the contract being tested:
 * find an open issue with the fingerprint label, comment on it or open a new
 * one, and put the opt-in half in a secret gist.
 */

const TOKEN = 'ghp-a-token-that-must-never-be-echoed';

const ENV = {
  AUTH_SECRET: 'a-test-secret-long-enough-for-hs256-abcdef',
  MONGODB_URI: 'mongodb://localhost:27017',
};

const bundle = (over: Partial<SupportBundle> = {}): SupportBundle => ({
  v: SUPPORT_BUNDLE_VERSION,
  at: 1_700_000_000_000,
  app: { version: '0.1.0', platform: 'android' },
  store: { schemaVersion: 5 },
  sync: { queued: 3, rejected: 1, lastSyncAt: null, lastError: 'Network error' },
  rejections: [{ entity: 'eggLog', op: 'create', reason: 'count out of range', count: 2 }],
  errors: [{ where: 'flush', message: 'Network error', count: 4 }],
  fingerprint: 'abc123',
  ...over,
});

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

/** Every GitHub call the route made, in order. */
let calls: Call[] = [];

/**
 * `openIssue` is what a repeat report finds: the search either returns the
 * existing issue or an empty list, and that single fact decides whether this
 * arrival opens issue four hundred or adds a comment to issue one.
 */
function github(options: { openIssue?: boolean; fail?: boolean } = {}): void {
  calls = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : {},
      });

      if (options.fail === true) return new Response('nope', { status: 503 });

      const json = (value: unknown): Response =>
        new Response(JSON.stringify(value), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });

      if (url.includes('/gists')) return json({ html_url: 'https://gist.test/secret' });
      if (url.includes('/comments')) return json({ id: 1 });
      if (url.includes('issues?')) {
        return json(
          options.openIssue === true
            ? [{ number: 7, html_url: 'https://github.test/issues/7' }]
            : [],
        );
      }
      return json({ html_url: 'https://github.test/issues/8' });
    }),
  );
}

async function serve(over: Record<string, string> = {}): Promise<Server> {
  return buildServer(readEnv({ ...ENV, ...over }));
}

/** The configured-and-private state: a tracker, and the records half allowed. */
const CONFIGURED = {
  SUPPORT_GITHUB_TOKEN: TOKEN,
  SUPPORT_REPO: 'SteveWeed79/steading',
  SUPPORT_ACCEPT_RECORDS: '1',
};

let app: Server | null = null;

beforeEach(() => {
  github();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await app?.close();
  app = null;
});

describe('a server with nowhere to file', () => {
  /**
   * The state every self-hosted box stays in, and it is supported rather than
   * broken: the app has a second door and needs to know to offer it.
   */
  it('says so plainly rather than swallowing the report', async () => {
    app = await serve();

    const res = await app.inject({ method: 'POST', url: '/support', payload: { bundle: bundle() } });

    expect(res.statusCode).toBe(501);
    expect(res.json().error).toContain('nowhere to file');
  });

  it('never pretends a report was sent', async () => {
    app = await serve();
    const res = await app.inject({ method: 'POST', url: '/support', payload: { bundle: bundle() } });

    expect(res.json().ok).toBeUndefined();
  });
});

describe('filing', () => {
  it('opens an issue labelled with the fingerprint', async () => {
    app = await serve(CONFIGURED);

    const res = await app.inject({
      method: 'POST',
      url: '/support',
      payload: { bundle: bundle() },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, created: true, url: 'https://github.test/issues/8' });

    const opened = calls.find((call) => call.method === 'POST' && call.url.endsWith('/issues'));
    expect(opened?.body.labels).toContain('fp:abc123');
    // S1: the body is the bundle, not prose about the bundle.
    expect(String(opened?.body.body)).toContain('"fingerprint": "abc123"');
  });

  /**
   * Dedup, which is what makes the loop survivable at all: one device in a
   * crash loop must produce one issue with the evidence accumulating on it,
   * not four hundred issues.
   */
  it('adds to the open issue rather than opening a second', async () => {
    github({ openIssue: true });
    app = await serve(CONFIGURED);

    const res = await app.inject({ method: 'POST', url: '/support', payload: { bundle: bundle() } });

    expect(res.json()).toMatchObject({ created: false, url: 'https://github.test/issues/7' });
    expect(calls.some((call) => call.url.endsWith('/comments'))).toBe(true);
    expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/issues'))).toBe(false);
  });

  it('refuses a report it cannot read', async () => {
    app = await serve(CONFIGURED);

    const res = await app.inject({
      method: 'POST',
      url: '/support',
      payload: { bundle: { ...bundle(), email: 'sam@example.test' } },
    });

    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  /**
   * A 502 rather than a 200, because the device holds the ticket until it is
   * sent and a false success would drop the one artefact the loop exists to
   * move.
   */
  it('tells the device to keep the report when the tracker is unreachable', async () => {
    github({ fail: true });
    app = await serve(CONFIGURED);

    const res = await app.inject({ method: 'POST', url: '/support', payload: { bundle: bundle() } });

    expect(res.statusCode).toBe(502);
    expect(res.json().error).toContain('still on your phone');
  });

  /**
   * A GitHub error can echo the request, and the request carried a token. The
   * route answers a client that ships inside an APK, so anybody can read what
   * it sends.
   */
  it('never echoes the tracker credential', async () => {
    github({ fail: true });
    app = await serve(CONFIGURED);

    const res = await app.inject({ method: 'POST', url: '/support', payload: { bundle: bundle() } });

    expect(res.body).not.toContain(TOKEN);
  });
});

/**
 * S5, and it is the gate that decides whether a farm's records can be
 * world-readable.
 *
 * The gate lives on the server rather than in the app because the app cannot
 * know a repository's visibility, and a build shipped before the change would
 * be wrong about it forever.
 */
describe('the opt-in half', () => {
  const records = JSON.stringify({ sheets: [{ name: 'eggs', csv: 'date,count\n2026-08-01,6' }] });

  it('goes to a secret gist the issue links, when the tracker may take it', async () => {
    app = await serve(CONFIGURED);

    const res = await app.inject({
      method: 'POST',
      url: '/support',
      payload: { bundle: bundle(), records },
    });

    expect(res.statusCode).toBe(200);

    const gist = calls.find((call) => call.url.endsWith('/gists'));
    expect(gist?.body.public).toBe(false);

    const opened = calls.find((call) => call.method === 'POST' && call.url.endsWith('/issues'));
    expect(String(opened?.body.body)).toContain('https://gist.test/secret');
    // Not inline: an issue body is capped at 65 KB and a farm's records are
    // not, and a body of four megabytes of JSON is an issue nobody opens.
    expect(String(opened?.body.body)).not.toContain('date,count');
  });

  it('declines them while the repository is public, and files the report anyway', async () => {
    app = await serve({ ...CONFIGURED, SUPPORT_ACCEPT_RECORDS: '' });

    const res = await app.inject({
      method: 'POST',
      url: '/support',
      payload: { bundle: bundle(), records },
    });

    expect(res.statusCode).toBe(200);
    expect(calls.some((call) => call.url.endsWith('/gists'))).toBe(false);

    /**
     * Answered rather than silently dropped. The farm was asked a question and
     * said yes, and it is owed the truth about what happened to the answer.
     */
    expect(res.json().note).toContain('not sent');
  });

  it('says nothing about records when none were offered', async () => {
    app = await serve(CONFIGURED);

    const res = await app.inject({ method: 'POST', url: '/support', payload: { bundle: bundle() } });

    expect(res.json().note).toBeUndefined();
    expect(calls.some((call) => call.url.endsWith('/gists'))).toBe(false);
  });
});
