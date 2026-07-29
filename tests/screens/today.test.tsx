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

    const before = await mount(<TodayScreen />);
    expect(before.text()).toContain('Trim feet — The goats');

    const care = await mount(<CareLogScreen {...routeProps({ groupId: GROUP })} />);
    await care.press('care-hoof-trim');
    await care.press('save-care');

    const after = await mount(<TodayScreen />);
    expect(after.text()).not.toContain('Trim feet');
    // The jobs that were NOT done are still there — logging one clears one.
    expect(after.text()).toContain('Check minerals — The goats');
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
