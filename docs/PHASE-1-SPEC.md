# Steading — Phase 1 Spec, Foundation & Tenancy Primitives

Executable task list. Exit gate: isolation suite green before any domain feature exists.

---

## T1 — Project init

```
pnpm create next-app@latest . --typescript --app --eslint --tailwind --src-dir --import-alias "@/*"
pnpm add mongodb next-auth@beta zod ulid idb
pnpm add -D vitest @vitest/coverage-v8 mongodb-memory-server
```

`tsconfig.json`: `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.

---

## T2 — Mongo client (`src/server/db/client.ts`)

Single `MongoClient` with dev HMR-safe global caching. **This is the only file permitted to import `mongodb`'s `MongoClient`.**

```ts
import { MongoClient, type Db } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI is not set');

declare global {
  // eslint-disable-next-line no-var
  var __mongoClient: Promise<MongoClient> | undefined;
}

const clientPromise: Promise<MongoClient> =
  global.__mongoClient ?? new MongoClient(uri).connect();

if (process.env.NODE_ENV !== 'production') global.__mongoClient = clientPromise;

export async function db(): Promise<Db> {
  return (await clientPromise).db(process.env.MONGODB_DB ?? 'steading');
}
```

---

## T3 — Scoped data layer (`src/server/db/scoped.ts`)

The only module exposing collections. Every filter is rewritten to include `orgId`; every insert has `orgId` stamped. No escape hatch, no "unsafe" variant.

```ts
import type { Db, Document, Filter, OptionalUnlessRequiredId, UpdateFilter } from 'mongodb';
import { db } from './client';

export const COLLECTIONS = [
  'mutations', 'flocks', 'eggLogs', 'feedLogs', 'mortality', 'predatorLogs',
  'equipment', 'hourReadings', 'maintenance', 'tasks', 'inventory', 'photos',
] as const;
export type CollectionName = (typeof COLLECTIONS)[number];

export interface Tenanted extends Document { orgId: string }

export async function scoped(orgId: string) {
  if (!orgId) throw new Error('scoped(): orgId is required');
  const database: Db = await db();

  const col = <T extends Tenanted>(name: CollectionName) => {
    const c = database.collection<T>(name);
    const guard = (f: Filter<T> = {}): Filter<T> => ({ ...f, orgId } as Filter<T>);

    return {
      findOne: (f?: Filter<T>) => c.findOne(guard(f)),
      findMany: (f?: Filter<T>, limit = 200) => c.find(guard(f)).limit(limit).toArray(),
      countDocuments: (f?: Filter<T>) => c.countDocuments(guard(f)),
      insertOne: (doc: Omit<OptionalUnlessRequiredId<T>, 'orgId'>) =>
        c.insertOne({ ...doc, orgId } as OptionalUnlessRequiredId<T>),
      updateOne: (f: Filter<T>, u: UpdateFilter<T>) => c.updateOne(guard(f), u),
      upsertOne: (f: Filter<T>, u: UpdateFilter<T>) =>
        c.updateOne(guard(f), u, { upsert: true }),
      deleteOne: (f: Filter<T>) => c.deleteOne(guard(f)),
      bulkWrite: c.bulkWrite.bind(c), // callers must build guarded filters; covered by tests
    };
  };

  return { col };
}
```

> Note on `bulkWrite`: it is the one primitive that cannot be transparently guarded. Either wrap it with an explicit filter-mapping helper or omit it in v1 — sequential flush does not need it.

---

## T4 — Indexes (`src/server/db/indexes.ts`)

Every collection gets a compound index led by `orgId`. Applied via a `pnpm db:indexes` script, not on request path.

```ts
await database.collection('mutations').createIndexes([
  { key: { orgId: 1, serverTs: -1 } },
  { key: { orgId: 1, deviceId: 1, clientSeq: 1 } },
]);
await database.collection('eggLogs').createIndex({ orgId: 1, occurredAt: -1 });
await database.collection('flocks').createIndex({ orgId: 1, _id: 1 });
// ...one per collection, orgId first, always
```

---

## T5 — Lint guard (`eslint.config.mjs`)

```js
{
  files: ['src/**/*.ts', 'src/**/*.tsx'],
  ignores: ['src/server/db/**'],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [{ name: 'mongodb', importNames: ['MongoClient'],
                message: 'Use server/db/client.ts' }],
    }],
    'no-restricted-syntax': ['error', {
      selector: "CallExpression[callee.property.name='collection']",
      message: 'Raw collection access is forbidden. Use scoped(orgId).col().',
    }],
  },
}
```

Add `pnpm lint` to CI as a blocking step.

---

## T6 — Auth (`src/server/auth/session.ts`)

Auth.js with **JWT strategy** — DB sessions cannot be validated offline and add a round-trip per request.

JWT claims: `sub`, `orgId`, `role`. Populated in the `jwt` callback on sign-in; `orgId` never comes from the client.

```ts
export type Role = 'owner' | 'admin' | 'hand';

export async function requireSession(): Promise<{ userId: string; orgId: string; role: Role }> {
  const session = await auth();
  if (!session?.user?.orgId) throw new HttpError(401, 'Unauthenticated');
  return { userId: session.user.id, orgId: session.user.orgId, role: session.user.role };
}

export function requireRole(role: Role, allowed: readonly Role[]): void {
  if (!allowed.includes(role)) throw new HttpError(403, 'Forbidden');
}
```

---

## T7 — Contracts (`src/lib/contracts/`)

- `mutation.ts` — envelope schema per `CLAUDE.md`.
- `entities/*.ts` — one `.strict()` schema per entity, plus a `PAYLOAD_SCHEMAS` map keyed by `entity` + `op`.
- Shared by client and server. Client-side IndexedDB reads parse through the same schemas.

---

## T8 — Isolation test suite (`tests/isolation/`)

Runs against `mongodb-memory-server`. Table-driven over every route.

```ts
it.each(ROUTES)('%s denies cross-tenant access', async (route) => {
  const { orgA, orgB } = await seedTwoOrgs();
  const doc = await createIn(orgB, route);
  const res = await callAs(orgA, route, doc._id);
  expect(res.status).toBe(404);          // not 403 — no existence disclosure
  expect(await res.text()).not.toContain(doc._id);
});

it('rejects payload-supplied orgId', async () => {
  const res = await callAs(orgA, '/api/sync', { orgId: orgB.id, mutations: [] });
  expect(res.status).toBe(400);
});
```

Also assert: every name in `COLLECTIONS` has an index whose first key is `orgId`.

---

## T9 — Deploy

Vercel project, `MONGODB_URI` / `MONGODB_DB` / `AUTH_SECRET` as encrypted env vars. CI step greps the client bundle for known secret values and fails on a hit.

---

## Definition of Done

- [ ] `pnpm typecheck` clean, zero `any` in `src/`
- [ ] `pnpm lint` clean, zero eslint-disable comments on the db guard rules
- [ ] Isolation suite green, covering every existing route
- [ ] Every collection in `COLLECTIONS` has an `orgId`-leading index, asserted by test
- [ ] Sign-in issues a JWT carrying `orgId` and `role`
- [ ] Deployed and reachable
