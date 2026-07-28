import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, Text, View } from 'react-native';
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

const TABS = [
  { name: 'Today', icon: 'today', component: TodayScreen },
  { name: 'Stock', icon: 'stock', component: StockScreen },
  { name: 'Growing', icon: 'streak-plant', component: GrowingScreen },
  { name: 'Iron', icon: 'iron', component: IronScreen },
] as const satisfies readonly { name: string; icon: IconName; component: () => React.ReactElement }[];

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
      {TABS.map(({ name, icon, component }) => (
        <Tab.Screen
          key={name}
          name={name}
          component={component}
          options={{
            tabBarAccessibilityLabel: name,
            tabBarIcon: ({ focused }) => <TabMark icon={icon} label={name} focused={focused} />,
          }}
        />
      ))}
    </Tab.Navigator>
  );
}

function TabMark({
  icon,
  label,
  focused,
}: {
  icon: IconName;
  label: string;
  focused: boolean;
}): React.ReactElement {
  const { colors } = useTheme();
  // Brass for the tab you are in — the only place the lantern colour appears
  // in the bar, so "where am I" is answered by colour and not by underline.
  const tint = focused ? colors.lanternInk : colors.muted;

  return (
    <View style={styles.mark}>
      <Icon name={icon} size={26} color={tint} />
      <Text style={[styles.label, { color: tint }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { alignItems: 'center', justifyContent: 'center', gap: 3 },
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label - 2,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});
