import type { NavigatorScreenParams } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { CachedClaims } from '../auth/session';
import { AddAnimalScreen } from '../screens/AddAnimalScreen';
import { AddBedScreen } from '../screens/AddBedScreen';
import { AddGroupScreen } from '../screens/AddGroupScreen';
import { AddItemScreen } from '../screens/AddItemScreen';
import { AddMachineScreen } from '../screens/AddMachineScreen';
import { AddServiceScreen } from '../screens/AddServiceScreen';
import { AnimalsScreen } from '../screens/AnimalsScreen';
import { BackupScreen } from '../screens/BackupScreen';
import { BreedingScreen } from '../screens/BreedingScreen';
import { CareLogScreen } from '../screens/CareLogScreen';
import { CareRoutineScreen } from '../screens/CareRoutineScreen';
import { DiagnosticsScreen } from '../screens/DiagnosticsScreen';
import { EditGroupScreen } from '../screens/EditGroupScreen';
import { FeedPlanScreen } from '../screens/FeedPlanScreen';
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
import { AccountScreen } from '../screens/AccountScreen';
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
import { SupportScreen } from '../screens/SupportScreen';
import { TreatmentScreen } from '../screens/TreatmentScreen';
import { TreatmentsScreen } from '../screens/TreatmentsScreen';
import { TrendScreen } from '../screens/TrendScreen';
import { WeatherScreen } from '../screens/WeatherScreen';
import { WeighScreen } from '../screens/WeighScreen';
import { Tabs, type TabParamList } from './Tabs';

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
  /**
   * The tab bar, and which tab to land on.
   *
   * `undefined` until something needed to send somebody to a *particular* tab
   * — Today's tally pointing at "What happened" so a mis-logged total can be
   * put right where it is visible. `NavigatorScreenParams` is React
   * Navigation's own shape for that, and typing it keeps the nested route name
   * checked rather than a string nobody validates.
   */
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
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
  /**
   * Records out as a file that can come back, and the way back from one.
   *
   * Distinct from Export, which is thirteen spreadsheets for a vet and an
   * accountant and deliberately loses the ids that would let anything read
   * them in again. This is the app's own format and the only route home for a
   * farm with no account.
   */
  Backup: undefined;
  /** Chores the farm wrote down itself — the one authored due kind. */
  Jobs: undefined;
  /**
   * The forecast, and where the farm is.
   *
   * A pushed screen rather than a tab: it is read once in the morning off the
   * row on Today, and the bar is full at three (see `tab-marks.ts`).
   */
  Weather: undefined;
  Inbox: undefined;
  Diagnostics: undefined;
  /** Telling somebody the app is wrong. See `docs/SUPPORT-LOOP.md`. */
  Support: undefined;
  Members: undefined;
  Licences: undefined;
  /**
   * Where an account is asked for, and the only place it is.
   *
   * Pushed from My Farm rather than standing in front of the app: the first
   * launch works without one (A2.1), so this is reached when somebody wants
   * what an account buys, not before.
   */
  Account: undefined;

  // Stock
  AddGroup: undefined;
  Group: { groupId: string };
  EditGroup: { groupId: string };
  Animals: { groupId: string };
  AddAnimal: { groupId: string };
  /**
   * The form, for a new treatment or an existing one.
   *
   * `treatmentId` present means editing: it is the only way to close a course
   * that is still running, and a running course holds its produce for ever
   * until somebody does.
   */
  Treatment: { groupId: string; treatmentId?: string };
  /** What this group has been given, and the way back into any of it. */
  Treatments: { groupId: string };
  CareLog: { groupId: string };
  /** How often this group's routine jobs come round, and which it does at all. */
  CareRoutine: { groupId: string };
  /** What this group has produced over a season, against what it has eaten. */
  Trend: { groupId: string };
  Weigh: { groupId: string };
  /** A clip. Offered only on a group kept for fibre. */
  Shearing: { groupId: string };
  Produce: { groupId: string };
  Feed: { groupId: string };
  /** What a group *should* be fed, as distinct from what it was. */
  FeedPlan: { groupId: string };
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

export function Root({
  onSignedIn,
  onSignedOut,
}: {
  onSignedIn: (claims: CachedClaims) => void;
  onSignedOut: () => void;
}): React.ReactElement {
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
      <Stack.Screen name="Backup" component={BackupScreen} />
      <Stack.Screen name="Jobs" component={JobsScreen} />
      <Stack.Screen name="Weather" component={WeatherScreen} />
      <Stack.Screen name="Inbox" component={InboxScreen} />
      <Stack.Screen name="Diagnostics" component={DiagnosticsScreen} />
      <Stack.Screen name="Support" component={SupportScreen} />
      <Stack.Screen name="Members" component={MembersScreen} />
      <Stack.Screen name="Licences" component={LicencesScreen} />
      <Stack.Screen name="Account">{() => <AccountScreen onSignedIn={onSignedIn} />}</Stack.Screen>

      <Stack.Screen name="AddGroup" component={AddGroupScreen} />
      <Stack.Screen name="Group" component={GroupScreen} />
      <Stack.Screen name="EditGroup" component={EditGroupScreen} />
      <Stack.Screen name="Animals" component={AnimalsScreen} />
      <Stack.Screen name="AddAnimal" component={AddAnimalScreen} />
      <Stack.Screen name="Treatment" component={TreatmentScreen} />
      <Stack.Screen name="Treatments" component={TreatmentsScreen} />
      <Stack.Screen name="CareLog" component={CareLogScreen} />
      <Stack.Screen name="CareRoutine" component={CareRoutineScreen} />
      <Stack.Screen name="Trend" component={TrendScreen} />
      <Stack.Screen name="Weigh" component={WeighScreen} />
      <Stack.Screen name="Shearing" component={ShearingScreen} />
      <Stack.Screen name="Produce" component={ProduceScreen} />
      <Stack.Screen name="Feed" component={FeedScreen} />
      <Stack.Screen name="FeedPlan" component={FeedPlanScreen} />
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
