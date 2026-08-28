import { ulid } from 'ulid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PULL_PAGE_SIZE, type SyncResponse } from '@homefarm/contracts';
import type { UserDoc } from '@homefarm/api/db/identity';
import { startTestDb } from '../support/mongo';
import { makeMutation } from '../support/fixtures';

/**
 * Tenancy, on the sync surface.
 *
 * This was a PARITY suite: the same assertions against the Next routes and the
 * Fastify ones, as evidence that porting the sync surface had not weakened
 * tenancy. The Next server is gone, so the parity half is gone with it — but
 * the assertions are not, because they were never really about parity. They
 * are the only place the sync surface is held to "another farm's document is a
 * 404, never a 403", and that rule does not stop mattering because there is
 * one server left to enforce it.
 *
 * A difference between them would mean a mutation accepted by one host and
 * refused by the other, which reaches a user as work landing in the rejected
 * inbox depending on which server answered.
 */

const harness = await startTestDb('homefarm_sync_tenancy');

if (harness) {
  process.env.MONGODB_URI = harness.uri;
  process.env.MONGODB_DB = 'homefarm_sync_tenancy';
}

const SECRET = 'a-test-secret-long-enough-for-hs256-abcdef';

const ORG_A = ulid();
const ORG_B = ulid();

const USERS = {
  ownerA: { _id: ulid(), orgId: ORG_A, role: 'owner' as const },
  ownerB: { _id: ulid(), orgId: ORG_B, role: 'owner' as const },
  handA: { _id: ulid(), orgId: ORG_A, role: 'hand' as const },
};

type TestUser = (typeof USERS)[keyof typeof USERS];

interface Answer {
  status: number;
  body: unknown;
}

/** What both servers have to be able to do, expressed once. */
interface Server {
  readonly name: string;
  as(user: TestUser | null): Promise<void>;
  postSync(body: unknown): Promise<Answer>;
  getSnapshot(since?: number, sinceId?: string | null): Promise<Answer>;
}

// ── The Fastify server ───────────────────────────────────────────────────────

let bearer: string | null = null;

const fastifyServer: Server = {
  name: 'fastify',

  async as(user) {
    if (!user) {
      bearer = null;
      return;
    }
    const { mintAccessToken } = await import('@homefarm/api/auth/tokens');
    bearer = await mintAccessToken(
      { userId: user._id, orgId: user.orgId, role: user.role },
      SECRET,
    );
  },

  async postSync(body) {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/sync',
      ...(bearer ? { headers: { authorization: `Bearer ${bearer}` } } : {}),
      payload: body as object,
    });
    await app.close();
    return { status: res.statusCode, body: res.json() };
  },

  async getSnapshot(since = 0, sinceId = null) {
    const app = await buildApp();
    const query = sinceId === null ? `since=${since}` : `since=${since}&sinceId=${sinceId}`;
    const res = await app.inject({
      method: 'GET',
      url: `/snapshot?${query}`,
      ...(bearer ? { headers: { authorization: `Bearer ${bearer}` } } : {}),
    });
    await app.close();
    return { status: res.statusCode, body: res.json() };
  },
};

async function buildApp() {
  const { buildServer } = await import('@homefarm/api/server');
  const { readEnv } = await import('@homefarm/api/env');
  return buildServer(
    readEnv({
      AUTH_SECRET: SECRET,
      MONGODB_URI: harness!.uri,
      MONGODB_DB: 'homefarm_sync_tenancy',
      CORS_ORIGINS: 'https://app.test',
      /**
       * Open deliberately, because none of this file is about entitlement.
       *
       * `syncAccess` refuses an ungranted farm on a server with no Play
       * configuration, which is the right default and the wrong fixture here:
       * every test below is about tenancy, idempotency, role refusal and
       * ordering, and a 402 in front of them would test the gate seven times
       * instead. The gate has its own file — `unit/sync-access.test.ts` — and
       * the granted and refused paths through this route are covered in
       * `claim.test.ts`.
       */
      SYNC_OPEN_TO_ALL: '1',
    }),
  );
}

// ── The suite, run once per server ───────────────────────────────────────────

const users = () => harness!.db.collection<UserDoc>('users');
const mutations = () => harness!.db.collection('mutations');

function flock(over: Record<string, unknown> = {}) {
  return { name: 'Alpha', species: 'chicken', count: 12, ...over };
}

const describeDb = harness ? describe : describe.skip;

afterAll(async () => {
  await harness?.stop();
});

describeDb.each([fastifyServer])('$name', (server: Server) => {
  beforeEach(async () => {
    await mutations().deleteMany({});
    await users().deleteMany({});
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
    await server.as(USERS.ownerA);
  });

  it('refuses an unauthenticated write', async () => {
    await server.as(null);
    expect((await server.postSync({ mutations: [makeMutation()] })).status).toBe(401);
  });

  it('refuses an unauthenticated read', async () => {
    await server.as(null);
    expect((await server.getSnapshot()).status).toBe(401);
  });

  it('rejects a payload-supplied orgId with 400 (C2)', async () => {
    const res = await server.postSync({ orgId: ORG_B, mutations: [makeMutation()] });
    expect(res.status).toBe(400);
  });

  it('stamps the session orgId, never one from the wire', async () => {
    const mutation = makeMutation();
    await server.postSync({ mutations: [mutation] });

    expect((await mutations().findOne({ _id: mutation.id as never }))?.orgId).toBe(ORG_A);
  });

  /**
   * A record id another farm already used (H3).
   *
   * The mutation-log insert has carried an `E11000` guard for exactly this,
   * with the reason written on it — *"`_id` is unique collection-wide, so a
   * mutation id already used by another tenant fails the insert rather than
   * matching the org-guarded filter"*. The **projection** insert had no such
   * guard, and `decideProjection` cannot see the collision either: `existing`
   * is org-scoped, so the other farm's document reads as `null` and the
   * decision is `insert`.
   *
   * It is reachable without anybody doing anything strange. `restore.ts`
   * re-enqueues a backup with its original ULIDs, on the argument that a create
   * at an existing targetId is a `noop` — true only within one org. Lose a
   * phone, install fresh so the device mints a new farm, restore, sign up,
   * flush: every id belongs to the old farm's documents.
   *
   * Uncaught it was a 500, so the client retried for ever, the row stayed
   * `pending` — which stalls the whole farm's pull feed — and the hourly
   * sweeper rethrew. `listOrgIds()` sorts by `createdAt`, so every farm created
   * after that one stopped being swept at all.
   */
  it('refuses a targetId another farm already holds, without a 500', async () => {
    const targetId = ulid();
    const mine = makeMutation({ entity: 'flock', targetId, payload: flock() });
    expect((await server.postSync({ mutations: [mine] })).status).toBe(200);

    await server.as(USERS.ownerB);
    const theirs = makeMutation({ entity: 'flock', targetId, payload: flock({ name: 'Beta' }) });
    const res = await server.postSync({ mutations: [theirs] });

    // A per-mutation refusal, not a crash — and never `duplicate`, which would
    // confirm to one farm that another farm holds that id.
    expect(res.status).toBe(200);
    const [result] = (res.body as SyncResponse).results;
    expect(result?.status).toBe('rejected');

    // And the farm that owns the id still owns it, unchanged.
    const doc = await harness!.db.collection('flocks').findOne({ _id: targetId as never });
    expect(doc?.orgId).toBe(ORG_A);
    expect((doc as { name?: string } | null)?.name).toBe('Alpha');
  });

  it('does not disclose another org document with the same id', async () => {
    const mutation = makeMutation();
    await server.postSync({ mutations: [mutation] });

    // A deliberate id collision — guessability is explicitly not a control (D5).
    await server.as(USERS.ownerB);
    const collided = await server.postSync({ mutations: [mutation] });
    const result = (collided.body as SyncResponse).results[0];

    // Never 'duplicate': that would confirm the foreign record exists.
    expect(result?.status).toBe('rejected');
    expect(JSON.stringify(collided.body)).not.toContain(ORG_A);
    expect((await mutations().findOne({ _id: mutation.id as never }))?.orgId).toBe(ORG_A);
  });

  it('refuses a hand creating a flock without failing the batch', async () => {
    await server.as(USERS.handA);

    const allowed = makeMutation();
    const forbidden = makeMutation({
      entity: 'flock',
      op: 'create',
      payload: { name: 'Layers', species: 'chicken', count: 12 },
    });

    const res = await server.postSync({ mutations: [allowed, forbidden] });
    const results = (res.body as SyncResponse).results;

    expect(res.status).toBe(200);
    expect(results.find((r) => r.id === allowed.id)?.status).toBe('applied');
    expect(results.find((r) => r.id === forbidden.id)?.status).toBe('rejected');
  });

  it('refuses an update to an append-only entity (D3)', async () => {
    const res = await server.postSync({
      mutations: [makeMutation({ op: 'update', payload: { count: 1 } })],
    });
    expect((res.body as SyncResponse).results[0]?.status).toBe('rejected');
  });

  it('applies a replayed batch exactly once', async () => {
    const batch = [makeMutation(), makeMutation()];

    const first = await server.postSync({ mutations: batch });
    const second = await server.postSync({ mutations: batch });

    expect((first.body as SyncResponse).results.every((r) => r.status === 'applied')).toBe(true);
    expect((second.body as SyncResponse).results.every((r) => r.status === 'duplicate')).toBe(true);
    expect(await mutations().countDocuments({})).toBe(2);
  });

  it('ships only the caller org history', async () => {
    const mine = makeMutation();
    await server.postSync({ mutations: [mine] });

    await server.as(USERS.ownerB);
    const theirs = makeMutation();
    await server.postSync({ mutations: [theirs] });

    const res = await server.getSnapshot(0);
    const body = res.body as { mutations: { id: string }[] };

    expect(body.mutations.map((m) => m.id)).toEqual([theirs.id]);
    expect(JSON.stringify(body)).not.toContain(mine.id);
  });

  it('does not leak another org timestamps through the watermark', async () => {
    await server.postSync({ mutations: [makeMutation()] });

    await server.as(USERS.ownerB);
    const body = (await server.getSnapshot(0)).body as { mutations: unknown[]; through: number };

    expect(body.mutations).toEqual([]);
    expect(body.through).toBe(0);
  });

  it('rejects a malformed cursor rather than defaulting to everything', async () => {
    expect((await server.getSnapshot(Number.NaN)).status).toBe(400);
    expect((await server.getSnapshot(0, 'too-short')).status).toBe(400);
  });

  /** The regression the shared cursor exists for, asserted on both servers. */
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
    await mutations().insertMany(docs as never);

    const first = (await server.getSnapshot(0)).body as {
      mutations: { id: string }[];
      through: number;
      throughId: string;
      more: boolean;
    };
    expect(first.mutations).toHaveLength(PULL_PAGE_SIZE);
    expect(first.more).toBe(true);

    const second = (await server.getSnapshot(first.through, first.throughId)).body as {
      mutations: { id: string }[];
    };

    const seen = new Set([...first.mutations, ...second.mutations].map((m) => m.id));
    expect(seen.size).toBe(PULL_PAGE_SIZE + 1);
  });
});
