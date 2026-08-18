import type { FastifyInstance } from 'fastify';

/**
 * The response headers both servers set, and why a JSON API bothers.
 *
 * ## Most of this is for the board, and one line is for the photos
 *
 * The API answers an APK. There is no browser, no cookie, no same-origin
 * policy, and most of what a header pack buys does not apply — which is the
 * argument that kept these off, and it was three-quarters right. The quarter it
 * missed:
 *
 * **`nosniff` is load-bearing on `/photos/:id`.** That route serves bytes a
 * farm account uploaded. The upload now checks their leading bytes, so what is
 * stored is an image — but records written before that check exists are not
 * covered by it, and a client that guesses at a content type is how stored
 * bytes become something other than a picture. Turning the guess off is one
 * header and it holds for every response including the old ones.
 *
 * **The operations board is a real web page**, served as HTML to a browser,
 * showing every farm on the server. Framing, referrer leakage and script
 * injection all mean something there, and it had none of the three.
 *
 * ## Hand-written rather than `helmet`
 *
 * Style asks what a dependency replaces and why the platform primitive is not
 * enough. Here the primitive is a `Reply` and a string: this is four headers on
 * the API and six on the board, all static. `@fastify/helmet` would be a
 * dependency, a version to keep current and a supply-chain surface, in exchange
 * for defaults that would then have to be turned off one at a time — its CSP
 * default alone blocks the board's own inline script.
 */

/**
 * What every response carries.
 *
 * `nosniff` for the reason above. `no-referrer` because a `Referer` on any
 * request this service provokes could carry a photo id or an invite token into
 * somebody else's logs. `X-Frame-Options` because a page that cannot be framed
 * cannot be clickjacked, and the board has buttons that grant subscriptions.
 * `X-Permitted-Cross-Domain-Policies` because Flash-era clients still honour a
 * cross-domain policy file, and this service serves none.
 */
const BASE: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'x-permitted-cross-domain-policies': 'none',
};

/**
 * The board's page, which is HTML and therefore has a content policy worth
 * writing.
 *
 * `default-src 'none'` and then only what the page genuinely uses: its own
 * inline style and its own inline script, named by **nonce** rather than by
 * `'unsafe-inline'`. The page is self-contained by design — no CDN, no font
 * host, no image host — so every other directive is a refusal, and `connect-src
 * 'self'` is what lets it call `/board` and nothing else.
 *
 * The page already puts every value into the DOM through `textContent`, which
 * is what makes a farm's name safe to render. This is the layer under that: if
 * a `textContent` ever became an `innerHTML`, the nonce is what stops the
 * injected script from running.
 *
 * `frame-ancestors 'none'` says the same thing as `X-Frame-Options` to a
 * browser that reads CSP, which is every current one. Both, because the header
 * is what an older one honours.
 */
export function boardPolicy(nonce: string): string {
  return [
    "default-src 'none'",
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * Sets the headers on every response.
 *
 * An `onSend` hook rather than a per-route header, because the value of these
 * is that nothing can be added without them — a route written next year gets
 * them by existing, which is the same argument `scoped()` makes about orgId.
 *
 * It does not overwrite. A route with something more specific to say — the
 * board's own CSP, or a photo's cache directive — has already said it by the
 * time this runs, and this must not talk over it.
 */
export function setSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onSend', async (_request, reply, payload) => {
    for (const [name, value] of Object.entries(BASE)) {
      if (!reply.hasHeader(name)) reply.header(name, value);
    }
    return payload;
  });
}
