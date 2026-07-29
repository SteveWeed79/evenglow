import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { nextRecordValue } from '@steading/core/db/project';
import { listGroups } from '@steading/core/read/groups';
import { listServices } from '@steading/core/read/iron';
import { enqueue } from '@steading/core/sync/queue';
import { localStore } from '@steading/core/db/store';
import { freshStore, simulateRestart } from '../support/store';

/**
 * An update merges into the local record; it does not replace it.
 *
 * The regression this guards is the worst kind the offline engine can have,
 * because it presents as data loss caused by the user's own edit: the
 * projection wrote `value = payload` for every op, so changing a group's head
 * count replaced its whole record with `{ count: 12 }`. The group then had no
 * name and no species, every reader skipped it as unparseable, and Stock went
 * empty — on the one device that had done nothing wrong.
 *
 * It stayed invisible for as long as nothing in the app could issue an update.
 * The moment the edit screens existed it was reachable from four of them.
 *
 * The server has always merged (`$set` in apply.ts). These assert the client
 * does the same, which is the property `project.ts` exists to keep.
 */

const T0 = new Date('2026-07-01T08:00:00Z').getTime();

describe('nextRecordValue', () => {
  it('replaces on create', () => {
    expect(nextRecordValue('create', { a: 1 }, { b: 2 })).toEqual({ b: 2 });
  });

  it('merges top-level fields on update', () => {
    expect(nextRecordValue('update', { name: 'Hens', count: 6 }, { count: 12 })).toEqual({
      name: 'Hens',
      count: 12,
    });
  });

  it('replaces a subdocument whole rather than merging into it', () => {
    // Mirrors `$set: { withdrawalDays: {…} }` — a treatment edited to drop its
    // milk withdrawal must actually drop it.
    const previous = { name: 'Baytril', withdrawalDays: { egg: 7, milk: 4 } };
    expect(nextRecordValue('update', previous, { withdrawalDays: { egg: 7 } })).toEqual({
      name: 'Baytril',
      withdrawalDays: { egg: 7 },
    });
  });

  it('keeps the record on delete rather than overwriting it with the reason', () => {
    // Archived, never deleted (P13): the history is the point of keeping it.
    const previous = { name: 'Hens', species: 'chicken' };
    expect(nextRecordValue('delete', previous, { reason: 'sold' })).toEqual(previous);
  });

  it('keeps the partial payload when the create has not arrived yet', () => {
    expect(nextRecordValue('update', undefined, { count: 12 })).toEqual({ count: 12 });
  });
});

describe('editing through the store', () => {
  beforeEach(async () => {
    await freshStore();
  });

  it('leaves a group readable after its head count changes', async () => {
    const id = newId();
    await enqueue({
      entity: 'flock',
      op: 'create',
      targetId: id,
      payload: { name: 'The hens', species: 'chicken', count: 6, purposes: ['eggs'] },
    });

    await enqueue({ entity: 'flock', op: 'update', targetId: id, payload: { count: 12 } });

    const [group] = await listGroups();
    expect(group?.name).toBe('The hens');
    expect(group?.species).toBe('chicken');
    expect(group?.count).toBe(12);
  });

  it('survives a restart with the merged value intact', async () => {
    const id = newId();
    await enqueue({
      entity: 'flock',
      op: 'create',
      targetId: id,
      payload: { name: 'The hens', species: 'chicken', count: 6 },
    });
    await enqueue({ entity: 'flock', op: 'update', targetId: id, payload: { count: 12 } });

    await simulateRestart();

    const [group] = await listGroups();
    expect(group).toMatchObject({ name: 'The hens', count: 12 });
  });

  it('applies successive updates cumulatively', async () => {
    const id = newId();
    await enqueue({
      entity: 'maintenance',
      op: 'create',
      targetId: id,
      payload: { equipmentId: newId(), title: 'Oil and filter', intervalHours: 100 },
    });
    await enqueue({
      entity: 'maintenance',
      op: 'update',
      targetId: id,
      payload: { lastDoneAtHours: 240 },
    });
    await enqueue({
      entity: 'maintenance',
      op: 'update',
      targetId: id,
      payload: { lastDoneAtDate: T0 },
    });

    const [service] = await listServices();
    expect(service).toMatchObject({
      title: 'Oil and filter',
      intervalHours: 100,
      lastDoneAtHours: 240,
      lastDoneAtDate: T0,
    });
  });

  it('merges the same way when the change arrives from the server', async () => {
    // Hydration and a device's own writes must build identical state, or the
    // disagreement only shows up after a reinstall.
    const id = newId();
    const deviceId = '00000000-0000-4000-8000-000000000001';

    await localStore().applyPulled(
      [
        {
          id: newId(),
          entity: 'flock',
          op: 'create',
          targetId: id,
          payload: { name: 'The hens', species: 'chicken', count: 6 },
          deviceId,
          clientSeq: 0,
          clientTs: T0,
          schemaVersion: 1,
          serverTs: T0,
        },
        {
          id: newId(),
          entity: 'flock',
          op: 'update',
          targetId: id,
          payload: { count: 12 },
          deviceId,
          clientSeq: 1,
          clientTs: T0,
          schemaVersion: 1,
          serverTs: T0 + 1,
        },
      ],
      { through: T0 + 1, throughId: id },
    );

    const [group] = await listGroups();
    expect(group).toMatchObject({ name: 'The hens', species: 'chicken', count: 12 });
  });
});
