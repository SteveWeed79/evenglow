import { useFonts } from 'expo-font';
import { FONTS } from './tokens';

/**
 * The faces, shipped in the APK.
 *
 * **Bundled, never fetched.** A webfont would mean the type ramp depended on a
 * signal, and the whole premise of this app is that a barn does not have one —
 * an offline-first app whose headings fall back to Roboto in the one place it
 * is designed to be used would be a strange thing to have built. These are
 * four `.ttf` files in `assets/fonts`, resolved by Metro at build time.
 *
 * **They were missing entirely until now, and it was invisible.** `tokens.ts`
 * has always named these families and nothing ever registered them. Android
 * does not error on an unknown `fontFamily` — it silently substitutes the
 * system face — so every heading, every tally and every small-caps label has
 * been rendering in Roboto while the code said otherwise. Nothing in the
 * repo could catch it: a typecheck sees a string, the bundler sees a string,
 * and there was no device to look at.
 *
 * ## Where they come from, and the licence
 *
 * All three families are SIL Open Font License 1.1, taken from the Google
 * Fonts upstream repository. The licence requires the text to travel with the
 * fonts, so `OFL-*.txt` sits beside them in the same directory rather than
 * being noted somewhere nobody unpacking an APK would look.
 *
 * Full faces rather than Latin subsets. The saving would be real — Alegreya
 * Sans carries a lot of scripts — but the app already renders `µ`, `°`, `×`,
 * `–`, `—`, `’`, `…`, `−`, `·`, `§` and `ñ`, and a subset that dropped one
 * would show a tofu box on a handset and nowhere else. 760 KB against an APK
 * measured in tens of megabytes is not the place to economise.
 *
 * ## Fraunces
 *
 * Cut from the variable font at the design's own declaration —
 * `'SOFT' 30, 'WONK' 1, 'wght' 700` — because React Native cannot set
 * variation axes at runtime. `opsz` is the axis the design does not name and
 * one value has to serve every size the face is used at, from the 19px lede
 * to the ~86px tally; it is pinned at 30, just above the heading band where
 * the face appears most often.
 *
 * If the tally ever looks under-inked next to the headings, the fix is a
 * second instance cut at a larger `opsz` and a `displayLarge` token — not a
 * different pin here, which would only move the compromise.
 */
/* eslint-disable @typescript-eslint/no-require-imports --
 * Metro resolves bundled assets through `require()`, and an `import` cannot
 * express one — the same reason `Plaster.tsx` reaches for it. The keys are the
 * family names `tokens.ts` declares, because the key is what `fontFamily`
 * matches at runtime: a typo here is a silent fallback to the system face,
 * which is exactly the failure this file exists to end. `fonts.test.ts` holds
 * the two in step.
 */
export const FONT_ASSETS = {
  [FONTS.display]: require('../../assets/fonts/Fraunces-Soft30Wonk1-Bold.ttf'),
  [FONTS.body]: require('../../assets/fonts/AlegreyaSans-Regular.ttf'),
  [FONTS.bodyBold]: require('../../assets/fonts/AlegreyaSans-Bold.ttf'),
  [FONTS.data]: require('../../assets/fonts/IBMPlexMono-Regular.ttf'),
} as const;
/* eslint-enable @typescript-eslint/no-require-imports */

export interface FontState {
  /** True once the faces are registered — or once we have stopped waiting. */
  ready: boolean;
  /** Set when a face could not be loaded. The app runs anyway. */
  failed: boolean;
}

/**
 * Loads them, and refuses to hold the app hostage to the result.
 *
 * `ready` goes true on success **and** on failure, and that asymmetry is the
 * whole point. A font is cosmetic; the records are not. An app that would not
 * open because a typeface did not decompress would be trading the only thing
 * it exists to protect for the way its headings look — so a failure is
 * reported to diagnostics and the system face is used, exactly as it has been
 * doing unnoticed all along.
 *
 * Which is also why this is deliberately not fatal in the way a database that
 * will not open is: `Boot` says so in words and stops, because an empty list
 * is indistinguishable from a farm with no animals. A wrong typeface is
 * distinguishable from anything at a glance.
 */
export function useAppFonts(): FontState {
  const [loaded, error] = useFonts(FONT_ASSETS);
  return { ready: loaded || error !== null, failed: error !== null };
}
