import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { knownFarmIds } from '../../apps/mobile/src/db/open';
import {
  ensureLocalOrgId,
  retireLocalOrgId,
  retiredOrgIds,
} from '../../apps/mobile/src/auth/local-org';
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

/**
 * The same loss with a different cause, and this one the app inflicted on
 * itself.
 *
 * Joining somebody else's farm has to move the active pointer — leaving it
 * would mean the next sign-out reopening a farm this device no longer belongs
 * to — but it used to *delete* the id, and the id is the only thing naming
 * `steading-{orgId}.db`. Every record behind it was stranded permanently, and
 * the adoption above cannot help: after a join there are two databases on
 * disk, so it correctly refuses to guess and mints a third.
 */
describe('the farm you had before you joined another', () => {
  it('is set aside rather than deleted', async () => {
    const mine = newId();
    farmOnDisk(mine);
    await ensureLocalOrgId();

    await retireLocalOrgId();

    expect(await retiredOrgIds()).toEqual([mine]);
  });

  it('comes back when the device is no longer on the other farm', async () => {
    const mine = newId();
    farmOnDisk(mine);
    expect(await ensureLocalOrgId()).toBe(mine);

    // The join: the employer's farm opens its own database beside ours.
    await retireLocalOrgId();
    farmOnDisk(newId());

    expect(await ensureLocalOrgId()).toBe(mine);
  });

  it('is claimed back once, not returned from the list forever', async () => {
    const mine = newId();
    farmOnDisk(mine);
    await ensureLocalOrgId();
    await retireLocalOrgId();
    farmOnDisk(newId());

    expect(await ensureLocalOrgId()).toBe(mine);
    expect(await retiredOrgIds()).toEqual([]);
  });

  /** Rejoining the same farm twice must not put it in the list twice. */
  it('is listed once however many times it is set aside', async () => {
    const mine = newId();
    farmOnDisk(mine);

    await ensureLocalOrgId();
    await retireLocalOrgId();
    farmOnDisk(newId());
    await ensureLocalOrgId(); // reclaims it
    await retireLocalOrgId();

    expect(await retiredOrgIds()).toEqual([mine]);
  });

  /**
   * Newest first, seeded rather than acted out.
   *
   * In practice the list rarely holds two — a sign-out reclaims the entry
   * before the next join can add another — so the only honest way to assert
   * the ordering is to hand it a list and see which end it reads. That is also
   * the read path invariant 11 cares about.
   */
  it('prefers the farm most recently left', async () => {
    const recent = newId();
    const older = newId();
    farmOnDisk(recent);
    farmOnDisk(older);
    seedSecureStore({ 'steading.retiredOrgs': JSON.stringify([recent, older]) });

    expect(await ensureLocalOrgId()).toBe(recent);
  });

  /**
   * Parsed, never trusted. A stored value that is not a list of ULIDs cannot
   * name a database this app made, and treating it as empty is recoverable
   * where opening a file named after a corrupted string is not.
   */
  it('treats an unreadable list as no list at all', async () => {
    seedSecureStore({ 'steading.retiredOrgs': 'not json' });
    expect(await retiredOrgIds()).toEqual([]);

    seedSecureStore({ 'steading.retiredOrgs': JSON.stringify({ orgId: newId() }) });
    expect(await retiredOrgIds()).toEqual([]);

    seedSecureStore({ 'steading.retiredOrgs': JSON.stringify(['nope', 42, null]) });
    expect(await retiredOrgIds()).toEqual([]);
  });

  /**
   * An id whose database is gone names nothing. `forgetDatabase` is the
   * deliberate hand-over-the-tablet action, and resurrecting a pointer to a
   * file it deleted would be the app undoing it.
   */
  it('ignores a retired farm whose database is no longer there', async () => {
    const mine = newId();
    farmOnDisk(mine);
    await ensureLocalOrgId();
    await retireLocalOrgId();
    files.delete(`${SQLITE}steading-${mine}.db`);

    const other = newId();
    farmOnDisk(other);

    // Falls through to adoption: exactly one database on disk, so that is the
    // farm — and it is not the retired one.
    expect(await ensureLocalOrgId()).toBe(other);
  });

  it('does nothing when there was no farm to set aside', async () => {
    await retireLocalOrgId();

    expect(await retiredOrgIds()).toEqual([]);
  });
});
