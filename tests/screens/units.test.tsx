import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@homefarm/contracts';
import { enqueue } from '@homefarm/core/sync/queue';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { AnimalsScreen } from '../../apps/mobile/src/screens/AnimalsScreen';
import { GroupScreen } from '../../apps/mobile/src/screens/GroupScreen';
import { HistoryScreen } from '../../apps/mobile/src/screens/HistoryScreen';
import { ShearingScreen } from '../../apps/mobile/src/screens/ShearingScreen';
import { WeighScreen } from '../../apps/mobile/src/screens/WeighScreen';

/**
 * The units switch, actually switching something.
 *
 * The setting had been on the site record since the site record existed, and
 * exactly one screen read it — the forecast. Every weight anywhere else was
 * `formatMass(ug, 'imperial')` with the argument written in. So a metric farm
 * that set the switch got Celsius on the weather screen and pounds on the
 * scales, which is worse than never having offered the choice: a setting that
 * half works teaches somebody it does not work, and they stop trusting the
 * others too.
 *
 * The comment in `HistoryScreen` said as much and named the other screens —
 * an accurate note about a defect, which is not the same as not having one.
 *
 * Asserted through the screens rather than against the hook, because the bug
 * was never in `formatMass`. It was in what the screens handed it.
 */

const GROUP = newId();

/** A little over two kilos, which reads as 4.9 lb — no confusing the two. */
const MASS_UG = 2_200_000_000;

async function farm(units?: 'metric' | 'imperial'): Promise<void> {
  await freshStore();

  await enqueue({
    entity: 'site',
    op: 'create',
    targetId: newId(),
    payload: { name: 'Rowan Bank', ...(units === undefined ? {} : { units }) },
  });

  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: {
      name: 'The Herd',
      species: 'sheep',
      count: 12,
      purposes: ['fibre'],
    },
  });
}

async function weighIn(): Promise<void> {
  await enqueue({
    entity: 'weight',
    op: 'create',
    targetId: newId(),
    payload: { occurredAt: Date.now(), flockId: GROUP, massUg: MASS_UG },
  });
}

beforeEach(async () => {
  await farm();
});

describe('a weight, wherever it is shown', () => {
  it('reads in kilos on a metric farm', async () => {
    await farm('metric');
    await weighIn();

    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);
    expect(screen.text()).toContain('2.2 kg');
    expect(screen.text()).not.toContain('lb');
  });

  it('reads in pounds on an imperial one', async () => {
    await farm('imperial');
    await weighIn();

    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);
    expect(screen.text()).toContain('4.9 lb');
  });

  /**
   * A farm that never opened Settings is an imperial farm. Changing that with
   * this work would silently re-read every existing record in other units.
   */
  it('stays imperial when the farm never said', async () => {
    await weighIn();

    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);
    expect(screen.text()).toContain('4.9 lb');
  });

  it('carries to the named animals', async () => {
    await farm('metric');
    const animal = newId();
    await enqueue({
      entity: 'animal',
      op: 'create',
      targetId: animal,
      payload: { name: 'Maisie', flockId: GROUP, species: 'sheep' },
    });
    await enqueue({
      entity: 'weight',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: Date.now(), animalId: animal, massUg: MASS_UG },
    });

    const screen = await mount(<AnimalsScreen {...routeProps({ groupId: GROUP })} />);
    expect(screen.text()).toContain('2.2 kg');
  });

  it('carries to what happened', async () => {
    await farm('metric');
    await weighIn();

    const screen = await mount(<HistoryScreen />);
    expect(screen.text()).toContain('2.2 kg');
  });
});

describe('what a scale is asked for', () => {
  /**
   * The half that display alone would not fix. A metric farm typing 2.2 into a
   * field labelled `lb` does not get a rounding error, it gets a record that
   * is off by a factor of 2.2 — and it is stored in micrograms, so nothing
   * downstream can tell it was ever wrong.
   */
  it('offers kilos and grams to a metric farm', async () => {
    await farm('metric');

    const screen = await mount(<WeighScreen {...routeProps({ groupId: GROUP })} />);
    expect(screen.labels()).toContain('Kilos');
    expect(screen.labels()).toContain('Grams');
    expect(screen.labels()).not.toContain('Pounds');
  });

  it('offers pounds and ounces to an imperial one', async () => {
    await farm('imperial');

    const screen = await mount(<WeighScreen {...routeProps({ groupId: GROUP })} />);
    expect(screen.labels()).toContain('Pounds');
    expect(screen.labels()).toContain('Ounces');
  });

  it('stores what a metric farm typed as kilos', async () => {
    await farm('metric');

    const screen = await mount(<WeighScreen {...routeProps({ groupId: GROUP })} />);
    // Twelve in this group, so it opens with a box per animal — the unit
    // applies to all of them, which is the point being asserted.
    await screen.type('weight-box-0', '2.2');

    // The button says what will be logged, which is the only place the number
    // is legible before it is committed.
    expect(screen.text().replace(/\s+/g, ' ')).toContain('Log 2.2 kg');
  });

  it('weighs a fleece in the farm’s own unit', async () => {
    await farm('metric');

    const screen = await mount(<ShearingScreen {...routeProps({ groupId: GROUP })} />);
    await screen.type('clip-amount', '2.2');
    expect(screen.text().replace(/\s+/g, ' ')).toContain('Log 2.2 kg');
  });
});
