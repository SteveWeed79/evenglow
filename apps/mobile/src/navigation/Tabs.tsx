import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, Text, View } from 'react-native';
import { TabDividers } from './TabDividers';
import { tabs } from './tab-marks';
import { FarmScreen } from '../screens/FarmScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { TodayScreen } from '../screens/TodayScreen';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, TAP, TYPE } from '../theme/tokens';

/**
 * The tabs (UX-SPEC §4). Four, five where a farm runs everything — not six,
 * because every additional tab is a decision made at 6am.
 *
 * The bar is built per farm, which is what makes room for the fifth: a keeper
 * with only animals never sees Growing or Iron, so "four" was always "at most
 * four". Only a farm running all three enterprises sees five.
 *
 * Real navigation rather than the `useState` switch the web shell used. That
 * choice was right for a precached web shell and wrong for an app: a back
 * stack, a back gesture, and screen transitions are three of the things that
 * separate a page from an app, and none of them can be faked.
 *
 * **Growing took More's place, and More was the right one to lose.** Crops are
 * half of a small farm and had no home in the bar at all; More was never a
 * place you go, it was a drawer. What was in it — diagnostics, the rejected
 * inbox, export, sign-out — is reached from the header instead, which is where
 * settings belong and where R3 will hang the sync chip beside them.
 */

/** The screen behind each tab. The names live in `tab-marks.ts`. */
const SCREENS: Record<string, () => React.ReactElement> = {
  Today: TodayScreen,
  Farm: FarmScreen,
  History: HistoryScreen,
};



export type TabParamList = {
  Today: undefined;
  Farm: undefined;
  History: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

export function Tabs(): React.ReactElement {
  const { colors } = useTheme();

  /**
   * The same three for every farm. What a farm runs still decides what it
   * sees — that now hides a row inside `FarmScreen` rather than a whole tab,
   * so the bar does not change shape under somebody's thumb.
   */
  const TABS = tabs();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        // The label is drawn below, so the built-in one is off: its type ramp
        // and spacing are not ours, and two labels is worse than either.
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: colors.raised,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth * 2,
          height: TAP.primary + 24,
          paddingTop: 6,
        },
        // A tab is one of the two things tapped through a glove. It gets the
        // full primary target even though the icon is 26px.
        tabBarItemStyle: { minHeight: TAP.primary },
        /**
         * Renders as a child of the bar, so it paints over the bar's own
         * background and under the items — which is the whole reason this
         * option exists and why the dividers do not need the background moved
         * out of `tabBarStyle` to be visible.
         */
        tabBarBackground: () => <TabDividers count={TABS.length} />,
      }}
    >
      {TABS.map(({ name }) => (
        <Tab.Screen
          key={name}
          name={name}
          component={SCREENS[name]!}
          options={{
            tabBarAccessibilityLabel: name,
            tabBarIcon: ({ focused }) => (
              <TabMark label={name} focused={focused} count={TABS.length} />
            ),
          }}
        />
      ))}
    </Tab.Navigator>
  );
}

/**
 * One tab: its name, and nothing else.
 *
 * The mark that used to sit above it was a doorway, and the word under it said
 * "TODAY" — so the bar drew every label twice. The words carry it now, at the
 * size the mark used to leave room for.
 *
 * ## Why the label needed fixing
 *
 * This is drawn into the navigator's ICON slot, which is a narrow box — and
 * the label had no line limit. So "TODAY" wrapped to "TODA / Y", "STOCK" to
 * "STOC / K" and "GROWING" to "GROW / ING", on every screen, in every
 * screenshot. Letter-spacing on an uppercase word in a box that narrow is what
 * pushed it over.
 *
 * ## Why it scales with the number of tabs
 *
 * The bar divides the screen by however many tabs there are, so every tab
 * added makes every label narrower. Four is what UX-SPEC fixes today and five
 * is already discussed, so the type gives ground before the words do:
 * letter-spacing goes first, because it is decoration, then size.
 *
 * Below that the label truncates rather than wraps or shrinks to nothing —
 * a clipped word still reads, and the accessibility label carries the whole
 * name regardless of what is drawn.
 */
function TabMark({
  label,
  focused,
  count,
}: {
  label: string;
  focused: boolean;
  count: number;
}): React.ReactElement {
  const { colors } = useTheme();
  // Brass for the tab you are in — the only place the lantern colour appears
  // in the bar, so "where am I" is answered by colour and not by underline.
  const tint = focused ? colors.lanternInk : colors.muted;

  const roomy = count <= 4;

  return (
    <View style={styles.mark}>
      {/**
        * One size for every tab, and no auto-shrink.
        *
        * `adjustsFontSizeToFit` shrinks each label independently, so the
        * longest one — HISTORY, at seven characters against TODAY's five —
        * came out visibly smaller than its neighbours and the bar read as
        * three different things. That was tolerable while a mark sat above
        * each word and carried the rank; with the marks gone the type *is*
        * the bar, and three sizes in it is three levels of importance nobody
        * meant.
        *
        * So the size is fixed and the names are held to what fits instead —
        * `tests/unit/tabs.test.ts` caps them at eight characters, which is
        * what a third of the narrowest phone takes at this size. Past that
        * `numberOfLines` clips, and a clipped word still reads.
        */}
      <Text
        numberOfLines={1}
        style={[
          styles.label,
          {
            color: tint,
            letterSpacing: roomy ? 1 : 0,
            fontSize: roomy ? TYPE.label : TYPE.label - 2,
          },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  /** Exactly as wide as a tab, because it is divided the same way. */
  // Full width of the slot, so the label has the whole tab to sit in rather
  // than only as much as the icon happens to occupy.
  mark: { alignItems: 'center', justifyContent: 'center', gap: 3, width: '100%' },
  label: {
    fontFamily: FONTS.data,
    textTransform: 'uppercase',
    textAlign: 'center',
    // Size and tracking come from TabMark — they depend on how many tabs there
    // are, and a StyleSheet cannot know that.
  },
});
