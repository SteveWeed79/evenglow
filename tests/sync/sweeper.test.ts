import { ulid } from 'ulid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionClaims } from '@steading/api/auth/claims';
import { scopedOn } from '@steading/api/db/scoped';
import { applyBatch } from '@steading/api/sync/apply';
import { PENDING } from '@steading/api/sync/outcome';
import { readSnapshotPage } from '@steading/api/sync/snapshot';
import { SWEEP_AFTER_MS, sweepFarm } from '@steading/api/sync/sweep';
import { makeMutation } from '../support/fixtures';
import { startTestDb } from '../support/mongo';

/**
 * The rows whose client never came back.
 *
 * `pending` is stamped with the envelope and withheld from the feed, and it
 * normally self-heals: the client that never got a response resends, the
 * duplicate branch sees `pending`, and re-projects from the stored envelope.
 *
 * **Unless the client never comes back.** A phone force-stopped between the log
 * write and the projection, wiped, lost, or never opened again leaves that row
 * `pending` for ever — and withheld from the feed means the record reaches no
 * other device on the farm, permanently. A reinstall does not repair it either,
 * because hydration replays the feed and the row is not in it.
 *
 * That was the last open box on P0-2, which the audit calls the worst item in
 * it. These are the assertions for closing it.
 *
 * Its own database name: these suites wipe collections in `beforeEach`, and
 * five files sharing one name is a bug this repository has already had.
 */

const harness = await startTestDb('steading_sweeper');
const describeDb = harness ? describe : describe.skip;

const ORG = ulid();
const OWNER_ID = ulid();
const OWNER: SessionClaims = { userId: OWNER_ID, orgId: ORG, role: 'owner' };

function scope() {
  return scopedOn(harness!.db, ORG);
}

function flock(over: Record<string, unknown> = {}) {
  return { name: 'Alpha', species: 'chicken', count: 12, ...over };
}

/** The owner, as `users` holds them — the sweeper re-derives the role from here. */
async function theOwnerExists(): Promise<void> {
  await harness!.db.collection('users').insertOne({
    _id: OWNER_ID as never,
    email: `${OWNER_ID.toLowerCase()}@example.test`,
    name: 'The keeper',
    orgId: ORG,
    role: 'owner',
    createdAt: new Date(),
  } as never);
}

/**
 * A row logged and never decided, exactly as a phone dying mid-request leaves
 * one: the envelope on disk, `outcome: pending`, and no projection.
 *
 * Written directly rather than by killing a real request, because the seam for
 * that does not exist — `applyMutation` takes no clock and no hook, which
 * `SYNC-INTEGRITY-TODO.md` names as the reason the crash test is still open.
 * What is being tested here is the repair, and the repair only needs the state.
 */
async function stranded(
  over: Record<string, unknown>,
  agoMs = SWEEP_AFTER_MS + 60_000,
): Promise<string> {
  const m = makeMutation(over as never);
  await harness!.db.collection('mutations').insertOne({
    _id: m.id,
    orgId: ORG,
    targetId: m.targetId,
    entity: m.entity,
    op: m.op,
    payload: m.payload,
    deviceId: m.deviceId,
    clientSeq: m.clientSeq,
    clientTs: m.clientTs,
    schemaVersion: m.schemaVersion,
    userId: OWNER_ID,
    serverTs: new Date(Date.now() - agoMs),
    outcome: PENDING,
  } as never);
  return m.id;
}

async function outcomeOf(id: string): Promise<unknown> {
  const doc = await harness!.db.collection('mutations').findOne({ _id: id as never });
  return doc?.outcome;
}

/** What a second device would receive. */
async function feed(): Promise<string[]> {
  const page = await readSnapshotPage(scope(), { since: 0, sinceId: null });
  return page.mutations.map((m) => m.id);
}

beforeEach(async () => {
  for (const name of ['mutations', 'flocks', 'users', 'eggLogs']) {
    await harness!.db.collection(name).deleteMany({});
  }
  await theOwnerExists();
});

afterAll(async () => {
  await harness?.stop();
});

describeDb('a record stranded by a phone that never came back', () => {
  it('is projected, decided and let into the feed', async () => {
    const targetId = ulid();
    const id = await stranded({ entity: 'flock', targetId, payload: flock() });

    // The state it was stuck in: logged, undecided, invisible to everyone else.
    expect(await outcomeOf(id)).toBe(PENDING);
    expect(await feed()).toEqual([]);
    expect(await harness!.db.collection('flocks').countDocuments({})).toBe(0);

    const report = await sweepFarm(scope(), Date.now());

    expect(report).toMatchObject({ found: 1, decided: 1 });
    expect(await outcomeOf(id)).toBe('insert');
    expect(await feed()).toEqual([id]);

    const doc = await harness!.db.collection('flocks').findOne({ _id: targetId as never });
    expect(doc?.name).toBe('Alpha');
  });

  /**
   * A row younger than the threshold is very probably about to be resent by a
   * client that has merely lost signal, and sweeping it early does the work
   * twice for no gain.
   */
  it('is left alone until the ordinary explanation has run out', async () => {
    const id = await stranded({ entity: 'flock', payload: flock() }, 60_000);

    const report = await sweepFarm(scope(), Date.now());

    expect(report.found).toBe(0);
    expect(await outcomeOf(id)).toBe(PENDING);
  });

  /**
   * Oldest first, because a later mutation against the same record may depend
   * on an earlier one having landed. Sweeping newest-first would apply an
   * update before the create it edits.
   */
  it('is replayed in the order it was logged', async () => {
    const targetId = ulid();
    await stranded(
      { entity: 'flock', targetId, op: 'create', payload: flock() },
      SWEEP_AFTER_MS + 120_000,
    );
    await stranded(
      { entity: 'flock', targetId, op: 'update', payload: { count: 20 } },
      SWEEP_AFTER_MS + 60_000,
    );

    const report = await sweepFarm(scope(), Date.now());

    expect(report.decided).toBe(2);
    const doc = await harness!.db.collection('flocks').findOne({ _id: targetId as never });
    expect(doc?.name).toBe('Alpha');
    expect(doc?.count).toBe(20);
  });

  /**
   * The whole reason the sweep re-reads inside the lane. A client that came
   * back between the query and the projection has already decided the row, and
   * projecting it a second time would apply an envelope twice.
   */
  it('leaves a row the client came back for alone', async () => {
    const targetId = ulid();
    const id = await stranded({ entity: 'flock', targetId, payload: flock() });

    // The resend, through the ordinary path.
    await applyBatch(scope(), OWNER, [
      makeMutation({ id, entity: 'flock', targetId, payload: flock() }),
    ]);
    expect(await outcomeOf(id)).toBe('insert');

    const report = await sweepFarm(scope(), Date.now());

    expect(report.decided).toBe(0);
    expect(await harness!.db.collection('flocks').countDocuments({})).toBe(1);
  });
});

/**
 * Authorization is re-derived on every mutation (invariant 8), and `project`'s
 * own comment adds that a role revoked since the command was queued must still
 * bite. The sweeper has no session, so identity comes from the log and the role
 * comes from `users` as it stands right now.
 */
describeDb('the person who recorded it', () => {
  it('is refused if they are no longer on this farm', async () => {
    await harness!.db.collection('users').deleteMany({});
    const id = await stranded({ entity: 'flock', payload: flock() });

    const report = await sweepFarm(scope(), Date.now());

    expect(report).toMatchObject({ found: 1, decided: 1, orphaned: 1 });
    expect(await outcomeOf(id)).toBe('rejected');
    // Decided, so it stops being swept for ever — and still withheld, because a
    // refusal is not something another device should replay.
    expect(await feed()).toEqual([]);
    expect(await harness!.db.collection('flocks').countDocuments({})).toBe(0);
  });

  it('is refused if their account has been removed', async () => {
    await harness!.db
      .collection('users')
      .updateOne({ _id: OWNER_ID as never }, { $set: { disabledAt: new Date() } });
    const id = await stranded({ entity: 'flock', payload: flock() });

    await sweepFarm(scope(), Date.now());

    expect(await outcomeOf(id)).toBe('rejected');
  });

  /**
   * The envelope stays either way. A refusal is still a thing that was
   * attempted, and `mutations` is the audit trail.
   */
  it('leaves the envelope in the log whatever it decides', async () => {
    await harness!.db.collection('users').deleteMany({});
    await stranded({ entity: 'flock', payload: flock() });

    await sweepFarm(scope(), Date.now());

    expect(await harness!.db.collection('mutations').countDocuments({})).toBe(1);
  });

  /** A role demoted since the row was queued bites on the sweep too. */
  it('is judged by the role they hold now, not the one they had', async () => {
    await harness!.db
      .collection('users')
      .updateOne({ _id: OWNER_ID as never }, { $set: { role: 'hand' } });

    // A hand may not create a group — `canMutate` is what `project` consults.
    const id = await stranded({ entity: 'flock', payload: flock() });

    await sweepFarm(scope(), Date.now());

    expect(await outcomeOf(id)).toBe('rejected');
    expect(await harness!.db.collection('flocks').countDocuments({})).toBe(0);
  });
});

/**
 * Rows written before the outcome field existed are absent-or-null, which
 * `replayFromLog` also treats as undecided. They projected when they were first
 * applied and they replicate today, so sweeping them would re-project a farm's
 * entire history on the hour.
 */
describeDb('a row from before the outcome field existed', () => {
  it('is not swept', async () => {
    const m = makeMutation({ entity: 'flock', payload: flock() });
    await harness!.db.collection('mutations').insertOne({
      _id: m.id,
      orgId: ORG,
      targetId: m.targetId,
      entity: m.entity,
      op: m.op,
      payload: m.payload,
      deviceId: m.deviceId,
      clientSeq: m.clientSeq,
      clientTs: m.clientTs,
      schemaVersion: m.schemaVersion,
      userId: OWNER_ID,
      serverTs: new Date(Date.now() - SWEEP_AFTER_MS - 60_000),
      // No outcome, which is exactly what is on disk for those rows.
    } as never);

    const report = await sweepFarm(scope(), Date.now());

    expect(report.found).toBe(0);
    // And it was already replicating, which is why no backfill is needed.
    expect(await feed()).toEqual([m.id]);
  });
});
