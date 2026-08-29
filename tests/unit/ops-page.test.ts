import { describe, expect, it } from 'vitest';
import { boardPolicy } from '@homefarm/api/headers';
import { boardPage } from '@homefarm/api/ops/page';

/**
 * The board's page against the board's own content policy.
 *
 * `tests/isolation/ops-board.test.ts` asserts the header — that it refuses
 * everything the page does not use, that it carries no `unsafe-inline`, that
 * the nonce in the header is the nonce in the markup. It cannot assert the
 * thing this file is about, because it needs a mongod and this does not:
 * **both halves are pure**, and the agreement between them is the whole
 * question.
 *
 * ## What went wrong between them
 *
 * The policy says `style-src 'nonce-…'`. **A nonce authorises a `<style>`
 * ELEMENT and never a `style=` ATTRIBUTE** — they are separate directives
 * precisely because a CSS attribute on injected markup can read a page and
 * exfiltrate through a background URL. The page carried six inline style
 * attributes, so a browser enforcing the header dropped every one of them: the
 * Refresh button un-anchored from the right, four inputs back at their default
 * width. The board drawn wrong by the board's own header, and nothing in either
 * file able to see it.
 *
 * `style-src-attr 'unsafe-inline'` would have made the page render too, and it
 * is the wrong trade — the argument for this header is that if a `textContent`
 * ever became an `innerHTML`, the nonce is what stops what arrives. So the page
 * gave the six rules classes in its nonced block instead, and this is what
 * keeps it that way.
 */

const NONCE = 'a-test-nonce';

describe('the board page under its own policy', () => {
  /**
   * The regression, stated as the rule rather than as the six. A seventh added
   * next year fails here rather than on somebody's screen.
   */
  it('carries no inline style attribute, because the policy authorises none', () => {
    expect(boardPolicy(NONCE)).toContain(`style-src 'nonce-${NONCE}'`);
    expect(boardPolicy(NONCE)).not.toContain('style-src-attr');
    expect(boardPolicy(NONCE)).not.toContain('unsafe-inline');

    // The attribute, not the CSS property: `style="..."` on an element.
    const attributes = boardPage(NONCE).match(/\sstyle\s*=\s*["']/g) ?? [];
    expect(attributes, `${attributes.length} inline style attribute(s)`).toEqual([]);
  });

  /**
   * And no inline event handler either, for the same reason one directive over:
   * `script-src 'nonce-…'` does not authorise `onclick=`. None has ever been
   * written here; this is what keeps that true.
   */
  it('carries no inline event handler, because the policy authorises none', () => {
    const handlers = boardPage(NONCE).match(/\son[a-z]+\s*=\s*["']/g) ?? [];
    expect(handlers, handlers.join(', ')).toEqual([]);
  });

  /** The two things the nonce does authorise are both still there and named. */
  it('nonces the one style element and the one script element', () => {
    const page = boardPage(NONCE);

    expect(page).toContain(`<style nonce="${NONCE}">`);
    expect(page).toContain(`<script nonce="${NONCE}">`);
    expect((page.match(/<style/g) ?? []).length).toBe(1);
    expect((page.match(/<script/g) ?? []).length).toBe(1);
  });

  /**
   * The layout the six attributes used to carry, now as rules. Asserted by name
   * so deleting one is a failure rather than a page that quietly reflows.
   */
  it('styles what it used to style inline, from the nonced block', () => {
    const page = boardPage(NONCE);

    for (const rule of ['.push-right', '.w-promo-days', '.w-grant-org']) {
      expect(page, rule).toContain(rule);
    }
    expect(page).toContain('class="sub push-right"');
  });
});
