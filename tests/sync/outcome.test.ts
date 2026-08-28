import { ulid } from 'ulid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionClaims } from '@homefarm/api/auth/claims';
import { scopedOn } from '@homefarm/api/db/scoped';
import { applyBatch } from '@homefarm/api/sync/apply';
import {
  OUTCOMES,
  PENDING,
  REPLICATED_OUTCOMES,
  WITHHELD_OUTCOMES,
  shouldReplicate,
} from '@homefarm/api/sync/outcome';
import { readSnapshotPage } from '@homefarm/api/sync/snapshot';
import { makeMutation } from '../support/fixtures';
import { startTestDb } from '../support/mongo';

/**
 * The log records what was ATTEMPTED; the feed carries what took effect.
 *
 * Before this split, a refusal the server issued on purpose was written into
 * every *other* device on the farm as though it had been accepted — the one
 * device that knew was the one that sent it. These tests are the line between
 * those two meanings, asserted from both ends: what the applier stamps, and
 * what hydration is willing to hand to a second device.
 *
 * Its own database name, because these suites wipe collections in `beforeEach`
 * and several files pointed at one server would wipe each other's fixtures
 * mid-test. Five files used to share `homefarm_isolation` for exactly that
 * reason; they no longer do (B-3), and every call site now names its own.
 */

const harness = await startTestDb('homefarm_outcome');
const describeDb = harness ? describe : describe.skip;

const ORG_A = ulid();
const OWNER: SessionClaims = { userId: ulid(), orgId: ORG_A, role: 'owner' };

function scope() {
  return scopedOn(harness!.db, ORG_A);
}

/** What a second device would receive, which is the only thing that matters here. */
async function feed(): Promise<string[]> {
  const page = await readSnapshotPage(scope(), { since: 0, sinceId: null });
  return page.mutations.map((m) => m.id);
}

async function storedOutcome(id: string): Promise<unknown> {
  const doc = await harness!.db.collection('mutations').findOne({ _id: id as never });
  return doc?.outcome;
}

function flock(overrides: Record<string, unknown> = {}) {
  return { name: 'Alpha', species: 'chicken', count: 12, ...overrides };
}

afterAll(async () => {
  await harness?.stop();
});

/**
 * Pure, so it runs without a mongod — and it is the guard that makes the
 * exclusion safe. An exclusion filter fails open when somebody adds a case, so
 * the classification is a total function and this asserts it stays one.
 */
describe('outcome classification', () => {
  it('classifies every outcome exactly once', () => {
    expect([...REPLICATED_OUTCOMES, ...WITHHELD_OUTCOMES].sort()).toEqual([...OUTCOMES].sort());
    expect(REPLICATED_OUTCOMES.filter((o) => WITHHELD_OUTCOMES.includes(o))).toEqual([]);
  });

  it('replicates only the outcomes that changed the projection', () => {
    expect([...REPLICATED_OUTCOMES].sort()).toEqual(['archive', 'insert', 'update']);
    expect([...WITHHELD_OUTCOMES].sort()).toEqual(['conflict', 'noop', PENDING, 'rejected']);
  });

  it('lets a row written before the field existed through, which is why no backfill is needed', () => {
    expect(shouldReplicate(undefined)).toBe(true);
    expect(shouldReplicate(null)).toBe(true);
  });

  it('withholds an outcome it cannot name rather than guessing', () => {
    // Only reachable from a newer deploy that was rolled back. The safe
    // direction for a row we cannot classify is the one that writes nothing.
    expect(shouldReplicate('some-future-kind')).toBe(false);
    expect(shouldReplicate(7)).toBe(false);
    expect(shouldReplicate({})).toBe(false);
  });

  it('withholds a command that has been logged but not yet decided', () => {
    expect(shouldReplicate(PENDING)).toBe(false);
  });
});

describeDb('the feed carries effects, not attempts', () => {
  beforeEach(async () => {
    await harness!.db.collection('mutations').deleteMany({});
    await harness!.db.collection('flocks').deleteMany({});
    await harness!.db.collection('hourReadings').deleteMany({});
    await harness!.db.collection('eggLogs').deleteMany({});
  });

  it('stamps what it decided, so the log says more than that it was asked', async () => {
    const created = makeMutation({ entity: 'flock', payload: flock() });
    await applyBatch(scope(), OWNER, [created]);

    expect(await storedOutcome(created.id)).toBe('insert');
  });

  /**
   * The hour meter refusal, which a farmer reaches by mistyping a digit. The
   * reading is logged — it has to be, it is the audit trail — and it must not
   * reach the other phones, where it would feed the service forecast.
   */
  it('does not replicate a reading the meter rule refused', async () => {
    const equipmentId = ulid();
    const reading = (hours: number) =>
      makeMutation({
        entity: 'hourReading',
        payload: { occurredAt: 1_700_000_000_000, equipmentId, hours },
      });

    const good = reading(999);
    const typo = reading(500);
    const results = await applyBatch(scope(), OWNER, [good, typo]);

    expect(results.map((r) => r.status)).toEqual(['applied', 'rejected']);
    expect(await storedOutcome(typo.id)).toBe('rejected');

    // Logged, so the audit trail is intact...
    expect(await harness!.db.collection('mutations').countDocuments({})).toBe(2);
    // ...and withheld, so no other device ever sees it.
    expect(await feed()).toEqual([good.id]);
  });

  /**
   * The one that undid an archive on every device except the one that tried it.
   * The client's `update` projection clears the deleted flag unconditionally,
   * so shipping a conflicted update resurrects a record a user retired.
   */
  it('does not replicate an update that conflicted with an archive', async () => {
    const targetId = ulid();
    const created = makeMutation({ targetId, entity: 'flock', payload: flock() });
    const archived = makeMutation({ targetId, entity: 'flock', op: 'delete', payload: {} });
    const edited = makeMutation({
      targetId,
      entity: 'flock',
      op: 'update',
      payload: { name: 'Renamed' },
    });

    const results = await applyBatch(scope(), OWNER, [created, archived, edited]);
    expect(results.map((r) => r.status)).toEqual(['applied', 'applied', 'conflict']);
    expect(await storedOutcome(edited.id)).toBe('conflict');

    expect(await feed()).toEqual([created.id, archived.id]);

    // And it stays archived here too, which is the state the feed now agrees with.
    const doc = await harness!.db.collection('flocks').findOne({ _id: targetId as never });
    expect(doc?.archivedAt).toBeInstanceOf(Date);
    expect(doc?.name).toBe('Alpha');
  });

  it('does not replicate a command that changed nothing', async () => {
    const targetId = ulid();
    const created = makeMutation({ targetId, entity: 'flock', payload: flock() });
    // A different mutation id against the same target: a second device that
    // created the same record. The projection is already in the desired state.
    const again = makeMutation({ targetId, entity: 'flock', payload: flock() });

    await applyBatch(scope(), OWNER, [created, again]);

    expect(await storedOutcome(again.id)).toBe('noop');
    expect(await feed()).toEqual([created.id]);
  });

  /**
   * The migration decision, asserted rather than described. Excluding these
   * instead would drop a farm's entire history from every new device, and it is
   * the one call here that cannot be taken back.
   */
  it('still replicates rows written before the outcome field existed', async () => {
    const legacy = makeMutation();
    await harness!.db.collection('mutations').insertOne({
      _id: legacy.id,
      orgId: ORG_A,
      targetId: legacy.targetId,
      entity: legacy.entity,
      op: legacy.op,
      payload: legacy.payload,
      deviceId: legacy.deviceId,
      clientSeq: legacy.clientSeq,
      clientTs: legacy.clientTs,
      schemaVersion: legacy.schemaVersion,
      userId: OWNER.userId,
      serverTs: new Date(),
      // No outcome. This is exactly what is on disk today.
    } as never);

    expect(await feed()).toEqual([legacy.id]);
  });

  /**
   * Filtering in the read loop rather than the query is what buys this. A query
   * filter would leave the cursor parked before a run of refused rows and
   * rescan them on every pull, for ever.
   */
  it('advances the watermark past what it withholds', async () => {
    const equipmentId = ulid();
    const good = makeMutation({
      entity: 'hourReading',
      payload: { occurredAt: 1_700_000_000_000, equipmentId, hours: 999 },
    });
    const refused = makeMutation({
      entity: 'hourReading',
      payload: { occurredAt: 1_700_000_000_000, equipmentId, hours: 10 },
    });

    await applyBatch(scope(), OWNER, [good, refused]);

    const page = await readSnapshotPage(scope(), { since: 0, sinceId: null });
    expect(page.mutations.map((m) => m.id)).toEqual([good.id]);
    // The last row READ, not the last row kept — so the refused row is behind
    // the cursor and is never scanned again.
    expect(page.throughId).toBe(refused.id);
  });
});

describeDb('a replayed id projects the log, not the request', () => {
  beforeEach(async () => {
    await harness!.db.collection('mutations').deleteMany({});
    await harness!.db.collection('flocks').deleteMany({});
    await harness!.db.collection('eggLogs').deleteMany({});
  });

  /**
   * `$setOnInsert` freezes the log row, so on a replay the request and the log
   * can disagree. Projecting the request would write domain state the audit row
   * does not describe — a write with no audit trail.
   */
  it('ignores a changed payload arriving under a known id', async () => {
    const targetId = ulid();
    const created = makeMutation({ targetId, entity: 'flock', payload: flock() });
    const renamed = makeMutation({
      targetId,
      entity: 'flock',
      op: 'update',
      payload: { name: 'Second' },
    });
    await applyBatch(scope(), OWNER, [created, renamed]);

    const tampered = { ...renamed, payload: { name: 'Tampered', count: 9999 } };
    const result = await applyBatch(scope(), OWNER, [tampered]);

    expect(result[0]?.status).toBe('duplicate');

    const doc = await harness!.db.collection('flocks').findOne({ _id: targetId as never });
    expect(doc?.name).toBe('Second');
    expect(doc?.count).toBe(12);

    // The log is untouched too, which it always was — the point is that the
    // projection now agrees with it.
    const logged = await harness!.db.collection('mutations').findOne({ _id: renamed.id as never });
    expect(logged?.payload).toEqual({ name: 'Second' });
  });

  it('ignores a different target arriving under a known id', async () => {
    const mine = ulid();
    const theirs = ulid();
    const created = makeMutation({ targetId: mine, entity: 'flock', payload: flock() });
    const other = makeMutation({ targetId: theirs, entity: 'flock', payload: flock({ name: 'Beta' }) });
    await applyBatch(scope(), OWNER, [created, other]);

    // Same id as `created`, pointed at somebody else's record.
    const redirected = { ...created, targetId: theirs, payload: flock({ name: 'Hijacked' }) };
    const result = await applyBatch(scope(), OWNER, [redirected]);

    expect(result[0]?.status).toBe('duplicate');
    const doc = await harness!.db.collection('flocks').findOne({ _id: theirs as never });
    expect(doc?.name).toBe('Beta');
  });

  /**
   * A refusal stays a refusal. Reporting `duplicate` would tell the device its
   * rejected-inbox entry had somehow been accepted on retry.
   */
  it('replays a decided refusal as the same refusal', async () => {
    const equipmentId = ulid();
    const reading = (hours: number, overrides = {}) =>
      makeMutation({
        entity: 'hourReading',
        payload: { occurredAt: 1_700_000_000_000, equipmentId, hours },
        ...overrides,
      });

    const good = reading(999);
    const typo = reading(500);
    await applyBatch(scope(), OWNER, [good, typo]);

    const again = await applyBatch(scope(), OWNER, [typo]);
    expect(again[0]?.status).toBe('rejected');
    expect(again[0]?.reason).toContain('999');
  });

  it('does not re-run the projection once a row is decided', async () => {
    const targetId = ulid();
    const created = makeMutation({ targetId, entity: 'flock', payload: flock() });
    await applyBatch(scope(), OWNER, [created]);

    const first = await harness!.db.collection('flocks').findOne({ _id: targetId as never });

    // Archive it behind the applier's back, then replay the create. Before the
    // outcome existed this re-projected every time; a decided row must not.
    await harness!.db
      .collection('flocks')
      .updateOne({ _id: targetId as never }, { $set: { archivedAt: new Date() } });

    const replay = await applyBatch(scope(), OWNER, [created]);
    expect(replay[0]?.status).toBe('duplicate');

    const after = await harness!.db.collection('flocks').findOne({ _id: targetId as never });
    expect(after?.archivedAt).toBeInstanceOf(Date);
    expect(after?.createdAt).toEqual(first?.createdAt);
  });
});

/**
 * The crash window between the two writes, which is why `pending` is stamped
 * with the envelope rather than after the decision.
 *
 * The API restarts on a five-minute deploy timer, so this is an ordinary event
 * rather than an exotic one.
 */
describeDb('a projection lost to a crash repairs itself', () => {
  beforeEach(async () => {
    await harness!.db.collection('mutations').deleteMany({});
    await harness!.db.collection('eggLogs').deleteMany({});
  });

  it('re-projects a logged row that never got a decision', async () => {
    const mutation = makeMutation({ payload: { occurredAt: 1, flockId: ulid(), count: 18 } });

    // Exactly the state a crash between the log write and the projection
    // leaves: the row is there, stamped pending, and nothing was projected.
    await harness!.db.collection('mutations').insertOne({
      _id: mutation.id,
      orgId: ORG_A,
      targetId: mutation.targetId,
      entity: mutation.entity,
      op: mutation.op,
      payload: mutation.payload,
      deviceId: mutation.deviceId,
      clientSeq: mutation.clientSeq,
      clientTs: mutation.clientTs,
      schemaVersion: mutation.schemaVersion,
      userId: OWNER.userId,
      serverTs: new Date(),
      outcome: 'pending',
    } as never);

    expect(await harness!.db.collection('eggLogs').countDocuments({})).toBe(0);
    // Withheld while undecided, so no device replays a command whose effect is
    // not yet known.
    expect(await feed()).toEqual([]);

    // The client never got a response, so it resends.
    const result = await applyBatch(scope(), OWNER, [mutation]);

    expect(result[0]?.status).toBe('duplicate');
    expect(await storedOutcome(mutation.id)).toBe('insert');
    // Repaired, and not duplicated.
    expect(await harness!.db.collection('eggLogs').countDocuments({})).toBe(1);
    expect(await feed()).toEqual([mutation.id]);
  });

  /**
   * What the page says about itself when it stopped rather than ran out (H6).
   *
   * `more` is not only a paging hint. The client's one-time projection repair
   * treats `false` as proof the log ran out, and on that proof deletes every
   * local record the replay did not stamp and no outbox row names. Answering
   * `false` at a stall — which this used to do, deliberately, to save a round
   * trip — meant a device whose records arrived by pull lost every record
   * whose log rows sat beyond the undecided one, and set `repairDone`, so the
   * repair never ran again to put them back.
   *
   * The saved round trip is spent instead: the client asks once more, reads
   * nothing, gets the cursor back unchanged, and stops on its own no-progress
   * guard with `more` still true.
   */
  it('says there is more when it stopped at a row it could not decide', async () => {
    const undecided = makeMutation({ payload: { occurredAt: 1, flockId: ulid(), count: 18 } });
    const behindIt = makeMutation({ payload: { occurredAt: 2, flockId: ulid(), count: 19 } });

    await harness!.db.collection('mutations').insertMany([
      {
        _id: undecided.id,
        orgId: ORG_A,
        targetId: undecided.targetId,
        entity: undecided.entity,
        op: undecided.op,
        payload: undecided.payload,
        deviceId: undecided.deviceId,
        clientSeq: undecided.clientSeq,
        clientTs: undecided.clientTs,
        schemaVersion: undecided.schemaVersion,
        userId: OWNER.userId,
        serverTs: new Date(1_000),
        outcome: 'pending',
      },
      {
        _id: behindIt.id,
        orgId: ORG_A,
        targetId: behindIt.targetId,
        entity: behindIt.entity,
        op: behindIt.op,
        payload: behindIt.payload,
        deviceId: behindIt.deviceId,
        clientSeq: behindIt.clientSeq,
        clientTs: behindIt.clientTs,
        schemaVersion: behindIt.schemaVersion,
        userId: OWNER.userId,
        serverTs: new Date(2_000),
        outcome: 'insert',
      },
    ] as never);

    const page = await readSnapshotPage(scope(), { since: 0, sinceId: null });

    // Held behind the undecided row, which is the ordering this stall exists
    // to protect — and the reason the client must not read the page as final.
    expect(page.mutations).toEqual([]);
    expect(page.more).toBe(true);
    // And the cursor did not move past it, so the next page starts here again.
    expect(page.through).toBe(0);
    expect(page.throughId).toBeNull();
  });

  /** The other half of the same flag: run out, and say so. */
  it('says there is no more when the log has genuinely run out', async () => {
    const mutation = makeMutation({ payload: { occurredAt: 1, flockId: ulid(), count: 18 } });
    await applyBatch(scope(), OWNER, [mutation]);

    const page = await readSnapshotPage(scope(), { since: 0, sinceId: null });

    expect(page.mutations.map((m) => m.id)).toEqual([mutation.id]);
    expect(page.more).toBe(false);
  });
});
