import type { Db } from 'mongodb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionClaims } from '@steading/api/auth/claims';
import { scopedOn } from '@steading/api/db/scoped';
import { applyBatch } from '@steading/api/sync/apply';
import {
  inCommitOrder,
  nextServerTs,
  resetCommitOrder,
} from '@steading/api/sync/commit-order';
import { makeMutation } from '../support/fixtures';

/**
 * `(serverTs, _id)` as an order over commits rather than over intentions.
 *
 * Hydration seeks and sorts on that pair and a device advances its watermark
 * past everything it has read, which is sound only if a row can never become
 * visible carrying a value below a watermark already published. It could: the
 * stamp was taken while the document was being built, before the `await` on the
 * upsert, so a request that stamped early and committed late landed behind a
 * device's cursor permanently. A clock stepping backwards on the host does the
 * same with no concurrency at all.
 *
 * Driven against a fake `Db`, so the ordering guarantees are asserted here
 * rather than only in the CI job that has a database — and the interleavings
 * are deterministic rather than timing-dependent, which is the point of the
 * lock.
 */

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const OWNER: SessionClaims = { userId: 'user-1', orgId: ORG_A, role: 'owner' };

/**
 * Enough Mongo to run mutations through, with a settable delay so one request
 * can be made to stall exactly where the bug used to live: after the stamp and
 * before the insert.
 */
function fakeDb(options: { newest?: Date; stallMs?: number } = {}) {
  const inserted: { id: string; serverTs: Date }[] = [];
  const events: string[] = [];
  let stall = options.stallMs ?? 0;

  const collection = (name: string) => ({
    findOne: () => Promise.resolve(null),
    find: () => ({
      limit: () => ({
        sort: () => ({
          toArray: () =>
            Promise.resolve(
              name === 'mutations' && options.newest ? [{ serverTs: options.newest }] : [],
            ),
        }),
      }),
    }),
    countDocuments: () => Promise.resolve(0),
    insertOne: () => Promise.resolve({ acknowledged: true }),
    updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      const set = (update.$setOnInsert ?? {}) as { serverTs?: Date };
      if (name === 'mutations' && set.serverTs instanceof Date) {
        events.push(`stamp:${String(filter._id)}`);
        if (stall > 0) {
          const wait = stall;
          stall = 0;
          await new Promise((r) => setTimeout(r, wait));
        }
        inserted.push({ id: String(filter._id), serverTs: set.serverTs });
        events.push(`insert:${String(filter._id)}`);
      }
      if (name !== 'mutations') events.push(`project:${name}`);
      return { upsertedCount: 1 };
    },
    deleteOne: () => Promise.resolve({ deletedCount: 1 }),
  });

  return { db: { collection } as unknown as Db, inserted, events };
}

beforeEach(resetCommitOrder);
afterEach(() => {
  vi.useRealTimers();
  resetCommitOrder();
});

describe('serialising a farm\'s commits', () => {
  it('runs queued work one at a time, in the order it arrived', async () => {
    const order: string[] = [];
    const step = async (name: string) => {
      order.push(`${name}:start`);
      await Promise.resolve();
      await Promise.resolve();
      order.push(`${name}:end`);
    };

    await Promise.all([
      inCommitOrder(ORG_A, () => step('a')),
      inCommitOrder(ORG_A, () => step('b')),
      inCommitOrder(ORG_A, () => step('c')),
    ]);

    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
  });

  it('does not make one farm wait for another', async () => {
    const order: string[] = [];
    let releaseA!: () => void;
    const blocked = new Promise<void>((r) => (releaseA = r));

    const a = inCommitOrder(ORG_A, async () => {
      order.push('a:start');
      await blocked;
      order.push('a:end');
    });
    const b = inCommitOrder(ORG_B, async () => {
      order.push('b');
    });

    await b;
    expect(order).toEqual(['a:start', 'b']);

    releaseA();
    await a;
  });

  /**
   * A mutation that throws must not wedge every later mutation for that farm
   * behind it — the chain is resolved from a `finally` precisely so a rejection
   * cannot become permanent.
   */
  it('keeps the chain moving when work throws', async () => {
    await expect(
      inCommitOrder(ORG_A, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');

    await expect(inCommitOrder(ORG_A, () => Promise.resolve('after'))).resolves.toBe('after');
  });

  it('does not accumulate a chain per farm for ever', async () => {
    for (let i = 0; i < 5; i++) await inCommitOrder(`org-${i}`, () => Promise.resolve());

    // Nothing queued behind any of them, so nothing is retained. Asserted
    // through behaviour rather than the map: a leak would show as a chain that
    // never lets the next caller start.
    const order: string[] = [];
    await inCommitOrder('org-0', async () => void order.push('ran'));
    expect(order).toEqual(['ran']);
  });
});

describe('stamping a commit', () => {
  it('never issues the same instant twice', async () => {
    const { db } = fakeDb();
    const scope = scopedOn(db, ORG_A);

    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_700_000_000_000));

    const stamps = [
      await nextServerTs(scope),
      await nextServerTs(scope),
      await nextServerTs(scope),
    ].map((d) => d.getTime());

    expect(stamps).toEqual([1_700_000_000_000, 1_700_000_000_001, 1_700_000_000_002]);
  });

  /**
   * The case that needs no concurrency at all: NTP correcting a drifted host,
   * or an operator setting the date. Without the clamp the later commit carries
   * the earlier stamp and lands behind a cursor that has already passed it.
   */
  it('keeps climbing when the host clock steps backwards', async () => {
    const { db } = fakeDb();
    const scope = scopedOn(db, ORG_A);

    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_700_000_000_000));
    const before = await nextServerTs(scope);

    vi.setSystemTime(new Date(1_600_000_000_000));
    const after = await nextServerTs(scope);

    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });

  /**
   * An in-memory floor is lost on restart — and a restart is exactly when a
   * corrected clock takes effect, so seeding from the newest row is what makes
   * the clamp survive the case it exists for.
   */
  it('seeds its floor from the newest row already stored', async () => {
    const { db } = fakeDb({ newest: new Date(1_900_000_000_000) });
    const scope = scopedOn(db, ORG_A);

    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_700_000_000_000));

    expect((await nextServerTs(scope)).getTime()).toBe(1_900_000_000_001);
  });

  it('keeps one farm\'s floor out of another\'s', async () => {
    const { db } = fakeDb();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_700_000_000_000));

    const a = await nextServerTs(scopedOn(db, ORG_A));
    const b = await nextServerTs(scopedOn(db, ORG_B));

    expect(a.getTime()).toBe(b.getTime());
  });
});

describe('a request that stamps early and commits late', () => {
  /**
   * The interleaving the item is named for, made deterministic by the lock.
   *
   * The first request is stalled between its stamp and its insert. Before the
   * fix it would insert behind the second one's timestamp — a row appearing
   * below a watermark a device may already have advanced past, and therefore
   * never pulled. Now the second cannot start until the first has committed.
   */
  it('cannot land behind a mutation that started after it', async () => {
    const { db, inserted, events } = fakeDb({ stallMs: 25 });
    const scope = scopedOn(db, ORG_A);

    const slow = makeMutation({ id: 'A'.repeat(26) });
    const quick = makeMutation({ id: 'B'.repeat(26) });

    await Promise.all([
      applyBatch(scope, OWNER, [slow]),
      applyBatch(scope, OWNER, [quick]),
    ]);

    const a = inserted.find((r) => r.id === 'A'.repeat(26));
    const b = inserted.find((r) => r.id === 'B'.repeat(26));

    expect(a).toBeDefined();
    expect(b).toBeDefined();
    // Insertion order and stamp order agree, which is the whole property.
    expect(inserted.map((r) => r.id)).toEqual(['A'.repeat(26), 'B'.repeat(26)]);
    expect(b!.serverTs.getTime()).toBeGreaterThan(a!.serverTs.getTime());

    // And nothing of the second interleaved into the first: no stamp is taken
    // before the previous insert has happened.
    const firstInsert = events.indexOf(`insert:${'A'.repeat(26)}`);
    const secondStamp = events.indexOf(`stamp:${'B'.repeat(26)}`);
    expect(secondStamp).toBeGreaterThan(firstInsert);
  });

  /**
   * The applier has to take the CLAMPED stamp, not a bare clock read.
   *
   * The lock alone makes insertion order match stamp order, but two mutations
   * inside one millisecond would then share a `serverTs` and the cursor would
   * fall back to breaking the tie on the ULID — which is client-minted and has
   * no relationship to commit order. A device that advanced past the higher
   * ULID would never be offered the lower one.
   */
  it('gives two commits in the same millisecond distinct stamps', async () => {
    const { db, inserted } = fakeDb();
    const scope = scopedOn(db, ORG_A);

    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_700_000_000_000));

    await applyBatch(scope, OWNER, [makeMutation({ id: 'B'.repeat(26) })]);
    await applyBatch(scope, OWNER, [makeMutation({ id: 'A'.repeat(26) })]);

    const [first, second] = inserted;
    expect(first?.serverTs.getTime()).toBe(1_700_000_000_000);
    // Strictly later, even though the clock did not move — and note the second
    // carries the LOWER ULID, which is exactly the case a tie-break would get
    // backwards.
    expect(second?.serverTs.getTime()).toBe(1_700_000_000_001);
  });

  /**
   * Interleaving 2, which no cursor change reaches. The log write and the
   * projection are separate awaits, so two concurrent mutations could project in
   * the opposite order to the one they logged in — leaving Mongo at one value
   * and a clean replay of the log at the other.
   */
  it('projects in the order it logged', async () => {
    const { db, events } = fakeDb({ stallMs: 25 });
    const scope = scopedOn(db, ORG_A);

    await Promise.all([
      applyBatch(scope, OWNER, [makeMutation({ id: 'A'.repeat(26) })]),
      applyBatch(scope, OWNER, [makeMutation({ id: 'B'.repeat(26) })]),
    ]);

    const sequence = events.filter((e) => !e.startsWith('project:mutations'));
    const firstProject = sequence.indexOf('project:eggLogs');

    // The first mutation's projection lands before the second is even stamped.
    expect(firstProject).toBeGreaterThan(sequence.indexOf(`insert:${'A'.repeat(26)}`));
    expect(firstProject).toBeLessThan(sequence.indexOf(`stamp:${'B'.repeat(26)}`));
  });
});
