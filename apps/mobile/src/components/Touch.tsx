import { Pressable, type PressableProps } from 'react-native';

/**
 * Everything in this app that can be pressed, and what it promises.
 *
 * ## Why this exists
 *
 * The arch used to answer "you can act on this" by shape: a doorway meant
 * press-this, go-there and this-is-the-point all at once. That is why seven of
 * them on one screen felt forced — one shape carrying three different promises
 * — and it is why the rule could never be checked. A reviewer could say a
 * screen looked wrong; nobody could say it *was* wrong.
 *
 * Five signals replace it, every pressable element carries exactly one, and
 * nothing inert carries any. That is a rule a test can hold, which is the
 * whole point of writing it down this way.
 *
 * ## Three layers, and none of them is a heuristic
 *
 * 1. **Lint** — `Pressable` may not be imported from react-native anywhere but
 *    this file, so nothing can be tappable without coming through here.
 * 2. **The type** — `affordance` is required. A new control cannot compile
 *    without its author saying what pressing it does.
 * 3. **The test** — `tests/screens/affordance.test.tsx` mounts every screen and
 *    reads these declarations off the tree.
 *
 * Sniffing the rendered output for a chevron would have been the obvious
 * alternative and it is the wrong one twice: it breaks the day the icon set
 * changes, and it can only find what is *drawn* rather than what was *meant*.
 * A declaration survives the marks being deleted entirely.
 *
 * ## What this does NOT do
 *
 * **It does not draw the signal.** It wraps a Pressable and forwards
 * everything; the visuals stay in the components that already own them. This
 * file is the audit's seam, not a restyling — those are two changes and mixing
 * them would mean neither could be reviewed.
 */

/**
 * The five, and one admission.
 *
 * Each means something different about what happens when a thumb lands, and
 * the difference is the reason there are five rather than one:
 */
export const AFFORDANCES = [
  /**
   * **The one thing this screen is for.** Brass fill, in the bottom third,
   * exactly one per screen — a screen that wants two is two screens. Commit
   * the tally; add what you keep.
   */
  'brass',
  /**
   * **Acts in place.** Does something without leaving the screen: the
   * steppers, the Record tiles, "Log something else". Any number per screen.
   */
  'border',
  /**
   * **Goes somewhere else.** The chevron is the affordance, not the row — so a
   * row's count sits before the chevron and never instead of it.
   */
  'chevron',
  /**
   * **Toggles a state and stays put.** The day's jobs, the species chips at
   * first run.
   */
  'check',
  /**
   * **Opens or closes in place** — the content appears below, the screen does
   * not change. Plus when shut, minus when open.
   */
  'disclose',
  /**
   * **Not a signal. A defect, named so it can be counted.**
   *
   * Two controls in the app are tappable and say nothing about it: the weather
   * line, which navigates, and the closed tally rows, which expand. Both were
   * found by the first pass of this audit, which is what it is for.
   *
   * It exists rather than being left absent because an optional field would let
   * a third one arrive silently. Every use is listed in the test, and that list
   * may only ever get shorter.
   */
  'unsignalled',
] as const;

export type Affordance = (typeof AFFORDANCES)[number];

export interface TouchProps extends PressableProps {
  /** What pressing this promises. See `AFFORDANCES`. */
  affordance: Affordance;
}

export function Touch({ affordance: _affordance, ...rest }: TouchProps): React.ReactElement {
  /**
   * The declaration is read off the component in the test tree by type, so it
   * is deliberately NOT forwarded to the Pressable. Nothing about this ships
   * to a handset — no extra prop crosses the bridge, and on Fabric an unknown
   * prop on a host view is dropped at the shadow node anyway, silently, which
   * is a poor place to keep something a build depends on.
   */
  return <Pressable {...rest} />;
}
