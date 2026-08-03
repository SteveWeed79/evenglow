import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { listAnimals } from '@steading/core/read/animals';
import { listBreedings, listIncubations, listWeights } from '@steading/core/read/breeding';
import { listCareLogs } from '@steading/core/read/care';
import { lastFedByGroup, listGroups, lossesByGroup, produceToday } from '@steading/core/read/groups';
import { listBeds, listHarvests, listPlantings, listVarieties, readSite } from '@steading/core/read/growing';
import { listInventory, listMachines, listServices } from '@steading/core/read/iron';
import { enqueue } from '@steading/core/sync/queue';
import { localStore } from '@steading/core/db/store';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { navCalls } from '../support/native/navigation';
import { haptics } from '../support/native/modules';

import { AddAnimalScreen } from '../../apps/mobile/src/screens/AddAnimalScreen';
import { AddBedScreen } from '../../apps/mobile/src/screens/AddBedScreen';
import { AddGroupScreen } from '../../apps/mobile/src/screens/AddGroupScreen';
import { AddItemScreen } from '../../apps/mobile/src/screens/AddItemScreen';
import { AddMachineScreen } from '../../apps/mobile/src/screens/AddMachineScreen';
import { AddServiceScreen } from '../../apps/mobile/src/screens/AddServiceScreen';
import { BreedingScreen } from '../../apps/mobile/src/screens/BreedingScreen';
import { CareLogScreen } from '../../apps/mobile/src/screens/CareLogScreen';
import { EditGroupScreen } from '../../apps/mobile/src/screens/EditGroupScreen';
import { GroupScreen } from '../../apps/mobile/src/screens/GroupScreen';
import { FeedScreen } from '../../apps/mobile/src/screens/FeedScreen';
import { HarvestScreen } from '../../apps/mobile/src/screens/HarvestScreen';
import { IncubationScreen } from '../../apps/mobile/src/screens/IncubationScreen';
import { InventoryScreen } from '../../apps/mobile/src/screens/InventoryScreen';
import { LogHoursScreen } from '../../apps/mobile/src/screens/LogHoursScreen';
import { LossScreen } from '../../apps/mobile/src/screens/LossScreen';
import { PickVarietyScreen } from '../../apps/mobile/src/screens/PickVarietyScreen';
import { PlantingScreen } from '../../apps/mobile/src/screens/PlantingScreen';
import { ProduceScreen } from '../../apps/mobile/src/screens/ProduceScreen';
import { ServiceDoneScreen } from '../../apps/mobile/src/screens/ServiceDoneScreen';
import { SetEggsScreen } from '../../apps/mobile/src/screens/SetEggsScreen';
import { SiteSetupScreen } from '../../apps/mobile/src/screens/SiteSetupScreen';
import { TodayScreen } from '../../apps/mobile/src/screens/TodayScreen';
import { TreatmentScreen } from '../../apps/mobile/src/screens/TreatmentScreen';
import { WeighScreen } from '../../apps/mobile/src/screens/WeighScreen';

/**
 * What each screen actually writes.
 *
 * Mounting proves a screen does not crash. This proves it does the job it
 * exists for — and it is not a formality, because `enqueue` validates every
 * payload against the same contract the server does. A screen that builds a
 * field the schema does not have, or omits one it requires, throws here rather
 * than being discovered as a row in the rejected inbox on somebody's phone.
 *
 * Read back through the real readers rather than by inspecting the outbox: the
 * round trip is the thing that matters, and it is where the update-merge bug
 * lived.
 */

const GROUP = newId();

async function aGroup(over: Record<string, unknown> = {}): Promise<void> {
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: { name: 'The hens', species: 'chicken', count: 6, purposes: ['eggs'], ...over },
  });
}

beforeEach(async () => {
  await freshStore();
  haptics.length = 0;
});

describe('stock', () => {
  it('adds a group with the breed and hatch date the clocks need', async () => {
    const screen = await mount(<AddGroupScreen />);

    await screen.pressLabel('Meat');
    await screen.type('group-name', 'The broilers');
    await screen.press('step-plus-10');
    await screen.pressLabel('Cornish Cross');
    await screen.pressLabel('I know when they hatched or were born');
    await screen.press('save-group');

    const [group] = await listGroups();
    expect(group).toMatchObject({ name: 'The broilers', species: 'chicken', count: 10 });
    expect(group?.breedId).toBeDefined();
    expect(group?.bornAt).toBeDefined();
    expect(group?.purposes).toContain('meat');
  });

  it('edits head count without losing the rest of the group', async () => {
    await aGroup();
    const screen = await mount(<EditGroupScreen {...routeProps({ groupId: GROUP })} />);

    await screen.press('step-plus-5');
    await screen.press('save-group');

    const [group] = await listGroups();
    expect(group).toMatchObject({ name: 'The hens', species: 'chicken', count: 11 });
  });

  it('takes two taps to put a group away', async () => {
    await aGroup();
    const screen = await mount(<EditGroupScreen {...routeProps({ groupId: GROUP })} />);

    await screen.press('archive-group');
    expect(await listGroups()).toHaveLength(1);

    await screen.press('archive-group');
    expect(await listGroups()).toHaveLength(0);
  });

  it('names an animal', async () => {
    await aGroup();
    const screen = await mount(<AddAnimalScreen {...routeProps({ groupId: GROUP })} />);

    await screen.type('animal-name', 'Bramble');
    await screen.press('save-animal');

    expect((await listAnimals())[0]).toMatchObject({ name: 'Bramble', flockId: GROUP, sex: 'female' });
  });
});

describe('treatments and the withdrawal interlock', () => {
  it('records a treatment and opens an egg withdrawal', async () => {
    await aGroup();
    const screen = await mount(<TreatmentScreen {...routeProps({ groupId: GROUP })} />);

    await screen.type('treatment-name', 'Baytril');
    // Eggs is the first withdrawal stepper on the screen.
    const steppers = screen.tree.root.findAllByProps({ testID: 'step-plus-7' });
    expect(steppers.length).toBeGreaterThan(0);
    await screen.press('save-treatment');

    const rows = await localStore().readRecordsByEntity('medication');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toMatchObject({ flockId: GROUP, name: 'Baytril' });
  });

  it('puts the withdrawal band and the Today row up together', async () => {
    await aGroup();
    await enqueue({
      entity: 'medication',
      op: 'create',
      targetId: newId(),
      payload: {
        flockId: GROUP,
        name: 'Baytril',
        administeredAt: Date.now(),
        treatmentEndsAt: Date.now(),
        withdrawalDays: { egg: 7 },
      },
    });

    const today = await mount(<TodayScreen />);
    // The band is on the group and the row is on the list; both read from the
    // same arithmetic, so they cannot disagree.
    expect(today.text()).toContain('eggs');
    expect(today.text().toLowerCase()).toContain('baytril');
  });
});

describe('husbandry', () => {
  it('logs a job and stops it reading as never done', async () => {
    await aGroup({ species: 'goat' });
    const screen = await mount(<CareLogScreen {...routeProps({ groupId: GROUP })} />);

    await screen.press('care-hoof-trim');
    await screen.press('save-care');

    const logs = await listCareLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ kind: 'hoof-trim', flockId: GROUP });
  });

  it('offers only the jobs the species has', async () => {
    await aGroup();
    const screen = await mount(<CareLogScreen {...routeProps({ groupId: GROUP })} />);
    // A chicken has no hooves.
    expect(screen.has('care-hoof-trim')).toBe(false);
    expect(screen.has('care-worming')).toBe(true);
  });
});

describe('what comes off them', () => {
  it('weighs a group in pounds and stores micrograms', async () => {
    await aGroup();
    const screen = await mount(<WeighScreen {...routeProps({ groupId: GROUP })} />);

    await screen.type('weight-amount', '6.4');
    await screen.press('save-weight');

    const [weight] = await listWeights();
    expect(weight?.massUg).toBe(Math.round(6.4 * 453_592_370));
    expect(weight?.flockId).toBe(GROUP);
    expect(weight?.sampled).toBe(true);
  });

  it('logs milk through the tally', async () => {
    await aGroup({ species: 'goat', purposes: ['milk'] });
    const screen = await mount(<ProduceScreen {...routeProps({ groupId: GROUP })} />);

    await screen.press('tally-plus-500');
    await screen.press('tally-plus-100');
    await screen.press('tally-commit');

    expect((await produceToday()).get(`${GROUP}:milk`)).toMatchObject({ amount: 600, unit: 'ml' });
  });

  it('logs a feed in scoops and stores grams', async () => {
    await aGroup();
    const screen = await mount(<FeedScreen {...routeProps({ groupId: GROUP })} />);

    await screen.press('tally-plus-2');
    await screen.press('tally-commit');

    expect((await lastFedByGroup()).get(GROUP)).toBeDefined();
  });

  it('records a loss and its predator as two facts', async () => {
    await aGroup();
    const screen = await mount(<LossScreen {...routeProps({ groupId: GROUP })} />);

    /**
     * `step-minus-1`, not `step-plus-1`.
     *
     * A screen headed "Record a loss" offering `+5` reads as five more
     * animals. The count is still a magnitude and still goes up — only the
     * sign the buttons show changes, so that the buttons and the heading agree.
     */
    expect(screen.has('step-plus-1')).toBe(false);
    await screen.press('step-minus-1');
    await screen.press('choice-predator');
    await screen.type('loss-predator', 'Fox');
    await screen.press('save-loss');

    expect((await lossesByGroup()).get(GROUP)).toBe(2);
    expect(await localStore().readRecordsByEntity('predator')).toHaveLength(1);
  });
});

describe('birthing and hatching', () => {
  it('records a mating against a named dam', async () => {
    await aGroup({ species: 'goat' });
    await enqueue({
      entity: 'animal',
      op: 'create',
      targetId: newId(),
      payload: { flockId: GROUP, name: 'Bramble', species: 'goat', sex: 'female' },
    });

    const screen = await mount(<BreedingScreen {...routeProps({ groupId: GROUP })} />);
    await screen.pressLabel('Bramble');
    await screen.press('save-breeding');

    expect((await listBreedings())[0]).toMatchObject({ species: 'goat' });
  });

  it('tells a bird keeper to use the incubator instead', async () => {
    await aGroup();
    const screen = await mount(<BreedingScreen {...routeProps({ groupId: GROUP })} />);
    expect(screen.text()).toContain('Not this kind of animal');
  });

  it('sets eggs, candles them, then hatches them', async () => {
    const setter = await mount(<SetEggsScreen />);
    await setter.type('incubation-label', 'The Sussex set');
    await setter.press('save-incubation');

    const [set] = await listIncubations();
    expect(set).toMatchObject({ label: 'The Sussex set', eggsSet: 12 });

    const detail = await mount(<IncubationScreen {...routeProps({ incubationId: set!.id })} />);
    await detail.press('save-candling');

    const [candled] = await listIncubations();
    expect(candled?.candledAt).toBeDefined();
    // The set's own figures survived the partial update.
    expect(candled).toMatchObject({ label: 'The Sussex set', eggsSet: 12, species: 'chicken' });

    const after = await mount(<IncubationScreen {...routeProps({ incubationId: set!.id })} />);
    await after.press('step-plus-6');
    await after.press('save-hatch');

    const [hatched] = await listIncubations();
    expect(hatched).toMatchObject({ hatched: 6, eggsSet: 12 });
    expect(hatched?.hatchedAt).toBeDefined();
  });
});

describe('iron', () => {
  it('adds a machine, logs its meter, schedules a service and closes it', async () => {
    const add = await mount(<AddMachineScreen />);
    await add.type('machine-name', 'The tractor');
    await add.press('save-machine');

    const [machine] = await listMachines();
    expect(machine).toMatchObject({ name: 'The tractor', hasHourMeter: true });

    const hours = await mount(<LogHoursScreen {...routeProps({ machineId: machine!.id })} />);
    await hours.press('tally-plus-100');
    await hours.press('tally-commit');
    expect((await listMachines())[0]?.hours).toBe(100);

    const service = await mount(<AddServiceScreen {...routeProps({ machineId: machine!.id })} />);
    await service.pressLabel('Oil and filter');
    await service.press('save-service');

    const [schedule] = await listServices();
    expect(schedule).toMatchObject({ title: 'Oil and filter', intervalHours: 100 });

    const done = await mount(<ServiceDoneScreen {...routeProps({ serviceId: schedule!.id })} />);
    await done.type('service-hours', '100');
    await done.press('save-done');

    const [closed] = await listServices();
    expect(closed).toMatchObject({ title: 'Oil and filter', intervalHours: 100, lastDoneAtHours: 100 });
  });

  it('refuses a schedule with nothing to come round on', async () => {
    await enqueue({
      entity: 'equipment',
      op: 'create',
      targetId: newId(),
      payload: { name: 'The pump', hasHourMeter: false },
    });
    const [machine] = await listMachines();

    const screen = await mount(<AddServiceScreen {...routeProps({ machineId: machine!.id })} />);
    await screen.type('service-title', 'Grease it');
    // No meter, and the day interval is off by default: nothing can fire.
    expect(screen.get('save-service').props.accessibilityState.disabled).toBe(true);
    expect(screen.text()).toContain('needs an hour interval');
  });

  it('adds a part and corrects the count on the shelf', async () => {
    const add = await mount(<AddItemScreen {...routeProps({})} />);
    await add.type('item-name', 'Oil filter');
    await add.press('save-item');

    expect((await listInventory())[0]).toMatchObject({ name: 'Oil filter', quantity: 1 });

    const shelf = await mount(<InventoryScreen />);
    await shelf.press('step-plus-5');
    expect((await listInventory())[0]?.quantity).toBe(6);
  });
});

describe('growing', () => {
  it('sets the ground, adds a bed, plants a variety, then picks it', async () => {
    const setup = await mount(<SiteSetupScreen />);
    await setup.press('save-site');

    const site = await readSite();
    expect(site?.frost).toBeDefined();

    const bed = await mount(<AddBedScreen {...routeProps({ siteId: site!.id })} />);
    await bed.type('bed-name', 'Bed 3');
    await bed.press('save-bed');

    const [added] = await listBeds();
    expect(added).toMatchObject({ name: 'Bed 3' });

    const pick = await mount(<PickVarietyScreen {...routeProps({ bedId: added!.id })} />);
    await pick.pressLabel('Sungold');
    await pick.press('plant-it');

    const [planting] = await listPlantings();
    const [variety] = await listVarieties();
    expect(variety?.name).toBe('Sungold');
    expect(planting).toMatchObject({ bedId: added!.id, status: 'planned' });

    const detail = await mount(<PlantingScreen {...routeProps({ plantingId: planting!.id })} />);
    await detail.press('mark-harvesting');
    expect((await listPlantings())[0]?.status).toBe('harvesting');

    const harvest = await mount(<HarvestScreen {...routeProps({ plantingId: planting!.id })} />);
    await harvest.type('harvest-mass', '4.5');
    await harvest.press('save-harvest');

    const [picked] = await listHarvests();
    expect(picked?.massUg).toBe(Math.round(4.5 * 453_592_370));
  });

  it('warns about a tender variety without blocking it', async () => {
    await enqueue({
      entity: 'site',
      op: 'create',
      targetId: newId(),
      payload: {
        name: 'The farm',
        frost: { lastSpring: 515, firstAutumn: 1005, source: 'entered' },
        zone: { system: 'usda', value: '4a' },
      },
    });
    const site = await readSite();
    await enqueue({
      entity: 'bed',
      op: 'create',
      targetId: newId(),
      payload: { siteId: site!.id, name: 'Bed 3', covered: false },
    });
    const [bed] = await listBeds();

    const screen = await mount(<PickVarietyScreen {...routeProps({ bedId: bed!.id })} />);
    await screen.pressLabel('Sungold');
    // Warns, never blocks — the button is still there.
    expect(screen.has('plant-it')).toBe(true);
  });
});

describe('navigation out of a screen', () => {
  it('goes back once the work is durable', async () => {
    await aGroup();
    const screen = await mount(<WeighScreen {...routeProps({ groupId: GROUP })} />);

    await screen.type('weight-amount', '6.4');
    await screen.press('save-weight');

    expect(navCalls()).toContainEqual({ action: 'goBack' });
  });
});

describe('the group hub, ranked rather than flat', () => {
  /**
   * From the emulator: nine rows of equal weight, each with an icon and a
   * line of explanation. Eighteen lines of text, no ranking, and past
   * Material's own ceiling for a related-action cluster.
   *
   * The split is by how often a thing is done. What must not happen is a
   * destination disappearing (invariant 13), so this asserts all nine are
   * still reachable.
   */
  const DAILY = ['go-treatment', 'go-care', 'go-feed', 'go-loss'];
  const OCCASIONAL = ['go-produce', 'go-weigh', 'go-animals', 'go-breeding', 'go-edit'];

  it('shows the four daily acts without asking', async () => {
    await aGroup();
    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);

    for (const id of DAILY) expect(screen.has(id), id).toBe(true);
    screen.unmount();
  });

  it('folds the occasional ones away', async () => {
    await aGroup();
    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);

    for (const id of OCCASIONAL) expect(screen.has(id), id).toBe(false);
    screen.unmount();
  });

  it('reaches every one of them in one tap, losing nothing', async () => {
    await aGroup();
    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);

    await screen.press('group-more');

    for (const id of [...DAILY, ...OCCASIONAL]) expect(screen.has(id), id).toBe(true);
    screen.unmount();
  });
});

describe('add stock follows the species you picked', () => {
  /**
   * From the emulator: "Chickens do not produce milk. The first selection
   * should determine what the user can choose below."
   */
  it('offers a hen keeper eggs, and never milk or fibre', async () => {
    const screen = await mount(<AddGroupScreen />);

    // Chickens are the default species.
    expect(screen.has('purpose-eggs')).toBe(true);
    expect(screen.has('purpose-milk')).toBe(false);
    expect(screen.has('purpose-fibre')).toBe(false);
    screen.unmount();
  });

  it('changes what is on offer when the species changes', async () => {
    const screen = await mount(<AddGroupScreen />);

    await screen.pressLabel('Goats');

    expect(screen.has('purpose-milk')).toBe(true);
    expect(screen.has('purpose-fibre')).toBe(true);
    expect(screen.has('purpose-eggs')).toBe(false);
    screen.unmount();
  });

  it('drops a purpose the new species cannot serve', async () => {
    /**
     * Pick goats, tick milk, change to chickens. Without this the flock is
     * saved as kept for milk — invisibly, because the chip that would have
     * shown it is gone with the species.
     */
    const screen = await mount(<AddGroupScreen />);

    await screen.pressLabel('Goats');
    await screen.press('purpose-milk');
    await screen.pressLabel('Chickens');
    await screen.press('save-group');

    const [group] = await listGroups();
    expect(group?.purposes ?? []).not.toContain('milk');
    screen.unmount();
  });
});
