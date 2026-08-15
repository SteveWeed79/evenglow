import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import type { SqlDriver, SqlOps, SqlValue } from '@steading/core/db/driver';
import { openSqliteStore } from '@steading/core/db/sqlite-store';
import { localStore, setLocalStore } from '@steading/core/db/store';
import { buildBackup, serialiseBackup } from '@steading/core/backup/file';
import { planRestore, readBackup, runRestore } from '@steading/core/backup/restore';
import { enqueue, enqueueAll } from '@steading/core/sync/queue';
import { freshStore } from '../support/store';
import { nodeIds, nodeSqlDriver } from '../support/sqlite';

/**
 * An entry that is two mutations, and the window between them (P1-6).
 *
 * A restore puts an archived record back as a `create` followed by a `delete`
 * — "archived" is not a field any create schema has, it is the outcome of a
 * delete. As two separate `enqueue` calls those were two transactions, so a
 * crash, a full disk, or a refusal between them left the record **live**.
 *
 * And nothing repaired it. `planRestore` treats the key's presence as
 * sufficient and skips the entry without comparing archive state, so on resume
 * the record is simply there and the missing archive is permanent. A retired
 * group, animal or machine reappears on every screen — on the morning somebody
 * sets the new phone up.
 *
 * The existing interruption test stops between *entries*, which is why it never
 * saw this: the window is inside one.
 */

const APP = '0.1.0-test';

/**
 * A driver that fails one statement, so a transaction can be cut in half from
 * the outside without the store knowing.
 *
 * The wrapping is on the handle the transaction body is given, not only on the
 * outer driver — that handle is the one the store writes through, and a
 * fault injected anywhere else would not be inside the transaction at all.
 */
function driverFailing(
  match: (sql: string, params: readonly SqlValue[]) => boolean,
): SqlDriver {
  const inner = nodeSqlDriver();

  const cut = (ops: SqlOps): SqlOps => ({
    run: async (sql, params = []) => {
      if (match(sql, params)) throw new Error('the lights went out');
      return ops.run(sql, params);
    },
    all: (sql, params) => ops.all(sql, params),
    get: (sql, params) => ops.get(sql, params),
    transaction: ops.transaction,
  });

  return {
    run: (sql, params) => inner.run(sql, params),
    all: (sql, params) => inner.all(sql, params),
    get: (sql, params) => inner.get(sql, params),
    transaction: (work) => inner.transaction((tx) => work(cut(tx))),
    close: () => inner.close(),
  };
}

/** The outbox insert carries the op at index 4. */
const OP = 4;

async function anArchivedFarm(): Promise<string> {
  const retired = newId();

  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: retired,
    payload: { name: 'Last year’s meat birds', species: 'chicken', count: 20, purposes: ['meat'] },
  });
  await enqueue({ entity: 'flock', op: 'delete', targetId: retired, payload: {} });

  return retired;
}

beforeEach(freshStore);

describe('a restore cut off between an entry’s two mutations', () => {
  it('leaves nothing rather than leaving the record live', async () => {
    const retired = await anArchivedFarm();
    const text = serialiseBackup((await buildBackup(newId(), APP)).file);
    const read = readBackup(text);
    if (!read.ok) throw new Error(read.message);

    // A fresh phone whose disk gives out on the archiving half of the entry.
    setLocalStore(
      await openSqliteStore(
        driverFailing((sql, params) => sql.includes('INSERT INTO outbox') && params[OP] === 'delete'),
        nodeIds(),
      ),
    );

    const plan = await planRestore(read.file, { signedIn: false });
    if (!plan.ok) throw new Error(plan.message);
    const result = await runRestore(plan);

    // Counted as refused, not written — which is the honest answer, and the
    // one a resume can act on.
    expect(result.written).toBe(0);
    expect(result.refused).toBe(1);

    // The create is gone with it. Before this, it stayed: a live record where
    // a retired one belonged.
    expect(await localStore().readRecordsByEntity('flock')).toEqual([]);
    expect(await localStore().readOutboxBySeq()).toEqual([]);

    // And the resume has something to do. A half-written entry looked complete
    // to `planRestore`, so this is what "never repaired" actually meant.
    const resumed = await planRestore(read.file, { signedIn: false });
    if (!resumed.ok) throw new Error(resumed.message);
    expect(resumed.toWrite.map((e) => e.targetId)).toContain(retired);
  });

  /**
   * The likelier of the three failures the work list names — far likelier than
   * a crash or a full disk — and the one that needs no fault injection at all:
   * the second payload is simply refused. Validating as it goes would have let
   * the first mutation through and then stopped, which is the same split state
   * arrived at by an ordinary route.
   */
  it('stores none of them when one payload is refused', async () => {
    const target = newId();

    await expect(
      enqueueAll([
        {
          entity: 'flock',
          op: 'create',
          targetId: target,
          payload: { name: 'The hens', species: 'chicken', count: 6, purposes: ['eggs'] },
        },
        { entity: 'flock', op: 'update', targetId: target, payload: { count: -4 } },
      ]),
    ).rejects.toThrow();

    expect(await localStore().readRecordsByEntity('flock')).toEqual([]);
    expect(await localStore().readOutboxBySeq()).toEqual([]);
  });
});

describe('an entry that is two mutations, when nothing goes wrong', () => {
  it('queues them in order, with consecutive sequence numbers', async () => {
    const retired = await anArchivedFarm();
    const text = serialiseBackup((await buildBackup(newId(), APP)).file);
    const read = readBackup(text);
    if (!read.ok) throw new Error(read.message);

    await freshStore();
    const plan = await planRestore(read.file, { signedIn: false });
    if (!plan.ok) throw new Error(plan.message);
    await runRestore(plan);

    const queued = (await localStore().readOutboxBySeq()).filter((m) => m.targetId === retired);

    expect(queued.map((m) => m.op)).toEqual(['create', 'delete']);
    // Consecutive, because the server applies in clientSeq order and a delete
    // that overtook its own create would archive nothing.
    expect(queued[1]!.clientSeq).toBe(queued[0]!.clientSeq + 1);

    // The projection agrees with the queue, which is invariant 5 across the
    // pair rather than across each half.
    const flocks = await localStore().readRecordsByEntity('flock');
    expect(flocks.find((r) => r.targetId === retired)?.deleted).toBe(true);
  });
});
