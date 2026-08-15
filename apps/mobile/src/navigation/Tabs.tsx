import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabDividers } from './TabDividers';
import { tabs } from './tab-marks';
import { FarmScreen } from '../screens/FarmScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { TodayScreen } from '../screens/TodayScreen';
import { useWindow } from '../hooks/useWindow';
import { useTheme } from '../theme/ThemeProvider';
import { hasRail } from '../theme/window';
import { FONTS, LAYOUT, SPACE, TAP, TYPE } from '../theme/tokens';

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
  const insets = useSafeAreaInsets();
  const { width } = useWindow();

  /**
   * The same three for every farm. What a farm runs still decides what it
   * sees — that now hides a row inside `FarmScreen` rather than a whole tab,
   * so the bar does not change shape under somebody's thumb.
   */
  const TABS = tabs();

  /**
   * A bar on a phone, a rail on a tablet.
   *
   * ## What it buys
   *
   * 88dp of height back, on the axis a landscape tablet is short of — it is a
   * *large*-width, *medium*-height window, and the bottom bar was spending its
   * scarcer axis stretching three words across a metre. And it puts the three
   * destinations at the edge a hand is already holding, instead of in the
   * centre-bottom dead spot two thumbs cannot reach.
   *
   * ## Why this needs no new dependency
   *
   * `tabBarPosition: 'left'` with `tabBarVariant: 'material'` is
   * react-navigation's own answer, and the material variant exists *only* for
   * the left and right positions. `@react-navigation/bottom-tabs` is already
   * here because the navigator requires it.
   *
   * ## Not yet seen on a handset
   *
   * The suite has no layout engine and every phone falls on the bar side of
   * this branch, so nothing below has been looked at on a device. The label
   * width is the specific worry — see `LAYOUT.rail`, and `TabMark` for the two
   * times this bar has clipped a word already.
   */
  const rail = hasRail(width);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        ...(rail ? { tabBarPosition: 'left', tabBarVariant: 'material' } : {}),
        /**
         * The word goes in the LABEL slot, which is the correction.
         *
         * It was drawn into `tabBarIcon` with the built-in label switched off,
         * on the reasoning that one label beats two and ours should be the one
         * that survives. The reasoning held; the slot did not. React Navigation
         * sizes the icon box for an icon — narrow, and `width: '100%'` inside
         * it is a hundred percent of something already too small. So the words
         * clipped: TODAY to "TO…", FARM to "FA…", HISTORY to "HI…", on a bar
         * whose only content is words.
         *
         * `tests/unit/tabs.test.ts` names this box as the cause and answers it
         * by keeping the names short. Five characters was not short enough,
         * and no name is: the slot is the wrong slot. The label slot spans the
         * tab, which is what a bar made of words needs.
         */
        tabBarShowLabel: true,
        /**
         * The bar clears the system navigation, and the explicit height is why
         * it did not.
         *
         * React Navigation adds the bottom inset to a tab bar by itself — and
         * stops doing so the moment `height` is set here, because a fixed
         * height is a fixed height. So on a handset with gesture navigation the
         * whole bar sat under the pill: reported as *"the Today, Farm and
         * History tabs are still completely hidden under the phone's onscreen
         * buttons"*, and it is the entire bar, not the edge of it.
         *
         * **The `Screen` inset fixed a different half.** That one gave scroll
         * content room at the bottom of a pushed screen. This bar is not on a
         * screen — it is beside them — so it needed its own, and having fixed
         * one it was easy to believe both were done.
         *
         * Stated in both places rather than relying on the default: the height
         * grows by the inset and the padding holds the content above it, so
         * what the marks sit in is the same size it always was.
         */
        tabBarStyle: rail
          ? {
              backgroundColor: colors.raised,
              /**
               * The edge moves with the bar. A rail is divided from the
               * content by its trailing edge, not by a top border — leaving
               * `borderTopWidth` on would draw a hairline across the top of
               * the rail, which is a line to nothing.
               */
              borderRightColor: colors.border,
              borderRightWidth: StyleSheet.hairlineWidth * 2,
              width: LAYOUT.rail + insets.left,
              /**
               * The left inset is the rail's problem now, exactly as the
               * bottom inset was the bar's.
               *
               * In landscape the cutout and the gesture bar move to a side
               * edge — the same insets `Screen` started reserving for — and
               * the rail is the thing that actually meets that edge. It grows
               * by the inset and pads its items past it, so the words sit
               * where they always did relative to the rail rather than
               * shifting when a device happens to have a cutout.
               */
              paddingLeft: insets.left,
              paddingTop: SPACE.lg,
              paddingBottom: insets.bottom,
            }
          : {
              backgroundColor: colors.raised,
              borderTopColor: colors.border,
              borderTopWidth: StyleSheet.hairlineWidth * 2,
              height: TAP.primary + 24 + insets.bottom,
              paddingTop: 6,
              paddingBottom: insets.bottom,
            },
        // A tab is one of the two things tapped through a glove. It gets the
        // full primary target even though the icon is 26px.
        tabBarItemStyle: { minHeight: TAP.primary },
        /**
         * Renders as a child of the bar, so it paints over the bar's own
         * background and under the items — which is the whole reason this
         * option exists and why the dividers do not need the background moved
         * out of `tabBarStyle` to be visible.
         *
         * **Omitted entirely on a rail, rather than turned sideways.** The
         * dividers exist because three words in a row across a metre of bar
         * need something saying where one tab ends and the next begins.
         * Stacked in a 96dp rail they are already obviously three things, and
         * two horizontal hairlines would be furniture — the same argument
         * `Icon.tsx` records for cutting sixty-four marks to sixteen.
         */
        ...(rail ? {} : { tabBarBackground: () => <TabDividers count={TABS.length} /> }),
      }}
    >
      {TABS.map(({ name }) => (
        <Tab.Screen
          key={name}
          name={name}
          component={SCREENS[name]!}
          options={{
            tabBarAccessibilityLabel: name,
            // No icon at all, so the label has the tab to itself rather than
            // sharing a column with an empty box.
            tabBarLabel: ({ focused }) => (
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
 * ## Why the label needed fixing, twice
 *
 * It was drawn into the navigator's ICON slot, which is a narrow box, with no
 * line limit — so "TODAY" wrapped to "TODA / Y" and "GROWING" to "GROW / ING"
 * in every screenshot. `numberOfLines={1}` stopped the wrapping and traded it
 * for clipping: the same narrow box, now cutting "TODAY" to "TO…" and
 * "HISTORY" to "HI…". A bar of three two-letter stubs.
 *
 * Shortening the names could not fix it and `tests/unit/tabs.test.ts` caps
 * them at eight characters trying. Five characters still clipped, because the
 * box is sized for an icon and no word is short enough to be an icon. It draws
 * in the LABEL slot now, which spans the tab.
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

  /**
   * And the weight, because colour alone was not enough on a handset.
   *
   * Reported from a device: the active tab changed colour and nothing else, so
   * in daylight, at arm's length, three mono labels of identical weight read as
   * three of the same thing. Brass against muted is a hue shift of similar
   * value — the exact difference a bright screen outdoors flattens, and the
   * one a colour-blind eye may not get at all. Weight survives both.
   *
   * A separate FAMILY rather than `fontWeight: 'bold'`: Android resolves a
   * named custom family to one registered file and ignores the weight prop, so
   * asking for bold here would have changed nothing and looked like it had.
   */
  const face = focused ? FONTS.dataBold : FONTS.data;

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
            fontFamily: face,
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
    textTransform: 'uppercase',
    textAlign: 'center',
    // Family, size and tracking all come from TabMark — the face depends on
    // whether this is the tab you are standing in, and the other two on how
    // many tabs there are. A StyleSheet cannot know either.
  },
});
