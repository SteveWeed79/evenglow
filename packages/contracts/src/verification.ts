import { z } from 'zod';
import { JOIN_CODE_ALPHABET, normalizeJoinCode, passwordSchema } from './membership';
import { PRODUCT_NAME } from './product';

/**
 * Proving that the address on an account is one its owner can read.
 *
 * `PASSWORD-RECOVERY.md` §10, which put this immediately after the sender and
 * said why: password signup accepts whatever is typed, and that is tolerable
 * only while an address does nothing. The moment an address can receive a reset
 * code, a typo at signup is a recovery route pointing at a stranger.
 *
 * ## What verification actually buys, since it is not what it first looks like
 *
 * It does **not** stop the stranger who receives a misdirected code from using
 * it — somebody reading that inbox can verify the address and then reset the
 * password, exactly as they could have reset it directly. Two things change,
 * and both matter more than that one does not:
 *
 * **The default becomes safe.** An unverified address cannot be reset to at
 * all, so a farm that never noticed the typo is not carrying a live takeover
 * route it does not know about. It has to be deliberately opened, by somebody
 * reading the inbox, once.
 *
 * **The farm is told.** A silent flag would be worth nothing; the account
 * screen says the address is unproved and offers to fix it, at signup, while
 * fixing it is still free. That is the real defence — the typo gets found by
 * the person who made it rather than by whoever owns the address they hit.
 *
 * And a farm that never verifies loses only *recovery*, never its records:
 * they are on the handset, and D1 means they stay there. Losing the password
 * on an unverified account costs the sync, not the season.
 */

/**
 * The same eight characters over the same alphabet a reset code uses.
 *
 * **Deliberately not weaker, because the two guard the same door.** It is
 * tempting to reason that a verification code merely turns recovery on and so
 * needs less strength than one that hands over an account. That is wrong by one
 * step: whoever verifies an address can then reset to it, so guessing this is
 * guessing the account with an extra round trip. Same length, same alphabet,
 * same attempt ceiling.
 */
export const VERIFY_CODE_LENGTH = 8;
export const VERIFY_CODE_ALPHABET = JOIN_CODE_ALPHABET;

/**
 * Twenty minutes, matching the reset code.
 *
 * The same journey justifies it — mail is read on a phone and the records are
 * on the tablet in the kitchen — and there is a second reason to keep the two
 * numbers equal rather than independently tuned: a farmer who has just used one
 * flow should not find the other behaving differently for no reason they can
 * see.
 */
export const VERIFY_CODE_TTL_MINUTES = 20;

/** Five wrong guesses and the code is dead, exactly as a reset code dies. */
export const VERIFY_MAX_ATTEMPTS = 5;

/** The same folding, so `l` for `1` is understood. */
export const normalizeVerifyCode = normalizeJoinCode;

/** Nothing to send: the route knows the account from the token. */
export const verifySendSchema = z.object({}).strict();

export const verifySchema = z.object({ code: z.string().min(1).max(40) }).strict();
export type Verify = z.infer<typeof verifySchema>;

/**
 * Correcting the address, which is what makes the whole feature honest.
 *
 * Without it a typo at signup is a permanent dead end: no recovery, and no way
 * in the app to fix the thing that caused it. Whoever is signed in can replace
 * an **unverified** address freely, because an unverified address asserts
 * nothing — swapping one unproved string for another discloses nothing and
 * grants nothing.
 *
 * **Changing a verified address is not this route and is not built.** That is a
 * different object: it needs the old address to confirm the move, or it is an
 * account-takeover primitive handed to anyone holding a session. Refused here
 * with a sentence rather than half-implemented.
 *
 * The current password is required even so. The person is signed in, so this
 * asks nothing they cannot answer — and it means a stolen refresh token alone
 * cannot walk the address onto an inbox the thief controls and then reset.
 */
export const changeEmailSchema = z
  .object({ email: z.string().email().max(254), password: passwordSchema })
  .strict();
export type ChangeEmail = z.infer<typeof changeEmailSchema>;

/** Said after a code is sent, and it names the wait rather than the outcome. */
export const VERIFY_SENT =
  'A code is on its way. It is good for twenty minutes.';

/**
 * One refusal for wrong, expired, spent and exhausted — the same reasoning
 * `RESET_REFUSAL` gives, and the same way out.
 */
export const VERIFY_REFUSAL = 'That code is not right, or it has expired. Ask for another.';

/** Said when the address is already proved, so there is nothing to do. */
export const ALREADY_VERIFIED = 'That email is already confirmed.';

/**
 * Said when somebody tries to move an address that has been proved.
 *
 * Distinct from every other refusal on purpose: it is not a security answer,
 * it is the truthful description of a feature that does not exist yet, and
 * hiding it behind a generic sentence would leave somebody retyping.
 */
export const VERIFIED_EMAIL_IS_FIXED =
  'That email is confirmed, so it cannot be changed here. Ask whoever runs the server.';

/** Said when the new address belongs to somebody else. */
export const EMAIL_TAKEN = `That email already has a ${PRODUCT_NAME} account.`;

/** Said when the password offered alongside a new address is not the account’s. */
export const WRONG_PASSWORD = 'That password is not right.';
