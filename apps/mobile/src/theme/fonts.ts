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
 * would show a tofu box on a handset and nowhere else. 925 KB against an APK
 * measured in tens of megabytes is not the place to economise.
 *
 * ## Fraunces
 *
 * Cut from the variable font at `'opsz' 30, 'SOFT' 100, 'WONK' 1, 'wght' 700`,
 * because React Native cannot set variation axes at runtime — `fontFamily`
 * resolves to exactly one file.
 *
 * `opsz` is the axis the design does not name and one value has to serve every
 * size the face is used at, from the 19px lede to the ~86px tally; it is pinned
 * at 30, just above the heading band where the face appears most often. If the
 * tally ever looks under-inked next to the headings, the fix is a second
 * instance cut at a larger `opsz` and a `displayLarge` token — not a different
 * pin here, which would only move the compromise.
 *
 * `SOFT` was the design's declared 30 and is now 100, the axis at its maximum.
 * It rounds the terminals and does nothing else — in particular it does **not**
 * thicken a stroke, so it is not an answer to the hairline risk a high-contrast
 * serif carries at 24dp. It was raised for warmth, on a name that means the
 * light at the end of the day, and for no other reason.
 *
 * ## Recursive Mono Casual
 *
 * The data face, replacing IBM Plex Mono. Plex is drawn to read as engineered
 * and does it well; this face carries 101 of the app's type styles — more than
 * body — so it was the app's dominant voice saying the one thing the app is
 * not.
 *
 * Recursive's `MONO` and `CASL` axes are exactly this trade, and it ships cut
 * at `MONO 1, CASL 1`: monospaced, because the figures still stand in columns,
 * and casual, because nothing else about a farm's tallies is technical.
 *
 * **Weight 500 in the regular slot, not 400.** Beside Plex Regular, Recursive
 * at 400 is visibly lighter and loses colour on the figures; 500 matches it.
 * That is not a preference — the face carries the counts, and `TYPE.body` has a
 * 17dp floor because these are read outdoors at arm's length.
 *
 * ## Re-cutting any of them
 *
 * `scripts/cut-fonts.py` holds the coordinates and runs. The instance a file
 * was cut at is in its name, all four axes of it, because the one axis the old
 * display file left out of its name is the one that later had to be recovered
 * by diffing outlines.
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
  [FONTS.display]: require('../../assets/fonts/Fraunces-Opsz30Soft100Wonk1-Bold.ttf'),
  [FONTS.body]: require('../../assets/fonts/AlegreyaSans-Regular.ttf'),
  [FONTS.bodyBold]: require('../../assets/fonts/AlegreyaSans-Bold.ttf'),
  [FONTS.data]: require('../../assets/fonts/RecursiveMonoCasual-Medium.ttf'),
  [FONTS.dataBold]: require('../../assets/fonts/RecursiveMonoCasual-Bold.ttf'),
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
