import { beforeEach, describe, expect, it } from 'vitest';
import { careDues, careIntervalDays, newId } from '@homefarm/contracts';
import { listGroups } from '@homefarm/core/read/groups';
import { enqueue } from '@homefarm/core/sync/queue';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { CareRoutineScreen } from '../../apps/mobile/src/screens/CareRoutineScreen';
import { TodayScreen } from '../../apps/mobile/src/screens/TodayScreen';

/**
 * Turning a routine job off, which until now was impossible.
 *
 * `careDues` has taken a per-group `intervals` override since it was written,
 * with `null` documented as "silences a job entirely", and **nothing anywhere
 * set it**. So a farm that buys in vaccinated pullets had two options: log a
 * vaccination it never gave, or scroll past that row every morning forever.
 *
 * A builder with no caller is a feature that exists only in the test suite —
 * the lesson `useDues` already records about the due builders that shipped
 * before anything could feed them. This is the caller.
 */

const GROUP = newId();

beforeEach(async () => {
  await freshStore();
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: { name: 'Chickens', species: 'chicken', count: 6, purposes: ['eggs'] },
  });
});

describe('the defaults', () => {
  /**
   * Poultry were charged twice for one walk-round: a monthly look-over beside
   * a monthly parasite check, on an animal where those are the same act.
   */
  it('no longer asks a chicken keeper to look at their chickens', () => {
    expect(careIntervalDays('chicken', 'health-check')).toBeNull();
  });

  /**
   * Red mite lives in the coop rather than on the bird and needs a torch after
   * dark — a real job that looking a hen over does not cover, and quarterly
   * rather than monthly.
   */
  it('keeps the parasite check, quarterly, because it is a different job', () => {
    expect(careIntervalDays('chicken', 'parasite-check')).toBe(90);
  });

  /** A faecal count is nothing like a general look, so ruminants keep both. */
  it('leaves a ruminant parasite check where it was', () => {
    expect(careIntervalDays('goat', 'parasite-check')).toBe(60);
  });

  /**
   * The measurable half of the complaint. A three-group farm owed roughly a
   * hundred confirmations a year; the same farm now owes fewer than half.
   */
  it('roughly halves what a poultry group asks for in a year', () => {
    const perYear = (['worming', 'parasite-check', 'vaccination', 'health-check'] as const)
      .map((kind) => careIntervalDays('chicken', kind))
      .filter((days): days is number => days !== null)
      .reduce((sum, days) => sum + 365 / days, 0);

    expect(Math.round(perYear)).toBeLessThan(10);
  });
});

describe('turning a job off', () => {
  it('stores it as never, and the row stops appearing', async () => {
    const screen = await mount(<CareRoutineScreen {...routeProps({ groupId: GROUP })} />);
    await screen.press('care-vaccination-never');
    screen.unmount();

    const [group] = await listGroups();
    expect(group?.careIntervals?.vaccination).toBeNull();

    const dues = careDues(
      { id: GROUP, name: 'Chickens', species: 'chicken', lastDone: {}, intervals: group?.careIntervals },
      Date.now(),
    );
    expect(dues.some((due) => due.key.endsWith('vaccination'))).toBe(false);
  });

  it('takes it off Today', async () => {
    const before = await mount(<TodayScreen />);
    // Behind the group's bundle, which is where husbandry rows past the first
    // one live.
    await before.pressLabel('more');
    expect(before.text()).toContain('Vaccinations — Chickens');
    before.unmount();

    const screen = await mount(<CareRoutineScreen {...routeProps({ groupId: GROUP })} />);
    await screen.press('care-vaccination-never');
    screen.unmount();

    const after = await mount(<TodayScreen />);
    expect(after.text()).not.toContain('Vaccinations — Chickens');
    after.unmount();
  });

  /**
   * The other half of the same field: a keeper who worms on their own schedule
   * should be able to say so rather than dismissing a row every four months.
   */
  it("accepts a farm's own interval as well as never", async () => {
    const screen = await mount(<CareRoutineScreen {...routeProps({ groupId: GROUP })} />);
    await screen.press('care-worming-twice-a-year');
    screen.unmount();

    const [group] = await listGroups();
    expect(group?.careIntervals?.worming).toBe(182);
  });

  /**
   * Three states, not two. "Default" must be the ABSENCE of a setting, so a
   * farm that never expressed a preference moves when the default moves — a
   * stored copy would freeze it at whatever shipped that day.
   */
  it('goes back to no opinion rather than to a stored copy of the default', async () => {
    const screen = await mount(<CareRoutineScreen {...routeProps({ groupId: GROUP })} />);
    await screen.press('care-worming-never');
    await screen.press('care-worming-default');
    screen.unmount();

    const [group] = await listGroups();
    expect(group?.careIntervals).not.toHaveProperty('worming');
  });

  /**
   * The case `health-check` being off by default is meant to leave open: a
   * group in a rented field two valleys over is genuinely worth a prompt.
   */
  it('lets a farm switch a job back on that the species defaults off', async () => {
    const screen = await mount(<CareRoutineScreen {...routeProps({ groupId: GROUP })} />);
    await screen.press('care-health-check-monthly');
    screen.unmount();

    const [group] = await listGroups();
    const dues = careDues(
      { id: GROUP, name: 'Chickens', species: 'chicken', lastDone: {}, intervals: group?.careIntervals },
      Date.now(),
    );
    expect(dues.some((due) => due.key.endsWith('health-check'))).toBe(true);
  });
});

describe('what the screen says is happening', () => {
  it('names the default rather than pretending the farm chose it', async () => {
    const screen = await mount(<CareRoutineScreen {...routeProps({ groupId: GROUP })} />);

    expect(screen.get('care-now-worming').children.join('')).toContain('120 days, by default');
    screen.unmount();
  });

  /**
   * Off by default is not the same as impossible, and the line says which.
   * Minerals for a laying flock is grit and oyster shell — a real job that
   * simply is not on a schedule unless somebody asks for one.
   */
  it('says a job is off rather than absent when it is merely off', async () => {
    const screen = await mount(<CareRoutineScreen {...routeProps({ groupId: GROUP })} />);

    expect(screen.get('care-now-mineral').children.join('')).toContain('Off unless you ask');
    screen.unmount();
  });
});

/**
 * "If the farm doesn't have the animal associated with the routine task, does
 * it need to be on the list?"
 *
 * No. The screen listed all seven kinds on the argument that hiding one makes
 * a capability invisible rather than absent — right about a job that is off by
 * default, wrong about one that cannot exist. A chicken has no teeth that need
 * doing, and seven interval chips under "Teeth" is a category error taking up
 * a screen.
 *
 * `null` had been doing both jobs: "not on a schedule" and "this animal does
 * not have one". `careApplies` is where the line lives now, and only anatomy
 * makes a job impossible.
 */
describe('which jobs are offered at all', () => {
  it('does not ask how often to do a chicken’s teeth', async () => {
    const screen = await mount(<CareRoutineScreen {...routeProps({ groupId: GROUP })} />);

    expect(screen.has('care-now-dental')).toBe(false);
    expect(screen.has('care-now-hoof-trim')).toBe(false);
    screen.unmount();
  });

  /**
   * But keeps everything that is merely switched off. Every animal has health,
   * can be wormed, can carry parasites, can be vaccinated, and eats.
   */
  it('keeps the jobs that are real and simply off', async () => {
    const screen = await mount(<CareRoutineScreen {...routeProps({ groupId: GROUP })} />);

    expect(screen.has('care-now-health-check')).toBe(true);
    expect(screen.has('care-now-mineral')).toBe(true);
    expect(screen.has('care-now-vaccination')).toBe(true);
    screen.unmount();
  });

  it('offers a goat its feet, which a chicken is not asked about', async () => {
    const goats = newId();
    await enqueue({
      entity: 'flock',
      op: 'create',
      targetId: goats,
      payload: { name: 'The goats', species: 'goat', count: 4, purposes: ['milk'] },
    });

    const screen = await mount(<CareRoutineScreen {...routeProps({ groupId: goats })} />);

    expect(screen.has('care-now-hoof-trim')).toBe(true);
    // And still no teeth: rasping is horses and camelids.
    expect(screen.has('care-now-dental')).toBe(false);
    screen.unmount();
  });

  /**
   * ── The animals that were told they had no body at all ───────────────────
   *
   * `careApplies` answered the anatomy question by checking whether the default
   * interval was null — the exact conflation this file's own note says must not
   * be made. The `other` group defaults everything to null and holds pigs,
   * rabbits, horses, donkeys and the catch-all `other` species. Horses and
   * donkeys are rescued by their own overrides; the rest were told they have
   * **neither feet nor teeth**, with no way to switch the chips on.
   *
   * A pig's feet are trimmed and a boar's tusks are a real job. A rabbit's
   * nails are clipped and its incisors are the classic thing that goes wrong
   * with a rabbit. And `other` means the app does not know what the animal is,
   * which is the one case where asserting an impossibility is indefensible.
   */
  it('offers a pig and a rabbit their feet and teeth', async () => {
    for (const [species, name] of [
      ['pig', 'The pigs'],
      ['rabbit', 'The rabbits'],
      ['other', 'The others'],
    ] as const) {
      const id = newId();
      await enqueue({
        entity: 'flock',
        op: 'create',
        targetId: id,
        payload: { name, species, count: 3, purposes: ['meat'] },
      });

      const screen = await mount(<CareRoutineScreen {...routeProps({ groupId: id })} />);

      expect(screen.has('care-now-hoof-trim'), `${species} feet`).toBe(true);
      expect(screen.has('care-now-dental'), `${species} teeth`).toBe(true);
      screen.unmount();
    }
  });

  /**
   * And the exclusions that are real are kept. A bird has no teeth; that is
   * settled and is not what this changed.
   */
  it('still does not ask a chicken about its teeth', async () => {
    const birds = newId();
    await enqueue({
      entity: 'flock',
      op: 'create',
      targetId: birds,
      payload: { name: 'The hens', species: 'chicken', count: 6, purposes: ['eggs'] },
    });

    const screen = await mount(<CareRoutineScreen {...routeProps({ groupId: birds })} />);

    expect(screen.has('care-now-dental')).toBe(false);
    expect(screen.has('care-now-hoof-trim')).toBe(false);
    screen.unmount();
  });

  /**
   * **The case a group-only table would have broken.** Alpacas and llamas sit
   * in the ruminant group, which does not do teeth — and camelids are floated
   * yearly, which their own interval says. A species override outranks its
   * group for exactly this reason.
   */
  it('keeps a llamas teeth, inside a group that has none', async () => {
    const llamas = newId();
    await enqueue({
      entity: 'flock',
      op: 'create',
      targetId: llamas,
      payload: { name: 'The llamas', species: 'llama', count: 3, purposes: ['fibre'] },
    });

    const screen = await mount(<CareRoutineScreen {...routeProps({ groupId: llamas })} />);

    expect(screen.has('care-now-dental')).toBe(true);
    expect(screen.has('care-now-hoof-trim')).toBe(true);
    screen.unmount();
  });

  it('offers a horse its teeth', async () => {
    const horses = newId();
    await enqueue({
      entity: 'flock',
      op: 'create',
      targetId: horses,
      payload: { name: 'The horses', species: 'horse', count: 2, purposes: ['work'] },
    });

    const screen = await mount(<CareRoutineScreen {...routeProps({ groupId: horses })} />);

    expect(screen.has('care-now-dental')).toBe(true);
    screen.unmount();
  });

  /**
   * A rule that arrived after a setting must not strand it. A farm that had
   * somehow answered for a kind keeps the row, whatever the rule now says.
   */
  it('still shows a kind the farm has already answered', async () => {
    const odd = newId();
    await enqueue({
      entity: 'flock',
      op: 'create',
      targetId: odd,
      payload: {
        name: 'The hens',
        species: 'chicken',
        count: 6,
        careIntervals: { dental: 365 },
      },
    });

    const screen = await mount(<CareRoutineScreen {...routeProps({ groupId: odd })} />);

    expect(screen.has('care-now-dental')).toBe(true);
    screen.unmount();
  });
});
