import { beforeEach, describe, expect, it } from 'vitest';
import { growOutWindow, newId } from '@steading/contracts';
import { listGroups, produceToday } from '@steading/core/read/groups';
import { localStore } from '@steading/core/db/store';
import { enqueue } from '@steading/core/sync/queue';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { TodayScreen } from '../../apps/mobile/src/screens/TodayScreen';

/**
 * What Today offers, and how much of the screen it takes.
 *
 * Both of these came from looking at the app on a phone rather than from a
 * test: a flock kept for the table was being asked for eggs every morning, and
 * three groups turned Today into a wall of full-height tallies with the thing
 * you came to do somewhere below the fold.
 */

async function aGroup(name: string, species: string, purposes: string[]): Promise<string> {
  const id = newId();
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: id,
    payload: { name, species, count: 10, purposes },
  });
  return id;
}

beforeEach(async () => {
  await freshStore();
});

describe('what a group is asked for', () => {
  it('does not ask meat birds for eggs', async () => {
    const id = await aGroup('Meat Birds', 'chicken', ['meat']);
    const screen = await mount(<TodayScreen />);

    // The group still appears in husbandry rows — worming a meat flock is
    // still worming. What it does not get is a tally nobody would ever fill.
    expect(screen.has(`tally-open-${id}:eggs`)).toBe(false);
    expect(screen.has('tally-commit')).toBe(false);
    expect(screen.text()).toContain('Nothing to collect');
  });

  it('asks a laying flock for eggs', async () => {
    const id = await aGroup('Eggers', 'chicken', ['eggs']);
    const screen = await mount(<TodayScreen />);

    expect(screen.has(`tally-open-${id}:eggs`)).toBe(true);
    expect(screen.text()).toContain('Eggers');
  });

  it('asks a flock kept for eggs and the table for eggs only', async () => {
    // Black Australorps: laying now, processed later. Both purposes are true
    // and only one of them is a daily tally.
    const id = await aGroup('Australorps', 'chicken', ['eggs', 'meat']);
    const screen = await mount(<TodayScreen />);

    expect(screen.has(`tally-open-${id}:eggs`)).toBe(true);
    expect(screen.has(`tally-open-${id}:meat`)).toBe(false);
  });

  it('asks a dairy goat for milk, which was never on Today at all', async () => {
    const id = await aGroup('Milk Goats', 'goat', ['milk']);
    const screen = await mount(<TodayScreen />);

    expect(screen.has(`tally-open-${id}:milk`)).toBe(true);
    expect(screen.text()).toContain('Milk');
  });

  it('keeps the annual jobs off it', async () => {
    // A fleece is once a year; a wool tally would be wrong every other morning.
    const id = await aGroup('The Sheep', 'sheep', ['fibre']);
    const screen = await mount(<TodayScreen />);
    expect(screen.has(`tally-open-${id}:fibre`)).toBe(false);
  });
});

describe('how much room it takes', () => {
  it('opens itself when there is only one thing to log', async () => {
    const id = await aGroup('Eggers', 'chicken', ['eggs']);
    const screen = await mount(<TodayScreen />);

    // No tap between somebody and the only reason they opened the app.
    expect(screen.has(`tally-open-${id}:eggs`)).toBe(true);
    expect(screen.has('tally-commit')).toBe(true);
  });

  it('collapses them all when there are several', async () => {
    const eggers = await aGroup('Eggers', 'chicken', ['eggs']);
    await aGroup('Milk Goats', 'goat', ['milk']);
    await aGroup('Ducks', 'duck', ['eggs']);

    const screen = await mount(<TodayScreen />);

    // Three rows, no tally open — the screen is a list you can read.
    expect(screen.text()).toContain('Eggers');
    expect(screen.text()).toContain('Milk Goats');
    expect(screen.text()).toContain('Ducks');
    expect(screen.has('tally-commit')).toBe(false);

    await screen.press(`tally-open-${eggers}:eggs`);
    expect(screen.has('tally-commit')).toBe(true);
  });

  it('keeps only one open at a time', async () => {
    const eggers = await aGroup('Eggers', 'chicken', ['eggs']);
    const goats = await aGroup('Milk Goats', 'goat', ['milk']);

    const screen = await mount(<TodayScreen />);
    await screen.press(`tally-open-${eggers}:eggs`);
    await screen.press(`tally-open-${goats}:milk`);

    // Opening the second closed the first, so there is exactly one commit.
    expect(screen.tree.root.findAllByProps({ testID: 'tally-commit' }).length).toBeGreaterThan(0);
    expect(screen.text()).toContain('Milk from Milk Goats');
    expect(screen.text()).not.toContain('Eggs from Eggers');
  });

  it('shows the running total without opening anything', async () => {
    const id = await aGroup('Eggers', 'chicken', ['eggs']);
    await aGroup('Ducks', 'duck', ['eggs']);
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      payload: { occurredAt: Date.now(), flockId: id, count: 6 },
    });

    const screen = await mount(<TodayScreen />);
    // Collapsed, but the number is the reason you would open it.
    expect(screen.has('tally-commit')).toBe(false);
    expect(screen.get(`tally-open-${id}:eggs`).props.accessibilityLabel).toContain('6 so far');
  });
});

describe('logging through the collapsed row', () => {
  it('writes milk as a productionLog, not an egg', async () => {
    const id = await aGroup('Milk Goats', 'goat', ['milk']);
    const screen = await mount(<TodayScreen />);

    await screen.press('tally-plus-500');
    await screen.press('tally-commit');

    expect((await produceToday()).get(`${id}:milk`)).toMatchObject({ amount: 500, unit: 'ml' });
    expect(await localStore().readRecordsByEntity('eggLog')).toHaveLength(0);
  });
});

describe('the processing figure', () => {
  it('keeps the library range when nobody overrides it', async () => {
    await freshStore();
    const id = newId();
    await enqueue({
      entity: 'flock',
      op: 'create',
      targetId: id,
      payload: {
        name: 'Broilers',
        species: 'chicken',
        count: 25,
        purposes: ['meat'],
        breedId: 'chicken-cornish-cross',
        bornAt: Date.now() - 30 * 86_400_000,
      },
    });

    const [group] = await listGroups();
    // Nothing written, so the library's 6-9 still applies rather than being
    // flattened to a single number the farm never chose.
    expect(group?.processAtWeeks).toBeUndefined();
    expect(growOutWindow({ ...group!, purposes: group!.purposes ?? [] })?.weeks).toEqual([6, 9]);
  });

  it('uses the farm figure once it is set', async () => {
    await freshStore();
    const id = newId();
    await enqueue({
      entity: 'flock',
      op: 'create',
      targetId: id,
      payload: {
        name: 'Australorps',
        species: 'chicken',
        count: 12,
        purposes: ['eggs', 'meat'],
        breedId: 'chicken-australorp',
        bornAt: Date.now() - 30 * 86_400_000,
        processAtWeeks: 11,
      },
    });

    const [group] = await listGroups();
    expect(growOutWindow({ ...group!, purposes: group!.purposes ?? [] })?.weeks).toEqual([11, 11]);
  });
});
