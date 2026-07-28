import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '../components/Icon';
import { IronScreen } from '../screens/IronScreen';
import { MoreScreen } from '../screens/MoreScreen';
import { StockScreen } from '../screens/StockScreen';
import { TodayScreen } from '../screens/TodayScreen';
import { useTheme } from '../theme/ThemeProvider';
import { font, tap, type as typeScale } from '../theme/tokens';

/**
 * The four tabs (UX-SPEC §4). Four, not six — every additional tab is a
 * decision made at 6am.
 *
 * Real navigation rather than the `useState` switch the web shell used. That
 * choice was right for a precached web shell and wrong for an app: a back
 * stack, a back gesture, and screen transitions are three of the things that
 * separate a page from an app, and none of them can be faked.
 */

const TABS = [
  { name: 'Today', icon: 'today', component: TodayScreen },
  { name: 'Stock', icon: 'stock', component: StockScreen },
  { name: 'Iron', icon: 'iron', component: IronScreen },
  { name: 'More', icon: 'more', component: MoreScreen },
] as const satisfies readonly { name: string; icon: IconName; component: () => React.ReactElement }[];

export type TabParamList = { Today: undefined; Stock: undefined; Iron: undefined; More: undefined };

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
          borderTopColor: colors.line,
          borderTopWidth: StyleSheet.hairlineWidth * 2,
          height: tap.primary + 24,
          paddingTop: 6,
        },
        // A tab is one of the two things tapped through a glove. It gets the
        // full primary target even though the icon is 26px.
        tabBarItemStyle: { minHeight: tap.primary },
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
  const tint = focused ? colors.lantern : colors.muted;

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
    fontFamily: font.data,
    fontSize: typeScale.label - 2,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});
