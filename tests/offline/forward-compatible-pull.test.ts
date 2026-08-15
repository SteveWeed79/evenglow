import { beforeEach, describe, expect, it } from 'vitest';
import { newId, readableRows, type PulledRow } from '@steading/contracts';
import { pullOnce } from '@steading/core/sync/pull';
import { localStore } from '@steading/core/db/store';
import {
  deleteMetaKey,
  freshStore,
  readRecordsByEntity,
  simulateRestart,
} from '../support/store';

/**
 * A client older than the farm's server.
 *
 * Widening `ENTITIES` is additive on the server, so the feed starts carrying a
 * new entity to every device the moment the server knows one — including the
 * ones still running last month's APK. The page used to be parsed as a unit
 * against the strict enum, so **one unmodelable row failed all of it**: the pull
 * returned `deferred: 'unreadable'`, the watermark never moved, and that install
 * stopped receiving any of the farm's records at all — not just the new kind —
 * permanently, behind a chip that said it was up to date.
 *
 * The comment in `mutation.ts` said this was fine. It was true of what a client
 * SENDS and false of what it reads.
 */

const DEVICE = '00000000-0000-4000-8000-0000000000ff';

interface Row {
  entity: string;
  targetId?: string;
  payload?: unknown;
  serverTs: number;
}

function row(r: Row, i: number): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: `${'0'.repeat(20)}${String(i).padStart(6, '0')}`,
    targetId: r.targetId ?? newId(),
    entity: r.entity,
    op: 'create',
    payload: r.payload ?? { name: 'Alpha', species: 'chicken', count: 12 },
    deviceId: DEVICE,
    clientSeq: i,
    clientTs: r.serverTs,
    serverTs: r.serverTs,
  };
}

/** One page, then nothing. */
function page(rows: Row[], overrides: Record<string, unknown> = {}) {
  return (since: number) =>
    Promise.resolve({
      status: 200,
      body:
        since === 0
          ? {
              mutations: rows.map(row),
              through: rows[rows.length - 1]?.serverTs ?? 0,
              throughId: `${'0'.repeat(20)}${String(rows.length - 1).padStart(6, '0')}`,
              more: false,
              ...overrides,
            }
          : { mutations: [], through: since, throughId: null, more: false },
    });
}

describe('a page carrying an entity this build does not know', () => {
  beforeEach(freshStore);

  it('applies the rows it can and skips the rest', async () => {
    const outcome = await pullOnce(
      page([
        { entity: 'flock', serverTs: 10 },
        { entity: 'beehive', serverTs: 20 },
        { entity: 'flock', payload: { name: 'Beta', species: 'chicken', count: 3 }, serverTs: 30 },
      ]),
    );

    expect(outcome.applied).toBe(2);
    expect(outcome.unmodelable).toBe(1);
    expect(outcome.deferred).toBeUndefined();

    const names = (await readRecordsByEntity('flock')).map((r) => (r.value as { name: string }).name);
    expect(names.sort()).toEqual(['Alpha', 'Beta']);
  });

  /**
   * The part that made it permanent. The cursor comes from the server's
   * `through`/`throughId`, taken from the last row READ rather than the last row
   * kept — so skipping locally still advances past what was skipped, exactly as
   * the server's own unknown-entity skip does.
   */
  it('advances the watermark past what it skipped', async () => {
    await pullOnce(page([{ entity: 'beehive', serverTs: 42 }]));

    expect((await localStore().pulledThrough()).through).toBe(42);
  });

  it('keeps hydrating on the next pass rather than wedging', async () => {
    await pullOnce(page([{ entity: 'beehive', serverTs: 10 }]));

    // A later pull, from the advanced cursor, delivers the rest of the farm.
    const second = await pullOnce((since) =>
      Promise.resolve({
        status: 200,
        body:
          since === 10
            ? {
                mutations: [row({ entity: 'flock', serverTs: 20 }, 1)],
                through: 20,
                throughId: `${'0'.repeat(20)}000001`,
                more: false,
              }
            : { mutations: [], through: since, throughId: null, more: false },
      }),
    );

    expect(second.applied).toBe(1);
    expect(await readRecordsByEntity('flock')).toHaveLength(1);
  });

  it('survives a page made entirely of rows it cannot model', async () => {
    const outcome = await pullOnce(
      page([
        { entity: 'beehive', serverTs: 10 },
        { entity: 'apiary', serverTs: 20 },
      ]),
    );

    expect(outcome.unmodelable).toBe(2);
    expect(outcome.applied).toBe(0);
    expect(outcome.deferred).toBeUndefined();
    expect((await localStore().pulledThrough()).through).toBe(20);
  });

  /**
   * The count has to outlive the pass that found it.
   *
   * Skipping the row is right — one unreadable kind must not stop hydration
   * altogether — but a device quietly missing a whole kind of record must not
   * look identical to one that has everything, and the pull that discovers it
   * is never the moment somebody is looking at a screen. So it is stored, and
   * the diagnostics sheet reads it.
   */
  it('remembers how many, across passes and across restarts', async () => {
    // Each pass serves whatever sits after the watermark, the way the real
    // feed does — `page()` above answers only the first ask, which is exactly
    // what a running total must not depend on.
    const later = (rows: Row[]) => (since: number) =>
      Promise.resolve({
        status: 200,
        body: {
          mutations: rows.filter((r) => r.serverTs > since).map(row),
          through: rows[rows.length - 1]?.serverTs ?? since,
          throughId: `${'0'.repeat(20)}${String(rows.length - 1).padStart(6, '0')}`,
          more: false,
        },
      });

    await pullOnce(later([{ entity: 'beehive', serverTs: 10 }]));
    expect(await localStore().unmodelableRows()).toBe(1);

    await pullOnce(later([{ entity: 'apiary', serverTs: 20 }]));
    expect(await localStore().unmodelableRows()).toBe(2);

    await simulateRestart();
    expect(await localStore().unmodelableRows()).toBe(2);
  });

  /**
   * And it resets when the projection repair starts, because that winds the
   * watermark to zero and reads every row again — a total that survived it
   * would double. The same reasoning `record_gen` gets: marks are only
   * meaningful within one run.
   */
  it('starts again when a repair replays the feed', async () => {
    await pullOnce(page([{ entity: 'beehive', serverTs: 10 }]));
    expect(await localStore().unmodelableRows()).toBe(1);

    // That first pull already ran the one repair this device owes, so the
    // markers are cleared to put it back where a device that has not.
    await deleteMetaKey('repairStarted');
    await deleteMetaKey('repairDone');
    await simulateRestart();

    expect(await localStore().startProjectionRepair()).toBe(true);
    expect(await localStore().unmodelableRows()).toBe(0);
  });

  /**
   * The distinction the fix turns on, and the reason `entity` is the ONLY field
   * that was loosened.
   *
   * A newer server sending a new entity is doing what it is allowed to do. A row
   * with a malformed ULID is a bug or a tampered response, and dropping it
   * quietly is how a real defect becomes invisible — the exact failure this item
   * is about, traded for a different silence.
   */
  it('still refuses a page whose rows are malformed', async () => {
    const outcome = await pullOnce(() =>
      Promise.resolve({
        status: 200,
        body: {
          mutations: [{ ...row({ entity: 'flock', serverTs: 10 }, 0), id: 'too-short' }],
          through: 10,
          throughId: `${'0'.repeat(20)}000000`,
          more: false,
        },
      }),
    );

    expect(outcome.deferred).toBe('unreadable');
    expect(outcome.applied).toBe(0);
    expect((await localStore().pulledThrough()).through).toBe(0);
  });

  it('still refuses a page whose envelope is malformed', async () => {
    const outcome = await pullOnce(() =>
      Promise.resolve({
        status: 200,
        body: { mutations: [], through: 10, throughId: 'not-a-ulid', more: false },
      }),
    );

    expect(outcome.deferred).toBe('unreadable');
  });
});

describe('readableRows', () => {
  const base = (entity: string): PulledRow => ({
    schemaVersion: 1,
    id: newId(),
    targetId: newId(),
    entity,
    op: 'create',
    payload: {},
    deviceId: DEVICE,
    clientSeq: 0,
    clientTs: 1,
    serverTs: 1,
  });

  it('splits the modelable from the rest, in order', () => {
    const { known, unmodelable } = readableRows([
      base('flock'),
      base('beehive'),
      base('eggLog'),
    ]);

    expect(known.map((k) => k.entity)).toEqual(['flock', 'eggLog']);
    expect(unmodelable).toBe(1);
  });

  it('counts rather than merely dropping', () => {
    // A device quietly missing a whole kind of record is the shape of failure
    // this path already had once; a silent skip would be the same silence.
    const { known, unmodelable } = readableRows([base('beehive'), base('apiary')]);

    expect(known).toEqual([]);
    expect(unmodelable).toBe(2);
  });

  it('passes an empty page straight through', () => {
    expect(readableRows([])).toEqual({ known: [], unmodelable: 0 });
  });
});
