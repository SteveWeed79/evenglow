import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@homefarm/contracts';
import { BACKUP_GOOD_FOR, EXPOSED_AT, readExposure } from '@homefarm/core/backup/exposure';
import { enqueue } from '@homefarm/core/sync/queue';
import { localStore } from '@homefarm/core/db/store';
import { freshStore } from '../support/store';

/**
 * The third moment in A2.3, as a condition a screen can ask.
 *
 * *"An account is asked for at three moments and no others… A second device. A
 * farm hand. Enough data to hurt losing."* The first two happen when somebody
 * goes looking. The third does not, and what stood in for it was one Settings
 * row saying "Everything is on this phone only" — true on day one about four
 * records and in year two about two thousand, and therefore furniture by the
 * time it meant anything.
 *
 * These are the tests that keep it from becoming a nag: silent on a new farm,
 * silent on a farm that syncs, silent after a copy is taken.
 */

const DAY = 86_400_000;

/** Enough records to be worth losing. */
async function log(n: number): Promise<void> {
  const flock = newId();
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: flock,
    payload: { name: 'The hens', species: 'chicken', count: 6, purposes: ['eggs'] },
  });

  for (let i = 1; i < n; i += 1) {
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      payload: { occurredAt: Date.now() - i * 3_600_000, flockId: flock, count: 6 },
    });
  }
}

beforeEach(async () => {
  await freshStore();
});

describe('when it says nothing', () => {
  it('is silent on a farm with nothing logged', async () => {
    expect((await readExposure()).exposed).toBe(false);
  });

  /**
   * A farm setting itself up — every group, every animal named, every machine
   * — lands in the low dozens. Being told its records are at risk on the
   * afternoon it started is the definition of a nag.
   */
  it('is silent while a farm is still being set up', async () => {
    await log(EXPOSED_AT - 1);
    expect((await readExposure()).exposed).toBe(false);
  });

  /**
   * The precise test, and it is not "has an account".
   *
   * A farm whose card lapsed still has a copy on the server and can pull it
   * back — `GET /snapshot` is deliberately ungated on billing — so it is not
   * exposed and must not be told it is.
   */
  it('is silent once anything has reached a server', async () => {
    await log(EXPOSED_AT + 50);
    await localStore().markSynced(Date.now());

    expect((await readExposure()).exposed).toBe(false);
  });

  it('is silent after a copy has been taken', async () => {
    await log(EXPOSED_AT + 50);
    await localStore().setLastBackupAt(Date.now());

    expect((await readExposure()).exposed).toBe(false);
  });
});

describe('when it speaks', () => {
  it('speaks once there is a season to lose', async () => {
    await log(EXPOSED_AT);

    const exposure = await readExposure();
    expect(exposure.exposed).toBe(true);
    expect(exposure.records).toBe(EXPOSED_AT);
    expect(exposure.everSynced).toBe(false);
    expect(exposure.lastBackupAt).toBeNull();
  });

  /**
   * A copy taken last spring is not protection, so it comes back.
   *
   * Long enough not to be a nag, short enough that "your last copy is from
   * February" is not something somebody discovers in September.
   */
  it('speaks again when the last copy has gone stale', async () => {
    await log(EXPOSED_AT + 50);
    const stale = Date.now() - BACKUP_GOOD_FOR - DAY;
    await localStore().setLastBackupAt(stale);

    const exposure = await readExposure();
    expect(exposure.exposed).toBe(true);
    expect(exposure.lastBackupAt).toBe(stale);
  });

  /**
   * Records, not mutations, and that distinction was got wrong first.
   *
   * The cheapest read is `counts()`, which the sync chip already makes — but
   * it counts outbox rows, and a group created and then edited three times is
   * four of those and one record. A strip reading "1,540 records" about
   * roughly 1,200 of them would be the app overstating the very thing it is
   * asking somebody to act on.
   */
  it('counts records, not the mutations that made them', async () => {
    const flock = newId();
    await enqueue({
      entity: 'flock',
      op: 'create',
      targetId: flock,
      payload: { name: 'The hens', species: 'chicken', count: 6, purposes: ['eggs'] },
    });
    for (const count of [7, 8, 9]) {
      await enqueue({ entity: 'flock', op: 'update', targetId: flock, payload: { count } });
    }

    expect((await localStore().counts()).queued).toBe(4);
    expect((await readExposure()).records).toBe(1);
  });

  /** An archived group is still a record, and still the history its logs name. */
  it('counts a record that has been archived', async () => {
    const flock = newId();
    await enqueue({
      entity: 'flock',
      op: 'create',
      targetId: flock,
      payload: { name: 'Last year’s birds', species: 'chicken', count: 20, purposes: ['meat'] },
    });
    await enqueue({ entity: 'flock', op: 'delete', targetId: flock, payload: {} });

    expect((await readExposure()).records).toBe(1);
  });
});

describe('the number itself', () => {
  /**
   * Not a naked constant: it has to sit above a setup burst and below a
   * season, and a value either side of that band makes it a nag or makes it
   * useless. Pinned so a later tidy-up cannot quietly move it.
   */
  it('sits above a setup burst and below a season', () => {
    expect(EXPOSED_AT).toBeGreaterThan(50);
    expect(EXPOSED_AT).toBeLessThan(500);
  });

  it('lets a copy stand for a season, not forever', () => {
    expect(BACKUP_GOOD_FOR).toBeGreaterThanOrEqual(30 * DAY);
    expect(BACKUP_GOOD_FOR).toBeLessThanOrEqual(180 * DAY);
  });
});
