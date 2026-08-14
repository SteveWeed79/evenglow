import { ulid } from 'ulid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionClaims } from '@steading/api/auth/claims';
import { scopedOn } from '@steading/api/db/scoped';
import { applyBatch } from '@steading/api/sync/apply';
import { makeMutation } from '../support/fixtures';
import { startTestDb } from '../support/mongo';

/**
 * The shelf adjustment on the write path — tenancy, idempotency, and the rule
 * that makes it append-only.
 *
 * Reported from a farm: *"users should be able to add direct quantities to the
 * items on the shelf as needed. Currently if an item is on the shelf it's there
 * until used. What if some is lost? Mice etc?"*
 *
 * The number could always be changed; changing it just said nothing. This is
 * the record of *why* — and because it is a new entity on the sync path,
 * `CLAUDE.md` asks for the isolation and idempotency tests before the feature
 * counts as done.
 */

const harness = await startTestDb('steading_stock');
const describeDb = harness ? describe : describe.skip;

const ORG_A = ulid();
const ORG_B = ulid();

const OWNER_A: SessionClaims = { userId: ulid(), orgId: ORG_A, role: 'owner' };
const OWNER_B: SessionClaims = { userId: ulid(), orgId: ORG_B, role: 'owner' };

const ITEM = ulid();

function scope(orgId: string) {
  return scopedOn(harness!.db, orgId);
}

function adjustment(over: Record<string, unknown> = {}) {
  return makeMutation({
    entity: 'stockAdjustment',
    op: 'create',
    payload: {
      itemId: ITEM,
      delta: -4,
      reason: 'lost',
      occurredAt: Date.parse('2026-08-14T09:00:00Z'),
      ...over,
    },
  });
}

afterAll(async () => {
  await harness?.stop();
});

describeDb('a shelf adjustment', () => {
  beforeEach(async () => {
    await harness!.db.collection('mutations').deleteMany({});
    await harness!.db.collection('stockAdjustments').deleteMany({});
  });

  it('applies', async () => {
    const results = await applyBatch(scope(ORG_A), OWNER_A, [adjustment()]);

    expect(results.map((r) => r.status)).toEqual(['applied']);

    const rows = await harness!.db.collection('stockAdjustments').find({ orgId: ORG_A }).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: 'lost', delta: -4, itemId: ITEM });
  });

  /** A3: the same batch twice is one record, not two. */
  it('is one record however many times the batch arrives', async () => {
    const batch = [adjustment()];

    await applyBatch(scope(ORG_A), OWNER_A, batch);
    const second = await applyBatch(scope(ORG_A), OWNER_A, batch);

    expect(second.map((r) => r.status)).toEqual(['duplicate']);
    expect(await harness!.db.collection('stockAdjustments').countDocuments({ orgId: ORG_A })).toBe(1);
  });

  /**
   * Cross-tenant. A farm's shelf losses are its own business — what went mouldy
   * and how much is exactly the sort of thing a neighbour has no claim on.
   */
  it('never lands in another farm', async () => {
    await applyBatch(scope(ORG_A), OWNER_A, [adjustment()]);

    expect(await harness!.db.collection('stockAdjustments').countDocuments({ orgId: ORG_B })).toBe(0);
  });

  it('does not let one farm write into another by asking nicely', async () => {
    await applyBatch(scope(ORG_B), OWNER_B, [adjustment({ delta: -99 })]);

    const mine = await harness!.db.collection('stockAdjustments').find({ orgId: ORG_A }).toArray();
    expect(mine).toHaveLength(0);
  });

  /**
   * Append-only. A loss is a thing that happened, and editing it away would be
   * the one operation that makes the record worthless — the whole reason this
   * entity exists rather than a silent quantity edit.
   */
  it('refuses an update', async () => {
    const results = await applyBatch(scope(ORG_A), OWNER_A, [
      makeMutation({ entity: 'stockAdjustment', op: 'update', payload: { delta: -1 } }),
    ]);

    expect(results[0]?.status).toBe('rejected');
  });

  /**
   * Taking one back IS allowed, and that is settled rather than an oversight.
   *
   * `mutation.ts` argues it at length under *there is no permanent entity*: a
   * fat-fingered entry that cannot be removed is a wrong number the farm is
   * stuck with forever. Append-only means it cannot be quietly **edited** into
   * something else — the removal is itself a mutation and leaves its own trace.
   */
  it('can be taken back, because a mistyped one otherwise stands forever', async () => {
    const results = await applyBatch(scope(ORG_A), OWNER_A, [
      makeMutation({ entity: 'stockAdjustment', op: 'delete', payload: {} }),
    ]);

    expect(results[0]?.status).toBe('applied');
  });

  /**
   * Zero is not a correction anybody makes — it is a form submitted by
   * accident, and accepting it would put rows in the history saying nothing
   * happened.
   */
  it('refuses a change of nothing', async () => {
    const results = await applyBatch(scope(ORG_A), OWNER_A, [adjustment({ delta: 0 })]);

    expect(results[0]?.status).toBe('rejected');
  });

  it('refuses a reason it does not know', async () => {
    const results = await applyBatch(scope(ORG_A), OWNER_A, [
      adjustment({ reason: 'borrowed by a neighbour' }),
    ]);

    expect(results[0]?.status).toBe('rejected');
  });

  /** Buying more is the same event in the other direction. */
  it('takes a positive change', async () => {
    const results = await applyBatch(scope(ORG_A), OWNER_A, [
      adjustment({ delta: 10, reason: 'bought' }),
    ]);

    expect(results[0]?.status).toBe('applied');
  });
});
