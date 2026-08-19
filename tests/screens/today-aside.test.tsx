import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@homefarm/contracts';
import { enqueue } from '@homefarm/core/sync/queue';
import { SPACE } from '../../apps/mobile/src/theme/tokens';
import { TodayScreen } from '../../apps/mobile/src/screens/TodayScreen';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { seedWindow } from '../support/native/react-native';
import { seedInsets } from '../support/native/modules';

/**
 * Where the dues sit, and what they stop saying once they sit beside.
 *
 * ## The report
 *
 * First screenshot of both panes actually rendering, off the tablet: *"the Also
 * today header causes some ugly. the two columns start at different heights"*.
 *
 * Two things stood above the aside's first card and nothing stood above the
 * column's, so the pair started a heading and a margin out of line and read as
 * a mistake rather than a layout. Neither is wrong on a phone — stacked under
 * the tallies the heading is what stops the list reading as more tallies, and
 * the margin is what holds it off them — so both are conditioned rather than
 * deleted, and the phone renders exactly what it rendered before.
 *
 * ## What must not happen while fixing it
 *
 * Invariant 13. The heading may go; **the dues may not**. A pane that quietly
 * dropped a row to line its top edge up would be a worse bug than the one being
 * fixed, and it would look tidy, which is how it would survive.
 */

const DAY = 86_400_000;

/** A 10" tablet. 1280 − 96 of rail leaves 1184, well over the 992 threshold. */
const TABLET = { width: 1280, height: 800 };

async function aDamInKid(): Promise<void> {
  const group = newId();
  const dam = newId();

  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: group,
    payload: { name: 'The does', species: 'goat', count: 4, purposes: ['milk'] },
  });
  await enqueue({
    entity: 'animal',
    op: 'create',
    targetId: dam,
    payload: { flockId: group, name: 'Bramble', species: 'goat', sex: 'female' },
  });
  await enqueue({
    entity: 'breeding',
    op: 'create',
    targetId: newId(),
    // Bred long enough ago that the birth row is inside its notice window.
    payload: { damId: dam, species: 'goat', method: 'natural', bredAt: Date.now() - 145 * DAY },
  });
}

beforeEach(async () => {
  await freshStore();
  seedWindow();
  seedInsets();
});

describe('the dues heading', () => {
  it('names the list when it is stacked under the tallies', async () => {
    await aDamInKid();
    const screen = await mount(<TodayScreen />);

    expect(screen.text()).toContain('Also today');
    screen.unmount();
  });

  it('says nothing when the list is a pane of its own', async () => {
    await aDamInKid();
    seedWindow(TABLET);
    const screen = await mount(<TodayScreen />);

    // The column beside it has no heading, so this one is the whole of the
    // difference between the two panes' top edges.
    expect(screen.text()).not.toContain('Also today');
    screen.unmount();
  });

  it('keeps every due either way', async () => {
    await aDamInKid();

    const phone = await mount(<TodayScreen />);
    const stacked = phone.text().replace('Also today', '');
    phone.unmount();

    seedWindow(TABLET);
    const tablet = await mount(<TodayScreen />);
    const beside = tablet.text();
    tablet.unmount();

    // Whatever the row says, it says it in both. Asserted against the phone's
    // own output rather than a copied string, so a change to the wording
    // cannot quietly turn this into a test of nothing.
    expect(stacked.length).toBeGreaterThan(0);
    for (const word of stacked.split(/\s+/).filter((w) => w.length > 3)) {
      expect(beside, word).toContain(word);
    }
  });
});

describe('the gap that held the dues off the tallies', () => {
  const asideBoxes = (screen: { tree: { toJSON: () => unknown } }): Record<string, unknown>[] =>
    styles(screen.tree.toJSON()).filter((s) => s.gap === SPACE.sm);

  it('is there when they are underneath', async () => {
    await aDamInKid();
    const screen = await mount(<TodayScreen />);

    expect(asideBoxes(screen).some((s) => s.marginTop === SPACE.md)).toBe(true);
    screen.unmount();
  });

  it('is gone when they are alongside, where there is nothing above to clear', async () => {
    await aDamInKid();
    seedWindow(TABLET);
    const screen = await mount(<TodayScreen />);

    expect(asideBoxes(screen).some((s) => s.marginTop === SPACE.md)).toBe(false);
    screen.unmount();
  });
});

/** Every element's effective style, flattened — same helper as panes.test. */
function styles(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    node.forEach((n) => styles(n, out));
    return out;
  }
  if (typeof node !== 'object' || node === null) return out;

  const n = node as { props?: { style?: unknown }; children?: unknown };
  if (n.props?.style !== undefined) {
    const merged: Record<string, unknown> = {};
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return void v.forEach(walk);
      if (typeof v === 'object' && v !== null) Object.assign(merged, v);
    };
    walk(n.props.style);
    out.push(merged);
  }
  if (n.children !== undefined) styles(n.children, out);
  return out;
}
