import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { knownFarmIds } from '../../apps/mobile/src/db/open';
import { ensureLocalOrgId } from '../../apps/mobile/src/auth/local-org';
import { files, seedSecureStore } from '../support/native/modules';

/**
 * The farm on disk that nothing points at.
 *
 * A farm's id lives in secure storage and its records live in
 * `steading-{orgId}.db`, so the id is the only pointer to the file. When the
 * id goes and the file does not — a cleared keystore, a restored backup, a
 * reinstall that kept app files — `ensureLocalOrgId` used to mint a fresh one
 * and the app opened an empty farm beside a full one.
 *
 * **No error, no warning, nothing on any screen.** That is the worst shape a
 * loss can take, and it is the shape that had somebody staring at an empty
 * Today twice while the records were sitting in the next file along.
 */

const SQLITE = 'file:///documents/SQLite/';

beforeEach(() => {
  files.clear();
  seedSecureStore({});
});

afterEach(() => {
  files.clear();
});

/** A farm's database, as it sits on disk with no id pointing at it. */
function farmOnDisk(orgId: string): void {
  files.set(`${SQLITE}steading-${orgId}.db`, 'a year of eggs');
}

describe('a farm whose id was lost', () => {
  it('is reopened rather than replaced', async () => {
    const lost = newId();
    farmOnDisk(lost);

    expect(await ensureLocalOrgId()).toBe(lost);
  });

  it('stays adopted, so the next launch is not a third farm', async () => {
    const lost = newId();
    farmOnDisk(lost);

    const first = await ensureLocalOrgId();
    const second = await ensureLocalOrgId();

    expect(second).toBe(first);
  });
});

describe('what it refuses to guess', () => {
  /**
   * Two databases means two farms have been on this device, and picking either
   * would be the app deciding which somebody meant. It mints instead — the
   * records stay exactly where they are rather than being merged into a guess.
   */
  it('mints rather than choose between two farms', async () => {
    const one = newId();
    const two = newId();
    farmOnDisk(one);
    farmOnDisk(two);

    const minted = await ensureLocalOrgId();

    expect(minted).not.toBe(one);
    expect(minted).not.toBe(two);
  });

  it('mints on a genuinely first launch', async () => {
    expect(await ensureLocalOrgId()).toHaveLength(26);
  });

  /** A file that is not one of ours is not a farm. */
  it('ignores anything that is not a farm database', async () => {
    files.set(`${SQLITE}kv.db`, 'x');
    files.set(`${SQLITE}steading-not-a-ulid.db`, 'x');

    expect(await knownFarmIds()).toEqual([]);
  });
});
