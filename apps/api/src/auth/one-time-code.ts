import { createHash, randomInt } from 'node:crypto';

/**
 * The two operations every short-lived code in this system needs, in one place.
 *
 * Join codes, reset codes and verification codes are the same object with
 * different lifetimes: minted from the CSPRNG over Crockford's alphabet, stored
 * only as a SHA-256 digest, and matched by hashing what was typed. That shape
 * was written out once per table and is now written out once.
 *
 * Extracted when the third one arrived rather than the second, which is the
 * point at which duplication stops being a coincidence — and these are the two
 * lines nobody would notice drifting, because a weaker mint or a different
 * digest still passes every test the flow above it has.
 */

/**
 * `randomInt` rather than `Math.random` or a modulo of random bytes.
 *
 * CSPRNG backed, and rejection sampling underneath — so every character is
 * uniform over the alphabet rather than biased toward its first few. A modulo
 * of `randomBytes` is the common shortcut and it quietly costs entropy on any
 * alphabet whose length does not divide 256.
 */
export function mintCode(length: number, alphabet: string): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[randomInt(alphabet.length)];
  }
  return out;
}

/**
 * The digest a code is stored and matched by. Takes the **normalised** code —
 * folding is the caller's job, because each flow names its own normaliser and a
 * default here would be a place for one of them to be forgotten.
 */
export function hashCode(normalised: string): string {
  return createHash('sha256').update(normalised).digest('hex');
}
