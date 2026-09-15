import { type LegalBlock, type LegalDocument, PRODUCT_NAME } from '@homefarm/contracts';

/**
 * The privacy policy and the terms, as web pages.
 *
 * Google Play needs a privacy policy at an address that works with nothing
 * installed, and the app needs the same words on a handset with no server
 * (D14). Both render `contracts/legal.ts`, so there is one copy of the text and
 * no way for the page and the screen to come to disagree.
 *
 * Built exactly as `account-page.ts` is — one self-contained string with a
 * nonced style block, no CDN, no font host, nothing to fetch. It carries no
 * script at all, which is worth saying: a document that only needs to be read
 * has no behaviour, so the policy's `script-src` authorises nothing here.
 */

/**
 * Text into HTML, escaped.
 *
 * **Every string in the document goes through this.** They are written by us
 * rather than by a farmer, so this is not defending against an attacker — it is
 * defending against an apostrophe or an ampersand in a sentence somebody edits
 * next year, which would otherwise render as mojibake or silently break the
 * markup on the one page a store reviewer reads.
 */
function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * One block.
 *
 * Exhaustive over `LegalBlock`, like the app's renderer, so a kind added to the
 * contract fails the compiler on both surfaces rather than rendering as nothing
 * on one of them.
 */
function renderBlock(block: LegalBlock): string {
  switch (block.kind) {
    case 'heading':
      return `<h2>${escape(block.text)}</h2>`;
    case 'paragraph':
      return `<p>${escape(block.text)}</p>`;
    case 'list':
      return `<ul>${block.items.map((item) => `<li>${escape(item)}</li>`).join('')}</ul>`;
    case 'contact':
      // A `mailto:` here where the app deliberately draws plain text — a
      // browser always has somewhere to send one, and a farm handset may not.
      return (
        `<p>${escape(block.label)} ` +
        `<a href="mailto:${escape(block.email)}">${escape(block.email)}</a>.</p>`
      );
  }
}

export function legalPage(document: LegalDocument, nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
<title>${escape(document.title)}</title>
<style nonce="${nonce}">
  :root {
    color-scheme: light dark;
    --bg: #f6f5f2; --card: #fffefb; --ink: #1c1a17; --muted: #6b665e;
    --line: #dedad2; --accent: #3f6f4f;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14150f; --card: #1c1e17; --ink: #ece9e1; --muted: #9a978d;
      --line: #2e3128; --accent: #8fbf9c;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 17px/1.55 ui-serif, Georgia, "Times New Roman", serif;
  }
  main { max-width: 660px; margin: 0 auto; padding: 40px 20px 80px; }
  h1 { font-size: 28px; margin: 0 0 6px; line-height: 1.2; }
  h2 { font-size: 19px; margin: 32px 0 8px; line-height: 1.3; }
  p, li { margin: 0 0 12px; }
  ul { padding-left: 22px; }
  a { color: var(--accent); }
  .effective {
    color: var(--muted); font-size: 13px; text-transform: uppercase;
    letter-spacing: 0.08em; margin: 0 0 28px;
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  }
  footer {
    margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--line);
    color: var(--muted); font-size: 14px;
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  }
</style>
</head>
<body>
<main>
  <h1>${escape(document.title)}</h1>
  <p class="effective">Effective ${escape(document.effective)}</p>
  ${document.blocks.map(renderBlock).join('\n  ')}
  <footer>${escape(PRODUCT_NAME)} — these same words are in the app, under Settings.</footer>
</main>
</body>
</html>
`;
}
