import { z } from 'zod';
import { JOIN_CODE_ALPHABET, normalizeJoinCode, passwordSchema } from './membership';

/**
 * Getting back in, for a farm that forgot its password.
 *
 * Designed in `docs/PASSWORD-RECOVERY.md`; this is the wire half of it. The
 * shapes live here rather than in the API because the app types the code and
 * the new password, and a second declaration of either is a second place for
 * the rules to drift.
 */

/**
 * Eight characters over the same 32-character alphabet a join code uses, so
 * each one is exactly five bits and none of them can be misread across a yard.
 *
 * **Longer than a join code because it has none of a join code's protections.**
 * A join code lives for ten minutes while somebody holds their phone out, one
 * per farm, redeemed by a person standing next to the person who minted it. A
 * reset code sits in an inbox — possibly on a shared machine — with nobody
 * watching the window. Six characters is a billion; eight is a trillion.
 *
 * **The attempt ceiling matters more than the length**, and that is worth
 * saying plainly: a code that dies on the fifth wrong guess makes the entropy
 * argument nearly academic. Both are cheap, and this is the flow that hands
 * over an account.
 */
export const RESET_CODE_LENGTH = 8;
export const RESET_CODE_ALPHABET = JOIN_CODE_ALPHABET;

/**
 * Twenty minutes, where a join code gets ten.
 *
 * Mail has to arrive, be noticed, and then be carried to another device —
 * email is read on a phone and the farm's records are on the tablet in the
 * kitchen. Ten minutes is a window that fails honest people.
 */
export const RESET_CODE_TTL_MINUTES = 20;

/**
 * Five wrong guesses and the code is dead, not merely refused.
 *
 * A route limit alone lets somebody spread guesses across time; killing the row
 * bounds the whole code's life to five attempts however patient the attacker
 * is. The person it belongs to asks for another, which costs them one email.
 */
export const RESET_MAX_ATTEMPTS = 5;

/** The same folding a join code gets, so `l` for `1` is understood. */
export const normalizeResetCode = normalizeJoinCode;

export const forgotSchema = z.object({ email: z.string().email().max(254) }).strict();
export type Forgot = z.infer<typeof forgotSchema>;

/**
 * The email travels with the code, and it is not decoration.
 *
 * The code alone would be enough to find the row, and requiring the address
 * means a code intercepted without knowing who it was for is not usable. It is
 * the same reasoning `inviteAcceptSchema` gives: the token proves someone has
 * it, the email proves they are who it was for.
 */
export const resetSchema = z
  .object({
    email: z.string().email().max(254),
    code: z.string().min(1).max(40),
    password: passwordSchema,
  })
  .strict();
export type Reset = z.infer<typeof resetSchema>;

/**
 * What `/auth/forgot` says, whether or not the address belongs to anybody.
 *
 * It reports what was *done* without asserting that an account exists —
 * "if that email has an account" is doing the work. Saying "we have sent you a
 * code" would be both a lie for an unknown address and an account enumerator
 * for a known one.
 */
export const FORGOT_ACKNOWLEDGEMENT =
  'If that email has an account, a code is on its way. It is good for twenty minutes.';

/**
 * One refusal for every way a reset can fail.
 *
 * Wrong code, expired, already spent, too many guesses, unknown address — all
 * one sentence, because distinguishing them tells somebody which of those they
 * achieved. It names the way out, since the person reading it is by definition
 * already stuck.
 */
export const RESET_REFUSAL = 'That code is not right, or it has expired. Ask for another.';

/** Said when the server has no mail configured, which is a server fault. */
export const NO_MAIL_CONFIGURED =
  'This server cannot send email yet, so it cannot reset a password. Ask whoever runs it.';
