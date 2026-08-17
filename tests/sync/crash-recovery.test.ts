import { ulid } from 'ulid';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionClaims } from '@steading/api/auth/claims';
import { scopedOn } from '@steading/api/db/scoped';
import { PENDING } from '@steading/api/sync/outcome';
import { SWEEP_AFTER_MS, sweepFarm } from '@steading/api/sync/sweep';
import { newId } from '@steading/contracts';
import { localStore } from '@steading/core/db/store';
import { flushOnce } from '@steading/core/sync/flush';
import { pullOnce } from '@steading/core/sync/pull';
import { enqueue } from '@steading/core/sync/queue';
import { type Farm, twoDevices } from '../support/devices';
import { makeMutation } from '../support/fixtures';
import { startTestDb } from '../support/mongo';
import { type Wire, wireTo } from '../support/wire';

/**
 * The record whose write was interrupted, seen from the phone that was not
 * holding the phone.
 *
 * ## Why this was deferred, and why it is not deferred any more
 *
 * The harness box lists *"crash between log write and projection"* among its
 * six assertions and defers it with a reason: *"Needs a seam that does not
 * exist — `applyMutation` takes no clock and no hook. Adding one is a
 * production change and belongs with the sweeper that uses it."* The sweeper
 * shipped on 17 August, so the deferral has expired.
 *
 * It also turns out not to need the seam. `sweeper.test.ts` makes the same
 * argument about its own fixtures — *"what is being tested here is the repair,
 * and the repair only needs the state"* — and the state is writable directly:
 * the envelope on disk, `outcome: pending`, no projection. That is exactly what
 * a process killed between the two writes leaves behind.
 *
 * ## What this adds over the sweeper's own suite
 *
 * That suite asserts the repair and reads `readSnapshotPage` through a helper
 * named `feed()`, commented *"what a second device would receive"*. This file
 * exists because **what a second device would receive is not what a second
 * device ends up holding** — between them sit the watermark, the re-sort and
 * `projectOne`. A stranded row is the case where that gap is most likely to
 * matter, because the row is decided long after it was logged while carrying
 * the `serverTs` it was logged with.
 */

const harness = await startTestDb('steading_crash_recovery');

/**
 * The sweeper re-derives the author's role through `findUserById`, which is
 * identity rather than tenant data and goes through the global `db()`. Same
 * reasoning, and the same two lines, as `sweeper.test.ts`.
 */
if (harness) {
  process.env.MONGODB_URI = harness.uri;
  process.env.MONGODB_DB = 'steading_crash_recovery';
}

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

let farm: Farm;
let wire: Wire;

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
 * A record whose log write landed and whose projection did not — a phone-side
 * crash from the server's point of view, written directly for the reason the
 * sweeper's suite gives about the identical fixture.
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

async function groupsOn(device: Farm['a']) {
  return device.as(() => localStore().readRecordsByEntity('flock' as never));
}

beforeEach(async () => {
  for (const name of ['mutations', 'flocks', 'users']) {
    await harness!.db.collection(name).deleteMany({});
  }
  await theOwnerExists();
  farm = await twoDevices();
  wire = wireTo(scope, OWNER);
});

afterEach(async () => {
  await farm.close();
});

afterAll(async () => {
  await harness?.stop();
});

describeDb('a record the server logged but never projected', () => {
  it('is on no other phone until the sweep decides it', async () => {
    const targetId = ulid();
    await stranded({ entity: 'flock', targetId, payload: flock() });

    await farm.b.as(() => pullOnce(wire.pull));
    expect(await groupsOn(farm.b)).toEqual([]);

    await sweepFarm(scope(), Date.now());

    const outcome = await farm.b.as(() => pullOnce(wire.pull));

    expect(outcome.applied).toBe(1);
    const [onB] = await groupsOn(farm.b);
    expect(onB?.targetId).toBe(targetId);
    expect((onB?.value as { name?: string }).name).toBe('Alpha');
  });

  /**
   * **The bug this file found, and the reason it belongs here rather than in
   * the sweeper's own suite.**
   *
   * A swept row keeps the `serverTs` it was logged with — `$setOnInsert` froze
   * it at the crash — while the farm goes on recording things that get later
   * stamps. `readSnapshotPage` used to skip an undecided row *and advance the
   * watermark past it*, on reasoning written for the refusals it skips
   * alongside. A refusal is permanent; `pending` is not. So every device that
   * pulled during the hour before the sweep ended up with a cursor beyond the
   * stranded row, and a cursor never looks back: the sweeper repaired the
   * server's projection and the record reached **no other phone on the farm,
   * for ever** — the precise harm P0-2's last box was closing.
   *
   * The sweeper's own suite cannot see it. Its `feed()` reads from `since: 0`
   * every time, which is a device that has never pulled; the loss only exists
   * for a device that has. That is this file's whole thesis — *what a second
   * device would receive is not what a second device ends up holding* — and it
   * is the first time the distinction has caught something.
   *
   * Both halves are asserted: the feed **waits** at the undecided row rather
   * than stepping over it, which is the cost, and everything arrives in the
   * order it was logged once the sweep decides, which is what the cost buys.
   */
  it('does not let a phone pull past the crash and lose it for ever', async () => {
    const lost = ulid();
    await stranded({ entity: 'flock', targetId: lost, payload: flock({ name: 'Stranded' }) });

    // Ordinary work, accepted now, so it is stamped later than the crash.
    const ordinary = newId();
    await farm.a.as(async () => {
      await enqueue({
        entity: 'flock',
        op: 'create',
        targetId: ordinary,
        payload: flock({ name: 'Ordinary' }),
      });
      await flushOnce(wire.push);
    });

    /**
     * B waits with it. The later record is held back too, because releasing it
     * is what would carry the cursor past the crash — the cost of keeping the
     * log's order, paid here in a delay rather than in a lost record.
     */
    await farm.b.as(() => pullOnce(wire.pull));
    expect(await groupsOn(farm.b)).toEqual([]);

    await sweepFarm(scope(), Date.now());

    await farm.b.as(() => pullOnce(wire.pull));

    const held = await groupsOn(farm.b);
    expect(held.map((r) => r.targetId).sort()).toEqual([lost, ordinary].sort());
    expect(held).toHaveLength(2);
  });

  /**
   * The stall is specific to the undecided row, not to withholding in general.
   *
   * A refusal is skipped and moved past exactly as before — if it were not, a
   * farm whose hand tries something forbidden would park every other phone's
   * feed behind it until somebody noticed.
   */
  it('still steps over a refusal, which is a decision and stays one', async () => {
    const hand: SessionClaims = { userId: OWNER_ID, orgId: ORG, role: 'hand' };
    const refused = newId();
    const after = newId();

    // A hand may not create a group, so the server refuses this one outright.
    await farm.a.as(async () => {
      await enqueue({ entity: 'flock', op: 'create', targetId: refused, payload: flock() });
      await flushOnce(wireTo(scope, hand).push);
    });
    await farm.a.as(async () => {
      await enqueue({
        entity: 'flock',
        op: 'create',
        targetId: after,
        payload: flock({ name: 'After' }),
      });
      await flushOnce(wire.push);
    });

    await farm.b.as(() => pullOnce(wire.pull));

    // The refusal never lands, and it does not hold up what followed it.
    expect((await groupsOn(farm.b)).map((r) => r.targetId)).toEqual([after]);
  });
});
