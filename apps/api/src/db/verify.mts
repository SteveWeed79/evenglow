/**
 * `pnpm db:verify` — first-contact check for the server data path.
 *
 * Every Mongo-touching line in this repo was written without a database ever
 * being reachable. This script is the shortest possible way to find out
 * whether any of it actually works: point it at any MongoDB and it exercises
 * the real code paths — the scoped layer, index application, the sync
 * applier — and reports plainly.
 *
 * It needs no vitest, no mongodb-memory-server, and no CI. One command
 * against a local Docker container answers the question.
 *
 * SAFETY: this script DROPS the database it uses, so it deliberately does not
 * use the app's database whatever MONGODB_URI or MONGODB_DB point at. The
 * separate name is a safety control, not an environment label — pointing this
 * at `homefarm` would delete a farm's records.
 */
import { MongoClient } from 'mongodb';
import { ulid } from 'ulid';
import { applyIndexes, INDEXES, leadingKey } from './indexes.ts';
import { COLLECTIONS, scopedOn, type Tenanted } from './scoped.ts';
import { applyBatch } from '../sync/apply.ts';
import { MUTATION_SCHEMA_VERSION } from '@homefarm/contracts';

const VERIFY_DB = 'homefarm_verify';

/**
 * A projected record, as much of it as the checks below read back.
 *
 * `col<T>` is constrained to `Tenanted` on purpose — a shape without `_id` and
 * `orgId` is not a document this layer will hand out, which is the type system
 * carrying the tenancy rule rather than a comment doing it.
 */
interface Projected extends Tenanted {
  archivedAt?: Date | null;
  count?: number;
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('Set MONGODB_URI. Example:\n  MONGODB_URI=mongodb://localhost:27017 pnpm db:verify');
  process.exit(1);
}

const checks: { name: string; ok: boolean; detail?: string }[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  checks.push(detail === undefined ? { name, ok } : { name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function fail(name: string, error: unknown): Promise<never> {
  check(name, false, error instanceof Error ? error.message : String(error));
  report();
  process.exit(1);
}

function report(): void {
  const failed = checks.filter((c) => !c.ok);
  console.log('');
  if (failed.length === 0) {
    console.log(`All ${checks.length} checks passed. The server data path works.`);
  } else {
    console.log(`${failed.length} of ${checks.length} checks FAILED:`);
    for (const f of failed) console.log(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  }
}

console.log(`Verifying against ${uri.replace(/\/\/[^@]*@/, '//***@')}, database "${VERIFY_DB}".\n`);

// Fail fast rather than hanging on the driver's 30s default — this is a
// diagnostic, and "cannot reach it" is a useful answer delivered quickly.
const client = await new MongoClient(uri, { serverSelectionTimeoutMS: 5_000 })
  .connect()
  .catch((error: unknown) => {
    console.error(`Could not reach MongoDB at that URI.\n  ${String(error)}`);
    process.exit(1);
  });
const database = client.db(VERIFY_DB);

// Start from nothing, so a previous run cannot make this one look good.
await database.dropDatabase();

// ── 1. Connection and index application ──────────────────────────────────────
try {
  await applyIndexes(database);
  check('Indexes apply without error', true);
} catch (error) {
  await fail('Indexes apply without error', error);
}

// ── 2. Index discipline, read back from the server (C3) ──────────────────────
// The unit test asserts the DEFINITIONS lead with orgId. This asserts the
// database actually has them, which is the part that was never verified.
for (const name of COLLECTIONS) {
  try {
    const live = await database.collection(name).indexes();
    const wanted = INDEXES[name];

    const missing = wanted.filter((want) => {
      const key = JSON.stringify(want.key);
      return !live.some((got) => JSON.stringify(got.key) === key);
    });

    const badLead = live
      .filter((i) => i.name !== '_id_')
      .filter((i) => Object.keys(i.key)[0] !== 'orgId');

    check(
      `${name}: every defined index exists and leads with orgId`,
      missing.length === 0 && badLead.length === 0,
      missing.length > 0
        ? `${missing.length} missing`
        : badLead.length > 0
          ? `${badLead.length} not orgId-leading`
          : undefined,
    );
  } catch (error) {
    await fail(`${name}: index check`, error);
  }
}

// Definitions themselves, for completeness.
check(
  'Every collection has an orgId-leading definition',
  COLLECTIONS.every((n) => INDEXES[n].every((i) => leadingKey(i) === 'orgId')),
);

// ── 3. The scoped layer against the real driver ──────────────────────────────
const ORG_A = ulid();
const ORG_B = ulid();

const claims = (orgId: string) => ({ userId: ulid(), orgId, role: 'owner' as const });

function eggLog(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: MUTATION_SCHEMA_VERSION,
    id: ulid(),
    targetId: ulid(),
    entity: 'eggLog' as const,
    op: 'create' as const,
    payload: { occurredAt: Date.now(), flockId: ulid(), count: 18 },
    deviceId: '00000000-0000-4000-8000-000000000001',
    clientSeq: 0,
    clientTs: Date.now(),
    ...overrides,
  };
}

try {
  const a = scopedOn(database, ORG_A);
  const batch = [eggLog({ clientSeq: 0 }), eggLog({ clientSeq: 1 })];

  const first = await applyBatch(a, claims(ORG_A), batch);
  check(
    'A batch applies through the real applier',
    first.every((r) => r.status === 'applied'),
    first.map((r) => r.status).join(', '),
  );

  // ── 4. Idempotency (A3) ────────────────────────────────────────────────────
  const replay = await applyBatch(a, claims(ORG_A), batch);
  check(
    'A replayed batch is a duplicate, not a second record',
    replay.every((r) => r.status === 'duplicate'),
    replay.map((r) => r.status).join(', '),
  );

  const count = await a.col('mutations').countDocuments();
  check('Exactly one record per mutation after replay', count === 2, `found ${count}`);

  // ── 5. Projection ──────────────────────────────────────────────────────────
  const projected = await a.col('eggLogs').countDocuments();
  check('Mutations project into their domain collection', projected === 2, `found ${projected}`);

  // ── 6. Tenant isolation (C1/C4) ────────────────────────────────────────────
  const b = scopedOn(database, ORG_B);
  const bSees = await b.col('mutations').countDocuments();
  check('Another org sees none of it', bSees === 0, `found ${bSees}`);

  const direct = await b.col('mutations').findOne({ _id: batch[0]!.id });
  check('A direct id lookup from another org returns null', direct === null);

  // ── 7. Cross-tenant id collision ───────────────────────────────────────────
  const collision = await applyBatch(b, claims(ORG_B), [batch[0]!]);
  check(
    'A foreign mutation id is rejected, never reported duplicate',
    collision[0]?.status === 'rejected',
    collision[0]?.status,
  );

  const stillA = await database.collection('mutations').findOne({ _id: batch[0]!.id as never });
  check("The original org's record is untouched", stillA?.orgId === ORG_A);

  // ── 8. Update on an append-only entity (D3) ────────────────────────────────
  const badOp = await applyBatch(a, claims(ORG_A), [
    eggLog({ op: 'update', payload: { count: 99 }, clientSeq: 2 }),
  ]);
  check('An update to an append-only entity is rejected', badOp[0]?.status === 'rejected');

  // ── 9. Hour-meter monotonicity ─────────────────────────────────────────────
  const machine = ulid();
  const reading = (hours: number, seq: number) => ({
    ...eggLog({ clientSeq: seq }),
    id: ulid(),
    targetId: ulid(),
    entity: 'hourReading' as const,
    payload: { occurredAt: Date.now(), equipmentId: machine, hours },
  });

  const high = await applyBatch(a, claims(ORG_A), [reading(412, 10)]);
  check('An hour reading applies', high[0]?.status === 'applied', high[0]?.reason);

  const low = await applyBatch(a, claims(ORG_A), [reading(41, 11)]);
  check(
    'An hour reading below the last is rejected',
    low[0]?.status === 'rejected',
    low[0]?.reason,
  );

  // ── 10. Taking an append-only record back (D3 as amended, §4 A10) ──────────
  //
  // Immutable in VALUE, removable in WHOLE. The update above stays rejected —
  // that is what makes these unable to conflict — and a delete archives, which
  // is repeatable and so cannot conflict either.
  const mistake = eggLog({ clientSeq: 20 });
  await applyBatch(a, claims(ORG_A), [mistake]);

  const removal = {
    ...eggLog({ clientSeq: 21 }),
    targetId: mistake.targetId,
    op: 'delete' as const,
    payload: {},
  };

  const removed = await applyBatch(a, claims(ORG_A), [removal]);
  check(
    'An append-only record can be taken back',
    removed[0]?.status === 'applied',
    removed[0]?.reason,
  );

  const gone = await a
    .col<Projected>('eggLogs')
    .findOne({ _id: mistake.targetId });
  check(
    'Removing archives rather than deleting (P13)',
    gone !== null && gone.archivedAt instanceof Date,
  );
  // Archived is not erased: the tally it held is still on the document.
  check('The archived record keeps the value it held', gone?.count === 18);

  const replayedRemoval = await applyBatch(a, claims(ORG_A), [removal]);
  const stillGone = await a
    .col<Projected>('eggLogs')
    .findOne({ _id: mistake.targetId });
  check(
    'A replayed removal is a duplicate, not a second archive',
    replayedRemoval[0]?.status === 'duplicate',
    replayedRemoval[0]?.status,
  );
  // The same instant, so archiving twice is genuinely archiving once — which
  // is why two devices cannot disagree about a removal.
  check(
    'Archiving twice leaves the same instant',
    stillGone?.archivedAt?.getTime() === gone?.archivedAt?.getTime(),
  );

  // Out-of-order arrival across devices: the delete beat its own create here.
  // The intent is satisfied — there is nothing to archive — and it must not be
  // an error, or a farm's inbox fills with refusals for work it did correctly.
  const orphanRemoval = await applyBatch(a, claims(ORG_A), [
    { ...eggLog({ clientSeq: 22 }), op: 'delete' as const, payload: {} },
  ]);
  check(
    'A removal that arrives before its record is a no-op, not an error',
    orphanRemoval[0]?.status === 'applied',
    orphanRemoval[0]?.reason,
  );

  // ── 11. The hour meter's way out ───────────────────────────────────────────
  //
  // The reason `hourReading` is removable rather than exempt, proven end to
  // end. Its own monotonic rule refuses the correction as readily as it
  // refuses nothing at all, so a fat-fingered reading locks the machine out of
  // its own log — permanently, unless the bad reading can be taken back AND
  // `highestHours` stops counting it. That second half is a Mongo query, so
  // this is the only place it can be proven.
  const typo = reading(9999, 30);
  const typoApplied = await applyBatch(a, claims(ORG_A), [typo]);
  check(
    'A mistyped hour reading applies — nothing above it exists to refuse it',
    typoApplied[0]?.status === 'applied',
    typoApplied[0]?.reason,
  );

  const blocked = await applyBatch(a, claims(ORG_A), [reading(500, 31)]);
  check(
    'Every true reading below the typo is now refused',
    blocked[0]?.status === 'rejected',
    blocked[0]?.reason,
  );

  const untyped = await applyBatch(a, claims(ORG_A), [
    { ...reading(0, 32), targetId: typo.targetId, op: 'delete' as const, payload: {} },
  ]);
  check(
    'The mistyped reading can be taken back',
    untyped[0]?.status === 'applied',
    untyped[0]?.reason,
  );

  const recovered = await applyBatch(a, claims(ORG_A), [reading(500, 33)]);
  check(
    'The machine can be logged again — highestHours skips archived rows',
    recovered[0]?.status === 'applied',
    recovered[0]?.reason,
  );

  // ── 12. Role enforcement ───────────────────────────────────────────────────
  const hand = { userId: ulid(), orgId: ORG_A, role: 'hand' as const };
  const forbidden = await applyBatch(a, hand, [
    {
      ...eggLog({ clientSeq: 12 }),
      entity: 'flock' as const,
      payload: { name: 'Layers', species: 'chicken', count: 12 },
    },
  ]);
  check('A hand cannot create a flock', forbidden[0]?.status === 'rejected', forbidden[0]?.reason);

  /**
   * A hand may take back what a hand may write.
   *
   * The person who mis-logged the tally is standing at the coop holding the
   * phone. Sending them to find an owner, who then removes a record they never
   * saw from a description given hours later, is worse for the data than
   * letting them fix it.
   */
  const handTally = eggLog({ clientSeq: 40 });
  const handWrote = await applyBatch(a, hand, [handTally]);
  check('A hand can record a tally', handWrote[0]?.status === 'applied', handWrote[0]?.reason);

  const handRemoved = await applyBatch(a, hand, [
    {
      ...eggLog({ clientSeq: 41 }),
      targetId: handTally.targetId,
      op: 'delete' as const,
      payload: {},
    },
  ]);
  check(
    'A hand can take back what a hand recorded',
    handRemoved[0]?.status === 'applied',
    handRemoved[0]?.reason,
  );

  const handEdit = await applyBatch(a, hand, [
    {
      ...eggLog({ clientSeq: 42 }),
      targetId: handTally.targetId,
      op: 'update' as const,
      payload: { count: 99 },
    },
  ]);
  check('A hand still cannot edit one', handEdit[0]?.status === 'rejected', handEdit[0]?.reason);

  // ── 13. Isolation of the removal path ──────────────────────────────────────
  //
  // The archive is an update, and an update is the operation a tenancy guard is
  // easiest to get wrong on — `assertSafeUpdate` exists for exactly this.
  const foreignRemoval = await applyBatch(b, claims(ORG_B), [
    {
      ...eggLog({ clientSeq: 50 }),
      targetId: mistake.targetId,
      op: 'delete' as const,
      payload: {},
    },
  ]);
  const untouched = await a
    .col<Projected>('eggLogs')
    .findOne({ _id: mistake.targetId });
  check(
    "Another org's removal cannot reach this farm's record",
    untouched?.archivedAt?.getTime() === gone?.archivedAt?.getTime(),
    foreignRemoval[0]?.status,
  );
} catch (error) {
  await fail('Data path', error);
}

// ── Clean up ─────────────────────────────────────────────────────────────────
await database.dropDatabase();
await client.close();

report();
process.exit(checks.some((c) => !c.ok) ? 1 : 0);
