import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@homefarm/contracts';
import { listAnimals } from '@homefarm/core/read/animals';
import { listBeds, listPlantings, listVarieties } from '@homefarm/core/read/growing';
import { listInventory, listMachines } from '@homefarm/core/read/iron';
import { localStore } from '@homefarm/core/db/store';
import { enqueue } from '@homefarm/core/sync/queue';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { EditAnimalScreen } from '../../apps/mobile/src/screens/EditAnimalScreen';
import { EditBedScreen } from '../../apps/mobile/src/screens/EditBedScreen';
import { EditVarietyScreen } from '../../apps/mobile/src/screens/EditVarietyScreen';
import { EditMachineScreen } from '../../apps/mobile/src/screens/EditMachineScreen';
import { EditItemScreen } from '../../apps/mobile/src/screens/EditItemScreen';
import { EditPlantingScreen } from '../../apps/mobile/src/screens/EditPlantingScreen';

/**
 * Changing a record after it exists, and taking it out of the lists.
 *
 * `DESIGN-BRIEF.md` calls the edit half the largest gap in the product:
 * sixteen entities are mutable in the contract and the app could change one of
 * them. A doe's tag was whatever was typed the first time; a ram recorded
 * female was offered for breeding for ever, because `possibleDams` reads sex;
 * a tunnel recorded as open ground raised frost alarms all spring for plants
 * in no danger.
 *
 * Two properties run through all of it. **Archived, never deleted** (P13) — the
 * records stay and the row leaves the lists. And **clearing works**, which is
 * new: `contracts/clearing.ts` gave the wire a `null` meaning *remove this*, so
 * a band that came off can actually be taken off rather than only replaced.
 */

const GROUP = newId();
const ANIMAL = newId();
const SITE = newId();
const BED = newId();
const VARIETY = newId();

const YEAR = new Date().getFullYear();

async function aFarm(): Promise<void> {
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: { name: 'The goats', species: 'goat', count: 4 },
  });
  await enqueue({
    entity: 'animal',
    op: 'create',
    targetId: ANIMAL,
    payload: { flockId: GROUP, name: 'Bramble', species: 'goat', sex: 'female', tag: 'UK7' },
  });
  await enqueue({
    entity: 'site',
    op: 'create',
    targetId: SITE,
    payload: {
      name: 'The garden',
      frost: { lastSpring: 515, firstAutumn: 1005, source: 'entered' },
    },
  });
  await enqueue({
    entity: 'bed',
    op: 'create',
    targetId: BED,
    payload: { siteId: SITE, name: 'Bed three', covered: false },
  });
  await enqueue({
    entity: 'variety',
    op: 'create',
    targetId: VARIETY,
    payload: {
      name: 'Roma',
      crop: 'Tomato',
      family: 'solanaceae',
      lifecycle: 'annual',
      daysToMaturity: 75,
    },
  });
}

/** What actually left the device, after the round trip that used to lose a clear. */
async function lastPayload(entity: string): Promise<Record<string, unknown>> {
  const outbox = await localStore().readOutboxBySeq();
  const last = outbox.filter((m) => m.entity === entity && m.op === 'update').pop();
  return JSON.parse(JSON.stringify(last?.payload)) as Record<string, unknown>;
}

beforeEach(async () => {
  await freshStore();
  await aFarm();
});

describe('changing an animal', () => {
  it('renames her', async () => {
    const screen = await mount(<EditAnimalScreen {...routeProps({ animalId: ANIMAL })} />);

    await screen.type('edit-animal-name', 'Bramble II');
    await screen.press('save-animal');
    screen.unmount();

    expect((await listAnimals())[0]?.name).toBe('Bramble II');
  });

  /**
   * The one that is not cosmetic. `possibleDams` reads sex, so a ram recorded
   * female is offered for breeding until this screen exists.
   */
  it('corrects a sex that was recorded wrong', async () => {
    const screen = await mount(<EditAnimalScreen {...routeProps({ animalId: ANIMAL })} />);

    await screen.pressLabel('Male');
    await screen.press('save-animal');
    screen.unmount();

    expect((await listAnimals())[0]?.sex).toBe('male');
  });

  /**
   * A band that came off, taken off the record. Before the wire had a word for
   * cleared this could be replaced and never emptied.
   */
  it('takes a tag off, and says so on the wire', async () => {
    const screen = await mount(<EditAnimalScreen {...routeProps({ animalId: ANIMAL })} />);

    await screen.type('edit-animal-tag', '');
    await screen.press('save-animal');
    screen.unmount();

    expect((await listAnimals())[0]?.tag).toBeUndefined();

    const sent = await lastPayload('animal');
    expect(sent).toHaveProperty('tag');
    expect(sent.tag).toBeNull();
  });

  it('puts her away without losing anything', async () => {
    await enqueue({
      entity: 'weight',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: Date.now(), animalId: ANIMAL, massUg: 54_000_000_000 },
    });

    const screen = await mount(<EditAnimalScreen {...routeProps({ animalId: ANIMAL })} />);
    await screen.press('archive-animal');
    await screen.press('archive-animal');
    screen.unmount();

    expect(await listAnimals()).toEqual([]);

    // Archived, never deleted (P13): the weight is still on the device.
    const records = await localStore().readRecordsByEntity('weight');
    expect(records.filter((r) => !r.deleted)).toHaveLength(1);
  });

  /**
   * The app cannot tell a sale from a death and must not imply it has recorded
   * one. §4's outcome flow is what will ask.
   */
  it('says it records that she is gone and not why', async () => {
    const screen = await mount(<EditAnimalScreen {...routeProps({ animalId: ANIMAL })} />);

    expect(screen.text()).toContain('not why');
    screen.unmount();
  });
});

describe('changing a bed', () => {
  /**
   * `covered` drives the frost warning. A tunnel recorded as open ground
   * raises alarms all spring for plants in no danger, and a farm that learns
   * to ignore frost warnings is the failure this app can least afford.
   */
  it('corrects whether it is under cover', async () => {
    const screen = await mount(<EditBedScreen {...routeProps({ bedId: BED })} />);

    await screen.pressLabel('Under cover');
    await screen.press('save-bed');
    screen.unmount();

    expect((await listBeds())[0]?.covered).toBe(true);
  });

  it('takes it out of use when it is empty', async () => {
    const screen = await mount(<EditBedScreen {...routeProps({ bedId: BED })} />);

    await screen.press('archive-bed');
    await screen.press('archive-bed');
    screen.unmount();

    expect(await listBeds()).toEqual([]);
  });

  /**
   * The one guard worth having. Archiving a bed with a crop in it takes the
   * crop off every growing screen while it is still in the ground, and the
   * harvest that follows has nowhere to be logged.
   */
  it('refuses while something is still growing in it, and says what to do', async () => {
    await enqueue({
      entity: 'planting',
      op: 'create',
      targetId: newId(),
      payload: { bedId: BED, varietyId: VARIETY, season: YEAR, status: 'in-ground' },
    });

    const screen = await mount(<EditBedScreen {...routeProps({ bedId: BED })} />);

    expect(screen.has('archive-bed')).toBe(false);
    expect(screen.text()).toContain('still growing');
    screen.unmount();

    expect(await listBeds()).toHaveLength(1);
  });
});

describe('changing a variety', () => {
  /**
   * The library is a starting point and the farm is the authority about the
   * farm — the same argument the grow-out clock makes for `processAtWeeks`.
   */
  it('takes the farm own days to maturity over the library figure', async () => {
    const screen = await mount(<EditVarietyScreen {...routeProps({ varietyId: VARIETY })} />);

    await screen.press('edit-variety-days-plus-25');
    await screen.press('save-variety');
    screen.unmount();

    expect((await listVarieties())[0]?.daysToMaturity).toBeGreaterThan(75);
  });

  it('renames it', async () => {
    const screen = await mount(<EditVarietyScreen {...routeProps({ varietyId: VARIETY })} />);

    await screen.type('edit-variety-name', 'Roma VF');
    await screen.press('save-variety');
    screen.unmount();

    expect((await listVarieties())[0]?.name).toBe('Roma VF');
  });

  /**
   * A variety is a description rather than a place, so dropping one that has
   * been planted is allowed — the plantings go on reading normally and it
   * simply stops being offered.
   */
  it('drops one that has been planted, leaving the plantings alone', async () => {
    await enqueue({
      entity: 'planting',
      op: 'create',
      targetId: newId(),
      payload: { bedId: BED, varietyId: VARIETY, season: YEAR, status: 'in-ground' },
    });

    const screen = await mount(<EditVarietyScreen {...routeProps({ varietyId: VARIETY })} />);
    await screen.press('archive-variety');
    await screen.press('archive-variety');
    screen.unmount();

    expect(await listVarieties()).toEqual([]);
    expect(await listPlantings()).toHaveLength(1);
  });
});

const MACHINE = newId();
const ITEM = newId();
const PLANTING = newId();

async function ironAndShelf(): Promise<void> {
  await enqueue({
    entity: 'equipment',
    op: 'create',
    targetId: MACHINE,
    payload: { name: 'The tractor', make: 'Kubota', serial: 'ABC123', hasHourMeter: true },
  });
  await enqueue({
    entity: 'inventory',
    op: 'create',
    targetId: ITEM,
    payload: { name: 'Oil filter', kind: 'part', unit: 'each', quantity: 2 },
  });
}

describe('changing a machine', () => {
  /**
   * The field that goes on the bill of sale, and the reason the read had to
   * grow: nothing could show a serial, so nothing could offer to fix one.
   */
  it('corrects a serial typed with a digit wrong', async () => {
    await ironAndShelf();

    const screen = await mount(<EditMachineScreen {...routeProps({ machineId: MACHINE })} />);
    await screen.type('edit-machine-serial', 'ABC124');
    await screen.press('save-machine');
    screen.unmount();

    expect((await listMachines())[0]?.serial).toBe('ABC124');
  });

  /**
   * `serviceDue` refuses to build a row it cannot evaluate, so an hours
   * interval on a meterless machine produces nothing at all. Taking the meter
   * off silently stops every hour-based schedule asking — which is how a pump
   * ended up with a 100-hour oil change nobody was ever reminded about.
   */
  it('says which schedules would go quiet before the meter comes off', async () => {
    await ironAndShelf();
    await enqueue({
      entity: 'maintenance',
      op: 'create',
      targetId: newId(),
      payload: { equipmentId: MACHINE, title: 'Oil and filter', intervalHours: 100 },
    });

    const screen = await mount(<EditMachineScreen {...routeProps({ machineId: MACHINE })} />);

    expect(screen.text()).not.toContain('would silence');
    await screen.pressLabel('It has an hour meter');

    expect(screen.text()).toContain('Oil and filter');
    // The harness joins string nodes with a space, so the interpolated
    // singular/plural words leave double gaps in the rendered sentence.
    expect(screen.text().replace(/\s+/g, ' ')).toContain('stops asking');
    screen.unmount();
  });

  it('retires it, and everything recorded stays', async () => {
    await ironAndShelf();
    await enqueue({
      entity: 'hourReading',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: Date.now(), equipmentId: MACHINE, hours: 240 },
    });

    const screen = await mount(<EditMachineScreen {...routeProps({ machineId: MACHINE })} />);
    await screen.press('archive-machine');
    await screen.press('archive-machine');
    screen.unmount();

    expect(await listMachines()).toEqual([]);
    const readings = await localStore().readRecordsByEntity('hourReading');
    expect(readings.filter((r) => !r.deleted)).toHaveLength(1);
  });
});

describe('changing something on the shelf', () => {
  it('corrects the unit it is counted in', async () => {
    await ironAndShelf();

    const screen = await mount(<EditItemScreen {...routeProps({ itemId: ITEM })} />);
    await screen.pressLabel('bag');
    await screen.press('save-item');
    screen.unmount();

    expect((await listInventory())[0]?.unit).toBe('bag');
  });

  /**
   * No guard on a quantity still on the shelf. A part the farm no longer
   * stocks may well have three left in the drawer, and refusing until the
   * count reached zero would teach people to type a zero they do not mean.
   */
  it('takes it off with stock still on it, rather than asking for a false zero', async () => {
    await ironAndShelf();

    const screen = await mount(<EditItemScreen {...routeProps({ itemId: ITEM })} />);
    await screen.press('archive-item');
    await screen.press('archive-item');
    screen.unmount();

    expect(await listInventory()).toEqual([]);
  });
});

describe('changing a planting', () => {
  async function aRow(): Promise<void> {
    await enqueue({
      entity: 'planting',
      op: 'create',
      targetId: PLANTING,
      payload: { bedId: BED, varietyId: VARIETY, season: YEAR, status: 'in-ground' },
    });
  }

  it('records how many went in', async () => {
    await aRow();

    const screen = await mount(<EditPlantingScreen {...routeProps({ plantingId: PLANTING })} />);
    await screen.type('edit-planting-quantity', '24');
    await screen.press('save-planting');
    screen.unmount();

    expect((await listPlantings())[0]?.quantity).toBe(24);
  });

  it('takes a row back out that should not have been recorded', async () => {
    await aRow();

    const screen = await mount(<EditPlantingScreen {...routeProps({ plantingId: PLANTING })} />);
    await screen.press('archive-planting');
    await screen.press('archive-planting');
    screen.unmount();

    expect(await listPlantings()).toEqual([]);
  });

  /**
   * The guard that matters most on this screen. A `harvest` names its planting,
   * and the bed and variety screens reach their harvests *through* the
   * plantings — so archiving one takes four kilos of tomatoes out of the bed's
   * story while the harvest records sit there untouched and unreachable.
   */
  it('refuses once something has been harvested off it, and says to pull it instead', async () => {
    await aRow();
    await enqueue({
      entity: 'harvest',
      op: 'create',
      targetId: newId(),
      payload: {
        occurredAt: Date.now(),
        plantingId: PLANTING,
        unit: 'mass',
        massUg: 4_000_000_000,
      },
    });

    const screen = await mount(<EditPlantingScreen {...routeProps({ plantingId: PLANTING })} />);

    expect(screen.has('archive-planting')).toBe(false);
    expect(screen.text()).toContain('pull it');
    screen.unmount();

    expect(await listPlantings()).toHaveLength(1);
  });
});
