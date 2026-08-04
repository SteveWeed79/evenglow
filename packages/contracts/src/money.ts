import { z } from 'zod';

/**
 * Money, as an integer.
 *
 * ## Minor units, for the reason everything else here is an integer
 *
 * Masses are micrograms, lengths micrometres, temperatures tenths of a degree.
 * Money is the case where floats are not merely imprecise but famously so:
 * `0.1 + 0.2` is not `0.3`, and a season of feed costs summed as dollars drifts
 * by real money. Stored as the smallest unit the currency has — cents, pence,
 * yen — and divided only to be read.
 *
 * ## What this is NOT
 *
 * Not a ledger. The masterplan is explicit: cost tracking goes as far as
 * cost-per-egg, cost-per-bird and cost-per-bed, and double-entry accounting is
 * out of scope because it is a different product. There is no account, no
 * balance, no reconciliation — only what a thing cost, carried far enough to
 * divide by what it produced.
 */

export type Minor = number;

/**
 * Non-negative because this app records what things cost, not what they earn.
 * A refund is a farm editing what it said it paid, not a negative purchase.
 */
export const minorSchema = z.number().int().nonnegative();

/**
 * ISO 4217, and the farm's own.
 *
 * A currency is a property of the farm, never of a record: a sack in dollars
 * and a sack in pounds on the same shelf cannot be added, and any total across
 * them would be a lie told confidently. One setting, applied to everything.
 *
 * Kept as free-form three letters rather than an enum of the world's currencies
 * — the list changes, and a farm in a currency this app has never heard of
 * should not be told its money does not exist.
 */
export const currencySchema = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/, 'A currency is three capital letters, like USD or GBP.');

export type Currency = z.infer<typeof currencySchema>;

/**
 * Dollars, for the reason imperial is the default unit system: the bundled
 * reference data and the first farms are US.
 */
export const DEFAULT_CURRENCY: Currency = 'USD';

/**
 * The ones a smallholding is likely to keep books in, with the symbol a person
 * reads. Anything else falls back to the code itself, which is correct if less
 * pretty — "42.00 ZAR" is unambiguous and never wrong.
 *
 * Not `Intl.NumberFormat`: Hermes ships without the full ICU data on Android,
 * so currency formatting silently degrades to the code on exactly the platform
 * this ships to first. A table of six is smaller than the bug.
 */
const SYMBOLS: Record<string, string> = {
  USD: '$',
  CAD: '$',
  AUD: '$',
  NZD: '$',
  GBP: '£',
  EUR: '€',
};

/**
 * How many minor units make one. Every currency here uses a hundred; the
 * exceptions that use none (yen, won) are handled rather than assumed, because
 * ¥500 shown as ¥5.00 is a hundredfold error that looks like a formatting slip.
 */
const NONE: readonly string[] = ['JPY', 'KRW', 'VND', 'CLP', 'ISK'];

export function minorPer(currency: Currency): number {
  return NONE.includes(currency) ? 1 : 100;
}

/**
 * A price, as a person reads it.
 *
 * Two decimals where the currency has them, none where it does not. No
 * thousands separators — a smallholding's feed bill does not reach them, and
 * the separator is the part that differs by locale and would need ICU.
 */
export function formatMoney(minor: Minor, currency: Currency = DEFAULT_CURRENCY): string {
  const per = minorPer(currency);
  const symbol = SYMBOLS[currency];
  const amount = per === 1 ? String(Math.round(minor)) : (minor / per).toFixed(2);

  return symbol === undefined ? `${amount} ${currency}` : `${symbol}${amount}`;
}

/**
 * A rate too small to show as money, shown honestly.
 *
 * Cost per egg is the number this whole feature exists for, and it is a few
 * cents. `formatMoney` rounds 3.4 minor units to "$0.03", which throws away the
 * precision that makes two seasons comparable — the difference between 3.4¢ and
 * 3.9¢ an egg is fifteen per cent, and rounding calls them the same.
 *
 * Under one whole unit this keeps a decimal place on the minor amount; above
 * it, ordinary money is what a person wants.
 */
export function formatRate(minor: number, currency: Currency = DEFAULT_CURRENCY): string {
  const per = minorPer(currency);
  if (per === 1 || minor >= per) return formatMoney(Math.round(minor), currency);

  const symbol = SYMBOLS[currency];
  // Cents have no symbol of their own in most currencies, and "¢" is wrong
  // outside a few. The fraction of the major unit is unambiguous everywhere.
  const amount = (minor / per).toFixed(3);
  return symbol === undefined ? `${amount} ${currency}` : `${symbol}${amount}`;
}
