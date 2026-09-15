import { describe, expect, it } from 'vitest';
import { ACCOUNT_DELETE_PATH, PRODUCT_NAME } from '@homefarm/contracts';

/**
 * The page somebody reaches without the app, and its content policy.
 *
 * **Runs anywhere, deliberately.** Everything else about deletion needs a
 * database and therefore skips on a machine that cannot obtain a mongod — and
 * this is the half Google Play actually inspects, so it is the worst one to
 * have covered only by a job somebody has to go and look at. The route touches
 * no collection, so it can be served against an env that names a database
 * nothing ever dials.
 *
 * What is asserted is what a reviewer and a farmer each need: that the address
 * answers at all, that it says what deletion costs *before* the form, and that
 * the nonce in the header is the one in the page. The third is the one that
 * fails silently — a mismatched nonce serves a page whose own script never
 * runs, which looks like a button that does nothing.
 */

async function pageResponse() {
  const { buildServer } = await import('@homefarm/api/server');
  const { readEnv } = await import('@homefarm/api/env');

  const app = await buildServer(
    readEnv({
      AUTH_SECRET: 'a-test-secret-long-enough-for-hs256-abcdef',
      // Never dialled: this route reads nothing. `env.ts` requires the value to
      // be present, not to be reachable.
      MONGODB_URI: 'mongodb://127.0.0.1:27017',
      MONGODB_DB: 'homefarm_account_delete_page',
    }),
  );

  const res = await app.inject({ method: 'GET', url: ACCOUNT_DELETE_PATH });
  await app.close();
  return res;
}

describe('the account deletion page', () => {
  it('is served as HTML at the documented address', async () => {
    const res = await pageResponse();

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain(`Delete your ${PRODUCT_NAME} account`);
  });

  /**
   * The three things the app says, said here too. A person reading this page
   * usually has no app in front of them to compare with, and a form that
   * deletes a farm must not be shorter than the warning.
   */
  it('says what a deletion costs before it offers the form', async () => {
    const res = await pageResponse();

    const warning = res.body.indexOf('deletes the farm');
    const form = res.body.indexOf('<form');

    expect(warning).toBeGreaterThan(-1);
    expect(warning).toBeLessThan(form);

    // The whole farm, everybody on it, and the store that is still charging.
    expect(res.body).toContain('accounts of everybody else');
    expect(res.body).toContain('Google Play');
    // And that the phone in their hand is not what this touches.
    expect(res.body).toContain('stays on that phone');
  });

  /** Nothing is cached: a page about deleting an account is not a page to keep. */
  it('is not stored by the browser', async () => {
    const res = await pageResponse();
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('refuses everything its own policy does not name', async () => {
    const res = await pageResponse();
    const policy = String(res.headers['content-security-policy']);

    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("connect-src 'self'");
    // No CDN, no font host: the page is self-contained, so anything else being
    // permitted would be a hole with nothing on the other side of it.
    expect(policy).not.toContain('unsafe-inline');
  });

  /**
   * The failure that looks like a broken button rather than a security fault:
   * a page whose script carries a nonce the response does not name never runs.
   */
  it('carries the same nonce in the header and the markup', async () => {
    const res = await pageResponse();
    const policy = String(res.headers['content-security-policy']);

    const script = /script-src 'nonce-([\w-]+)'/.exec(policy)?.[1];
    const style = /style-src 'nonce-([\w-]+)'/.exec(policy)?.[1];

    expect(script).toBeDefined();
    expect(style).toBe(script);
    expect(res.body).toContain(`<script nonce="${script}">`);
    expect(res.body).toContain(`<style nonce="${script}">`);
  });

  /** A nonce that repeats is not one. */
  it('mints a new nonce for every response', async () => {
    const first = await pageResponse();
    const second = await pageResponse();

    const nonceOf = (res: { headers: Record<string, unknown> }) =>
      /script-src 'nonce-([\w-]+)'/.exec(String(res.headers['content-security-policy']))?.[1];

    expect(nonceOf(first)).toBeDefined();
    expect(nonceOf(first)).not.toBe(nonceOf(second));
  });

  /** Search engines have no business holding this. */
  it('asks not to be indexed', async () => {
    const res = await pageResponse();
    expect(res.body).toContain('noindex');
  });
});
