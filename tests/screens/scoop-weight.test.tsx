import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@homefarm/contracts';
import { listInventory } from '@homefarm/core/read/iron';
import { enqueue } from '@homefarm/core/sync/queue';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { navCalls } from '../support/native/navigation';
import { AddItemScreen } from '../../apps/mobile/src/screens/AddItemScreen';
import { EditItemScreen } from '../../apps/mobile/src/screens/EditItemScreen';
import { FeedScreen } from '../../apps/mobile/src/screens/FeedScreen';
import { InventoryScreen } from '../../apps/mobile/src/screens/InventoryScreen';

/**
 * Saying what your scoop holds, somewhere a person can find it.
 *
 * Reported: *"I don't see where the user can add the weight that their scoop
 * holds for feeding usage."*
 *
 * The field existed. It was reachable from exactly one place — the feed log —
 * behind four conditions stacked on each other: the feed had to match a shelf
 * sack **by name**, the measure had to be scoops, the sack had to be counted in
 * lb or kg, and the scoop had to be **unanswered**. A farm browsing the app for
 * it would never meet all four at once, which is why the report reads as though
 * the feature is missing. From outside, an unfindable control is a missing one.
 *
 * The last condition was the worse half. Answering removed the only control
 * that could change the answer, so a scoop fat-fingered as 20 lb instead of 2
 * multiplied every scoop-measured feeding by ten — permanently, with no way
 * back and nothing on screen saying what figure was being used.
 *
 * So the scoop is a fact about the sack now, kept where the sack is described:
 * offered when it goes on the shelf, owned by the edit screen, shown on the
 * shelf card, and still asked for mid-feed because that is when it is noticed.
 */

const GROUP = newId();
const PELLETS = newId();

/** Grams per unit as the app states them — see `GRAMS_PER_UNIT` in `iron.ts`. */
const LB = 454;
const KG = 1000;

async function shelfItem(over: Record<string, unknown> = {}): Promise<void> {
  await enqueue({
    entity: 'inventory',
    op: 'create',
    targetId: PELLETS,
    payload: { name: 'Layer pellets', kind: 'feed', unit: 'lb', quantity: 50, ...over },
  });
}

async function only(): Promise<Record<string, unknown>> {
  const items = await listInventory();
  expect(items).toHaveLength(1);
  return items[0] as unknown as Record<string, unknown>;
}

beforeEach(async () => {
  await freshStore();
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: { name: 'Breeding Crew', species: 'chicken', count: 10, purposes: ['eggs'] },
  });
});

/**
 * The shelf is where a sack is described, so it is where the scoop belongs.
 * A farm unpacking a bag can answer once and never think about it again.
 */
describe('putting a sack on the shelf', () => {
  it('asks what the scoop holds, and stores it in grams', async () => {
    const screen = await mount(<AddItemScreen {...routeProps({})} />);

    await screen.type('item-name', 'Layer pellets');
    await screen.pressLabel('Pounds');
    await screen.type('item-scoop', '2');
    await screen.press('save-item');

    expect((await only()).scoopGrams).toBe(2 * LB);
  });

  /** Optional, and it has to stay optional — nothing is lost by skipping it. */
  it('saves without one, leaving the scoop an estimate', async () => {
    const screen = await mount(<AddItemScreen {...routeProps({})} />);

    await screen.type('item-name', 'Layer pellets');
    await screen.pressLabel('Pounds');
    await screen.press('save-item');

    expect((await only()).scoopGrams).toBeUndefined();
  });

  /**
   * And it is only asked where the answer could be used for something. A scoop
   * of bedding is not fed, and a sack counted in bags cannot be drawn down by
   * one — so asking would be collecting a number to ignore.
   */
  it('does not ask about a feed counted in bags', async () => {
    const screen = await mount(<AddItemScreen {...routeProps({})} />);
    // 'bag' is the starting unit, so this is the state a farm lands in.
    expect(screen.has('item-scoop')).toBe(false);
  });

  it('does not ask about bedding', async () => {
    const screen = await mount(<AddItemScreen {...routeProps({})} />);

    await screen.pressLabel('Bedding');
    await screen.pressLabel('Pounds');

    expect(screen.has('item-scoop')).toBe(false);
  });
});

/**
 * ── The correction that could not be made ────────────────────────────────────
 *
 * This is the half the report was really about. Before, answering the question
 * destroyed the only place it could be answered.
 */
describe('changing a scoop already said', () => {
  it('shows what the farm said, in the sack’s own unit', async () => {
    await shelfItem({ scoopGrams: 2 * LB });
    const screen = await mount(<EditItemScreen {...routeProps({ itemId: PELLETS })} />);

    expect(screen.shows('edit-item-scoop')).toBe('2');
  });

  it('takes a correction', async () => {
    await shelfItem({ scoopGrams: 20 * LB });
    const screen = await mount(<EditItemScreen {...routeProps({ itemId: PELLETS })} />);

    await screen.type('edit-item-scoop', '2');
    await screen.press('save-item');

    expect((await only()).scoopGrams).toBe(2 * LB);
  });

  /**
   * Emptying it is a real answer — *I do not know what my scoop holds any
   * more* — and puts the sack back to the estimate rather than freezing a
   * figure the farm has disowned. Null is how the wire says that.
   */
  it('goes back to an estimate when emptied', async () => {
    await shelfItem({ scoopGrams: 2 * LB });
    const screen = await mount(<EditItemScreen {...routeProps({ itemId: PELLETS })} />);

    await screen.type('edit-item-scoop', '');
    await screen.press('save-item');

    expect((await only()).scoopGrams).toBeUndefined();
  });

  /**
   * Correcting how the sack is COUNTED must not resize the scoop.
   *
   * The field states the scoop in the sack's unit, so switching lb to kg would
   * otherwise leave "2" standing and quietly mean 2 kg — a scoop that grew by
   * a factor of two because somebody fixed an unrelated field.
   */
  it('holds the scoop’s weight when the sack’s unit changes', async () => {
    await shelfItem({ scoopGrams: 2 * LB });
    const screen = await mount(<EditItemScreen {...routeProps({ itemId: PELLETS })} />);

    await screen.pressLabel('kg');
    await screen.press('save-item');

    const item = await only();
    expect(item.unit).toBe('kg');
    // 908 g, still — 0.91 kg re-expressed and rounded to the two decimals the
    // field shows. What matters is that it did not become 2 kg.
    expect(item.scoopGrams).toBe(Math.round(0.91 * KG));
  });

  /**
   * A feed corrected to a unit a scoop cannot be stated against loses the
   * scoop with it. Leaving the grams behind would have the shelf drawing down
   * on a figure no screen displays any more.
   */
  it('drops the scoop when the sack stops being counted by weight', async () => {
    await shelfItem({ scoopGrams: 2 * LB });
    const screen = await mount(<EditItemScreen {...routeProps({ itemId: PELLETS })} />);

    await screen.pressLabel('bag');
    expect(screen.has('edit-item-scoop')).toBe(false);

    await screen.press('save-item');
    expect((await only()).scoopGrams).toBeUndefined();
  });
});

/** And it is visible without opening anything, so a wrong one can be spotted. */
describe('the shelf', () => {
  it('says what each sack’s scoop holds', async () => {
    await shelfItem({ scoopGrams: 2 * LB });
    const screen = await mount(<InventoryScreen />);

    expect(screen.text()).toContain('scoop 2 lb');
  });

  it('says nothing where nobody has said', async () => {
    await shelfItem();
    const screen = await mount(<InventoryScreen />);

    expect(screen.text()).not.toContain('scoop');
  });

  /**
   * The only route to the edit screen ran through "Something happened to it",
   * which means *record an event* and reads like it — so the name, the unit,
   * the reorder level and the scoop were four taps deep behind a label that
   * promises something else.
   */
  it('offers a way to change the sack itself', async () => {
    await shelfItem();
    const screen = await mount(<InventoryScreen />);

    await screen.press(`edit-${PELLETS}`);

    expect(navCalls()).toContainEqual({
      action: 'navigate',
      route: 'EditItem',
      params: { itemId: PELLETS },
    });
  });
});

/**
 * Mid-feed, the question still gets asked — that part was right, and standing
 * in the barn wondering why the shelf did not move is when it makes sense.
 * What changed is what happens after it is answered.
 */
describe('logging a feed by the scoop', () => {
  async function feeding(): Promise<Awaited<ReturnType<typeof mount>>> {
    const screen = await mount(<FeedScreen {...routeProps({ groupId: GROUP })} />);
    await screen.pressLabel('Layer pellets');
    await screen.pressLabel('Scoops');
    return screen;
  }

  it('still asks when nothing has been said', async () => {
    await shelfItem();
    const screen = await feeding();

    expect(screen.text()).toContain('How much does your scoop hold?');
    expect(screen.has('feed-scoop-size')).toBe(true);
  });

  /** It used to go silent here, using a figure it would not show. */
  it('says what scoop it is using once it knows', async () => {
    await shelfItem({ scoopGrams: 2 * LB });
    const screen = await feeding();

    expect(screen.text()).toContain('at 2 lb a scoop');
  });

  /** And answering no longer removes every way to change the answer. */
  it('offers the way back to correct it', async () => {
    await shelfItem({ scoopGrams: 20 * LB });
    const screen = await feeding();

    await screen.press('feed-scoop-change');

    expect(navCalls()).toContainEqual({
      action: 'navigate',
      route: 'EditItem',
      params: { itemId: PELLETS },
    });
  });
});
