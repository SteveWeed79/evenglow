import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openSqliteStore } from '@steading/core/db/sqlite-store';
import { nodeSqlDriver } from '../support/sqlite';

/**
 * The runtime the tests run in is more generous than the phone.
 *
 * `enqueue` called bare `crypto.randomUUID()`. Node has that global. React
 * Native does not — and Expo's runtime installs `fetch`, `URL`, `TextDecoder`,
 * `FormData` and `AbortSignal`, but no `crypto`. On a handset that line was a
 * ReferenceError.
 *
 * The shape is what made it invisible. It sits in the `deviceId === undefined`
 * branch, which runs on the FIRST enqueue ever. The throw rolls the
 * transaction back, so the id is never persisted — so the next save takes the
 * identical branch and fails identically. Every write, from the first, on
 * every device, while ~900 tests stayed green over a line that could not
 * execute there.
 *
 * This suite deletes the global before touching the store. It is the smallest
 * possible version of the device-parity idea: run the code against what the
 * phone actually provides, not what Node happens to have.
 */

const realCrypto = globalThis.crypto;

beforeEach(() => {
  // What React Native gives you: no crypto at all.
  Reflect.deleteProperty(globalThis, 'crypto');
});

afterEach(() => {
  Object.defineProperty(globalThis, 'crypto', {
    value: realCrypto,
    configurable: true,
    writable: true,
  });
});

describe('a store on a runtime with no crypto global', () => {
  it('mints a device id from the source it was handed', async () => {
    const store = await openSqliteStore(nodeSqlDriver(), {
      randomUUID: () => '3f1d2c4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
    });

    // The first enqueue is the one that takes the deviceId branch. Before the
    // fix this threw a ReferenceError and rolled the whole thing back.
    const queued = await store.enqueue({
      entity: 'flock',
      op: 'create',
      targetId: '01J8XQK5T7WZ3P4N6M8R2V9C0D',
      payload: { name: 'The hens', species: 'chicken', count: 6 },
    });

    expect(queued.deviceId).toBe('3f1d2c4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f');
  });

  it('keeps the same device id for every later mutation', async () => {
    let minted = 0;
    const store = await openSqliteStore(nodeSqlDriver(), {
      randomUUID: () => `3f1d2c4e-5a6b-4c7d-8e9f-0a1b2c3d4e5${minted++}`,
    });

    const seen: string[] = [];
    for (const targetId of ['01J8XQK5T7WZ3P4N6M8R2V9C0D', '01J8XQK5T7WZ3P4N6M8R2V9C0E']) {
      const queued = await store.enqueue({
        entity: 'flock',
        op: 'create',
        targetId,
        payload: { name: 'x', species: 'chicken', count: 1 },
      });
      seen.push(queued.deviceId);
    }

    // Asked once and persisted, not re-minted per write — the branch that
    // failed was also the branch that was supposed to run exactly once.
    expect(minted).toBe(1);
    expect(new Set(seen).size).toBe(1);
  });
});
