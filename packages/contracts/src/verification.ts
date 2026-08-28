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
export const EMAIL_TAKEN = `That email is already registered with ${PRODUCT_NAME}.`;

/** Said when the password offered alongside a new address is not the account’s. */
export const WRONG_PASSWORD = 'That password is not right.';

// ── Linking a Google identity from inside a session ──────────────────────────

/**
 * Connecting a Google account to the one already signed in.
 *
 * **The way back from the H1 fix.** `linkGoogleSub` refuses to bind a Google
 * identity to an account whose address was never proved, because an address in
 * `users` is a claim rather than a fact and linking on it handed whoever typed
 * it first the sign-in of whoever actually owns it. Every password account —
 * signup, invite, join code — is in exactly that state, so the Google button on
 * the sign-in screen now refuses them until `/auth/verify` has been through.
 *
 * A session answers the question the address was standing in for. Whoever is
 * holding this session *is* the account, so the proof the sign-in route could
 * not have is already in hand, and the link is safe without the address ever
 * being confirmed.
 *
 * **The password is asked for anyway**, exactly as `changeEmailSchema` asks for
 * it fifteen lines above, and for a stronger version of the same reason. A
 * Google link is the one grant in this system nothing revokes: `/auth/google`
 * signs a caller in from the subject alone, so a link minted by a stolen
 * session outlives the password change and the token revocation meant to evict
 * the thief. Session plus password is two secrets; a session alone is one.
 *
 * **This is in tension with A2.4 and the tension is worth naming.** Google
 * sign-in exists so there is "no password to store, reset or forget", and this
 * asks for one on the screen where somebody is trying to stop typing them.
 * What it costs is one password, once, on a screen they opened deliberately —
 * and what it buys is that connecting Google cannot be done *to* an account by
 * somebody who merely holds its session. After this, the password need never be
 * typed again, which is the promise A2.4 actually made.
 *
 * Optional, because an account created *by* Google has no password to offer —
 * and needs none, since it already carries the identity this route would bind.
 * The route answers that account with the truth rather than a refusal about a
 * password it never had.
 */
export const googleLinkSchema = z
  .object({ idToken: z.string().min(1).max(8192), password: passwordSchema.optional() })
  .strict();
export type GoogleLink = z.infer<typeof googleLinkSchema>;

/**
 * Said when this account already has a Google identity bound to it.
 *
 * Names the remedy rather than stopping at the refusal, because for the common
 * case — somebody connecting the same Google account twice — there is nothing
 * wrong and the sentence should not read like a fault.
 */
export const GOOGLE_ALREADY_LINKED =
  'This account is already connected to a Google account. Sign in with it instead.';

/**
 * Said when the Google account offered belongs to somebody else here.
 *
 * Templated on `PRODUCT_NAME` like `EMAIL_TAKEN`, and it ends in the action:
 * that Google account is a way in, just to a different farm.
 */
export const GOOGLE_TAKEN = `That Google account is already registered with ${PRODUCT_NAME}. Sign in with it instead.`;

/**
 * Said when the link could not be written and no other answer fits.
 *
 * The filter it comes from has three ways to match nothing — the account has
 * gone, it has been removed from the farm, or a Google identity arrived
 * between the read and the write — and this sentence covers all three rather
 * than guessing which. `/auth/email` makes the same choice about the same kind
 * of filter and says so; the alternative is telling somebody who was removed
 * from a farm mid-request that their account is connected to a Google account
 * they have never seen.
 */
export const GOOGLE_LINK_FAILED =
  'That could not be connected just now. Try again in a minute.';
