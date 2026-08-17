import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { enqueue } from '@steading/core/sync/queue';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { navCalls } from '../support/native/navigation';
import { AnimalScreen } from '../../apps/mobile/src/screens/AnimalScreen';
import { BedScreen } from '../../apps/mobile/src/screens/BedScreen';
import { GroupScreen } from '../../apps/mobile/src/screens/GroupScreen';
import { MachineScreen } from '../../apps/mobile/src/screens/MachineScreen';
import { TodayScreen } from '../../apps/mobile/src/screens/TodayScreen';

/**
 * What is coming for one thing — the other half of the reusable detail screen.
 *
 * The due engine has composed twelve builders into a farm-wide list since it
 * was written, and exactly one screen ever rendered a row from it. So the app
 * knew a tractor's yearly service was due in November and would not say so on
 * the tractor's own screen, which is the question somebody opens that screen to
 * ask. Nothing here computes anything new; it is the same list, asked a
 * narrower question.
 *
 * Two properties are worth holding still, and each has its own describe block
 * below:
 *
 * **It shows what Today deliberately hides.** `todayList` drops `later` rows
 * because a morning's list that reaches into November is one nobody finishes.
 * That is a judgement about Today rather than about the row, so the panel keeps
 * them — and every test here uses a row far enough out that Today refuses it,
 * because a panel that only repeated Today would be furniture.
 *
 * **It finds the rows that are about a thing without naming it.** `Due.subject`
 * means *where this opens*, which is why a birth names the dam's group rather
 * than the dam. `Due.about` is what the row is actually about, and without it
 * Bramble's screen would have nothing to say while "Bramble due" sat on Today.
 */

const DAY = 86_400_000;
const YEAR = new Date().getFullYear();

const GROUP = newId();
const ANIMAL = newId();
const MACHINE = newId();
const SITE = newId();
const BED = newId();
const VARIETY = newId();
const PLANTING = newId();

async function theGoats(): Promise<void> {
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: { name: 'The does', species: 'goat', count: 4, purposes: ['milk'] },
  });
  await enqueue({
    entity: 'animal',
    op: 'create',
    targetId: ANIMAL,
    payload: { flockId: GROUP, name: 'Bramble', species: 'goat', sex: 'female' },
  });
}

/**
 * A tractor with a yearly service done this morning.
 *
 * Due in a year against three weeks of notice, so it is `later` and Today will
 * not draw it. That is the whole point of the fixture.
 */
async function theTractor(): Promise<string> {
  const service = newId();
  await enqueue({
    entity: 'equipment',
    op: 'create',
    targetId: MACHINE,
    payload: { name: 'The tractor' },
  });
  await enqueue({
    entity: 'maintenance',
    op: 'create',
    targetId: service,
    payload: {
      equipmentId: MACHINE,
      title: 'Oil and filter',
      intervalDays: 365,
      lastDoneAtDate: Date.now(),
    },
  });
  return service;
}

/** A bed with something sown in it this morning, ready in seventy-five days. */
async function theGarden(): Promise<void> {
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
  await enqueue({
    entity: 'planting',
    op: 'create',
    targetId: PLANTING,
    payload: {
      bedId: BED,
      varietyId: VARIETY,
      season: YEAR,
      status: 'in-ground',
      sownAt: Date.now(),
    },
  });
}

/** The last `navigate` a screen asked for. */
function wentTo(): { route?: string; params?: unknown } | undefined {
  const navigations = navCalls().filter((call) => call.action === 'navigate');
  return navigations[navigations.length - 1];
}

beforeEach(async () => {
  await freshStore();
  navCalls().length = 0;
});

describe('a schedule too far off for Today', () => {
  it('is on the machine it belongs to', async () => {
    const service = await theTractor();

    const today = await mount(<TodayScreen />);
    expect(today.text()).not.toContain('Oil and filter');
    today.unmount();

    const screen = await mount(<MachineScreen {...routeProps({ machineId: MACHINE })} />);
    expect(screen.text()).toContain('Oil and filter');
    expect(screen.has(`due-${MACHINE}:service:${service}`)).toBe(true);
    screen.unmount();
  });

  /**
   * A service row resolves to its machine, so on the machine's own screen the
   * chevron would reload the screen somebody is standing on. `DueRow` renders
   * the unpressable branch as `accessibilityRole: 'text'`, which is how a row
   * that deliberately goes nowhere is told from one that is missing.
   */
  it('is not a door back to the screen it is already on', async () => {
    const service = await theTractor();

    const screen = await mount(<MachineScreen {...routeProps({ machineId: MACHINE })} />);

    expect(screen.get(`due-${MACHINE}:service:${service}`).props.accessibilityRole).toBe('text');
    screen.unmount();
  });

  it('says so in words when a thing owes nothing', async () => {
    await enqueue({
      entity: 'equipment',
      op: 'create',
      targetId: MACHINE,
      payload: { name: 'The mower' },
    });

    const screen = await mount(<MachineScreen {...routeProps({ machineId: MACHINE })} />);

    expect(screen.text()).toContain('Nothing is due for this');
    screen.unmount();
  });
});

/**
 * Nothing is ever due for a bed — a `planting` is what carries the dates, the
 * same way a `harvest` names a planting rather than the bed it came out of. The
 * bed passes itself and its plantings, which is the hop `Timeline` already
 * makes, made by the screen that means it.
 */
describe('a bed, which has no dues of its own', () => {
  it('shows what its plantings want', async () => {
    await theGarden();

    const today = await mount(<TodayScreen />);
    expect(today.text()).not.toContain('should be ready');
    today.unmount();

    const screen = await mount(<BedScreen {...routeProps({ bedId: BED })} />);
    expect(screen.text()).toContain('Roma should be ready in Bed three');
    screen.unmount();
  });

  /**
   * And here the row IS a door, because the planting is not this screen. The
   * `here` guard drops a row that would reload the screen it is drawn on and
   * nothing else.
   */
  it('opens the planting the row is about', async () => {
    await theGarden();

    const screen = await mount(<BedScreen {...routeProps({ bedId: BED })} />);
    await screen.press(`due-${PLANTING}:harvest`);
    screen.unmount();

    expect(wentTo()?.route).toBe('Planting');
    expect(wentTo()?.params).toEqual({ plantingId: PLANTING });
  });
});

/**
 * The rows whose `subject` points somewhere other than what they are about.
 *
 * Three builders do this, all for the same good reason — `subject` is what
 * opens the row — and all three would be invisible to a panel that filtered on
 * it alone.
 */
describe('a row about something it does not name', () => {
  /**
   * `birthDue` names the dam's GROUP, because an animal id in a `groupId` slot
   * rendered "That group — Missing" on a live row. Her own screen finds it
   * through `about`, and does not inherit the group's husbandry list with it.
   */
  it('puts a dam in kid on her own screen, and not the group’s whole routine', async () => {
    await theGoats();
    await enqueue({
      entity: 'breeding',
      op: 'create',
      targetId: newId(),
      payload: {
        damId: ANIMAL,
        species: 'goat',
        method: 'natural',
        // Ten days gone of a hundred and fifty, so Today will not draw it.
        bredAt: Date.now() - 10 * DAY,
      },
    });

    const today = await mount(<TodayScreen />);
    expect(today.text()).not.toContain('Bramble due');
    today.unmount();

    const screen = await mount(<AnimalScreen {...routeProps({ animalId: ANIMAL })} />);

    expect(screen.text()).toContain('Bramble due');
    // Her group's husbandry is about the herd, not about her.
    expect(screen.text()).not.toContain('Look over');
    screen.unmount();
  });

  /** And it still opens where a birth is discharged. */
  it('opens her group’s breeding book from her screen', async () => {
    await theGoats();
    const breeding = newId();
    await enqueue({
      entity: 'breeding',
      op: 'create',
      targetId: breeding,
      payload: { damId: ANIMAL, species: 'goat', method: 'natural', bredAt: Date.now() - 10 * DAY },
    });

    const screen = await mount(<AnimalScreen {...routeProps({ animalId: ANIMAL })} />);
    await screen.press(`due-${breeding}:birth`);
    screen.unmount();

    expect(wentTo()?.route).toBe('Breeding');
    expect(wentTo()?.params).toEqual({ groupId: GROUP });
  });

  /**
   * A chore names itself, because it clears on its own `completedAt` rather
   * than on anything the group does — the one authored kind. It is still the
   * group's job, and the group's screen is where somebody looks for it.
   */
  it('puts a chore pinned to a group on that group’s screen', async () => {
    await theGoats();
    await enqueue({
      entity: 'task',
      op: 'create',
      targetId: newId(),
      payload: {
        title: 'Move the fence',
        recurrence: 'none',
        // Three days of notice, so a fortnight out is not on Today.
        dueAtDate: Date.now() + 14 * DAY,
        subjectId: GROUP,
      },
    });

    const today = await mount(<TodayScreen />);
    expect(today.text()).not.toContain('Move the fence');
    today.unmount();

    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);
    expect(screen.text()).toContain('Move the fence');
    screen.unmount();
  });
});
