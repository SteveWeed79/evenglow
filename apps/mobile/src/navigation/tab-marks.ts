import type { Enterprise } from '@steading/contracts';
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
export type TabName = 'Today' | 'Stock' | 'Growing' | 'Iron';

export interface TabMarkSpec {
  /**
   * Named as a union rather than a string so the navigator keeps its route
   * checking — `Tab.Screen name=` will not take an arbitrary string, and a
   * typo here should be a compile error rather than a tab that goes nowhere.
   */
  name: TabName;
  icon: IconName;
  /**
   * The enterprise this tab belongs to, or undefined for one that is always
   * there. Today is always there: it is the app.
   */
  enterprise?: Enterprise;
}

/**
 * Annotated rather than `as const satisfies`, because narrowing each entry to
 * its own literal type means Today — which has no enterprise — has no such
 * property to read, and `tabsFor` cannot ask about it.
 */
export const TAB_MARKS: readonly TabMarkSpec[] = [
  { name: 'Today', icon: 'today' },
  { name: 'Stock', icon: 'stock', enterprise: 'stock' },
  { name: 'Growing', icon: 'growing', enterprise: 'growing' },
  { name: 'Iron', icon: 'iron', enterprise: 'iron' },
];

/**
 * The tabs a given farm sees.
 *
 * A market gardener has no stock; a suburban poultry keeper has no tractor and
 * no beds. Both used to get four tabs, two of them empty forever.
 *
 * Today survives every combination, including a farm that has turned
 * everything off — an app with no tab bar at all is a dead end, and Today is
 * where the answer to that is (it says there is nothing to log yet).
 */
export function tabsFor(enterprises: readonly Enterprise[]): readonly TabMarkSpec[] {
  return TAB_MARKS.filter(
    (tab) => tab.enterprise === undefined || enterprises.includes(tab.enterprise),
  );
}
