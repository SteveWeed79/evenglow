import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { knownFarmIds } from '../../apps/mobile/src/db/open';
import { disposeIfMarked } from '../../apps/mobile/src/db/store';
import {
  discardEmptyLocalOrg,
  ensureLocalOrgId,
  retireLocalOrgId,
  retiredOrgIds,
} from '../../apps/mobile/src/auth/local-org';
import { files, seedSecureStore } from '../support/native/modules';

/**
 * A farm minted on first launch that nothing was ever put into.
 *
 * ## An empty farm is not free
 *
 * `ensureLocalOrgId` recovers a farm whose id was lost by adopting the database
 * on disk — but only when there is **exactly one**, because choosing between
 * two would be the app deciding which farm somebody meant. `knownFarmIds`
 * matches on filename, so a leftover counts however empty it is:
 *
 *     one real farm + one empty leftover  →  two files  →  mints a third
 *
 * and the real records are stranded silently, which is the precise loss that
 * adoption path exists to prevent. An empty farm carries no information and
 * full weight in the one decision that recovers a real one.
 *
 * ## And why a join must not do what a sign-in does
 *
 * The asymmetry is the interesting half, and getting it the other way round
 * would leak a farm across tenants rather than merely litter a disk.
 *
 * After a **join**, the retired id is what a later sign-out comes back to.
 * Delete an empty one instead and there is nothing to come back to — adoption
 * runs, finds the employer's database as the only one on disk, and opens it. A
 * hand who signed out at the end of a season would be looking at their
 * employer's farm with no account.
 *
 * After a **sign-in** to an account of your own, the database left behind is
 * the one that account already syncs, and adopting it later is the app doing
 * the right thing.
 */

const SQLITE = 'file:///documents/SQLite/';

function farmOnDisk(orgId: string): void {
  files.set(`${SQLITE}steading-${orgId}.db`, 'a year of eggs');
}

beforeEach(() => {
  files.clear();
  seedSecureStore({});
});

describe('discarding a farm nothing was logged into', () => {
  it('deletes the database and stops pointing at it', async () => {
    const empty = newId();
    farmOnDisk(empty);
    expect(await ensureLocalOrgId()).toBe(empty);

    await discardEmptyLocalOrg();
    // Deferred: the file is still open at the moment the decision is made, and
    // deleting an open database does not work. The store switch carries it out.
    expect(await knownFarmIds()).toEqual([empty]);

    expect(await disposeIfMarked(empty)).toBe(true);
    expect(await knownFarmIds()).toEqual([]);
  });

  /** Not retired. There is nothing to come back to and nothing lost by that. */
  it('does not put it on the list of farms to return to', async () => {
    const empty = newId();
    farmOnDisk(empty);
    await ensureLocalOrgId();

    await discardEmptyLocalOrg();

    expect(await retiredOrgIds()).toEqual([]);
  });

  /**
   * The point of all of it: the farm that is left can be recovered, because it
   * is now the only one on disk.
   */
  it('leaves the signed-in farm adoptable when its id is later lost', async () => {
    const empty = newId();
    const real = newId();
    farmOnDisk(empty);
    await ensureLocalOrgId();

    // Signing in opens the account's farm beside the empty one.
    await discardEmptyLocalOrg();
    await disposeIfMarked(empty);
    farmOnDisk(real);

    // The id goes — a cleared keystore, a restored backup, a reinstall.
    seedSecureStore({});

    expect(await ensureLocalOrgId()).toBe(real);
  });

  /**
   * The bug, stated as the test that would have caught it. Without the discard
   * the empty farm is still on disk, two files means a refusal to guess, and a
   * third farm is minted over a full one.
   */
  it('is what stops an empty leftover stranding a real farm', async () => {
    const empty = newId();
    const real = newId();
    farmOnDisk(empty);
    farmOnDisk(real);
    seedSecureStore({});

    const minted = await ensureLocalOrgId();

    expect(minted).not.toBe(real);
    expect(minted).not.toBe(empty);
  });

  it('does nothing when there is no local farm to discard', async () => {
    await expect(discardEmptyLocalOrg()).resolves.toBeUndefined();
  });
});

describe('an id nobody marked', () => {
  /**
   * Being closed is not a reason to be deleted — every farm switch closes one.
   * Only a farm somebody decided was empty may go.
   */
  it('survives the store switch that closes it', async () => {
    const other = newId();
    farmOnDisk(other);

    expect(await disposeIfMarked(other)).toBe(false);
    expect(await knownFarmIds()).toEqual([other]);
  });

  it('cannot be disposed of twice', async () => {
    const empty = newId();
    farmOnDisk(empty);
    await ensureLocalOrgId();
    await discardEmptyLocalOrg();

    expect(await disposeIfMarked(empty)).toBe(true);
    expect(await disposeIfMarked(empty)).toBe(false);
  });
});

describe('a join, which must not discard', () => {
  /**
   * Retiring an empty farm looks like waste and is the thing keeping a hand
   * off their employer's records. The file stays so a sign-out has somewhere
   * of its own to land.
   */
  it('keeps an empty farm so signing out does not adopt the employer', async () => {
    const mine = newId();
    const employer = newId();
    farmOnDisk(mine);
    await ensureLocalOrgId();

    // What `joinFarm` does: retire, whatever is in it.
    await retireLocalOrgId();
    farmOnDisk(employer);

    expect(await ensureLocalOrgId()).toBe(mine);
  });

  /**
   * And the counterfactual, so the reason is asserted rather than described:
   * discarding instead would hand over the employer's farm.
   */
  it('would land on the employer if it discarded instead', async () => {
    const mine = newId();
    const employer = newId();
    farmOnDisk(mine);
    await ensureLocalOrgId();

    await discardEmptyLocalOrg();
    await disposeIfMarked(mine);
    farmOnDisk(employer);

    expect(await ensureLocalOrgId()).toBe(employer);
  });
});
