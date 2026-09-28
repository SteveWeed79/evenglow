import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@homefarm/contracts';
import { enqueue } from '@homefarm/core/sync/queue';
import { localStore } from '@homefarm/core/db/store';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';

import { GroupScreen } from '../../apps/mobile/src/screens/GroupScreen';
import { ProduceScreen } from '../../apps/mobile/src/screens/ProduceScreen';
import { TodayScreen } from '../../apps/mobile/src/screens/TodayScreen';

/**
 * A withdrawal is about one produce, and the screens have to ask which.
 *
 * Every reader of withdrawals outside `useDues` asked for `'egg'` and stopped.
 * Today then drew a milk tally with the egg holds beside it, and the group
 * screen's band — the one `TreatmentScreen` promises — appeared for hens and
 * for nothing that is milked or eaten. `CLAUDE.md` names the poultry-only
 * assumption as the one to hunt for; on this feature it is a regulatory event
 * rather than a wrong word, so each direction of the mistake gets a test.
 */

const GROUP = newId();

async function theGoats(): Promise<void> {
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: { name: 'The goats', species: 'goat', count: 4, purposes: ['milk'] },
  });
}

async function treated(withdrawalDays: { egg?: number; meat?: number; milk?: number }, name = 'Oxytet'): Promise<void> {
  await enqueue({
    entity: 'medication',
    op: 'create',
    targetId: newId(),
    payload: {
      flockId: GROUP,
      name,
      administeredAt: Date.now(),
      treatmentEndsAt: Date.now(),
      withdrawalDays,
    },
  });
}

beforeEach(async () => {
  await freshStore();
});

describe('Today', () => {
  it('holds the milk tally under a milk withdrawal', async () => {
    await theGoats();
    await treated({ milk: 4 });

    const today = await mount(<TodayScreen />);
    expect(today.text()).toContain('Milk withheld — Oxytet');

    // One press arms, the second logs — the same interlock the egg tally has.
    await today.press('tally-plus-8');
    await today.press('tally-commit');
    expect(await localStore().readRecordsByEntity('productionLog')).toHaveLength(0);
    expect(today.text()).toContain('anyway');

    await today.press('tally-commit');
    const [milk] = await localStore().readRecordsByEntity('productionLog');
    expect(milk?.value).toMatchObject({ kind: 'milk', withdrawalAcknowledged: true });
    today.unmount();
  });

  it('does not gate the milk with an egg period', async () => {
    await theGoats();
    // A label that names egg days and nothing else says nothing about milk.
    await treated({ egg: 7 });

    const today = await mount(<TodayScreen />);
    expect(today.text()).not.toContain('withheld');

    await today.press('tally-plus-8');
    await today.press('tally-commit');
    expect(await localStore().readRecordsByEntity('productionLog')).toHaveLength(1);
    expect(today.text()).not.toContain('anyway');
    today.unmount();
  });
});

describe('the group screen', () => {
  it('shows a band for each kind held', async () => {
    await theGoats();
    await treated({ milk: 4, meat: 28 });

    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);
    const body = screen.text();
    expect(body).toContain('Milk withheld — Oxytet');
    expect(body).toContain('Meat withheld — Oxytet');
    screen.unmount();
  });

  it('shows nothing when the only period is for a produce this group does not give', async () => {
    await theGoats();
    await treated({ egg: 7 });

    // An egg hold on a goat herd is still a hold — the band is per treatment,
    // not per species — so it shows; what must not happen is the milk band
    // being drawn from it. Eggs alone, then.
    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);
    expect(screen.text()).toContain('Eggs withheld');
    expect(screen.text()).not.toContain('Milk withheld');
    screen.unmount();
  });
});

describe('the produce screen', () => {
  it('gates the milk and not the fleece', async () => {
    await theGoats();
    await treated({ milk: 4 });

    const screen = await mount(<ProduceScreen {...routeProps({ groupId: GROUP })} />);
    // Milk is the default, and it is held.
    expect(screen.text()).toContain('Milk withheld — Oxytet');

    // A fleece off the same doe is not milk; the band goes with the switch.
    await screen.press('choice-fibre');
    expect(screen.text()).not.toContain('withheld');
    screen.unmount();
  });
});
