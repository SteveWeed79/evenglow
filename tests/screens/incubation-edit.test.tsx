import { beforeEach, describe, expect, it } from 'vitest';
import { incubationDues, newId } from '@steading/contracts';
import { fertilityRate, hatchRate, listIncubations } from '@steading/core/read/breeding';
import { listHistory } from '@steading/core/read/history';
import { enqueue } from '@steading/core/sync/queue';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { EditIncubationScreen } from '../../apps/mobile/src/screens/EditIncubationScreen';
import { GroupScreen } from '../../apps/mobile/src/screens/GroupScreen';

/**
 * Correcting a set of eggs, and taking one back out.
 *
 * Two of these fields are the app's arithmetic rather than description.
 * `setAt` and `species` are what both dates count from, and `SetEggsScreen`
 * opens on chicken at today — so a duck set entered two days after it went
 * under gets a wrong candling date and a hatch date wrong by a week, and both
 * notices pass silently. `eggsSet` is the denominator of every rate the detail
 * screen prints.
 *
 * And three counts could only ever be written once: the forms that record
 * `fertile`, `hatched` and `earlyLosses` vanish the moment they are filled in,
 * which is right for a screen about what is left to do and meant a mistyped
 * hatch count was permanent.
 */

const DAY = 86_400_000;

const GROUP = newId();
const EGGS = newId();

async function theHens(): Promise<void> {
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: { name: 'The hens', species: 'chicken', count: 6, purposes: ['eggs'] },
  });
}

async function aSet(over: Record<string, unknown> = {}): Promise<void> {
  await enqueue({
    entity: 'incubation',
    op: 'create',
    targetId: EGGS,
    payload: {
      species: 'chicken',
      label: 'Sussex',
      setAt: Date.now() - 10 * DAY,
      eggsSet: 21,
      source: 'own',
      method: 'incubator',
      ...over,
    },
  });
}

async function theSet(): Promise<Awaited<ReturnType<typeof listIncubations>>[number]> {
  const [set] = await listIncubations();
  if (set === undefined) throw new Error('the set went missing');
  return set;
}

beforeEach(async () => {
  await freshStore();
});

describe('the numbers the rates are built on', () => {
  /**
   * Twelve typed as twenty-one makes a good hatch read as 38%, and that
   * percentage is what a keeper diagnoses an incubator by.
   */
  it('corrects a miscounted clutch, and every rate with it', async () => {
    await aSet({ candledAt: Date.now() - 3 * DAY, fertile: 10, hatchedAt: Date.now(), hatched: 8 });

    expect(Math.round((hatchRate(await theSet()) ?? 0) * 100)).toBe(38);

    const screen = await mount(<EditIncubationScreen {...routeProps({ incubationId: EGGS })} />);
    // 21 down to 12. Named steppers, because this form has four of them and
    // that is exactly what `Stepper`'s testID prefix is for.
    for (let i = 0; i < 9; i += 1) await screen.press('eggs-correct');
    await screen.press('save-incubation-edit');
    screen.unmount();

    const after = await theSet();
    expect(after.eggsSet).toBe(12);
    expect(Math.round((hatchRate(after) ?? 0) * 100)).toBe(67);
  });

  /**
   * The hatch form is gone once it has been filled in — correctly, since a
   * finished step is not a job — so this was the only way a fat-fingered count
   * could ever be put right.
   */
  it('corrects a hatch count the detail screen will never ask about again', async () => {
    await aSet({ eggsSet: 12, hatchedAt: Date.now(), hatched: 12 });

    const screen = await mount(<EditIncubationScreen {...routeProps({ incubationId: EGGS })} />);
    expect(screen.text()).toContain('How many hatched?');

    for (let i = 0; i < 4; i += 1) await screen.press('hatched-correct');
    await screen.press('save-incubation-edit');
    screen.unmount();

    expect((await theSet()).hatched).toBe(8);
  });

  /**
   * A set that has not been candled must not gain a `fertile` of nought from a
   * stepper nobody touched — that is a recorded claim that every egg was clear,
   * and `fertilityRate` would print 0%.
   */
  it('does not invent a candling that has not happened', async () => {
    await aSet({ eggsSet: 12 });

    const screen = await mount(<EditIncubationScreen {...routeProps({ incubationId: EGGS })} />);
    expect(screen.text()).not.toContain('fertile at candling');
    await screen.press('save-incubation-edit');
    screen.unmount();

    const after = await theSet();
    expect(after.fertile).toBeUndefined();
    expect(fertilityRate(after)).toBeNull();
  });
});

describe('the two fields the dates are computed from', () => {
  /**
   * Every chicken egg is 21 days and every duck egg is 28. A duck set left on
   * the screen's opening default hatches a week early in the app and nowhere
   * else, and a hatch row that came and went is not one anybody can tell was
   * wrong.
   */
  it('moves both dates when the species was wrong', async () => {
    await aSet({ eggsSet: 12, setAt: Date.now() });

    const before = incubationDues(await theSet(), 'Sussex').find((d) => d.kind === 'hatch');

    const screen = await mount(<EditIncubationScreen {...routeProps({ incubationId: EGGS })} />);
    await screen.pressLabel('Ducks');
    await screen.press('save-incubation-edit');
    screen.unmount();

    const after = incubationDues(await theSet(), 'Sussex').find((d) => d.kind === 'hatch');

    expect((await theSet()).species).toBe('duck');
    expect(Math.round(((after?.at ?? 0) - (before?.at ?? 0)) / DAY)).toBe(7);
  });

  /** And the screen says where they landed, before the save rather than after. */
  it('says the dates back before they are saved', async () => {
    await aSet({ eggsSet: 12, setAt: Date.now() });

    const screen = await mount(<EditIncubationScreen {...routeProps({ incubationId: EGGS })} />);
    const chicken = screen.text();
    await screen.pressLabel('Ducks');
    const duck = screen.text();
    screen.unmount();

    expect(chicken).toContain('Your dates');
    expect(duck).not.toBe(chicken);
  });
});

/**
 * `flockId` — "the group the eggs came from, when they came from this farm" —
 * has been in the schema since it was written, decides whose timeline the hatch
 * appears on, and `SetEggsScreen` never asked for it.
 */
describe('whose eggs they were', () => {
  it('can be said, and puts the hatch on that group’s own story', async () => {
    await theHens();
    await aSet({ eggsSet: 12, hatchedAt: Date.now(), hatched: 8 });

    const before = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);
    expect(before.text()).not.toContain('Sussex eggs hatched');
    before.unmount();

    const screen = await mount(<EditIncubationScreen {...routeProps({ incubationId: EGGS })} />);
    await screen.press(`edit-incubation-flock-${GROUP}`);
    await screen.press('save-incubation-edit');
    screen.unmount();

    const after = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);
    expect(after.text()).toContain('Sussex eggs hatched');
    after.unmount();
  });

  /** A bought box of eggs came from somebody else's birds. */
  it('is not asked about a set that was not this farm’s', async () => {
    await theHens();
    await aSet({ eggsSet: 12, source: 'bought' });

    const screen = await mount(<EditIncubationScreen {...routeProps({ incubationId: EGGS })} />);

    expect(screen.has(`edit-incubation-flock-${GROUP}`)).toBe(false);
    await screen.pressLabel('My own');
    expect(screen.has(`edit-incubation-flock-${GROUP}`)).toBe(true);
    screen.unmount();
  });
});

/**
 * Archiving costs more here than on any other screen, and the screen says so.
 *
 * Everywhere else the record leaves the lists and what was logged against it
 * stays, because those are separate records that merely name it. A set of eggs
 * keeps its whole story on itself, so taking it out takes the hatch out of the
 * farm's history too.
 */
describe('taking a set back out', () => {
  it('warns that the hatch goes with it, once there is one', async () => {
    await aSet({ eggsSet: 12, hatchedAt: Date.now(), hatched: 8 });

    const screen = await mount(<EditIncubationScreen {...routeProps({ incubationId: EGGS })} />);

    expect(screen.text()).toContain('takes the hatch out of What happened');
    screen.unmount();
  });

  it('does not warn about a hatch that has not happened', async () => {
    await aSet({ eggsSet: 12 });

    const screen = await mount(<EditIncubationScreen {...routeProps({ incubationId: EGGS })} />);

    expect(screen.text()).not.toContain('takes the hatch out of What happened');
    expect(screen.text()).toContain('never actually put under');
    screen.unmount();
  });

  /**
   * Allowed, unlike a planting with harvests against it — and the difference is
   * the point. There the harvests would survive unreachable; here nothing is
   * stranded, because the row and the record are the same thing.
   */
  it('goes, and takes its hatch with it', async () => {
    await theHens();
    await aSet({ eggsSet: 12, flockId: GROUP, hatchedAt: Date.now(), hatched: 8 });

    const screen = await mount(<EditIncubationScreen {...routeProps({ incubationId: EGGS })} />);
    await screen.press('archive-incubation');
    await screen.press('archive-incubation');
    screen.unmount();

    expect(await listIncubations()).toEqual([]);
    const days = await listHistory();
    expect(days.flatMap((day) => day.events).some((e) => e.entity === 'incubation')).toBe(false);
  });
});
