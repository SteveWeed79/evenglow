import type { IconName } from '../components/Icon';

/**
 * The tabs, as data: what each is called and which mark it carries.
 *
 * Separate from `Tabs.tsx` because that file calls
 * `createBottomTabNavigator()` at module scope, which cannot be imported
 * outside a running navigator — so anything that wants to reason about the bar
 * could not, and nothing did.
 *
 * What wants to reason about it is a test. A bottom bar divides the screen by
 * however many tabs there are, so the count and the length of the names are
 * one shared budget, and overspending it is invisible until somebody looks at
 * a phone. It was overspent: every screenshot of this app shows "TODAY"
 * wrapped to "TODA / Y" and "GROWING" to "GROW / ING".
 *
 * ## Three, and it stays three
 *
 * Stock, Growing and Iron used to be tabs. They are one tab now — `FarmScreen`
 * — and the reason is worth keeping: the bar was full before the record had
 * anywhere to live, which made it look like a choice between amending
 * UX-SPEC §4 and dropping What happened.
 *
 * It was a false choice. Those three are the same kind of thing: places you go
 * to set something up or look something over. Today is the morning, What
 * happened is the record, the farm is the farm. Three questions, three tabs —
 * and now every new enterprise costs a row rather than a fight for the bottom
 * of the screen.
 *
 * **The bar no longer changes shape under somebody either.** It used to grow
 * and shrink with what a farm ran, so turning on Growing moved every other
 * tab. Muscle memory is most of what a tab bar is for.
 */
export type TabName = 'Today' | 'Farm' | 'History';

export interface TabMarkSpec {
  /**
   * Named as a union rather than a string so the navigator keeps its route
   * checking — `Tab.Screen name=` will not take an arbitrary string, and a
   * typo here should be a compile error rather than a tab that goes nowhere.
   */
  name: TabName;
  icon: IconName;
}

export const TAB_MARKS: readonly TabMarkSpec[] = [
  { name: 'Today', icon: 'today' },
  /**
   * The hub. `arch` rather than `stock`, which belongs to the animals row
   * inside it — a tab wearing the mark of one of its own children reads as
   * that child.
   */
  { name: 'Farm', icon: 'arch' },
  /**
   * "History" here, "What happened" on the screen, and that is deliberate.
   *
   * The slot holds one short uppercase word (see `tests/unit/tabs.test.ts`),
   * and "WHAT HAPPENED" is two words that would wrap into the defect this
   * whole file exists to stop. So the bar gets the signpost and the screen
   * gets the sentence, which is the farm's own words for it.
   */
  { name: 'History', icon: 'season' },
];

/**
 * The bar, which is now the same for every farm.
 *
 * Kept as a function rather than inlining `TAB_MARKS` at the call site,
 * because what a farm runs still decides what it sees — that decision just
 * moved one level down, into `FarmScreen`, where it hides a row instead of a
 * tab. This is the seam that would carry a genuinely conditional tab if one
 * ever earns its place.
 */
export function tabs(): readonly TabMarkSpec[] {
  return TAB_MARKS;
}

/**
 * The hairlines between tabs.
 *
 * ## Why the bar needs them at all
 *
 * It does not, today — an icon over a word is self-separating, because the
 * mark occupies the middle of its slot and the eye reads three objects. The
 * design pass proposes dropping the marks and leaving three words, and three
 * words in a row are a sentence until something says otherwise. This is that
 * something.
 *
 * ## Short, and thinner than the bar's own rule
 *
 * The top rule separates the bar from the screen — a boundary between two
 * different things — and is drawn at twice a hairline. These separate peers,
 * so they are one hairline and roughly the height of the mark rather than the
 * height of the bar. Same `border` token, less of it: the hierarchy comes from
 * weight and length rather than from a second colour nobody would be able to
 * name.
 *
 * A full-height divider was the other option and it is the one to avoid — it
 * turns the bar into a segmented control, which is a different promise about
 * what pressing does.
 *
 * ## Nothing hangs on them
 *
 * Each tab is already its own target at `TAP.primary` with its own
 * accessibility label, and React Navigation announces them separately. These
 * are decoration in the strict sense — removable without changing what the bar
 * does — which is exactly why they are worth almost nothing and cost almost
 * nothing.
 */
export const TAB_DIVIDER = {
  /**
   * Share of the bar's height left clear above and below.
   *
   * Expressed as the inset rather than the length because that is what the
   * style takes — two equal insets centre the line without a percentage
   * transform, which resolves against the element's own size and is a newer
   * RN feature than this needs to depend on.
   *
   * 0.28 each end leaves 44% drawn: about the height of a mark and its label,
   * so the line brackets the content rather than ruling the whole bar.
   */
  inset: 0.28,
} as const;

/** What is actually drawn, as a fraction. Derived, so the two cannot drift. */
export const dividerLength = (): number => 1 - TAB_DIVIDER.inset * 2;

/**
 * Where each one sits, as a fraction of the bar's width.
 *
 * Between the slots and never at an edge — a line at 0 or 1 would double the
 * screen border on one side and read as a frame.
 */
export function dividerOffsets(count: number): number[] {
  if (count < 2) return [];
  return Array.from({ length: count - 1 }, (_, i) => (i + 1) / count);
}
