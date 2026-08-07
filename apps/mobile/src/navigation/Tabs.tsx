import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dividerOffsets, TAB_DIVIDER, tabs } from './tab-marks';
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
 * The hairlines between the tabs. See `TAB_DIVIDER` for why they are short.
 *
 * `pointerEvents="none"` because they sit across the bar and a tab is one of
 * the two things in this app tapped through a glove — a decorative line that
 * swallowed even a pixel of a target would be the worst possible trade.
 *
 * Centred by percentage rather than by a computed pixel offset, so the bar can
 * be any width and gain or lose a tab without this knowing: the offsets are
 * fractions and the inset is a fraction, which means rotation and a tablet
 * both come free.
 *
 * **Except the bottom safe area, which is not free.** React Navigation adds the
 * home-indicator inset as padding *below* the height set in `tabBarStyle`, so
 * the container this fills is taller than the part anybody looks at — by 34pt
 * on the phones that have one. Centring in the container would drop the lines
 * a sixth of a bar below the marks they divide, which is exactly the sort of
 * thing that looks fine in Node and wrong in the hand.
 */
function TabDividers({ count }: { count: number }): React.ReactElement {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={[StyleSheet.absoluteFill, { bottom: insets.bottom }]} pointerEvents="none">
      {dividerOffsets(count).map((offset) => (
        <View
          key={offset}
          style={[
            styles.divider,
            {
              left: `${offset * 100}%`,
              top: `${TAB_DIVIDER.inset * 100}%`,
              bottom: `${TAB_DIVIDER.inset * 100}%`,
              backgroundColor: colors.border,
            },
          ]}
        />
      ))}
    </View>
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
      <Text
        // The whole point: one line, always. Everything else is how it copes.
        numberOfLines={1}
        // Android honours this alongside numberOfLines, so a long name shrinks
        // to fit before it is cut.
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        style={[
          styles.label,
          {
            color: tint,
            letterSpacing: roomy ? 1.2 : 0,
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
  /**
   * Centred by equal insets rather than by `top: 50%` and a half-height
   * transform. Percentage transforms resolve against the element's own size
   * and are a newer RN feature; two equal insets are as old as flexbox and
   * cannot behave differently on a handset than they do here.
   */
  divider: { position: 'absolute', width: StyleSheet.hairlineWidth },
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
