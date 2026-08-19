import { beforeEach, describe, expect, it } from 'vitest';
import { newId, poundsToUg, serviceDue } from '@homefarm/contracts';
import { listAnimals } from '@homefarm/core/read/animals';
import { listBreedings, listIncubations, listWeights } from '@homefarm/core/read/breeding';
import { listCareLogs } from '@homefarm/core/read/care';
import { listHistory } from '@homefarm/core/read/history';
import {
  currentFeedPlans,
  lastFedByGroup,
  listGroups,
  lossesByGroup,
  produceToday,
} from '@homefarm/core/read/groups';
import { listBeds, listHarvests, listPlantings, listVarieties, readSite } from '@homefarm/core/read/growing';
import { listInventory, listMachines, listServices } from '@homefarm/core/read/iron';
import { listTasks } from '@homefarm/core/read/tasks';
import { enqueue } from '@homefarm/core/sync/queue';
import { localStore } from '@homefarm/core/db/store';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { navCalls, setBackable } from '../support/native/navigation';
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
import { FarmScreen } from '../../apps/mobile/src/screens/FarmScreen';
import { GroupScreen } from '../../apps/mobile/src/screens/GroupScreen';
import { FeedPlanScreen } from '../../apps/mobile/src/screens/FeedPlanScreen';
import { FeedScreen } from '../../apps/mobile/src/screens/FeedScreen';
import { HarvestScreen } from '../../apps/mobile/src/screens/HarvestScreen';
import { IncubationScreen } from '../../apps/mobile/src/screens/IncubationScreen';
import { InventoryScreen } from '../../apps/mobile/src/screens/InventoryScreen';
import { LogHoursScreen } from '../../apps/mobile/src/screens/LogHoursScreen';
import { LossScreen } from '../../apps/mobile/src/screens/LossScreen';
import { PickVarietyScreen } from '../../apps/mobile/src/screens/PickVarietyScreen';
import { ProduceScreen } from '../../apps/mobile/src/screens/ProduceScreen';
import { ServiceDoneScreen } from '../../apps/mobile/src/screens/ServiceDoneScreen';
import { SetEggsScreen } from '../../apps/mobile/src/screens/SetEggsScreen';
import { ShearingScreen } from '../../apps/mobile/src/screens/ShearingScreen';
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
  /**
   * How a group gets weighed, and it took four reports to get here.
   *
   *  1. "weigh them on a flock of 7 only has 1 input; average is okay but it's
   *     a secondary option" — one field, defaulted to an average.
   *  2. "I thought you fixed the weight being only a single measurement?" — the
   *     add-one-at-a-time loop was there and looked exactly like the old screen.
   *  3. "there are 7 birds in that flock… 1 weight makes little sense" — the
   *     head count was known and never said.
   *  4. "shouldn't there be a spot to enter the weight of each bird? or a
   *     toggle to turn that on if it's a large group?" — which is this.
   *
   * A box each is the default for a group you could carry to a scale. Seven
   * boxes you can see and fill in any order beats seven trips through one box.
   */
  it('gives a group a box per animal, and writes only the filled ones', async () => {
    await aGroup({ count: 6 });
    const screen = await mount(<WeighScreen {...routeProps({ groupId: GROUP })} />);

    // Every box present, and none of them compulsory.
    expect(screen.has('weight-box-5')).toBe(true);
    await screen.type('weight-box-0', '6.4');
    await screen.type('weight-box-2', '5.9');
    await screen.press('save-weight');

    const weights = await listWeights();
    expect(weights).toHaveLength(2);
    expect(weights.every((w) => w.flockId === GROUP)).toBe(true);
    /**
     * NOT sampled, and this is the assertion that started it all. `sampled`
     * means "a group average rather than one animal on a scale" and used to
     * default to on, so one bird lifted onto a scale out of six was stored as
     * the average of all six and every growth curve read it that way.
     */
    expect(weights.every((w) => w.sampled === undefined)).toBe(true);
    expect(weights.map((w) => w.massUg).sort()).toEqual(
      [6.4, 5.9].map((lb) => Math.round(lb * 453_592_370)).sort(),
    );
  });

  it('says how many there are, and counts what is done against it', async () => {
    await aGroup({ count: 7 });
    const screen = await mount(<WeighScreen {...routeProps({ groupId: GROUP })} />);

    expect(screen.text()).toContain('All 7');
    await screen.type('weight-box-0', '6.4');
    await screen.type('weight-box-1', '5.9');
    expect(screen.text()).toContain('2 of 7 weighed');

    // The average AND the spread, which one figure could never have given.
    expect(screen.text()).toContain('6.2 lb average');
  });

  /**
   * The loop is still there for a flock too big to draw a box for, and it is
   * the mode a farm can always choose. `BOXES_MAX` is 24, so 40 gets two
   * options rather than three.
   */
  it('falls back to one at a time for a flock too big for boxes', async () => {
    await aGroup({ count: 40 });
    const screen = await mount(<WeighScreen {...routeProps({ groupId: GROUP })} />);

    expect(screen.has('weight-box-0')).toBe(false);
    await screen.type('weight-amount', '6.4');
    await screen.press('weight-add');
    await screen.type('weight-amount', '5.9');
    await screen.press('weight-add');
    expect(screen.text()).toContain('2 of 40 weighed');

    /**
     * Typed and NOT added — the finish button must still take it, or the
     * number somebody is looking at is dropped for want of a tap they had no
     * reason to make. The service meter fault, on another screen.
     */
    await screen.type('weight-amount', '6.1');
    await screen.press('save-weight');

    expect(await listWeights()).toHaveLength(3);
  });

  /**
   * Carrying on is the green button and finishing is the quiet one.
   *
   * The ranking used to be reversed, so somebody typed the first weight,
   * pressed the obvious green button and was returned to Today having logged
   * one — reported as "when you enter a weight the app goes to the Today
   * screen" and "that seems lazy on our end".
   */
  it('does not leave the screen when the loop carries on', async () => {
    await aGroup({ count: 40 });
    const screen = await mount(<WeighScreen {...routeProps({ groupId: GROUP })} />);

    await screen.type('weight-amount', '6.4');
    await screen.press('weight-add');

    expect(navCalls().filter((c) => c.action === 'goBack')).toHaveLength(0);
    expect(await listWeights()).toHaveLength(0);
  });

  /** The fallback is still there, and now it says what it is. */
  it('records one figure as an average when asked to', async () => {
    await aGroup({ count: 6 });
    const screen = await mount(<WeighScreen {...routeProps({ groupId: GROUP })} />);

    await screen.pressLabel('One average');
    await screen.type('weight-amount', '6.4');
    await screen.press('save-weight');

    const weights = await listWeights();
    expect(weights).toHaveLength(1);
    expect(weights[0]?.sampled).toBe(true);
  });

  /**
   * Nothing carries between modes. An average logged alongside six individuals
   * would double every total that sums either, and a box still filled behind a
   * mode nobody can see is worse.
   */
  it('drops what was collected when the mode changes', async () => {
    await aGroup({ count: 6 });
    const screen = await mount(<WeighScreen {...routeProps({ groupId: GROUP })} />);

    await screen.type('weight-box-0', '6.4');
    await screen.pressLabel('One average');
    await screen.type('weight-amount', '6.0');
    await screen.press('save-weight');

    const weights = await listWeights();
    expect(weights).toHaveLength(1);
    expect(weights[0]?.massUg).toBe(Math.round(6.0 * 453_592_370));
  });

  /**
   * A group of one has nothing to choose between, and "1 of 1 weighed" is a
   * screen being pleased with itself.
   */
  it('offers a group of one a single box and no picker', async () => {
    await aGroup({ count: 1 });
    const screen = await mount(<WeighScreen {...routeProps({ groupId: GROUP })} />);

    expect(screen.text()).not.toContain('How are you weighing them?');
    await screen.type('weight-amount', '6.4');
    await screen.press('save-weight');

    const weights = await listWeights();
    expect(weights).toHaveLength(1);
    expect(weights[0]?.sampled).toBeUndefined();
  });

  /** A quart and a cup, on the default imperial farm, stored as millilitres. */
  it('logs milk through the tally', async () => {
    await aGroup({ species: 'goat', purposes: ['milk'] });
    const screen = await mount(<ProduceScreen {...routeProps({ groupId: GROUP })} />);

    await screen.press('tally-plus-32');
    await screen.press('tally-plus-8');
    await screen.press('tally-commit');

    // 40 fl oz. Rounded to whole millilitres because the schema takes an int.
    expect((await produceToday()).get(`${GROUP}:milk`)).toMatchObject({ amount: 1183, unit: 'ml' });
  });

  /**
   * The five-gallon morning, which is what the typed door exists for.
   *
   * Twenty taps of `+32` is the same record and nobody would ever produce it,
   * so a herd's total simply never got logged. R5 allows the keyboard exactly
   * here — "unless the value can exceed 99".
   */
  it('takes a herd-sized milking as a typed number', async () => {
    await aGroup({ species: 'goat', purposes: ['milk'] });
    const screen = await mount(<ProduceScreen {...routeProps({ groupId: GROUP })} />);

    await screen.press('tally-type');
    await screen.type('tally-typed', '640');
    await screen.press('tally-commit');

    // 640 fl oz — five US gallons — in millilitres.
    expect((await produceToday()).get(`${GROUP}:milk`)).toMatchObject({ amount: 18_927, unit: 'ml' });
  });

  /**
   * The steps do not leave when the field arrives, and this is the reason
   * they do not: a typed total that then needs one more pull should be one
   * tap, not a retype. Both controls move the same count.
   */
  it('lets the steps carry on from a typed number', async () => {
    await aGroup({ species: 'goat', purposes: ['milk'] });
    const screen = await mount(<ProduceScreen {...routeProps({ groupId: GROUP })} />);

    await screen.press('tally-type');
    await screen.type('tally-typed', '600');
    await screen.press('tally-plus-32');

    // The field shows what the tap did, rather than the two disagreeing.
    expect(screen.shows('tally-typed')).toBe('632');
  });

  /**
   * A slipped keystroke is forever in an append-only log, so the count sticks
   * visibly at the cap rather than writing a farm six hundred thousand
   * fluid ounces of milk.
   */
  it('refuses a fat-fingered number rather than recording it', async () => {
    await aGroup({ species: 'goat', purposes: ['milk'] });
    const screen = await mount(<ProduceScreen {...routeProps({ groupId: GROUP })} />);

    await screen.press('tally-type');
    await screen.type('tally-typed', '64000000');

    expect(screen.shows('tally-typed')).toBe('999999');
  });

  it('logs a feed in scoops and stores grams', async () => {
    await aGroup();
    const screen = await mount(<FeedScreen {...routeProps({ groupId: GROUP })} />);

    await screen.press('tally-plus-2');
    await screen.press('tally-commit');

    expect((await lastFedByGroup()).get(GROUP)).toBeDefined();
  });

  it('takes a bale-sized feed as a typed number', async () => {
    await aGroup();
    const screen = await mount(<FeedScreen {...routeProps({ groupId: GROUP })} />);

    await screen.pressLabel('Pounds');
    await screen.press('tally-type');
    await screen.type('tally-typed', '60');
    await screen.press('tally-commit');

    const [fed] = await localStore().readRecordsByEntity('feedLog');
    expect(fed?.value).toMatchObject({ amountGrams: 60 * 454 });
  });

  /**
   * The ration — the last of the four entities that had a schema, a sync path
   * and a server applier and nothing that could write one.
   */
  it('sets a ration, then supersedes it rather than rewriting it', async () => {
    await aGroup({ species: 'goat', count: 4, purposes: ['milk'] });
    const first = await mount(<FeedPlanScreen {...routeProps({ groupId: GROUP })} />);

    await first.type('plan-feed', 'Goat mix');
    // Ounces on the default imperial farm.
    await first.type('plan-amount', '16');
    await first.press('save-plan');
    first.unmount();

    const plans = await currentFeedPlans();
    expect(plans.get(GROUP)).toMatchObject({ feedName: 'Goat mix' });
    // A pound each, in micrograms.
    expect(plans.get(GROUP)?.perAnimalPerDayUg).toBe(poundsToUg(1));

    const second = await mount(<FeedPlanScreen {...routeProps({ groupId: GROUP })} />);
    await second.type('plan-feed', 'Winter mix');
    await second.type('plan-amount', '24');
    await second.press('save-plan');
    second.unmount();

    /**
     * One ration in force, not two — and the old row is still on disk, ended.
     * A cost read over last season has to use last season's figure, which is
     * the same reason `feedLog` stamps its own cost at log time.
     */
    const after = await currentFeedPlans();
    expect(after.size).toBe(1);
    expect(after.get(GROUP)).toMatchObject({ feedName: 'Winter mix' });
    expect(await localStore().readRecordsByEntity('feedPlan')).toHaveLength(2);
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

    /**
     * Nothing is recordable until a number is entered.
     *
     * The stepper starts at zero everywhere a count is being built up, so
     * pressing Save straight away must do nothing — the alternative is
     * recording the death of an animal nobody counted.
     */
    expect(screen.get('save-loss').props['accessibilityState']).toMatchObject({ disabled: true });

    await screen.press('step-minus-1');
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

  /**
   * The set date is what a keeper does arithmetic *from*; the day count is
   * the answer they were doing it for, so the screen does the counting.
   */
  it('says which day a running set is on, and stops once it hatches', async () => {
    const id = newId();
    await enqueue({
      entity: 'incubation',
      op: 'create',
      targetId: id,
      payload: {
        species: 'chicken',
        label: 'The Sussex set',
        // Under seventeen days ago, so today is day 18 — lockdown.
        setAt: Date.now() - 17 * 86_400_000,
        eggsSet: 12,
        source: 'own',
        method: 'incubator',
      },
    });

    const running = await mount(<IncubationScreen {...routeProps({ incubationId: id })} />);
    expect(running.text()).toContain('Day 18 of 21');
    expect(running.text()).toContain('stop turning');
    // The one figure it must never invent, on the day somebody would want it.
    expect(running.text()).not.toMatch(/humidity/i);
    running.unmount();

    await enqueue({
      entity: 'incubation',
      op: 'update',
      targetId: id,
      payload: { hatchedAt: Date.now(), hatched: 10 },
    });

    // A day count is not history. What happened is, and the panel below says it.
    const done = await mount(<IncubationScreen {...routeProps({ incubationId: id })} />);
    expect(done.text()).not.toContain('Day 18 of 21');
    // Loosely spaced: `text()` joins each rendered string, so the percent
    // sign arrives as its own node.
    expect(done.text()).toMatch(/83\s*%\s*hatched/);
  });

  it('sets eggs, candles them, then hatches them', async () => {
    const setter = await mount(<SetEggsScreen />);
    await setter.type('incubation-label', 'The Sussex set');
    // A dozen, entered rather than assumed — the stepper starts at nothing.
    await setter.press('step-plus-12');
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

  /**
   * "I have it done, does nothing, it doesn't clear the task."
   *
   * The test above types into the meter field, and so did every other test
   * that has ever exercised this screen — which is precisely why nobody caught
   * it. **A farm does not type into it.** The field shows the machine's
   * current reading as a placeholder, so the box looks filled in and tapping
   * straight past it is the obvious move.
   *
   * An empty field wrote no `lastDoneAtHours`, `serviceDue` counts from
   * `(lastDoneAtHours ?? 0) + everyHours`, and a 100-hour interval on a
   * machine at 110 hours stayed overdue the instant it was marked done. The
   * date half landed, so the screen said "Last done August 11" while the farm
   * list still demanded it — everything recorded, nothing changed.
   */
  it('takes the meter reading on screen when nobody types one', async () => {
    const add = await mount(<AddMachineScreen />);
    await add.type('machine-name', 'The tractor');
    await add.press('save-machine');
    const [machine] = await listMachines();

    const hours = await mount(<LogHoursScreen {...routeProps({ machineId: machine!.id })} />);
    await hours.press('tally-plus-100');
    await hours.press('tally-plus-10');
    await hours.press('tally-commit');
    expect((await listMachines())[0]?.hours).toBe(110);

    const service = await mount(<AddServiceScreen {...routeProps({ machineId: machine!.id })} />);
    await service.pressLabel('Oil and filter');
    await service.press('save-service');
    const [schedule] = await listServices();

    // Straight to the button, past a field showing 110 in grey.
    const done = await mount(<ServiceDoneScreen {...routeProps({ serviceId: schedule!.id })} />);
    await done.press('save-done');

    const [closed] = await listServices();
    expect(closed?.lastDoneAtHours).toBe(110);

    // The whole point of recording it: the next one is 210, not 100.
    const due = serviceDue(
      { id: machine!.id, name: 'The tractor', hasHourMeter: true, hours: 110, usagePerDay: null },
      { id: schedule!.id, name: 'Oil and filter', everyHours: 100, lastDoneAtHours: closed?.lastDoneAtHours },
      Date.now(),
    );
    expect(due?.atReading).toBe(210);
  });

  /**
   * And it lands in What happened, which is the other half of the report.
   *
   * `serviceCompletion` rather than `maintenance`: the schedule is still the
   * mutable thing somebody edits, and the doing of it is an append-only event,
   * so six springs of oil changes are six rows rather than one overwritten
   * date. See `entities/completions.ts`.
   */
  it('puts a finished service in history', async () => {
    const add = await mount(<AddMachineScreen />);
    await add.type('machine-name', 'The tractor');
    await add.press('save-machine');
    const [machine] = await listMachines();

    const service = await mount(<AddServiceScreen {...routeProps({ machineId: machine!.id })} />);
    await service.pressLabel('Oil and filter');
    await service.press('save-service');
    const [schedule] = await listServices();

    const done = await mount(<ServiceDoneScreen {...routeProps({ serviceId: schedule!.id })} />);
    await done.press('save-done');

    const events = (await listHistory()).flatMap((day) => day.events);
    const serviced = events.find((event) => event.entity === 'serviceCompletion');

    expect(serviced?.title).toBe('Oil and filter — The tractor');
    expect(serviced?.detail).toContain('Service done');

    // The reason it is an event: doing it again leaves both, where the old
    // field left only the second.
    const again = await mount(<ServiceDoneScreen {...routeProps({ serviceId: schedule!.id })} />);
    await again.press('save-done');

    const after = (await listHistory()).flatMap((day) => day.events);
    expect(after.filter((event) => event.entity === 'serviceCompletion')).toHaveLength(2);
  });

  /**
   * P15, both halves: the preset arrives with a walkaround attached, and the
   * one thing that was not right survives the morning as a job.
   */
  it('carries a checklist onto the schedule and turns a failed check into a job', async () => {
    const add = await mount(<AddMachineScreen />);
    await add.type('machine-name', 'The tractor');
    await add.press('save-machine');
    const [machine] = await listMachines();

    const service = await mount(<AddServiceScreen {...routeProps({ machineId: machine!.id })} />);
    await service.pressLabel('Oil and filter');

    // The farm's own line, added to the preset's rather than instead of them.
    await service.type('service-check', 'Hydraulic hoses');
    await service.press('add-check');
    await service.press('save-service');

    const [schedule] = await listServices();
    expect(schedule?.checks).toEqual([
      'Drain plug and washer',
      'Filter seal seated',
      'Level on the dipstick',
      'Leaks underneath',
      'Hydraulic hoses',
    ]);

    const done = await mount(<ServiceDoneScreen {...routeProps({ serviceId: schedule!.id })} />);
    expect(done.text()).toContain('Filter seal seated');

    await done.pressLabel('Hydraulic hoses');
    await done.type('service-hours', '100');
    await done.press('save-done');

    // The service is closed, so the interval counts from today.
    expect((await listServices())[0]?.lastDoneAtDate).toBeDefined();

    /**
     * One job, for the one check that failed — not five for the five that
     * were looked at. Undated, so it waits on the Jobs list rather than
     * nagging from Today, and tied to the machine it was found on.
     */
    const jobs = await listTasks();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      title: 'Hydraulic hoses — The tractor',
      subjectId: machine!.id,
    });
    expect(jobs[0]?.dueAtDate).toBeUndefined();
  });

  it('raises nothing when the whole walkaround was fine', async () => {
    const add = await mount(<AddMachineScreen />);
    await add.type('machine-name', 'The tractor');
    await add.press('save-machine');
    const [machine] = await listMachines();

    const service = await mount(<AddServiceScreen {...routeProps({ machineId: machine!.id })} />);
    await service.pressLabel('Grease it');
    await service.press('save-service');

    const [schedule] = await listServices();
    const done = await mount(<ServiceDoneScreen {...routeProps({ serviceId: schedule!.id })} />);
    await done.press('save-done');

    // An ordinary morning costs no taps and leaves no jobs behind.
    expect(await listTasks()).toHaveLength(0);
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
    /**
     * One filter, said rather than defaulted.
     *
     * The quantity stepper started at 1, so every entry began by pressing
     * minus — a bag of feed is fifty pounds, never one of anything. It starts
     * at nothing now, which means a count that is saved is a count somebody
     * entered.
     */
    await add.press('item-quantity-plus-1');
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
    // Crops collapse now, so the crop is the first decision and the variety the
    // second — which is how somebody standing at a bed actually chooses.
    await pick.press('crop-Tomato');
    await pick.pressLabel('Sungold');
    await pick.press('plant-it');

    const [planting] = await listPlantings();
    const [variety] = await listVarieties();
    expect(variety?.name).toBe('Sungold');
    expect(planting).toMatchObject({ bedId: added!.id, status: 'planned' });

    /**
     * Straight to picking, with nothing pressed to announce it.
     *
     * There used to be an "It is ready — start picking" button here and this
     * test pressed it. It is gone, because `HarvestScreen` already moves the
     * planting to `harvesting` on the first pick — so the button did by hand
     * what picking does by happening, and two controls meaning "it is harvest
     * time" is a screen asking to be told something it is about to find out.
     *
     * Asserting the status *after* the pick is the stronger test: it proves the
     * thing the button was standing in for still happens without it.
     */
    const harvest = await mount(<HarvestScreen {...routeProps({ plantingId: planting!.id })} />);
    await harvest.type('harvest-mass', '4.5');
    await harvest.press('save-harvest');

    const [picked] = await listHarvests();
    expect(picked?.massUg).toBe(Math.round(4.5 * 453_592_370));
    expect((await listPlantings())[0]?.status).toBe('harvesting');
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
    await screen.press('crop-Tomato');
    await screen.pressLabel('Sungold');
    // Warns, never blocks — the button is still there.
    expect(screen.has('plant-it')).toBe(true);
  });
});

describe('navigation out of a screen', () => {
  it('goes back once the work is durable', async () => {
    await aGroup({ count: 6 });
    const screen = await mount(<WeighScreen {...routeProps({ groupId: GROUP })} />);

    // A box per animal is the default for a group this size, so the weighing
    // goes in a box rather than the single field.
    await screen.type('weight-box-0', '6.4');
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

/**
 * "I log a Chick starter on The Shelf but the option to feed my chickens it
 * does not appear. Having to enter this data twice is a time waste."
 *
 * The farm had already named the sack. The feed screen asked them to type it
 * again into a free text box beside a placeholder naming three feeds they do
 * not own — so two spellings of one sack end up in the records and no report
 * can add them up.
 */
describe('feeding from the shelf', () => {
  async function aSack(name: string, unit: string): Promise<void> {
    await enqueue({
      entity: 'inventory',
      op: 'create',
      targetId: newId(),
      payload: { name, kind: 'feed', unit, quantity: 50, reorderBelow: 10 },
    });
  }

  it('offers what is on the shelf, so the name is not typed twice', async () => {
    await aGroup();
    await aSack('Purina Chick Starter', 'lb');

    const screen = await mount(<FeedScreen {...routeProps({ groupId: GROUP })} />);
    await screen.pressLabel('Purina Chick Starter');

    // The name reached the field, so the record carries the farm's own
    // spelling rather than a second one.
    expect(screen.shows('feed-type')).toBe('Purina Chick Starter');
    screen.unmount();
  });

  it('takes the measure from the shelf when it is the same question', async () => {
    await aGroup();
    await aSack('Purina Chick Starter', 'lb');

    const screen = await mount(<FeedScreen {...routeProps({ groupId: GROUP })} />);
    await screen.pressLabel('Purina Chick Starter');
    await screen.press('tally-plus-1');
    await screen.press('tally-commit');
    screen.unmount();

    // One pound, in grams — not one scoop. The shelf said pounds.
    const [fed] = await localStore().readRecordsByEntity('feedLog');
    expect(fed?.value).toMatchObject({ feedType: 'Purina Chick Starter', amountGrams: 454 });
  });

  /**
   * A bale says nothing about how much goes in a trough, so it must not
   * silently reinterpret the scoop the person is about to count.
   */
  it('leaves the measure alone when the shelf unit is not a feed measure', async () => {
    await aGroup();
    await aSack('Meadow hay', 'bale');

    const screen = await mount(<FeedScreen {...routeProps({ groupId: GROUP })} />);
    await screen.pressLabel('Meadow hay');
    await screen.press('tally-plus-1');
    await screen.press('tally-commit');
    screen.unmount();

    // Still a scoop, the default.
    const [fed] = await localStore().readRecordsByEntity('feedLog');
    expect(fed?.value).toMatchObject({ feedType: 'Meadow hay', amountGrams: 907 });
  });

  /** Only feed. A box of syringes is not something anybody puts in a trough. */
  it('offers only what is feed', async () => {
    await aGroup();
    await aSack('Purina Chick Starter', 'lb');
    await enqueue({
      entity: 'inventory',
      op: 'create',
      targetId: newId(),
      payload: { name: 'Syringes', kind: 'medicine', unit: 'each', quantity: 20 },
    });

    const screen = await mount(<FeedScreen {...routeProps({ groupId: GROUP })} />);
    const offered = screen.labels();

    expect(offered).toContain('Purina Chick Starter');
    expect(offered).not.toContain('Syringes');
    screen.unmount();
  });
});

/**
 * "If it's chick food… it's not for goats, well in most cases."
 *
 * The hedge is the design. A keeper who puts chick crumb in front of a poorly
 * bantam, or scratch in front of the goats because it is the sack that is
 * open, is doing an ordinary thing — so the shelf sorts and never argues.
 */
describe('who the feed is for', () => {
  async function aSackFor(name: string, species?: string[]): Promise<void> {
    await enqueue({
      entity: 'inventory',
      op: 'create',
      targetId: newId(),
      payload: {
        name,
        kind: 'feed',
        unit: 'lb',
        quantity: 50,
        ...(species === undefined ? {} : { species }),
      },
    });
  }

  it('records who a feed is for', async () => {
    await aGroup();
    const screen = await mount(<AddItemScreen {...routeProps({})} />);

    await screen.type('item-name', 'Purina Chick Starter');
    await screen.press('item-species-chicken');
    await screen.press('save-item');
    screen.unmount();

    const [item] = await listInventory();
    expect(item).toMatchObject({ name: 'Purina Chick Starter', species: ['chicken'] });
  });

  /** Nineteen chips for animals nobody owns is a list that gets skipped. */
  it('offers only the species the farm keeps', async () => {
    await aGroup();
    const screen = await mount(<AddItemScreen {...routeProps({})} />);

    expect(screen.has('item-species-chicken')).toBe(true);
    expect(screen.has('item-species-goat')).toBe(false);
    screen.unmount();
  });

  it('puts their feed first without hiding the rest', async () => {
    await aGroup();
    await aSackFor('Goat Mix', ['goat']);
    await aSackFor('Chick Starter', ['chicken']);

    const screen = await mount(<FeedScreen {...routeProps({ groupId: GROUP })} />);
    const offered = screen.labels();

    // Both reachable — the goats' sack is still a thing you can put in front
    // of a hen if it is what is open.
    expect(offered).toContain('Chick Starter');
    expect(offered).toContain('Goat Mix');
    expect(offered.indexOf('Chick Starter')).toBeLessThan(offered.indexOf('Goat Mix'));
    screen.unmount();
  });

  /**
   * An unanswered question is not a statement that the sack is for something
   * else — and every item on every shelf predates the field.
   */
  it('treats feed with nobody named as theirs, not as somebody else’s', async () => {
    await aGroup();
    await aSackFor('Goat Mix', ['goat']);
    await aSackFor('Scratch grain');

    const screen = await mount(<FeedScreen {...routeProps({ groupId: GROUP })} />);
    const offered = screen.labels();

    expect(offered.indexOf('Scratch grain')).toBeLessThan(offered.indexOf('Goat Mix'));
    screen.unmount();
  });
});

/**
 * "The set-eggs screen does not list breeds. Each is a little different I
 * assume?"
 *
 * Not for the dates — see the note on `incubationShape.breedId`. Incubation
 * length is a species property and hardly a breed one at all, and a per-breed
 * table would be inventing precision.
 *
 * It matters for what comes out. The library knows when a Rhode Island Red
 * starts to lay; without this the hatch produces chicks the app can say
 * nothing about, and the eggs were the last moment anybody knew for certain
 * what they were.
 */
describe('what is under the broody', () => {
  it('records the breed with the set', async () => {
    const screen = await mount(<SetEggsScreen />);

    await screen.press('incubation-breed-chicken-rhode-island-red');
    await screen.press('step-plus-12');
    await screen.press('save-incubation');
    screen.unmount();

    const [set] = await listIncubations();
    expect(set).toMatchObject({ species: 'chicken', breedId: 'chicken-rhode-island-red' });
  });

  /** Optional, and it must be: a bought set is often genuinely mixed. */
  it('sets them without one', async () => {
    const screen = await mount(<SetEggsScreen />);

    await screen.press('step-plus-12');
    await screen.press('save-incubation');
    screen.unmount();

    const [set] = await listIncubations();
    expect(set?.species).toBe('chicken');
    expect(set?.breedId).toBeUndefined();
  });

  /**
   * The same bug the group screen already had: a breed left set across a
   * species change is invisible, because the chip that showed it is gone.
   */
  it('drops a breed the new species cannot be', async () => {
    const screen = await mount(<SetEggsScreen />);

    await screen.press('incubation-breed-chicken-rhode-island-red');
    await screen.pressLabel('Ducks');
    await screen.press('step-plus-12');
    await screen.press('save-incubation');
    screen.unmount();

    const [set] = await listIncubations();
    expect(set?.species).toBe('duck');
    expect(set?.breedId).toBeUndefined();
  });
});

/**
 * "Several could be combined into a My Farm button — the flock, planting and
 * iron set-up could all be an option in a small menu. It adds a press but
 * cleans up the home screen."
 *
 * Right, and it dissolved a problem rather than trading against it: the bar
 * was full, What happened needed a place, and this made room without amending
 * the four-tab rule.
 */
describe('the farm hub', () => {
  it('offers each part of the farm the keeper runs', async () => {
    const screen = await mount(<FarmScreen />);

    // A farm that has never been asked runs everything.
    for (const key of ['stock', 'growing', 'iron']) {
      expect(screen.has(`farm-${key}`), key).toBe(true);
    }
    screen.unmount();
  });

  it('hides what the farm does not run', async () => {
    await enqueue({
      entity: 'site',
      op: 'create',
      targetId: newId(),
      payload: { name: 'Hollow Farm', enterprises: ['stock'] },
    });

    const screen = await mount(<FarmScreen />);

    expect(screen.has('farm-stock')).toBe(true);
    expect(screen.has('farm-growing')).toBe(false);
    expect(screen.has('farm-iron')).toBe(false);
    screen.unmount();
  });

  /**
   * The dead end that has to not exist: a farm with everything switched off
   * needs somewhere obvious to switch it back on.
   */
  it('keeps a way back in when everything is switched off', async () => {
    await enqueue({
      entity: 'site',
      op: 'create',
      targetId: newId(),
      payload: { name: 'Hollow Farm', enterprises: [] },
    });

    const screen = await mount(<FarmScreen />);

    expect(screen.has('farm-my-farm')).toBe(true);
    expect(screen.text()).toContain('Nothing switched on yet');
    screen.unmount();
  });
});

/**
 * The clip.
 *
 * The app has offered fibre as a purpose since purposes existed and had
 * nowhere to record the one event that purpose is about. A keeper who ticked
 * fibre was promised something that did not exist.
 */
describe('shearing', () => {
  async function fibreGoats(): Promise<void> {
    await aGroup({ name: 'The angoras', species: 'goat', purposes: ['fibre'], count: 8 });
  }

  it('records a clip in the canonical unit', async () => {
    await fibreGoats();
    const screen = await mount(<ShearingScreen {...routeProps({ groupId: GROUP })} />);

    await screen.type('clip-amount', '7.5');
    await screen.press('save-clip');
    screen.unmount();

    const [clip] = await localStore().readRecordsByEntity('shearing');
    // Pounds typed, micrograms stored — so a farm that switches to metric
    // later reads the same record back exactly rather than approximately.
    expect(clip?.value).toMatchObject({ flockId: GROUP, animalsShorn: 1 });
    expect((clip?.value as { massUg: number }).massUg).toBe(Math.round(7.5 * 453_592_370));
  });

  it('counts how many were shorn, so the per-animal figure means something', async () => {
    await fibreGoats();
    const screen = await mount(<ShearingScreen {...routeProps({ groupId: GROUP })} />);

    await screen.type('clip-amount', '40');
    await screen.press('step-plus-5');
    await screen.press('save-clip');
    screen.unmount();

    const [clip] = await localStore().readRecordsByEntity('shearing');
    expect(clip?.value).toMatchObject({ animalsShorn: 6 });
  });

  /**
   * The same mistake the egg tally made before `productsOf`: a row nobody will
   * ever fill in, offered every time they open the group.
   */
  it('is offered on a fibre group and not on a laying flock', async () => {
    await fibreGoats();
    const fibre = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);
    // The occasional acts live behind More; the four daily ones do not.
    await fibre.press('group-more');
    expect(fibre.has('go-shearing')).toBe(true);
    fibre.unmount();

    await freshStore();
    await aGroup();
    const layers = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);
    await layers.press('group-more');
    expect(layers.has('go-shearing')).toBe(false);
    layers.unmount();
  });

  it('reaches the export and What happened like any other record', async () => {
    await fibreGoats();
    const screen = await mount(<ShearingScreen {...routeProps({ groupId: GROUP })} />);
    await screen.type('clip-amount', '7.5');
    await screen.press('save-clip');
    screen.unmount();

    const { listHistory } = await import('@homefarm/core/read/history');
    const days = await listHistory('imperial');
    expect(days[0]?.events[0]?.title).toContain('Shorn');

    const { buildExport } = await import('@homefarm/core/export/csv');
    expect((await buildExport()).some((s) => s.name === 'shearing')).toBe(true);
  });
});

/**
 * Leaving a screen when there is nothing behind it.
 *
 *   The action 'GO_BACK' was not handled by any navigator.
 *   Is there any screen to go back to?
 *
 * From a tablet, on the first day the app ran on one. Twenty-eight call sites
 * did `nav.goBack()` unguarded after a save — correct in the ordinary case and
 * unguarded in every other.
 *
 * The trigger is device-shaped: a save is awaited, and on a handset an
 * edge-swipe back is the natural way to leave a screen you are done with.
 * Swipe during the save and the screen pops; the save lands a moment later and
 * calls `goBack` on an empty stack. The emulator has the same gesture and
 * nobody uses it, which is why this survived every run until the tablet.
 */
describe('finishing a screen with nothing behind it', () => {
  it('lands on the tabs rather than failing to leave', async () => {
    await aGroup({ count: 6 });
    const screen = await mount(<WeighScreen {...routeProps({ groupId: GROUP })} />);

    // The stack emptied while the save was in flight.
    setBackable(false);

    await screen.type('weight-box-0', '6.4');
    await screen.press('save-weight');

    expect(navCalls()).not.toContainEqual({ action: 'goBack' });
    expect(navCalls()).toContainEqual({ action: 'navigate', route: 'Tabs', params: undefined });
    // And the work still landed, which is the half that must never be traded.
    expect(await listWeights()).toHaveLength(1);
  });

  it('still goes back the ordinary way', async () => {
    await aGroup({ count: 6 });
    const screen = await mount(<WeighScreen {...routeProps({ groupId: GROUP })} />);

    await screen.type('weight-box-0', '6.4');
    await screen.press('save-weight');

    expect(navCalls()).toContainEqual({ action: 'goBack' });
  });
});
