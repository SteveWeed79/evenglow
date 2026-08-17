import { formatPromoCode, promoGrantSchema } from '@steading/contracts';
import { z } from 'zod';
import { findOrgById, setSyncGrant } from '../db/identity';
import { createPromoCode, mintPromoCode } from '../db/promo-codes';
import { HttpError } from '../http';

/**
 * The two things the board may change, and the long list of things it may not.
 *
 * ## What is allowed, and the rule that decides it
 *
 * **No credential-changing actions.** That is the line, and it replaced a
 * weaker "read-only first" — read-only would have ruled out the two useful
 * buttons while still permitting anything else somebody later thought was safe.
 * Naming the forbidden class instead means the rule keeps working on actions
 * nobody has written yet.
 *
 * So `promo:new` and `farm:grant` are here: their worst case is a spurious code
 * or a comped farm, both reversible by hand and neither of which gives anybody
 * access to anything. **`db:password` stays on the shell.** It sets any
 * account's password, which makes a button for it an account-takeover
 * primitive — and that is equally true on localhost, so it is not an argument
 * about where the page is served from.
 *
 * ## Functions, never a shell
 *
 * These call the same exported functions the `.mts` commands call. Shelling out
 * to `pnpm …` would be a command-injection surface, and it would also make the
 * board depend on a checkout being present beside the running service — which
 * is not something a deployed process should assume about its own disk.
 */

export const newPromoRequest = z
  .object({
    /** Null is the forever grant, which `promoGrantSchema` already models. */
    days: z.number().int().positive().max(3650).nullable(),
    uses: z.number().int().positive().max(1000),
    note: z.string().max(200).optional(),
  })
  .strict();

export interface NewPromoResult {
  /** Shown once and never again — only a SHA-256 of it is stored. */
  code: string;
  days: number | null;
  uses: number;
}

/**
 * Mints a promotion code and returns it exactly once.
 *
 * The code is hashed on the way in, so this response is the only time it can
 * ever be read. The page says so beside it, in the same words the command uses,
 * because somebody who closes the panel without copying it has not lost access
 * to anything — they have simply wasted a code, and should mint another.
 */
export async function actionNewPromo(raw: unknown): Promise<NewPromoResult> {
  const parsed = newPromoRequest.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, 'That is not a code this server can mint.');

  const grant = promoGrantSchema.parse({
    days: parsed.data.days,
    ...(parsed.data.note === undefined ? {} : { note: parsed.data.note }),
  });

  const code = mintPromoCode();
  await createPromoCode({ code, grant, maxRedemptions: parsed.data.uses });

  return { code: formatPromoCode(code), days: grant.days, uses: parsed.data.uses };
}

export const grantRequest = z
  .object({
    orgId: z.string().length(26),
    revoke: z.boolean(),
    note: z.string().max(200).optional(),
  })
  .strict();

export interface GrantResult {
  orgId: string;
  name: string;
  granted: boolean;
}

/**
 * Gives a farm sync, or takes it back.
 *
 * Reversible in one click either way, which is the whole reason it is allowed
 * to be a button: the worst outcome is a farm syncing that should not be, for
 * as long as it takes somebody to notice and press the other one.
 *
 * A farm that does not exist is a 404 rather than a silent no-op — an operator
 * pasting an id from somewhere needs to hear that it did not match, or they
 * will believe a grant happened.
 */
export async function actionGrant(raw: unknown): Promise<GrantResult> {
  const parsed = grantRequest.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, 'That is not a farm id.');

  const farm = await findOrgById(parsed.data.orgId);
  if (farm === null) throw new HttpError(404, 'No farm on this server has that id.');

  await setSyncGrant(
    farm._id,
    parsed.data.revoke
      ? null
      : { at: new Date(), ...(parsed.data.note === undefined ? {} : { note: parsed.data.note }) },
  );

  return { orgId: farm._id, name: farm.name, granted: !parsed.data.revoke };
}
