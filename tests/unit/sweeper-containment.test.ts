import { describe, expect, it } from 'vitest';
import type { Db } from 'mongodb';
import { scopedOn } from '@homefarm/api/db/scoped';
import { sweepFarm } from '@homefarm/api/sync/sweep';

/**
 * One bad row must not take the farm, or every farm behind it.
 *
 * The sweeper had **no error containment at all**: the only `try` was around
 * the whole pass, so a row that threw abandoned every remaining row on that
 * farm and every farm after it in `listOrgIds`. And the row stays undecided —
 * that is what being swept would have changed — so it throws again on the next
 * pass, and the one after that.
 *
 * A box with two hundred farms could therefore have every farm past the third
 * silently unswept for ever, which is exactly the *"quietest possible bug"*
 * `sweepAllFarms` says in its own comment it was written to prevent.
 *
 * ## Why a fake scope rather than the isolation suite
 *
 * `sweepFarm` takes its `Scoped` as a parameter — a seam the code genuinely has
 * — so the throw can be injected without a mongod. The mongod-backed sweeper
 * suite covers what a real sweep decides; this covers what it does when
 * something under it fails, which is the half no fixture can arrange.
 */

const CUTOFF_SAFE = 0;

/**
 * A database whose `mutations` page is `rows`, and whose per-row read throws
 * for any id in `poison`.
 *
 * A fake `Db` behind the real `scopedOn`, which is the seam that function's own
 * comment names — *"so the guard behaviour can be exercised against a fake in
 * tests without a live server"* — and the same shape `scoped.test.ts` uses. The
 * first draft faked `Scoped` itself and would not typecheck against its generic
 * `col`, which was the type system pointing at the wrong seam.
 *
 * `sweepOne` reads the envelope back through `replayFromLog`, so a `findOne`
 * that rejects is a row that throws: a corrupt document, a driver timeout, a
 * decoding failure.
 */
function dbWith(rows: readonly string[], poison: ReadonlySet<string>): Db {
  const page = rows.map((id) => ({ _id: id, userId: 'u1', serverTs: new Date(1_000) }));
  let served = false;

  const collection = () => ({
    find: () => ({
      limit: () => ({
        sort: () => ({
          toArray: () => {
            // One page, then nothing — the loop stops on a short page.
            if (served) return Promise.resolve([]);
            served = true;
            return Promise.resolve(page);
          },
        }),
        toArray: () => Promise.resolve([]),
      }),
    }),
    findOne: (filter: { _id?: string }) => {
      const id = filter._id;
      if (id !== undefined && poison.has(id)) {
        return Promise.reject(new Error(`row ${id} is unreadable`));
      }
      // Not a shape `replayFromLog` can use, so the row is counted
      // `unreadable` — a decision, and not a throw.
      return Promise.resolve(null);
    },
    countDocuments: () => Promise.resolve(0),
    // The `unreadable` path STAMPS the row, so the write has to succeed or
    // every row throws and the test proves nothing. That is what the first
    // draft did, and it is why the numbers came back three instead of one.
    updateOne: () => Promise.resolve({ matchedCount: 1, modifiedCount: 1 }),
    insertOne: () => Promise.resolve({ acknowledged: true }),
    deleteOne: () => Promise.resolve({ deletedCount: 0 }),
  });

  return { collection } as unknown as Db;
}

const farm = (rows: readonly string[], poison: ReadonlySet<string>) =>
  scopedOn(dbWith(rows, poison), 'org-1');

describe('a row that throws mid-sweep', () => {
  it('does not stop the rows behind it', async () => {
    const report = await sweepFarm(farm(['a', 'b', 'c'], new Set(['b'])), Date.now(), CUTOFF_SAFE);

    // All three were looked at, one threw, and the other two reached an outcome.
    expect(report.found).toBe(3);
    expect(report.rowsFailed).toBe(1);
    expect(report.unreadable).toBe(2);
  });

  /**
   * Counted and named, not swallowed. `capped` exists for the same reason: a
   * pass that skipped something and a pass that found everything must not look
   * the same in a log.
   */
  it('says what went wrong, keeping the first reason', async () => {
    const report = await sweepFarm(
      farm(['a', 'b', 'c'], new Set(['a', 'c'])),
      Date.now(),
      CUTOFF_SAFE,
    );

    expect(report.rowsFailed).toBe(2);
    expect(report.failure).toBe('row a is unreadable');
  });

  /** A clean farm reports no failures at all, so the counter means something. */
  it('says nothing failed when nothing did', async () => {
    const report = await sweepFarm(farm(['a', 'b'], new Set()), Date.now(), CUTOFF_SAFE);

    expect(report.rowsFailed).toBe(0);
    expect(report.farmsFailed).toBe(0);
    expect(report.failure).toBeUndefined();
  });
});
