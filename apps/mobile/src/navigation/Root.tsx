import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SettingsScreen } from '../screens/SettingsScreen';
import { Tabs } from './Tabs';

/**
 * The stack the tabs live inside.
 *
 * Settings sits here rather than in the bar. It is not somewhere you go during
 * chores — it is somewhere you go once, and then twice a year — so it costs a
 * tab it was never worth. Pushing it also gets the swipe-back gesture for
 * free, which is the correct way out of a screen you opened by accident with
 * cold hands.
 */

export type RootParamList = { Tabs: undefined; Settings: undefined };

const Stack = createNativeStackNavigator<RootParamList>();

export function Root({ onSignedOut }: { onSignedOut: () => void }): React.ReactElement {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={Tabs} />
      <Stack.Screen name="Settings">
        {() => <SettingsScreen onSignedOut={onSignedOut} />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
