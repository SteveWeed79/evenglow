import { ulid } from 'ulid';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionClaims } from '@steading/api/auth/claims';
import { scopedOn } from '@steading/api/db/scoped';
import { applyBatch } from '@steading/api/sync/apply';
import { newId } from '@steading/contracts';
import { localStore } from '@steading/core/db/store';
import { flushOnce } from '@steading/core/sync/flush';
import { discardRejected, listRejected } from '@steading/core/sync/inbox';
import { pullOnce } from '@steading/core/sync/pull';
import { enqueue } from '@steading/core/sync/queue';
import { type Farm, twoDevices } from '../support/devices';
import { makeMutation } from '../support/fixtures';
import { startTestDb } from '../support/mongo';
import { type Wire, wireTo } from '../support/wire';

/**
 * What the *other* phone on the farm ends up holding.
 *
 * ## The end that was never tested
 *
 * `outcome.test.ts` asserts the server half of P0-2 thoroughly: what the applier
 * stamps, and what `readSnapshotPage` is willing to hand out. Its own helper is
 * named `feed()` and commented *"what a second device would receive"* — which is
 * the honest limit of a suite with one device in it. **What a second device
 * would receive is not what a second device ends up holding.** Between them sit
 * `pullOnce`, the watermark, the re-sort, the pending-target pause and
 * `projectOne`, and P0-2's sharpest symptom lived in that last one: *"the
 * client's `update` projection clears the deleted flag unconditionally"*, so the
 * archive was actively undone rather than merely not re-applied.
 *
 * `SYNC-INTEGRITY-TODO.md` states the gap as a fact about the suite: *"Every
 * claim in this document about what device B sees is therefore untested from
 * both ends."* These are the both-ends versions, over `tests/support/devices.ts`.
 *
 * ## Two real stores, one real server, no HTTP
 *
 * Each device is its own SQLite file with its own `deviceId` and `clientSeq`;
 * the wire is the real applier and the real snapshot read, called directly, for
 * the reason `idempotency.test.ts` gives about itself. A fabricated page cannot
 * disagree with the server, and disagreement is the whole subject.
 *
 * ## Two of the listed assertions are deliberately not here
 *
 * **Late insertion behind an advanced cursor.** That is P0-3, and the
 * verification pass re-ranked it and refused the original prescription — the
 * restatement *"as a property of visible order"* is the open item. A test
 * written now would encode a rule nobody has settled, which is worse than no
 * test because it would have to be rewritten to match whatever is decided.
 *
 * **Crash between log write and projection.** The list already says why: *"Needs
 * a seam that does not exist — `applyMutation` takes no clock and no hook."*
 * Adding one is a production change and belongs with the sweeper that uses it.
 */

const harness = await startTestDb('steading_two_devices');
const describeDb = harness ? describe : describe.skip;

const ORG = ulid();
const OWNER: SessionClaims = { userId: ulid(), orgId: ORG, role: 'owner' };

function scope() {
  return scopedOn(harness!.db, ORG);
}

function flock(over: Record<string, unknown> = {}) {
  return { name: 'Alpha', species: 'chicken', count: 12, ...over };
}

let farm: Farm;
let wire: Wire;

beforeEach(async () => {
  for (const name of ['mutations', 'flocks', 'hourReadings', 'equipment']) {
    await harness!.db.collection(name).deleteMany({});
  }
  farm = await twoDevices();
  wire = wireTo(scope, OWNER);
});

afterEach(async () => {
  await farm.close();
});

afterAll(async () => {
  await harness?.stop();
});

/** Every projected record of one entity on one device. */
async function recordsOn(device: Farm['a'], entity: string) {
  return device.as(() => localStore().readRecordsByEntity(entity as never));
}

/** The whole inbox dealt with, as a farmer clearing "Needs a look" does. */
async function discardAll(): Promise<void> {
  for (const refusal of await listRejected()) await discardRejected(refusal.id);
}

describeDb('a record made on one phone', () => {
  it('reaches the other one, whole', async () => {
    const group = newId();

    await farm.a.as(async () => {
      await enqueue({ entity: 'flock', op: 'create', targetId: group, payload: flock() });
      await flushOnce(wire.push);
    });

    const outcome = await farm.b.as(() => pullOnce(wire.pull));

    expect(outcome.applied).toBe(1);
    const onB = await recordsOn(farm.b, 'flock');
    expect(onB).toHaveLength(1);
    expect(onB[0]?.targetId).toBe(group);
    expect((onB[0]?.value as { name?: string }).name).toBe('Alpha');
  });

  /**
   * The baseline the refusal tests are measured against: after a full round
   * trip both phones hold the same thing, so a later divergence is the finding
   * rather than the harness.
   */
  it('leaves both phones holding the same thing', async () => {
    const group = newId();

    await farm.a.as(async () => {
      await enqueue({ entity: 'flock', op: 'create', targetId: group, payload: flock() });
      await enqueue({ entity: 'flock', op: 'update', targetId: group, payload: { count: 14 } });
      await flushOnce(wire.push);
    });
    await farm.b.as(() => pullOnce(wire.pull));

    const [onA] = await recordsOn(farm.a, 'flock');
    const [onB] = await recordsOn(farm.b, 'flock');

    expect((onA?.value as { count?: number }).count).toBe(14);
    expect((onB?.value as { count?: number }).count).toBe(14);
    expect(onA?.deleted).toBe(onB?.deleted);
  });
});

/**
 * The four symptoms P0-2 names, each asserted where it actually hurt: on the
 * phone belonging to somebody who did nothing wrong and got no signal.
 */
describeDb('a refusal the server issued', () => {
  /**
   * A mistyped hour meter reading — reachable from the shipped UI, which the
   * screen's own copy invites. Logged for the audit trail, and it must not
   * reach the other phone, where it would feed the service forecast.
   */
  it('does not arrive on the other phone as a reading', async () => {
    const machine = newId();

    await farm.a.as(async () => {
      await enqueue({ entity: 'equipment', op: 'create', targetId: machine, payload: { name: 'The tractor' } });
      await enqueue({
        entity: 'hourReading',
        op: 'create',
        targetId: newId(),
        payload: { occurredAt: 1_700_000_000_000, equipmentId: machine, hours: 999 },
      });
      await flushOnce(wire.push);

      // The digit somebody drops. The meter's own rule refuses anything lower.
      await enqueue({
        entity: 'hourReading',
        op: 'create',
        targetId: newId(),
        payload: { occurredAt: 1_700_000_000_100, equipmentId: machine, hours: 500 },
      });
      await flushOnce(wire.push);
    });

    await farm.b.as(() => pullOnce(wire.pull));

    const readings = await recordsOn(farm.b, 'hourReading');
    expect(readings).toHaveLength(1);
    expect((readings[0]?.value as { hours?: number }).hours).toBe(999);
  });

  /**
   * **The sharpest one, and the reason this file exists.**
   *
   * A device archives a group. Another device, offline, edits it. The server
   * conflicts the edit exactly as intended — and `projectOne` writes
   * `deleted = op === 'delete' ? 1 : 0` on every row, so a pulled `update`
   * clears the flag. The archive was not merely un-re-applied; it was undone.
   *
   * The editing device is the one that already knows, from its own inbox. This
   * asserts the state it is left holding once it has heard back and caught up:
   * the group is archived on both phones, and the refusal is sitting where
   * somebody will see it.
   */
  it('leaves an archived group archived on the phone that tried to edit it', async () => {
    const group = newId();

    await farm.a.as(async () => {
      await enqueue({ entity: 'flock', op: 'create', targetId: group, payload: flock() });
      await flushOnce(wire.push);
    });
    await farm.b.as(() => pullOnce(wire.pull));

    // A retires it while B is out of signal.
    await farm.a.as(async () => {
      await enqueue({ entity: 'flock', op: 'delete', targetId: group, payload: {} });
      await flushOnce(wire.push);
    });

    // B edits the group it still believes is live, then gets signal back.
    const refused = await farm.b.as(async () => {
      await enqueue({ entity: 'flock', op: 'update', targetId: group, payload: { name: 'Renamed' } });
      const outcome = await flushOnce(wire.push);
      await pullOnce(wire.pull);
      return { outcome, inbox: await listRejected() };
    });

    expect(refused.outcome.rejected).toBe(1);
    expect(refused.inbox.map((m) => m.op)).toEqual(['update']);

    const [onB] = await recordsOn(farm.b, 'flock');
    expect(onB?.deleted).toBe(true);

    const [onA] = await recordsOn(farm.a, 'flock');
    expect(onA?.deleted).toBe(true);
  });
});

/**
 * What the edit itself leaves behind on the phone that made it — which is a
 * different question from whether it replicated, and has a settled answer that
 * this file had wrong.
 *
 * **A refusal does not revert anything on its own.** N-1 in
 * `SYNC-INTEGRITY-TODO.md` decided that deliberately: *"a rejected mutation is
 * a decision the user has not made yet, so hiding the record leaves them
 * reading an inbox entry about a group they can no longer see, and
 * `retryRejected` would have nothing left to re-project."* The pre-image in
 * `record_undo` is spent by `discardRejected`, not by the rejection.
 *
 * So the optimistic name survives the flush, and whether it survives past the
 * discard depends on **what else touched the record in between** — `after`
 * only restores over a row nothing has moved since. Both orders happen on a
 * real farm and they end in different places, so both are pinned here. The
 * original version of this suite asserted the second one's outcome while
 * performing the first one's sequence, which is what CI caught.
 */
describeDb('the refused edit on the phone that made it', () => {
  /** A retires the group, B renames it offline. Shared by both orders below. */
  async function upTo(group: string): Promise<void> {
    await farm.a.as(async () => {
      await enqueue({ entity: 'flock', op: 'create', targetId: group, payload: flock() });
      await flushOnce(wire.push);
    });
    await farm.b.as(() => pullOnce(wire.pull));

    await farm.a.as(async () => {
      await enqueue({ entity: 'flock', op: 'delete', targetId: group, payload: {} });
      await flushOnce(wire.push);
    });

    await farm.b.as(async () => {
      await enqueue({ entity: 'flock', op: 'update', targetId: group, payload: { name: 'Renamed' } });
      await flushOnce(wire.push);
    });
  }

  /** Discarded before anything else lands, the pre-image puts the name back. */
  it('is taken back cleanly when the farmer deals with the inbox first', async () => {
    const group = newId();
    await upTo(group);

    await farm.b.as(async () => {
      await discardAll();

      const [restored] = await localStore().readRecordsByEntity('flock' as never);
      expect((restored?.value as { name?: string }).name).toBe('Alpha');
      expect(restored?.deleted).toBe(false);

      await pullOnce(wire.pull);
    });

    // And then it converges on exactly what A holds.
    const [onA] = await recordsOn(farm.a, 'flock');
    const [onB] = await recordsOn(farm.b, 'flock');
    expect(onB?.deleted).toBe(true);
    expect((onB?.value as { name?: string }).name).toBe('Alpha');
    expect((onA?.value as { name?: string }).name).toBe('Alpha');
  });

  /**
   * Pulled first, the archive is newer than the pre-image's `after`, so the
   * discard stands down rather than restoring over it — *"newer wins"*.
   *
   * The residue that leaves is the name on an **archived** record, on the one
   * phone whose user typed it and was told it was refused. It shows in no live
   * list and reaches no other device; the alternative is a discard that can
   * resurrect a value the farm has moved past, which `restoreBefore` exists to
   * prevent. Pinned so the trade is visible rather than discovered.
   */
  it('is left in place when an archive from elsewhere has already landed on it', async () => {
    const group = newId();
    await upTo(group);

    await farm.b.as(async () => {
      await pullOnce(wire.pull);
      await discardAll();
    });

    const [onB] = await recordsOn(farm.b, 'flock');
    expect(onB?.deleted).toBe(true);
    expect((onB?.value as { name?: string }).name).toBe('Renamed');

    // The farm at large never heard of it, which is the part that matters.
    const [onA] = await recordsOn(farm.a, 'flock');
    expect((onA?.value as { name?: string }).name).toBe('Alpha');
    const server = await harness!.db.collection('flocks').findOne({ _id: group as never });
    expect(server?.name).toBe('Alpha');
  });
});

/**
 * `$setOnInsert` freezes the log row, so on a replay the request and the log
 * can disagree. The list is specific about the shape that bites: *"Use the
 * hour-reading or `update` shape, not an append-only create"*, because an
 * append-only create against an existing target is a `noop` and the assertion
 * would pass without proving anything.
 */
describeDb('a replayed id carrying a changed payload', () => {
  it('reaches the other phone as what was logged, not as what was resent', async () => {
    const group = newId();

    await farm.a.as(async () => {
      await enqueue({ entity: 'flock', op: 'create', targetId: group, payload: flock() });
      await flushOnce(wire.push);
    });

    const edit = makeMutation({
      targetId: group,
      entity: 'flock',
      op: 'update',
      payload: { name: 'Renamed' },
    });
    await applyBatch(scope(), OWNER, [edit]);

    // The same id, resent with different content — a tampered or garbled retry.
    const tampered = { ...edit, payload: { name: 'Something else' } };
    const [result] = await applyBatch(scope(), OWNER, [tampered]);
    expect(result?.status).toBe('duplicate');

    await farm.b.as(() => pullOnce(wire.pull));

    const [onB] = await recordsOn(farm.b, 'flock');
    expect((onB?.value as { name?: string }).name).toBe('Renamed');
  });
});
