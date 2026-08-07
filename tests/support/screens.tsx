/**
 * Every screen, with whatever route params it needs, and a farm to render.
 *
 * Shared because two suites walk the same list for different reasons —
 * `mounts.test.tsx` proves each screen renders at all, and
 * `affordance.test.tsx` reads what every pressable on it promises. A second
 * copy of forty-five entries would drift within a month, and the suite that
 * drifted would be the one quietly checking less.
 */

import { newId } from '@steading/contracts';
import { enqueue } from '@steading/core/sync/queue';
import { routeProps } from './screen';

import { AddAnimalScreen } from '../../apps/mobile/src/screens/AddAnimalScreen';
import { AddBedScreen } from '../../apps/mobile/src/screens/AddBedScreen';
import { AddGroupScreen } from '../../apps/mobile/src/screens/AddGroupScreen';
import { AddItemScreen } from '../../apps/mobile/src/screens/AddItemScreen';
import { AddMachineScreen } from '../../apps/mobile/src/screens/AddMachineScreen';
import { AddServiceScreen } from '../../apps/mobile/src/screens/AddServiceScreen';
import { AccountScreen } from '../../apps/mobile/src/screens/AccountScreen';
import { AnimalsScreen } from '../../apps/mobile/src/screens/AnimalsScreen';
import { BackupScreen } from '../../apps/mobile/src/screens/BackupScreen';
import { BreedingScreen } from '../../apps/mobile/src/screens/BreedingScreen';
import { CareLogScreen } from '../../apps/mobile/src/screens/CareLogScreen';
import { DiagnosticsScreen } from '../../apps/mobile/src/screens/DiagnosticsScreen';
import { EditGroupScreen } from '../../apps/mobile/src/screens/EditGroupScreen';
import { FeedScreen } from '../../apps/mobile/src/screens/FeedScreen';
import { GroupScreen } from '../../apps/mobile/src/screens/GroupScreen';
import { GrowingScreen } from '../../apps/mobile/src/screens/GrowingScreen';
import { HarvestScreen } from '../../apps/mobile/src/screens/HarvestScreen';
import { InboxScreen } from '../../apps/mobile/src/screens/InboxScreen';
import { IncubationScreen } from '../../apps/mobile/src/screens/IncubationScreen';
import { IncubationsScreen } from '../../apps/mobile/src/screens/IncubationsScreen';
import { InventoryScreen } from '../../apps/mobile/src/screens/InventoryScreen';
import { LicencesScreen } from '../../apps/mobile/src/screens/LicencesScreen';
import { ExportScreen } from '../../apps/mobile/src/screens/ExportScreen';
import { FarmScreen } from '../../apps/mobile/src/screens/FarmScreen';
import { HistoryScreen } from '../../apps/mobile/src/screens/HistoryScreen';
import { IronScreen } from '../../apps/mobile/src/screens/IronScreen';
import { JobsScreen } from '../../apps/mobile/src/screens/JobsScreen';
import { LogHoursScreen } from '../../apps/mobile/src/screens/LogHoursScreen';
import { LossScreen } from '../../apps/mobile/src/screens/LossScreen';
import { MachineScreen } from '../../apps/mobile/src/screens/MachineScreen';
import { MembersScreen } from '../../apps/mobile/src/screens/MembersScreen';
import { PickVarietyScreen } from '../../apps/mobile/src/screens/PickVarietyScreen';
import { PlantingScreen } from '../../apps/mobile/src/screens/PlantingScreen';
import { ProduceScreen } from '../../apps/mobile/src/screens/ProduceScreen';
import { ServiceDoneScreen } from '../../apps/mobile/src/screens/ServiceDoneScreen';
import { SetEggsScreen } from '../../apps/mobile/src/screens/SetEggsScreen';
import { SettingsScreen } from '../../apps/mobile/src/screens/SettingsScreen';
import { SiteSetupScreen } from '../../apps/mobile/src/screens/SiteSetupScreen';
import { ShearingScreen } from '../../apps/mobile/src/screens/ShearingScreen';
import { StockScreen } from '../../apps/mobile/src/screens/StockScreen';
import { TodayScreen } from '../../apps/mobile/src/screens/TodayScreen';
import { TreatmentScreen } from '../../apps/mobile/src/screens/TreatmentScreen';
import { WeighScreen } from '../../apps/mobile/src/screens/WeighScreen';

/**
 * Every screen, on an empty farm and on a stocked one.
 *
 * The cheapest test in the suite and the one that would have caught the most:
 * a screen with a hook after an early return, a reader that rejects, a field
 * read off a record that is null on the first paint. None of those is a
 * typecheck error and none stops the bundler — they are a white screen on a
 * handset, found by whoever opened the app next.
 *
 * Twice over, because empty and full are genuinely different code paths: the
 * empty branch is the invitation (UX-SPEC §6) and the full branch is the one
 * that indexes into records.
 */

const GROUP = newId();
const ANIMAL = newId();
const MACHINE = newId();
const SERVICE = newId();
const SITE = newId();
const BED = newId();
const VARIETY = newId();
const PLANTING = newId();
const INCUBATION = newId();

/** A farm with one of everything, so the populated branch of each screen runs. */
export async function stockTheFarm(): Promise<void> {
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: {
      name: 'The hens',
      species: 'chicken',
      count: 6,
      purposes: ['eggs', 'meat'],
      breedId: 'breed-chicken-rhode-island-red',
      bornAt: Date.now() - 30 * 86_400_000,
    },
  });
  await enqueue({
    entity: 'animal',
    op: 'create',
    targetId: ANIMAL,
    payload: { flockId: GROUP, name: 'Bramble', species: 'chicken', sex: 'female' },
  });
  await enqueue({
    entity: 'equipment',
    op: 'create',
    targetId: MACHINE,
    payload: { name: 'The tractor', make: 'Kubota', hasHourMeter: true },
  });
  await enqueue({
    entity: 'hourReading',
    op: 'create',
    payload: { occurredAt: Date.now() - 10 * 86_400_000, equipmentId: MACHINE, hours: 200 },
  });
  await enqueue({
    entity: 'hourReading',
    op: 'create',
    payload: { occurredAt: Date.now(), equipmentId: MACHINE, hours: 240 },
  });
  await enqueue({
    entity: 'maintenance',
    op: 'create',
    targetId: SERVICE,
    payload: { equipmentId: MACHINE, title: 'Oil and filter', intervalHours: 100 },
  });
  await enqueue({
    entity: 'inventory',
    op: 'create',
    targetId: newId(),
    payload: { name: 'Oil filter', kind: 'part', unit: 'each', quantity: 0, reorderBelow: 1 },
  });
  await enqueue({
    entity: 'site',
    op: 'create',
    targetId: SITE,
    payload: {
      name: 'The farm',
      frost: { lastSpring: 515, firstAutumn: 1005, source: 'entered' },
      zone: { system: 'usda', value: '7a' },
    },
  });
  await enqueue({
    entity: 'bed',
    op: 'create',
    targetId: BED,
    payload: { siteId: SITE, name: 'Bed 3', covered: false },
  });
  await enqueue({
    entity: 'variety',
    op: 'create',
    targetId: VARIETY,
    payload: { name: 'Sungold', crop: 'Tomato', family: 'solanaceae', lifecycle: 'annual', daysToMaturity: 65 },
  });
  await enqueue({
    entity: 'planting',
    op: 'create',
    targetId: PLANTING,
    payload: { bedId: BED, varietyId: VARIETY, season: new Date().getFullYear(), status: 'planned' },
  });
  await enqueue({
    entity: 'incubation',
    op: 'create',
    targetId: INCUBATION,
    payload: {
      species: 'chicken',
      label: 'The Sussex set',
      setAt: Date.now() - 7 * 86_400_000,
      eggsSet: 12,
      source: 'own',
      method: 'incubator',
    },
  });
}

/** Every screen, with whatever route params it needs. */
export const SCREENS: [string, () => React.ReactElement][] = [
  ['Today', () => <TodayScreen />],
  ['Stock', () => <StockScreen />],
  ['Growing', () => <GrowingScreen />],
  ['Iron', () => <IronScreen />],
  ['Settings', () => <SettingsScreen onSignedOut={() => undefined} />],
  /**
    * The one screen that leads to an account, and it was not on this list.
    *
    * `useGoogleSignIn` throws during render when no Google client id is
    * configured — which is every build of this app so far — so `AccountScreen`
    * was a red error box on a handset while the whole suite stayed green.
    * Nothing else could have caught it: a typecheck cannot see a hook that
    * throws, and the bundler cannot either.
    */
  ['Account', () => <AccountScreen onSignedIn={() => undefined} />],
  ['Inbox', () => <InboxScreen />],
  ['Diagnostics', () => <DiagnosticsScreen />],
  ['Members', () => <MembersScreen />],
  ['Licences', () => <LicencesScreen />],
  ['History', () => <HistoryScreen />],
  ['Farm', () => <FarmScreen />],
  ['Export', () => <ExportScreen />],
  ['Backup', () => <BackupScreen />],
  ['Jobs', () => <JobsScreen />],
  ['AddGroup', () => <AddGroupScreen />],
  ['Group', () => <GroupScreen {...routeProps({ groupId: GROUP })} />],
  ['EditGroup', () => <EditGroupScreen {...routeProps({ groupId: GROUP })} />],
  ['Animals', () => <AnimalsScreen {...routeProps({ groupId: GROUP })} />],
  ['AddAnimal', () => <AddAnimalScreen {...routeProps({ groupId: GROUP })} />],
  ['Treatment', () => <TreatmentScreen {...routeProps({ groupId: GROUP })} />],
  ['CareLog', () => <CareLogScreen {...routeProps({ groupId: GROUP })} />],
  ['Weigh', () => <WeighScreen {...routeProps({ groupId: GROUP })} />],
  ['Shearing', () => <ShearingScreen {...routeProps({ groupId: GROUP })} />],
  ['Produce', () => <ProduceScreen {...routeProps({ groupId: GROUP })} />],
  ['Feed', () => <FeedScreen {...routeProps({ groupId: GROUP })} />],
  ['Loss', () => <LossScreen {...routeProps({ groupId: GROUP })} />],
  ['Breeding', () => <BreedingScreen {...routeProps({ groupId: GROUP })} />],
  ['Incubations', () => <IncubationsScreen />],
  ['SetEggs', () => <SetEggsScreen />],
  ['Incubation', () => <IncubationScreen {...routeProps({ incubationId: INCUBATION })} />],
  ['AddMachine', () => <AddMachineScreen />],
  ['Machine', () => <MachineScreen {...routeProps({ machineId: MACHINE })} />],
  ['LogHours', () => <LogHoursScreen {...routeProps({ machineId: MACHINE })} />],
  ['AddService', () => <AddServiceScreen {...routeProps({ machineId: MACHINE })} />],
  ['ServiceDone', () => <ServiceDoneScreen {...routeProps({ serviceId: SERVICE })} />],
  ['Inventory', () => <InventoryScreen />],
  ['AddItem', () => <AddItemScreen {...routeProps({})} />],
  ['SiteSetup', () => <SiteSetupScreen />],
  ['AddBed', () => <AddBedScreen {...routeProps({ siteId: SITE })} />],
  ['PickVariety', () => <PickVarietyScreen {...routeProps({ bedId: BED })} />],
  ['Planting', () => <PlantingScreen {...routeProps({ plantingId: PLANTING })} />],
  ['Harvest', () => <HarvestScreen {...routeProps({ plantingId: PLANTING })} />],
];

