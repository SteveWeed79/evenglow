import { PRODUCT_NAME } from './product';

/**
 * What this app is not, said where it matters — `UNCONSIDERED.md` `[16]`.
 *
 * ## Why it is one constant and not a paragraph per screen
 *
 * It appears in two places that are nothing alike: Settings, where somebody is
 * reading about the app, and the withdrawal banner, where somebody is deciding
 * whether to sell eggs. Two wordings would drift, and the one that drifted
 * would be the banner's — the one that is read under pressure and the one a
 * regulator would care about.
 *
 * ## Two sentences, and the second is the one that earns its place
 *
 * "Not veterinary advice" on its own is the boilerplate everybody scrolls past,
 * and it is also not the useful fact. The useful fact is *where the number came
 * from*: the app does arithmetic on a withdrawal period somebody typed in, so
 * the date on screen is exactly as right as what was entered and no righter. A
 * farmer who knows that checks the label; one who thinks the app knows the
 * medicine does not.
 *
 * So it names the mechanism rather than disclaiming in the abstract, which is
 * what `UX-SPEC.md` §6 asks of every sentence in this app.
 *
 * **Templated on `PRODUCT_NAME`** so the brand stays in one place — the rule
 * `check:names` enforces, and the one a rename has already broken twice.
 */
export const NOT_VETERINARY_ADVICE =
  `${PRODUCT_NAME} keeps records; it does not give veterinary advice. ` +
  'Every withdrawal date here is worked out from what was typed in, so the ' +
  "medicine's label and your vet are what decide it.";
