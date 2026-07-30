import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, Text, View } from 'react-native';
import { TAB_MARKS } from './tab-marks';
import { Icon, type IconName } from '../components/Icon';
import { GrowingScreen } from '../screens/GrowingScreen';
import { IronScreen } from '../screens/IronScreen';
import { StockScreen } from '../screens/StockScreen';
import { TodayScreen } from '../screens/TodayScreen';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, TAP, TYPE } from '../theme/tokens';

/**
 * The four tabs (UX-SPEC §4). Four, not six — every additional tab is a
 * decision made at 6am.
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

/** The screen behind each mark. Names and marks live in `tab-marks.ts`. */
const SCREENS: Record<string, () => React.ReactElement> = {
  Today: TodayScreen,
  Stock: StockScreen,
  Growing: GrowingScreen,
  Iron: IronScreen,
};

const TABS = TAB_MARKS;

export type TabParamList = {
  Today: undefined;
  Stock: undefined;
  Growing: undefined;
  Iron: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

export function Tabs(): React.ReactElement {
  const { colors } = useTheme();

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
      }}
    >
      {TABS.map(({ name, icon }) => (
        <Tab.Screen
          key={name}
          name={name}
          component={SCREENS[name]!}
          options={{
            tabBarAccessibilityLabel: name,
            tabBarIcon: ({ focused }) => (
              <TabMark icon={icon} label={name} focused={focused} count={TABS.length} />
            ),
          }}
        />
      ))}
    </Tab.Navigator>
  );
}

/**
 * One tab: its mark, and its name under it.
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
  icon,
  label,
  focused,
  count,
}: {
  icon: IconName;
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
      <Icon name={icon} size={roomy ? 26 : 24} color={tint} />
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
            fontSize: roomy ? TYPE.label - 2 : TYPE.label - 3,
          },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
