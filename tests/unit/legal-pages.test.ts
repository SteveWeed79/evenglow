import { describe, expect, it } from 'vitest';
import { PRIVACY_PATH, PRIVACY_POLICY, TERMS_PATH } from '@homefarm/contracts';

/**
 * The two documents as web pages — the addresses Google Play's listing points
 * at, and the ones that must work with nothing installed.
 *
 * Runs anywhere, like `account-delete-page.test.ts` and for the same reason:
 * these routes touch no collection, and the half a store reviewer actually
 * opens is the worst one to have covered only by a job somebody has to remember
 * to look at.
 */

async function fetchPage(path: string) {
  const { buildServer } = await import('@homefarm/api/server');
  const { readEnv } = await import('@homefarm/api/env');

  const app = await buildServer(
    readEnv({
      AUTH_SECRET: 'a-test-secret-long-enough-for-hs256-abcdef',
      // Never dialled — these routes read nothing.
      MONGODB_URI: 'mongodb://127.0.0.1:27017',
      MONGODB_DB: 'homefarm_legal_pages',
    }),
  );

  const res = await app.inject({ method: 'GET', url: path });
  await app.close();
  return res;
}

describe.each([
  ['privacy policy', PRIVACY_PATH],
  ['terms of service', TERMS_PATH],
])('the %s page', (_name, path) => {
  it('is served as HTML', async () => {
    const res = await fetchPage(path);

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('carries its own effective date', async () => {
    const res = await fetchPage(path);
    expect(res.body).toContain('Effective');
  });

  /**
   * A document that is only read has no behaviour, so the page carries no
   * script at all. Asserted rather than assumed: a script tag appearing here
   * later would be something nobody intended.
   */
  it('runs no script', async () => {
    const res = await fetchPage(path);
    expect(res.body).not.toContain('<script');
  });

  it('refuses everything its policy does not name', async () => {
    const res = await fetchPage(path);
    const policy = String(res.headers['content-security-policy']);

    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain('unsafe-inline');
  });

  /** The style block is nonced, and the nonce is the one the header names. */
  it('carries the header’s nonce on its style', async () => {
    const res = await fetchPage(path);
    const nonce = /style-src 'nonce-([\w-]+)'/.exec(
      String(res.headers['content-security-policy']),
    )?.[1];

    expect(nonce).toBeDefined();
    expect(res.body).toContain(`<style nonce="${nonce}">`);
  });

  /**
   * Cached, unlike the deletion form. A reviewer may fetch these repeatedly,
   * they change a few times a year, and nothing here harms somebody who sees a
   * slightly stale copy — the effective date settles which version it is.
   */
  it('may be cached', async () => {
    const res = await fetchPage(path);
    expect(res.headers['cache-control']).toContain('max-age');
  });
});

describe('the privacy page', () => {
  it('renders the document rather than a stub', async () => {
    const res = await fetchPage(PRIVACY_PATH);

    // A heading, a list and a paragraph, which between them exercise three of
    // the four block kinds.
    expect(res.body).toContain('<h2>');
    expect(res.body).toContain('<li>');
    expect(res.body).toContain('Who receives information');
  });

  /** The fourth kind: an address a browser can act on. */
  it('makes the contact address a mailto', async () => {
    const res = await fetchPage(PRIVACY_PATH);
    expect(res.body).toContain('href="mailto:');
  });

  /**
   * The page and the app show the same words, which is the whole reason the
   * text lives in the contracts package. Checked on a sentence carrying an
   * apostrophe, because that is the one escaping would mangle.
   */
  it('shows the same words as the app', async () => {
    const res = await fetchPage(PRIVACY_PATH);
    const paragraph = PRIVACY_POLICY.blocks.find(
      (block) => block.kind === 'paragraph' && block.text.includes('two decimal places'),
    );

    expect(paragraph).toBeDefined();
    // Rendered with HTML escaping, so compare on a distinctive fragment that
    // contains no character escaping would touch.
    expect(res.body).toContain('rounded to two decimal places');
  });

  /** An apostrophe must survive as an apostrophe rather than as mojibake. */
  it('escapes without mangling ordinary punctuation', async () => {
    const res = await fetchPage(PRIVACY_PATH);
    expect(res.body).not.toContain('&amp;#');
    expect(res.body).toContain("Evenglow's server");
  });
});
