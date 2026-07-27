/**
 * Voice — UX-SPEC §6.
 *
 * "Warm and plainspoken — a well-kept notebook, not a greeting card."
 *
 * The whimsy budget is absolute about where warmth is allowed: controls,
 * errors, and data stay plain, and the exhale after a successful log is the
 * one place on the working path where the app is permitted a whole sentence
 * about itself. That sentence lives here so it is written once, tested, and
 * cannot drift into a control label.
 */

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
] as const;

const TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
] as const;

/**
 * A count as words, for prose only.
 *
 * Numerals stay numerals everywhere they are *data* — the Tally face, the
 * hour reading, the head count — because those are read at a glance through
 * a glove. This is for the one sentence that is read as English, where the
 * spec's own example is "Eighteen in the basket." rather than "18".
 *
 * Above ninety-nine it gives up and returns digits: "two hundred and forty"
 * is not warmer than "240", it is just longer.
 */
export function spellCount(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) return String(n);
  if (n < 20) return ONES[n] as string;

  const tens = TENS[Math.floor(n / 10)] as string;
  const ones = n % 10;
  return ones === 0 ? tens : `${tens}-${ONES[ones] as string}`;
}

function opening(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * The default exhale, for any countable log that has no better sentence.
 *
 * Plain on purpose. A confirmation that reaches for charm it has not earned
 * is worse than one that simply says what happened.
 */
export function loggedConfirmation(count: number, unit: string): string {
  return `${opening(spellCount(count))} ${unit} logged.`;
}

/**
 * Eggs get the good line, because eggs genuinely go in a basket.
 *
 * This is deliberately not the default: the Tally is reused for every
 * countable log, and "412 hours in the basket" is the exact failure the
 * whimsy budget is written to prevent — warmth applied without looking at
 * what it is describing.
 */
export function basketConfirmation(count: number): string {
  return `${opening(spellCount(count))} in the basket.`;
}
