import { beforeEach, describe, expect, it } from 'vitest';
import { isAppendOnly, newId, stockAdjustmentCreateSchema } from '@homefarm/contracts';
import { enqueue } from '@homefarm/core/sync/queue';
import { listInventory } from '@homefarm/core/read/iron';
import { listHistory } from '@homefarm/core/read/history';
import { freshStore } from '../support/store';

/**
 * Recording what happened to something on the shelf.
 *
 * Reported from a farm: *"users should be able to add direct quantities to the
 * items on the shelf as needed. Currently if an item is on the shelf it's there
 * until used. What if some is lost? Mice etc?"*
 *
 * The gap was never that the number could not be changed — `inventory` is
 * mutable and `quantity` was always writable. It was that changing it **said
 * nothing**, and because logging feed is the one thing that already drew the
 * shelf down, every other reason silently looked like consumption. A farm that
 * loses a quarter of a sack to vermin has not spent that on eggs, and
 * `feedCostPerEgg` divides by exactly that number.
 *
 * The write path through the applier — tenancy and idempotency — is in
 * `tests/sync/stock-adjustment.test.ts`, which needs a real mongod and runs in
 * CI. What is asserted here is the contract and the local store, which do not.
 */

const ITEM = newId();

async function aSack(quantity = 10): Promise<void> {
  await enqueue({
    entity: 'inventory',
    op: 'create',
    targetId: ITEM,
    payload: { name: 'Layer pellets', kind: 'feed', unit: 'bag', quantity },
  });
}

const adjust = (over: Record<string, unknown> = {}): Promise<unknown> =>
  enqueue({
    entity: 'stockAdjustment',
    op: 'create',
    targetId: newId(),
    payload: {
      itemId: ITEM,
      delta: -4,
      reason: 'lost',
      occurredAt: Date.parse('2026-08-14T09:00:00'),
      ...over,
    },
  });

beforeEach(async () => {
  await freshStore();
  await aSack();
});

describe('the shape', () => {
  /**
   * Append-only, and that is the point rather than a category it happened to
   * land in. A loss is a thing that happened; editing it away afterwards would
   * make the record worthless, which is the whole reason this exists instead of
   * a silent quantity edit.
   */
  it('cannot be edited or removed', () => {
    expect(isAppendOnly('stockAdjustment')).toBe(true);
  });

  it('refuses a change of nothing', () => {
    const parsed = stockAdjustmentCreateSchema.safeParse({
      itemId: ITEM,
      delta: 0,
      reason: 'lost',
      occurredAt: 1,
    });

    expect(parsed.success).toBe(false);
  });

  it('refuses a reason it does not know', () => {
    const parsed = stockAdjustmentCreateSchema.safeParse({
      itemId: ITEM,
      delta: -1,
      reason: 'borrowed by a neighbour',
      occurredAt: 1,
    });

    expect(parsed.success).toBe(false);
  });

  /** Half a bale is a real amount, and so is half a bale gone mouldy. */
  it('takes a fraction', () => {
    const parsed = stockAdjustmentCreateSchema.safeParse({
      itemId: ITEM,
      delta: -0.5,
      reason: 'spoiled',
      occurredAt: 1,
    });

    expect(parsed.success).toBe(true);
  });
});

describe('recording one', () => {
  it('is refused locally before it can reach the queue', async () => {
    await expect(adjust({ delta: 0 })).rejects.toThrow();
  });

  it('keeps the reason and the note', async () => {
    await adjust({ note: 'Chewed through the corner' });

    const days = await listHistory();
    const said = days.flatMap((day) => day.events).map((event) => `${event.title} ${event.detail ?? ''}`);

    expect(said.join(' | ')).toContain('Lost 4');
    expect(said.join(' | ')).toContain('Layer pellets');
    expect(said.join(' | ')).toContain('Chewed through the corner');
  });

  /**
   * The two writes are separate mutations, the same shape `FeedScreen` uses to
   * log a feed and draw the sack down. The adjustment is the record; the
   * quantity is the running total, and it stays a running total for the reason
   * it always was — a stock level is corrected, not observed.
   */
  it('leaves the shelf alone by itself', async () => {
    await adjust();

    const [item] = await listInventory();
    expect(item?.quantity).toBe(10);
  });

  it('moves with the paired update, as the screen writes it', async () => {
    await adjust();
    await enqueue({
      entity: 'inventory',
      op: 'update',
      targetId: ITEM,
      payload: { quantity: 6 },
    });

    const [item] = await listInventory();
    expect(item?.quantity).toBe(6);
  });
});
