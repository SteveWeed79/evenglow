import { z } from 'zod';
import { passwordSchema } from './membership';

/**
 * Deleting an account, and what that means for the farm it belongs to.
 *
 * `docs/ACCOUNT-DELETION.md` is the decision; this file is the wire shape and
 * the sentences. The rule that everything else follows from:
 *
 * > **The last owner takes the farm with them. Anybody else takes only
 * > themselves.**
 *
 * A farm is its owner's. A hand's account is membership of somebody else's
 * farm, so deleting it removes the person and leaves the records — a morning's
 * egg logs do not stop being true because the person who typed them left,
 * which is the same rule removal already follows. An owner with a co-owner is
 * in the same position: the farm has somebody left to own it. The last owner
 * has nobody to leave it to, and an unowned farm is one nobody can ever act on,
 * export, or delete — so it goes, whole: every record, every photo's bytes,
 * the mutation log, and every other member's account on it.
 *
 * ## Two proofs, because there are two kinds of account
 *
 * A password account proves itself with the password, exactly as a change of
 * address does and for the same reason: a stolen session on its own must not
 * be enough to destroy a farm. An account Google created has no password and
 * needs none — it proves itself with a fresh Google ID token for the same
 * subject. An account with both may use either. The server decides which it
 * is holding; the client only offers what it can.
 */
export const deleteAccountSchema = z
  .object({
    password: passwordSchema.optional(),
    idToken: z.string().min(1).max(8192).optional(),
  })
  .strict()
  .refine((proof) => proof.password !== undefined || proof.idToken !== undefined, {
    message: 'One proof is required.',
  });

export type DeleteAccount = z.infer<typeof deleteAccountSchema>;

/**
 * The same deletion, asked for from a web page rather than from inside a
 * session (`ACCOUNT_DELETE_PATH`).
 *
 * Google Play requires a way to delete an account that does not need the app
 * installed, and a farm that has lost its phone is the one that needs it. The
 * proof is the sign-in pair — the page has no session to present — and the
 * password bound is the sign-in bound rather than `passwordSchema`, because an
 * old account whose password predates the twelve-character floor still has to
 * be able to leave.
 */
export const deleteByCredentialsSchema = z
  .object({
    email: z.string().email().max(320),
    password: z.string().min(1).max(1024),
  })
  .strict();

export type DeleteByCredentials = z.infer<typeof deleteByCredentialsSchema>;

/**
 * Where the web form lives, on the API's own host.
 *
 * One constant so the store listing, the in-app copy and the route cannot
 * name three different addresses.
 */
export const ACCOUNT_DELETE_PATH = '/account/delete';

/**
 * What the server did, so the device can say it back.
 *
 * `members` on the farm outcome is how many *other* accounts went with it —
 * the number the owner was warned about before confirming, repeated so the
 * confirmation can be checked against the warning.
 */
export const deletionOutcomeSchema = z.discriminatedUnion('deleted', [
  z.object({ deleted: z.literal('farm'), members: z.number().int().nonnegative() }).strict(),
  z.object({ deleted: z.literal('member') }).strict(),
]);

export type DeletionOutcome = z.infer<typeof deletionOutcomeSchema>;

/** Said when neither proof was offered, or the one offered was not this account's. */
export const DELETION_PROOF_NEEDED =
  'Confirm with your password, or with the Google account this account signs in with.';

/**
 * Said to the web form for every failure — unknown address, wrong password,
 * an account with no password. One sentence, because a page anybody can reach
 * must not say which addresses have accounts.
 */
export const DELETION_REFUSED = 'That email or password is not right.';
