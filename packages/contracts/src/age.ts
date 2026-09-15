import { z } from 'zod';

import { PRODUCT_NAME } from './product';

/**
 * The age floor, in one place — `UNCONSIDERED.md` `[3]`.
 *
 * ## Why this is a constant and not three sentences
 *
 * The number appeared in the privacy policy, in the terms, and nowhere else:
 * the app made no such check, so the claim was true only in the sense that
 * nobody had contradicted it. The Play Console asks the same question a third
 * time, and a declaration that disagrees with the app is the one kind of wrong
 * that is enforcement rather than rejection.
 *
 * So `legal.ts` interpolates this number, the sign-up screen shows
 * `AGE_CONFIRMATION`, and the four account-creating routes will not parse a
 * body without the assertion. Moving the floor is one edit and cannot leave a
 * document behind.
 *
 * ## Where the floor comes from
 *
 * Thirteen, because COPPA's obligations attach to a service directed to
 * children under that age or with actual knowledge of them. A farm record book
 * is not directed to children, and the assertion is what closes the second
 * half.
 */
export const MINIMUM_AGE = 13;

/** What the person ticks. Plain enough to mean something at six in the morning. */
export const AGE_CONFIRMATION = `I am ${MINIMUM_AGE} or over`;

/**
 * Said beside the tick, because the tick on its own explains nothing.
 *
 * It names the one thing somebody would want to know before answering: that
 * the offline app is not what is being gated. A child helping with the hens on
 * a family handset is using this app exactly as intended, and nothing here
 * stops them — the floor is on *an account*, which is the only thing that puts
 * a person's details on somebody's server.
 */
export const AGE_WHY =
  `Only an account has an age limit. ${PRODUCT_NAME} itself does not — anybody ` +
  'can keep records on this phone.';

/**
 * What a body that asserted nothing is told, on the routes that create accounts.
 *
 * **Two sentences, and the second is the one that earns its place.** The app
 * will not let somebody past the tick, so the only person who sees this is on
 * the sign-in tab pressing Google with an address that turns out to have no
 * account — the one path where a *sign-in* can create one. Told only the rule,
 * they are stuck on a screen that never asked them anything. Told where the
 * box is, they are one tap from the answer.
 */
export const AGE_NOT_CONFIRMED =
  `You must be ${MINIMUM_AGE} or over to create an account. ` +
  'Choose "Set up an account" and tick the box to say so.';

/**
 * The assertion on the wire, and **`true` is the only value that parses**.
 *
 * A boolean plus a check in the handler was the other option and it is the
 * wrong one: there are four routes that create an account — signup, the Google
 * first sign-in, an invitation and a join code — and a check a handler has to
 * remember is a check the fifth one will not have. Parsing is the gate, so a
 * route cannot be added without the field and cannot accept `false` by
 * forgetting something.
 *
 * **What is stored is a date, not this flag.** `UserDoc.ageAssertedAt` records
 * that the assertion was made and when. Keeping a birth date to enforce a rule
 * about collecting personal data would be collecting more personal data — and
 * it would then owe a retention line of its own in the policy this exists to
 * make true.
 */
export const ageConfirmedSchema = z.literal(true);
