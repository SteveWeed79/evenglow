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
 */
export interface TabMarkSpec {
  name: string;
  icon: IconName;
}

export const TAB_MARKS = [
  { name: 'Today', icon: 'today' },
  { name: 'Stock', icon: 'stock' },
  { name: 'Growing', icon: 'growing' },
  { name: 'Iron', icon: 'iron' },
] as const satisfies readonly TabMarkSpec[];
