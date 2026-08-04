import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { listRejected } from '@steading/core/sync/inbox';
import { enqueue } from '@steading/core/sync/queue';
import { localStore } from '@steading/core/db/store';
import { freshStore, readOutboxBySeq } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { navCalls } from '../support/native/navigation';

import { CareLogScreen } from '../../apps/mobile/src/screens/CareLogScreen';
import { IncubationScreen } from '../../apps/mobile/src/screens/IncubationScreen';
import { InboxScreen } from '../../apps/mobile/src/screens/InboxScreen';
import { PlantingScreen } from '../../apps/mobile/src/screens/PlantingScreen';
import { TodayScreen } from '../../apps/mobile/src/screens/TodayScreen';

/**
 * Today, and the screens that empty it.
 *
 * This is the property the whole app turns on and the one nothing tested
 * end to end: **a row leaves Today because the thing it was waiting for was
 * recorded.** Not because anybody ticked it — there is no completion flag
 * anywhere — so the only way to prove it works is to render the list, go and
 * do the job on the real screen, and render the list again.
 *
 * Every step below runs the real due builders over the real store. The only
 * fiction is that nothing is drawn.
 */

const DAY = 86_400_000;
const GROUP = newId();

async function theGoats(): Promise<void> {
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: { name: 'The goats', species: 'goat', count: 4, purposes: ['milk'] },
  });
}

beforeEach(async () => {
  await freshStore();
});

describe('husbandry', () => {
  it('sits on Today until the job is recorded, then goes', async () => {
    await theGoats();

    /**
     * A group's husbandry arrives as one bundle now, so the individual jobs
     * are one tap in — see `todayBundles`. Expanded here deliberately rather
     * than asserted around, because what this test is about is that a job
     * sits on the list until it is recorded, and that is still true of the
     * row whether or not it is the one on top.
     */
    const before = await mount(<TodayScreen />);
    await before.pressLabel('more');
    expect(before.text()).toContain('Trim feet — The goats');

    const care = await mount(<CareLogScreen {...routeProps({ groupId: GROUP })} />);
    await care.press('care-hoof-trim');
    await care.press('save-care');

    const after = await mount(<TodayScreen />);
    await after.pressLabel('more');
    expect(after.text()).not.toContain('Trim feet');
    // The jobs that were NOT done are still there — logging one clears one.
    expect(after.text()).toContain('Check minerals — The goats');
  });
});

/**
 * What order the morning is in.
 *
 * The screen used to put the whole due list above the tallies. Bundling gave
 * each group a row plus an "and 3 more" line, so three groups of routine
 * look-overs filled a Pixel and the tally — the one control that is tapped
 * every single morning — started below the fold.
 *
 * `VISIBLE_DUES` was meant to prevent that and could not: it counts bundles,
 * and a bundle is not one line.
 */
describe('the order of the morning', () => {
  it('puts the tally above the day’s jobs', async () => {
    await theGoats();

    const today = await mount(<TodayScreen />);
    const body = today.text();

    // The goats are kept for milk, so there is a tally; husbandry supplies the
    // jobs. Both are on screen — this is only about which comes first.
    expect(body).toContain('Milk');
    expect(body).toContain('Also today');
    expect(body.indexOf('Milk')).toBeLessThan(body.indexOf('Also today'));
    today.unmount();
  });

  /**
   * The reason moving the list is safe, asserted rather than assumed.
   *
   * W2 makes withdrawals the highest-value safety surface in the app, so
   * burying one under a tally would be a bad trade — but that is not the trade.
   * A withdrawal row has `noticeDays: 0` and reads "clear again after", so it
   * appears on the day the withdrawal ENDS. While produce is actually being
   * withheld there is no due row at all, and the guard is the banner on the
   * tally plus the second press it demands.
   *
   * Moving the list does not move the guard, because the guard was never in
   * the list. This test is what stops that from being a comment nobody checked.
   */
  it('guards a withdrawal on the tally itself, not from the list', async () => {
    await enqueue({
      entity: 'flock',
      op: 'create',
      targetId: GROUP,
      payload: { name: 'The hens', species: 'chicken', count: 6, purposes: ['eggs'] },
    });
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

    // The warning is on the tally, so it sits with the tally — above the
    // day's jobs, without the list having to carry it.
    const body = today.text();
    expect(body).toContain('Eggs withheld — Baytril');
    expect(body.indexOf('Eggs withheld')).toBeLessThan(body.indexOf('Also today'));

    // And it still will not commit on one press.
    await today.press('tally-plus-6');
    await today.press('tally-commit');
    expect(await localStore().readRecordsByEntity('eggLog')).toHaveLength(0);
    today.unmount();
  });
});

describe('withdrawals', () => {
  it('puts a row up and makes logging through it deliberate', async () => {
    await enqueue({
      entity: 'flock',
      op: 'create',
      targetId: GROUP,
      payload: { name: 'The hens', species: 'chicken', count: 6, purposes: ['eggs'] },
    });
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
    expect(today.text()).toContain('Baytril');

    // One tally tap, then commit: the first press arms rather than logs.
    await today.press('tally-plus-6');
    await today.press('tally-commit');
    expect(await localStore().readRecordsByEntity('eggLog')).toHaveLength(0);
    expect(today.text()).toContain('anyway');

    await today.press('tally-commit');
    const [egg] = await localStore().readRecordsByEntity('eggLog');
    // Recorded, not merely displayed — the audit trail for a deliberate call.
    expect(egg?.value).toMatchObject({ count: 6, withdrawalAcknowledged: true });
  });
});

describe('growing', () => {
  it('drops the sow row once the seed is in', async () => {
    const site = newId();
    const bed = newId();
    const variety = newId();
    const planting = newId();

    await enqueue({
      entity: 'site',
      op: 'create',
      targetId: site,
      payload: {
        name: 'The farm',
        frost: { lastSpring: 515, firstAutumn: 1005, source: 'entered' },
      },
    });
    await enqueue({
      entity: 'bed',
      op: 'create',
      targetId: bed,
      payload: { siteId: site, name: 'Bed 3', covered: false },
    });
    await enqueue({
      entity: 'variety',
      op: 'create',
      targetId: variety,
      payload: {
        name: 'Sungold',
        crop: 'Tomato',
        family: 'solanaceae',
        lifecycle: 'annual',
        daysToMaturity: 57,
      },
    });
    await enqueue({
      entity: 'planting',
      op: 'create',
      targetId: planting,
      payload: {
        bedId: bed,
        varietyId: variety,
        season: new Date().getFullYear(),
        status: 'planned',
        plannedSowAt: Date.now() - DAY,
      },
    });

    const before = await mount(<TodayScreen />);
    expect(before.text()).toContain('Sow Sungold in Bed 3');

    const detail = await mount(<PlantingScreen {...routeProps({ plantingId: planting })} />);
    await detail.press('mark-sown');

    const after = await mount(<TodayScreen />);
    expect(after.text()).not.toContain('Sow Sungold');
  });
});

describe('incubation', () => {
  it('clears candling and keeps the hatch', async () => {
    const id = newId();
    await enqueue({
      entity: 'incubation',
      op: 'create',
      targetId: id,
      payload: {
        species: 'chicken',
        label: 'Sussex',
        setAt: Date.now() - 7 * DAY,
        eggsSet: 12,
        source: 'own',
        method: 'incubator',
      },
    });

    const before = await mount(<TodayScreen />);
    expect(before.text()).toContain('Candle the Sussex eggs');

    const detail = await mount(<IncubationScreen {...routeProps({ incubationId: id })} />);
    await detail.press('save-candling');

    const after = await mount(<TodayScreen />);
    expect(after.text()).not.toContain('Candle the Sussex');
    // The hatch is still coming — clearing one step must not clear the other.
    expect(after.text()).toContain('Sussex eggs due to hatch');
  });
});

describe('iron', () => {
  it('shows a service and, separately, the part it needs ordering', async () => {
    const machine = newId();
    const part = newId();

    await enqueue({
      entity: 'equipment',
      op: 'create',
      targetId: machine,
      payload: { name: 'The tractor', hasHourMeter: true },
    });
    for (const [ago, hours] of [[20, 100], [0, 240]] as const) {
      await enqueue({
        entity: 'hourReading',
        op: 'create',
        payload: { occurredAt: Date.now() - ago * DAY, equipmentId: machine, hours },
      });
    }
    await enqueue({
      entity: 'inventory',
      op: 'create',
      targetId: part,
      payload: { name: 'Oil filter', kind: 'part', unit: 'each', quantity: 0, equipmentId: machine },
    });
    await enqueue({
      entity: 'maintenance',
      op: 'create',
      targetId: newId(),
      payload: {
        equipmentId: machine,
        title: 'Oil and filter',
        intervalHours: 250,
        partIds: [part],
      },
    });

    const today = await mount(<TodayScreen />);
    expect(today.text()).toContain('Oil and filter on The tractor');
    // Its own row, because ordering and fitting are discharged differently.
    expect(today.text()).toContain('Order Oil filter');
  });
});

describe('the rejected inbox', () => {
  async function aRejection(): Promise<string> {
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      payload: { occurredAt: Date.now(), flockId: newId(), count: 6 },
    });
    const [queued] = await readOutboxBySeq();
    await localStore().resolveBatch(
      [queued!],
      [{ id: queued!.id, status: 'rejected', reason: 'That group is not on this farm.' }],
    );
    return queued!.id;
  }

  it('shows the server’s own words', async () => {
    await aRejection();
    const inbox = await mount(<InboxScreen />);

    expect(inbox.text()).toContain('egg count');
    expect(inbox.text()).toContain('That group is not on this farm.');
  });

  it('sends it again', async () => {
    const id = await aRejection();
    const inbox = await mount(<InboxScreen />);

    await inbox.press(`retry-${id}`);
    expect(await listRejected()).toHaveLength(0);
  });

  it('takes two taps to throw work away', async () => {
    const id = await aRejection();
    const inbox = await mount(<InboxScreen />);

    await inbox.press(`discard-${id}`);
    expect(await listRejected()).toHaveLength(1);

    await inbox.press(`discard-${id}`);
    expect(await listRejected()).toHaveLength(0);
  });

  it('is reachable from the chip on any screen', async () => {
    await aRejection();
    const today = await mount(<TodayScreen />);

    await today.press('sync-chip');
    // Straight to the work, not to a diagnostics screen it is hiding behind.
    expect(navCalls()).toContainEqual({ action: 'navigate', route: 'Inbox', params: undefined });
  });

  it('goes to diagnostics when nothing was refused', async () => {
    const today = await mount(<TodayScreen />);
    await today.press('sync-chip');
    expect(navCalls()).toContainEqual({
      action: 'navigate',
      route: 'Diagnostics',
      params: undefined,
    });
  });
});

describe('the shape of the morning', () => {
  /**
   * The screenshot that prompted this: a two-group farm opening on nine
   * husbandry rows differing by one word, with the tally pushed off the
   * bottom of the screen.
   */
  async function twoGroups(): Promise<void> {
    await theGoats();
    await enqueue({
      entity: 'flock',
      op: 'create',
      targetId: '01J8XQK5T7WZ3P4N6M8R2V9C0Z',
      payload: { name: 'The hens', species: 'chicken', count: 6, purposes: ['eggs'] },
    });
  }

  it('shows one row per group, not one per job', async () => {
    await twoGroups();
    const screen = await mount(<TodayScreen />);
    const text = screen.text();

    // One lead row each, and the rest folded behind a count.
    expect(text).toContain('The goats');
    expect(text).toContain('The hens');
    expect(text).toMatch(/and \d+ more/);
  });

  it('still reaches the tally, which is what most people opened it for', async () => {
    await twoGroups();
    const screen = await mount(<TodayScreen />);

    // The failure this cap exists to prevent: dues pushing the log path off
    // the screen. Both groups' tallies are still rendered.
    expect(screen.has('tally-open-01J8XQK5T7WZ3P4N6M8R2V9C0Z:eggs')).toBe(true);
  });

  it('opens every job of a group with one tap', async () => {
    await twoGroups();
    const screen = await mount(<TodayScreen />);

    // Opens the first bundle on the list. Which group that is depends on the
    // sort, so the assertion is about a job that was folded rather than about
    // a particular animal.
    const folded = screen.text();
    expect(folded).not.toContain('Worm check — The hens');

    await screen.pressLabel('more');
    // Nothing was dropped — the jobs are all still there, one tap in.
    expect(screen.text()).toContain('Worm check — The hens');
  });
});

/**
 * "Can there be an option to confirm they are complete as much as they need to
 * be, and then they roll into the What happened screen."
 *
 * Yes — and importantly, without a completion flag. `due/types.ts` property 3
 * refuses one, and the reasoning still holds: a stored "done" is a second
 * source of truth about whether something happened, and the two drift.
 *
 * Pressing Done writes the same `careLog` the form would have written. The row
 * clears because that record now exists, which is the same reason every other
 * row clears — and because it is a real record, it lands in What happened. A
 * flag never would have.
 */
describe('finishing a job from the list', () => {
  it('writes the record rather than marking anything', async () => {
    await theGoats();

    const today = await mount(<TodayScreen />);
    // Minerals rather than the look-over: `health-check` is off by default now
    // — you see your animals daily, and an app asking monthly for confirmation
    // is a chore it invented. See CARE_INTERVALS.
    const key = `${GROUP}:care:mineral`;
    // Minerals sit inside the group's bundle rather than on its lead row.
    await today.pressLabel('more');

    // Armed first: a careLog is append-only and there is no undo, so a
    // mis-tap must not record a job nobody did.
    await today.press(`due-done-${key}`);
    expect(await localStore().readRecordsByEntity('careLog')).toHaveLength(0);

    await today.press(`due-done-${key}`);
    today.unmount();

    const [logged] = await localStore().readRecordsByEntity('careLog');
    expect(logged?.value).toMatchObject({ kind: 'mineral', flockId: GROUP });
  });

  it('takes the row off Today, because the thing it waited for now exists', async () => {
    await theGoats();

    const before = await mount(<TodayScreen />);
    const key = `${GROUP}:care:mineral`;
    await before.pressLabel('more');
    expect(before.text()).toContain('Check minerals — The goats');
    await before.press(`due-done-${key}`);
    await before.press(`due-done-${key}`);
    before.unmount();

    const after = await mount(<TodayScreen />);
    await after.pressLabel('more');
    expect(after.text()).not.toContain('Check minerals — The goats');
    after.unmount();
  });

  it('rolls into What happened', async () => {
    await theGoats();

    const today = await mount(<TodayScreen />);
    // Trimming is inside the group's bundle rather than its lead row.
    await today.pressLabel('more');
    const key = `${GROUP}:care:hoof-trim`;
    await today.press(`due-done-${key}`);
    await today.press(`due-done-${key}`);
    today.unmount();

    const { listHistory } = await import('@steading/core/read/history');
    const days = await listHistory();
    expect(days[0]?.events[0]?.title).toBe('Trimmed feet — The goats');
  });

  /**
   * Absent everywhere one press could not honestly stand in for the form. A
   * hatch needs how many hatched, which is the entire point of recording it.
   */
  it('is not offered on a row a press could not honestly complete', async () => {
    await enqueue({
      entity: 'incubation',
      op: 'create',
      targetId: newId(),
      payload: {
        species: 'chicken',
        label: 'The broody set',
        setAt: Date.now() - 20 * DAY,
        eggsSet: 12,
        source: 'own',
        method: 'broody',
        candledAt: Date.now() - 13 * DAY,
        fertile: 10,
      },
    });

    const today = await mount(<TodayScreen />);

    expect(today.text()).toContain('hatch');
    expect(today.labels()).not.toContain('Done');
    today.unmount();
  });
});
