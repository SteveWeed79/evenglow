import { ulid } from 'ulid';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PULL_PAGE_SIZE, type Role, type SyncResponse } from '@steading/contracts';
import type { UserDoc } from '@steading/api/db/identity';
import { startTestDb } from '../support/mongo';
import { makeMutation } from '../support/fixtures';

/**
 * Cross-tenant isolation against the real route handler and a real mongod.
 * This suite is the Phase 1 exit gate.
 */

const harness = await startTestDb('steading_isolation');

// Point the app's Mongo client at the harness before the route imports it.
if (harness) {
  process.env.MONGODB_URI = harness.uri;
  process.env.MONGODB_DB = 'steading_isolation';
}

interface TestSession {
  user: { id: string; orgId: string; role: Role; email: string; name: string };
}

let currentSession: TestSession | null = null;

vi.mock('@/server/auth/config', () => ({
  auth: () => Promise.resolve(currentSession),
  handlers: { GET: () => new Response(), POST: () => new Response() },
  signIn: () => Promise.resolve(),
  signOut: () => Promise.resolve(),
}));

const ORG_A = ulid();
const ORG_B = ulid();

const USERS = {
  ownerA: { _id: ulid(), orgId: ORG_A, role: 'owner' as const },
  ownerB: { _id: ulid(), orgId: ORG_B, role: 'owner' as const },
  handA: { _id: ulid(), orgId: ORG_A, role: 'hand' as const },
};

function sessionFor(user: { _id: string; orgId: string; role: Role }): TestSession {
  return {
    user: {
      id: user._id,
      orgId: user.orgId,
      role: user.role,
      email: `${user._id}@example.test`,
      name: 'Test User',
    },
  };
}

/** Typed handles, so assertions read the string _ids these collections use. */
interface MutationDoc {
  _id: string;
  orgId: string;
  clientSeq: number;
  clientTs: number;
  payload: unknown;
  serverTs: Date;
}

const users = () => harness!.db.collection<UserDoc>('users');
const mutations = () => harness!.db.collection<MutationDoc>('mutations');

async function getPull(
  since = 0,
  sinceId: string | null = null,
): Promise<{ status: number; body: unknown }> {
  const { GET } = await import('@/app/api/pull/route');
  const query = sinceId === null ? `since=${since}` : `since=${since}&sinceId=${sinceId}`;
  const res = await GET(new Request(`https://steading.test/api/pull?${query}`));
  return { status: res.status, body: await res.json() };
}

interface PullBody {
  mutations: { id: string; serverTs: number }[];
  through: number;
  throughId: string | null;
  more: boolean;
}

async function postSync(body: unknown): Promise<{ status: number; body: unknown }> {
  const { POST } = await import('@/app/api/sync/route');
  const res = await POST(
    new Request('https://steading.test/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json() };
}

const describeDb = harness ? describe : describe.skip;

// File-level so every suite in this file gets a clean, seeded database —
// not just the first one.
afterAll(async () => {
  await harness?.stop();
});

beforeEach(async () => {
  if (!harness) return;
  await mutations().deleteMany({});
  await users().deleteMany({});

  // requireMutationSession re-derives role and org from these documents.
  await users().insertMany(
    Object.values(USERS).map((u) => ({
      _id: u._id,
      email: `${u._id}@example.test`,
      passwordHash: 'unused-in-this-suite',
      name: 'Test User',
      orgId: u.orgId,
      role: u.role,
      createdAt: new Date(),
    })),
  );

  currentSession = sessionFor(USERS.ownerA);
});

describeDb('/api/sync — tenant isolation', () => {
  it('rejects an unauthenticated request', async () => {
    currentSession = null;
    const res = await postSync({ mutations: [makeMutation()] });
    expect(res.status).toBe(401);
  });

  it('rejects a payload-supplied orgId with 400 (C2)', async () => {
    const res = await postSync({ orgId: ORG_B, mutations: [makeMutation()] });
    expect(res.status).toBe(400);
  });

  it('stamps the session orgId, never one from the wire', async () => {
    const mutation = makeMutation();
    await postSync({ mutations: [mutation] });

    const doc = await mutations().findOne({ _id: mutation.id });
    expect(doc?.orgId).toBe(ORG_A);
  });

  it('does not disclose or touch another org document with the same id', async () => {
    const mutation = makeMutation();
    const applied = await postSync({ mutations: [mutation] });
    expect((applied.body as SyncResponse).results[0]?.status).toBe('applied');

    // Org B replays org A's exact mutation id — a deliberate collision, since
    // ID guessability is explicitly not a security control (D5).
    currentSession = sessionFor(USERS.ownerB);
    const collided = await postSync({ mutations: [mutation] });
    const result = (collided.body as SyncResponse).results[0];

    // Never 'duplicate': that would confirm the foreign record exists.
    expect(result?.status).toBe('rejected');
    expect(JSON.stringify(collided.body)).not.toContain(ORG_A);

    // Org A's document is untouched and still org A's.
    const doc = await mutations().findOne({ _id: mutation.id });
    expect(doc?.orgId).toBe(ORG_A);
    expect(await mutations().countDocuments({})).toBe(1);
  });

  it('scopes reads so one org cannot see another org records', async () => {
    await postSync({ mutations: [makeMutation(), makeMutation()] });

    const { scoped } = await import('@steading/api/db/scoped');
    const asB = await scoped(ORG_B);

    expect(await asB.col('mutations').countDocuments()).toBe(0);
    expect(await asB.col('mutations').findMany()).toEqual([]);

    const asA = await scoped(ORG_A);
    expect(await asA.col('mutations').countDocuments()).toBe(2);
  });

  it('returns null, not another org document, on a direct id lookup', async () => {
    const mutation = makeMutation();
    await postSync({ mutations: [mutation] });

    // The scoped layer is what makes a cross-tenant fetch a 404 rather than a
    // 403 at the route level: the record simply is not found.
    const { scoped } = await import('@steading/api/db/scoped');
    const asB = await scoped(ORG_B);
    expect(await asB.col('mutations').findOne({ _id: mutation.id })).toBeNull();
  });
});

describeDb('/api/sync — per-mutation authorization', () => {
  // Runs after the file-level seed, so users exist and the queue is empty.
  beforeEach(() => {
    currentSession = sessionFor(USERS.handA);
  });

  it('lets a hand record an observation', async () => {
    const res = await postSync({ mutations: [makeMutation()] });
    expect((res.body as SyncResponse).results[0]?.status).toBe('applied');
  });

  it('refuses a hand creating a flock, without failing the whole batch', async () => {
    const allowed = makeMutation();
    const forbidden = makeMutation({
      entity: 'flock',
      op: 'create',
      payload: { name: 'Layers', species: 'chicken', count: 12 },
    });

    const res = await postSync({ mutations: [allowed, forbidden] });
    const results = (res.body as SyncResponse).results;

    expect(res.status).toBe(200);
    expect(results.find((r) => r.id === allowed.id)?.status).toBe('applied');
    expect(results.find((r) => r.id === forbidden.id)?.status).toBe('rejected');
  });

  it('refuses an update to an append-only entity (D3)', async () => {
    currentSession = sessionFor(USERS.ownerA);
    const res = await postSync({
      mutations: [makeMutation({ op: 'update', payload: { count: 99 } })],
    });

    expect((res.body as SyncResponse).results[0]?.status).toBe('rejected');
  });

  it('re-derives role from the database, not from the token', async () => {
    // The session still claims owner; the user document says hand.
    await users().updateOne({ _id: USERS.ownerA._id }, { $set: { role: 'hand' } });
    currentSession = sessionFor(USERS.ownerA);

    const res = await postSync({
      mutations: [
        makeMutation({ entity: 'flock', op: 'create', payload: { name: 'X', species: 'chicken', count: 1 } }),
      ],
    });

    expect((res.body as SyncResponse).results[0]?.status).toBe('rejected');
  });

  it('refuses a disabled account even with a valid token', async () => {
    await users().updateOne({ _id: USERS.handA._id }, { $set: { disabledAt: new Date() } });

    const res = await postSync({ mutations: [makeMutation()] });
    expect(res.status).toBe(401);
  });
});


describeDb('/api/pull — tenant isolation', () => {
  it('rejects an unauthenticated request', async () => {
    currentSession = null;
    expect((await getPull()).status).toBe(401);
  });

  it('ships only the caller org history', async () => {
    const a1 = makeMutation();
    const a2 = makeMutation();
    await postSync({ mutations: [a1, a2] });

    currentSession = sessionFor(USERS.ownerB);
    const bOwn = makeMutation();
    await postSync({ mutations: [bOwn] });

    // Org B pulls from the beginning of time and must see only its own.
    const res = await getPull(0);
    const body = res.body as { mutations: { id: string }[] };

    expect(res.status).toBe(200);
    expect(body.mutations.map((m) => m.id)).toEqual([bOwn.id]);
    expect(JSON.stringify(body)).not.toContain(a1.id);
    expect(JSON.stringify(body)).not.toContain(a2.id);
  });

  it('does not disclose another org history through the watermark', async () => {
    await postSync({ mutations: [makeMutation()] });

    currentSession = sessionFor(USERS.ownerB);
    const res = await getPull(0);
    const body = res.body as { mutations: unknown[]; through: number };

    // Nothing of org A's leaks, including its timestamps.
    expect(body.mutations).toEqual([]);
    expect(body.through).toBe(0);
  });

  it('rejects a malformed watermark rather than defaulting to everything', async () => {
    const res = await getPull(Number.NaN as unknown as number);
    expect(res.status).toBe(400);
  });

  it('pages through history in serverTs order', async () => {
    const batch = [makeMutation(), makeMutation(), makeMutation()];
    await postSync({ mutations: batch });

    const res = await getPull(0);
    const body = res.body as { mutations: { serverTs: number }[] };
    const stamps = body.mutations.map((m) => m.serverTs);

    expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
  });

  it('rejects a malformed sinceId rather than ignoring it', async () => {
    expect((await getPull(0, 'too-short')).status).toBe(400);
  });

  /**
   * The regression this cursor exists for.
   *
   * serverTs is millisecond-resolution and applyBatch stamps mutations in a
   * tight sequential loop, so a real batch routinely puts many rows in one
   * millisecond. Paging on the timestamp alone loses every row after the page
   * cut: the next request asks for "> that millisecond" and they are never
   * offered again. Silent, permanent, and only observable after a reinstall.
   *
   * Rows are written straight to the collection so the boundary is exact
   * rather than dependent on how fast the applier happens to run.
   */
  it('loses no rows when a page boundary falls inside one millisecond', async () => {
    const sameMs = new Date(1_700_000_000_000);
    const docs = Array.from({ length: PULL_PAGE_SIZE + 1 }, () => {
      const m = makeMutation();
      return {
        _id: m.id,
        orgId: ORG_A,
        targetId: m.targetId,
        entity: m.entity,
        op: m.op,
        payload: m.payload,
        deviceId: m.deviceId,
        clientSeq: m.clientSeq,
        clientTs: m.clientTs,
        schemaVersion: m.schemaVersion,
        serverTs: sameMs,
      };
    });
    await mutations().insertMany(docs);

    const first = (await getPull(0)).body as PullBody;
    expect(first.mutations).toHaveLength(PULL_PAGE_SIZE);
    expect(first.more).toBe(true);
    // Every row shares the millisecond, so the timestamp alone cannot advance.
    expect(first.through).toBe(sameMs.getTime());
    expect(first.throughId).not.toBeNull();

    const second = (await getPull(first.through, first.throughId)).body as PullBody;

    const seen = new Set([...first.mutations, ...second.mutations].map((m) => m.id));
    expect(seen.size).toBe(PULL_PAGE_SIZE + 1);
    expect(seen).toEqual(new Set(docs.map((d) => d._id)));
  });

  it('does not re-serve a row the cursor has already passed', async () => {
    await postSync({ mutations: [makeMutation(), makeMutation()] });

    const first = (await getPull(0)).body as PullBody;
    expect(first.mutations.length).toBe(2);

    // Resuming from the returned cursor must yield nothing, not the last row
    // again — an inclusive boundary would re-apply it on every pass.
    const second = (await getPull(first.through, first.throughId)).body as PullBody;
    expect(second.mutations).toEqual([]);
  });
});
