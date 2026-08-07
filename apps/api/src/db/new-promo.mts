/**
 * `pnpm promo:new` — writes a promotion code and prints it once.
 *
 * **A script, never a route.** There is no path from the wire to a new code:
 * minting requires a shell on the server, which is the only authority that
 * should be able to give a subscription away. The redeem route can spend a
 * code and cannot create one, so the worst an attacker with the whole API can
 * do is guess.
 *
 * Printed once and stored hashed, so this output is the only time the code
 * exists in readable form. Losing it means minting another — which is cheap,
 * and much better than a database that hands out working codes to anybody who
 * reads it.
 *
 *   pnpm promo:new                       one code, forever, single use
 *   pnpm promo:new --days 365            a year from whenever it is redeemed
 *   pnpm promo:new --uses 5 --note beta  five farms, and a word to remember why
 */

import { formatPromoCode, promoGrantSchema } from '@steading/contracts';
import { createPromoCode, mintPromoCode } from './promo-codes';

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

const days = flag('days');
const uses = flag('uses');
const note = flag('note');

/**
 * Parsed through the contract rather than trusted, even here.
 *
 * A typo'd `--days abc` would otherwise write `NaN` into a document and hand
 * out a subscription that expires at an unrepresentable moment. The one place
 * this app skips a boundary parse should not be the one that mints money.
 */
const grant = promoGrantSchema.parse({
  days: days === undefined ? null : Number(days),
  ...(note === undefined ? {} : { note }),
});

const maxRedemptions = uses === undefined ? 1 : Number(uses);
if (!Number.isInteger(maxRedemptions) || maxRedemptions < 1) {
  throw new Error(`--uses must be a whole number of farms. Got: ${uses}`);
}

const code = mintPromoCode();
await createPromoCode({ code, grant, maxRedemptions });

console.log(`
  Code:   ${formatPromoCode(code)}
  Worth:  ${grant.days === null ? 'sync, forever' : `sync for ${grant.days} days from redemption`}
  Uses:   ${maxRedemptions} ${maxRedemptions === 1 ? 'farm' : 'farms'}${note === undefined ? '' : `\n  Note:   ${note}`}

  Write it down. It is stored hashed and cannot be shown again.
`);

process.exit(0);
