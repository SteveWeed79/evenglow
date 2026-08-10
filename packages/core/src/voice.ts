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

/**
 * What a group is, as a sentence.
 *
 * The collective noun was already correct everywhere — `SPECIES_TRAITS` has
 * carried herd, drove and gaggle since the beginning. It was being *printed*
 * rather than *said*: `CHICKENS · FLOCK · 10 HEAD · AUSTRALORP`, set in the
 * data face in caps, which is the register reserved for section labels and
 * units. A farm's own word for its own animals, formatted as if it were
 * telemetry.
 *
 * Primitives rather than a `Species`, so this module keeps its one useful
 * property: it depends on nothing and can be read end to end in a minute.
 * The caller already has the traits.
 *
 * The count stays a numeral. It is the one part of this line that is data —
 * read at a glance, off a screen held at arm's length — and `spellCount` is
 * for prose that is read as English.
 */
export function groupPhrase(input: {
  /** "flock", "herd", "drove" — never the entity name. */
  collective: string;
  /** Lowercase and plural: "chickens", "cattle", "guinea fowl". */
  species?: string;
  /** Lowercase and singular: "chicken", "cow", "guinea fowl". */
  singular?: string;
  /**
   * Head count. **Required, and separate from whether it is printed.**
   *
   * It settles the grammar whether or not it appears in the words: a group of
   * one is not a herd, and a group of none is not a flock of nothing. Stock's
   * cards shipped without passing it at all — the count has its own column
   * there — so the sentence had no way to know it was describing a single
   * animal, and a farm with one Angus read "A herd of Angus cattle."
   */
  count: number;
  breed?: string;
  /**
   * Whether the numeral belongs in the sentence.
   *
   * False where the count is already on screen in its own column. It changes
   * only the plural case: "one" and "no" are carried by the words themselves,
   * so in those there is no numeral to suppress.
   */
  showCount?: boolean;
}): string {
  const { collective, species, singular, count, breed, showCount = true } = input;

  const named = (word: string | undefined): string =>
    [breed ?? null, word ?? null]
      .filter((part): part is string => part !== null && part !== '')
      .join(' ');

  /**
   * A group that has been emptied — sold, processed, or lost — is still a
   * group, and must not be called a herd of zero. `count` is `nonnegative` in
   * the schema, so this is a real row rather than a hypothetical one.
   */
  if (count === 0) {
    return species === undefined ? 'Nothing in it yet.' : `No ${species} yet.`;
  }

  /**
   * One animal, which is the case a handset found.
   *
   * "One Angus cow." rather than "A herd of 1 Angus cattle." The collective
   * goes entirely: there is no collective noun for one of anything, and
   * reaching for the plural species word beside it is what made the sentence
   * wrong to begin with.
   */
  if (count === 1) {
    const one = named(singular);
    return one === '' ? 'One of them.' : `One ${one}.`;
  }

  // "A group of 2 other" — the `other` species has no word worth saying, so
  // the sentence stops at the count rather than naming a category nobody
  // chose. Same for a breed the library does not know.
  const tail = [showCount ? String(count) : null, named(species)]
    .filter((part): part is string => part !== null && part !== '')
    .join(' ');

  return tail === '' ? `A ${collective}.` : `A ${collective} of ${tail}.`;
}

/**
 * The exhale for a form that stays on screen after it saves.
 *
 * ## Why these are here and not in the screens
 *
 * Thirty-six save paths ended in the same success haptic and no words at all.
 * Two-thirds of them navigate away, where the previous screen changing *is*
 * the confirmation and a sentence would be shown to nobody. The remaining
 * third stay put — you add a note and the form is still there, empty, looking
 * exactly as it did before you pressed anything.
 *
 * One record, so every sentence in the app can be read in one place and
 * checked against the whimsy budget together. Written per entity rather than
 * generated, because "Treatment created." is what a schema would say and none
 * of these are that.
 *
 * ## Why this list is short
 *
 * Staying put is not the same as being silent. Adding a job, sending an invite
 * and correcting a history row all leave the screen up — and all three visibly
 * change it, because a row appears, a link is minted, or the corrected line
 * redraws. Those already acknowledge; a sentence beside them would be the app
 * congratulating itself for something the farmer can see.
 *
 * What is here is the set where the only evidence a write happened was a
 * cleared field: a note whose text vanishes, a mating whose dam picker resets,
 * a candling and a planting mark that change a stored date and nothing on
 * screen. Those are indistinguishable from a form that silently failed.
 *
 * Opt-in: a caller that passes nothing gets silence, which is the right
 * default for a path that leaves.
 */
export const SAID = {
  note: 'Noted.',
  mating: 'In the book.',
  candling: 'Candled.',
  planting: 'Marked down.',
} as const;

export type Said = keyof typeof SAID;

/**
 * One sentence per entity, for the screens that stay.
 *
 * A function rather than a bare lookup so the call site reads as speech and
 * the union is checked — a typo'd key is a compile error rather than
 * `undefined` rendered as a blank line under a form.
 */
export function saidConfirmation(kind: Said): string {
  return SAID[kind];
}
