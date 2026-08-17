import { ulid } from 'ulid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { listFarmSummaries } from '@steading/api/db/farms';
import { type UserDoc, insertOrg, insertUser, recordLastSeen } from '@steading/api/db/identity';
import { startTestDb } from '../support/mongo';

/**
 * What build is actually out there.
 *
 * The version header arrived on every sync, decided the 426, and was thrown
 * away — so `MINIMUM_CLIENT_VERSION` was a lever nobody could aim. Sideloaded
 * installs have no updater and no telemetry, so setting a floor meant guessing
 * what it would lock out. This is the reading that turns the guess into a
 * decision, and the control centre's version panel is what reads it.
 *
 * Its own database and the app's global client pointed at it: `recordLastSeen`
 * and `listFarmSummaries` are identity-side, which is deliberately *not*
 * tenant-scoped — sign-in has to find a user before an orgId exists — so they
 * go through `db()` rather than taking an injected scope.
 */

const harness = await startTestDb('steading_last_seen');

if (harness) {
  process.env.MONGODB_URI = harness.uri;
  process.env.MONGODB_DB = 'steading_last_seen';
}

const describeDb = harness ? describe : describe.skip;

const ORG = ulid();

async function theFarmExists(): Promise<void> {
  await insertOrg({ _id: ORG, name: 'Hollow Farm', createdAt: new Date() });
}

async function somebody(over: Partial<UserDoc> = {}): Promise<string> {
  const id = ulid();
  await insertUser({
    _id: id,
    email: `${id.toLowerCase()}@example.test`,
    name: 'The keeper',
    orgId: ORG,
    role: 'owner',
    createdAt: new Date(),
    ...over,
  });
  return id;
}

async function lastSeenOf(userId: string): Promise<UserDoc['lastSeen']> {
  const { findUserById } = await import('@steading/api/db/identity');
  return (await findUserById(userId))?.lastSeen;
}

beforeEach(async () => {
  for (const name of ['users', 'orgs', 'mutations']) {
    await harness!.db.collection(name).deleteMany({});
  }
  await theFarmExists();
});

afterAll(async () => {
  await harness?.stop();
});

describeDb('the build an account is running', () => {
  it('is written down when it says one', async () => {
    const who = await somebody();
    const at = new Date();

    await recordLastSeen(who, '0.2.1', at);

    expect(await lastSeenOf(who)).toEqual({ at, client: '0.2.1' });
  });

  /**
   * A header is caller-controlled data reaching the database, and this one is
   * rendered on an operations page and aggregated into counts. `parseVersion`
   * bounds it to three integers, so nothing arbitrary is ever stored — a
   * version histogram cannot be sprayed across a thousand invented values, and
   * no reader downstream has to be careful with the string.
   */
  it('refuses to store anything that is not a version', async () => {
    const who = await somebody();

    for (const nonsense of ['', 'latest', '1.2', '../../etc', '<script>', '9'.repeat(40)]) {
      await recordLastSeen(who, nonsense, new Date());
      expect((await lastSeenOf(who))?.client).toBeUndefined();
    }
  });

  /**
   * The visit still counts. A build that predates the header is exactly the
   * population a floor exists to catch, and recording nothing would make that
   * account look dormant instead of old.
   */
  it('records the visit even when the build says nothing', async () => {
    const who = await somebody();
    const at = new Date();

    await recordLastSeen(who, undefined, at);

    expect(await lastSeenOf(who)).toEqual({ at });
  });

  it('keeps only the latest answer', async () => {
    const who = await somebody();
    const then = new Date(Date.now() - 86_400_000);
    const now = new Date();

    await recordLastSeen(who, '0.1.18', then);
    await recordLastSeen(who, '0.2.1', now);

    expect(await lastSeenOf(who)).toEqual({ at: now, client: '0.2.1' });
  });

  /**
   * Telemetry must never be the reason a farm's morning fails. An account that
   * has been removed between the token being minted and the batch arriving
   * matches nothing, and that has to be a quiet no-op rather than a throw on
   * the sync path.
   */
  it('says nothing about an account that is not there', async () => {
    await expect(recordLastSeen(ulid(), '0.2.1', new Date())).resolves.toBeUndefined();
  });
});

describeDb('what a farm is running, on the operations listing', () => {
  it('counts the accounts on each build, newest first', async () => {
    await somebody();
    await somebody();
    await somebody();
    const [a, b, c] = await harness!.db
      .collection('users')
      .find({})
      .toArray()
      .then((rows) => rows.map((r) => String(r._id)));

    await recordLastSeen(a!, '0.2.1', new Date());
    await recordLastSeen(b!, '0.2.1', new Date());
    await recordLastSeen(c!, '0.1.18', new Date());

    const [farm] = await listFarmSummaries();

    expect(farm?.builds).toEqual([
      { version: '0.2.1', people: 2 },
      { version: '0.1.18', people: 1 },
    ]);
  });

  /**
   * Sorted as numbers, not as text. `0.10.0` is newer than `0.9.0` and sorts
   * before it alphabetically — a fleet readout that files the newest build in
   * the middle of the list is one nobody trusts a second time.
   */
  it('puts 0.10.0 above 0.9.0, where a string sort would not', async () => {
    const older = await somebody();
    const newer = await somebody();

    await recordLastSeen(older, '0.9.0', new Date());
    await recordLastSeen(newer, '0.10.0', new Date());

    const [farm] = await listFarmSummaries();

    expect(farm?.builds.map((b) => b.version)).toEqual(['0.10.0', '0.9.0']);
  });

  /** Every farm looks like this the day the field ships, so it says so plainly. */
  it('reports nothing rather than guessing when no one has reported', async () => {
    await somebody();

    const [farm] = await listFarmSummaries();

    expect(farm?.builds).toEqual([]);
    expect(farm?.lastSeenAt).toBeUndefined();
  });

  it('carries the farm, its people and its records', async () => {
    await somebody();
    await somebody();
    const wrote = new Date();
    await harness!.db
      .collection('mutations')
      .insertMany([
        { _id: ulid() as never, orgId: ORG, serverTs: new Date(wrote.getTime() - 1000) },
        { _id: ulid() as never, orgId: ORG, serverTs: wrote },
      ]);

    const [farm] = await listFarmSummaries();

    expect(farm?.org._id).toBe(ORG);
    expect(farm?.people).toBe(2);
    expect(farm?.records).toBe(2);
    expect(farm?.lastWriteAt).toEqual(wrote);
  });

  /**
   * The cross-tenant read is the point of the module, so it has to actually
   * separate them — a count that leaked across farms would be worse than no
   * listing, because it would look authoritative.
   */
  it('counts each farm separately', async () => {
    const other = ulid();
    await insertOrg({ _id: other, name: 'Far Field', createdAt: new Date() });

    const here = await somebody();
    await recordLastSeen(here, '0.2.1', new Date());
    await harness!.db
      .collection('mutations')
      .insertOne({ _id: ulid() as never, orgId: ORG, serverTs: new Date() });

    const farms = await listFarmSummaries();
    const mine = farms.find((f) => f.org._id === ORG);
    const theirs = farms.find((f) => f.org._id === other);

    expect(mine?.records).toBe(1);
    expect(mine?.builds).toEqual([{ version: '0.2.1', people: 1 }]);
    expect(theirs?.records).toBe(0);
    expect(theirs?.people).toBe(0);
    expect(theirs?.builds).toEqual([]);
  });

  it('says so plainly when there are no farms at all', async () => {
    await harness!.db.collection('orgs').deleteMany({});

    expect(await listFarmSummaries()).toEqual([]);
  });
});
