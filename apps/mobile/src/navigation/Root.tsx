import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AddAnimalScreen } from '../screens/AddAnimalScreen';
import { AddBedScreen } from '../screens/AddBedScreen';
import { AddGroupScreen } from '../screens/AddGroupScreen';
import { AddItemScreen } from '../screens/AddItemScreen';
import { AddMachineScreen } from '../screens/AddMachineScreen';
import { AddServiceScreen } from '../screens/AddServiceScreen';
import { AnimalsScreen } from '../screens/AnimalsScreen';
import { BreedingScreen } from '../screens/BreedingScreen';
import { CareLogScreen } from '../screens/CareLogScreen';
import { DiagnosticsScreen } from '../screens/DiagnosticsScreen';
import { EditGroupScreen } from '../screens/EditGroupScreen';
import { FeedScreen } from '../screens/FeedScreen';
import { GroupScreen } from '../screens/GroupScreen';
import { HarvestScreen } from '../screens/HarvestScreen';
import { ExportScreen } from '../screens/ExportScreen';
import { GrowingScreen } from '../screens/GrowingScreen';
import { IronScreen } from '../screens/IronScreen';
import { JobsScreen } from '../screens/JobsScreen';
import { QuickAddScreen } from '../screens/QuickAddScreen';
import { StockScreen } from '../screens/StockScreen';
import { MyFarmScreen } from '../screens/MyFarmScreen';
import { InboxScreen } from '../screens/InboxScreen';
import { IncubationScreen } from '../screens/IncubationScreen';
import { IncubationsScreen } from '../screens/IncubationsScreen';
import { InventoryScreen } from '../screens/InventoryScreen';
import { LicencesScreen } from '../screens/LicencesScreen';
import { LogHoursScreen } from '../screens/LogHoursScreen';
import { LossScreen } from '../screens/LossScreen';
import { MachineScreen } from '../screens/MachineScreen';
import { MembersScreen } from '../screens/MembersScreen';
import { PickVarietyScreen } from '../screens/PickVarietyScreen';
import { PlantingScreen } from '../screens/PlantingScreen';
import { ProduceScreen } from '../screens/ProduceScreen';
import { ShearingScreen } from '../screens/ShearingScreen';
import { ServiceDoneScreen } from '../screens/ServiceDoneScreen';
import { SetEggsScreen } from '../screens/SetEggsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { SiteSetupScreen } from '../screens/SiteSetupScreen';
import { TreatmentScreen } from '../screens/TreatmentScreen';
import { WeighScreen } from '../screens/WeighScreen';
import { Tabs } from './Tabs';

/**
 * The stack the tabs live inside.
 *
 * Settings sits here rather than in the bar. It is not somewhere you go during
 * chores — it is somewhere you go once, and then twice a year — so it costs a
 * tab it was never worth.
 *
 * **Everything else here used to be a `useState` switch inside its parent
 * screen, and that was a defect rather than a shortcut.** A screen rendered by
 * `if (adding) return <AddGroupScreen/>` still drew a back arrow, and that
 * arrow called `navigation.goBack()` on a stack whose only entry was `Tabs` —
 * so it did nothing at all. Worse on the platform this ships to first:
 * Android's hardware back button left the app from a half-filled form. A
 * pushed route gets the arrow, the swipe gesture and the system button for
 * free, and all three are things a person expects an app to have and a web
 * page not to.
 *
 * **Params are IDs, never records.** A route param survives process death and
 * is restored by React Navigation; a `Group` object captured at push time does
 * not, and would be a stale copy of a row the store has since changed. Every
 * screen below takes an id and reads the row itself.
 */

export type RootParamList = {
  Tabs: undefined;
  Settings: undefined;
  /** Verb first, subject second — see QuickAddScreen. */
  QuickAdd: undefined;
  /** What this farm runs, and therefore what it sees. */
  MyFarm: undefined;
  /**
   * The three places on the farm, reached from the Farm tab rather than from
   * the bar. See `tab-marks.ts` for why they stopped being tabs.
   */
  Stock: undefined;
  Growing: undefined;
  Iron: undefined;
  /** Records out, as spreadsheets. */
  Export: undefined;
  /** Chores the farm wrote down itself — the one authored due kind. */
  Jobs: undefined;
  Inbox: undefined;
  Diagnostics: undefined;
  Members: undefined;
  Licences: undefined;

  // Stock
  AddGroup: undefined;
  Group: { groupId: string };
  EditGroup: { groupId: string };
  Animals: { groupId: string };
  AddAnimal: { groupId: string };
  Treatment: { groupId: string };
  CareLog: { groupId: string };
  Weigh: { groupId: string };
  /** A clip. Offered only on a group kept for fibre. */
  Shearing: { groupId: string };
  Produce: { groupId: string };
  Feed: { groupId: string };
  Loss: { groupId: string };
  Breeding: { groupId: string };
  Incubations: undefined;
  SetEggs: undefined;
  Incubation: { incubationId: string };

  // Iron
  AddMachine: undefined;
  Machine: { machineId: string };
  LogHours: { machineId: string };
  AddService: { machineId: string };
  ServiceDone: { serviceId: string };
  Inventory: undefined;
  AddItem: { equipmentId?: string };

  // Growing
  SiteSetup: undefined;
  AddBed: { siteId: string };
  PickVariety: { bedId: string };
  Planting: { plantingId: string };
  Harvest: { plantingId: string };
};

/** What a routed screen receives. Saves every screen restating the generic. */
export type ScreenProps<K extends keyof RootParamList> = NativeStackScreenProps<RootParamList, K>;

const Stack = createNativeStackNavigator<RootParamList>();

export function Root({ onSignedOut }: { onSignedOut: () => void }): React.ReactElement {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={Tabs} />

      <Stack.Screen name="Settings">
        {() => <SettingsScreen onSignedOut={onSignedOut} />}
      </Stack.Screen>
      <Stack.Screen name="QuickAdd" component={QuickAddScreen} />
      <Stack.Screen name="MyFarm" component={MyFarmScreen} />
      <Stack.Screen name="Stock" component={StockScreen} />
      <Stack.Screen name="Growing" component={GrowingScreen} />
      <Stack.Screen name="Iron" component={IronScreen} />
      <Stack.Screen name="Export" component={ExportScreen} />
      <Stack.Screen name="Jobs" component={JobsScreen} />
      <Stack.Screen name="Inbox" component={InboxScreen} />
      <Stack.Screen name="Diagnostics" component={DiagnosticsScreen} />
      <Stack.Screen name="Members" component={MembersScreen} />
      <Stack.Screen name="Licences" component={LicencesScreen} />

      <Stack.Screen name="AddGroup" component={AddGroupScreen} />
      <Stack.Screen name="Group" component={GroupScreen} />
      <Stack.Screen name="EditGroup" component={EditGroupScreen} />
      <Stack.Screen name="Animals" component={AnimalsScreen} />
      <Stack.Screen name="AddAnimal" component={AddAnimalScreen} />
      <Stack.Screen name="Treatment" component={TreatmentScreen} />
      <Stack.Screen name="CareLog" component={CareLogScreen} />
      <Stack.Screen name="Weigh" component={WeighScreen} />
      <Stack.Screen name="Shearing" component={ShearingScreen} />
      <Stack.Screen name="Produce" component={ProduceScreen} />
      <Stack.Screen name="Feed" component={FeedScreen} />
      <Stack.Screen name="Loss" component={LossScreen} />
      <Stack.Screen name="Breeding" component={BreedingScreen} />
      <Stack.Screen name="Incubations" component={IncubationsScreen} />
      <Stack.Screen name="SetEggs" component={SetEggsScreen} />
      <Stack.Screen name="Incubation" component={IncubationScreen} />

      <Stack.Screen name="AddMachine" component={AddMachineScreen} />
      <Stack.Screen name="Machine" component={MachineScreen} />
      <Stack.Screen name="LogHours" component={LogHoursScreen} />
      <Stack.Screen name="AddService" component={AddServiceScreen} />
      <Stack.Screen name="ServiceDone" component={ServiceDoneScreen} />
      <Stack.Screen name="Inventory" component={InventoryScreen} />
      <Stack.Screen name="AddItem" component={AddItemScreen} />

      <Stack.Screen name="SiteSetup" component={SiteSetupScreen} />
      <Stack.Screen name="AddBed" component={AddBedScreen} />
      <Stack.Screen name="PickVariety" component={PickVarietyScreen} />
      <Stack.Screen name="Planting" component={PlantingScreen} />
      <Stack.Screen name="Harvest" component={HarvestScreen} />
    </Stack.Navigator>
  );
}
