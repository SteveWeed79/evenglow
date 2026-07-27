# Steading — Phase 1 Spec, Foundation & Tenancy Primitives

Executable task list. **Exit gate: isolation suite green and a debug APK running on real hardware, before any domain feature exists.**

---

## T1 — Workspace

```bash
mkdir steading && cd steading && pnpm init
printf 'packages:\n  - "apps/*"\n  - "packages/*"\n' > pnpm-workspace.yaml

pnpm create vite apps/app --template react-ts
mkdir -p apps/api/src packages/contracts/src

# client
pnpm --filter app add @capacitor/core @capacitor/app @capacitor/network \
  @capacitor/haptics @capacitor/preferences @capacitor-community/sqlite \
  react-router-dom ulid zod
pnpm --filter app add -D @capacitor/cli @capacitor/android

# server
pnpm --filter api add fastify @fastify/cors @fastify/rate-limit \
  fastify-type-provider-zod mongodb jose zod ulid
pnpm --filter api add -D tsx typescript vitest mongodb-memory-server
```

Root `tsconfig.base.json`: `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `verbatimModuleSyntax: true`. Both apps extend it.

---

## T2 — Contracts package

`packages/contracts` exports the mutation envelope, per-entity payload schemas, auth DTOs, and the sync response shape. Both apps import it; **neither redeclares a wire type**.

```ts
// packages/contracts/src/sync.ts
export const mutationResultSchema = z.object({
  id: z.string().length(26),
  status: z.enum(['applied', 'duplicate', 'rejected', 'conflict']),
  reason: z.string().optional(),
}).strict();

export const syncResponseSchema = z.object({
  results: z.array(mutationResultSchema),
  serverTs: z.string().datetime(),
}).strict();
```

---

## T3 — Mongo client (`apps/api/src/db/client.ts`)

The only file permitted to import `MongoClient`.

```ts
import { MongoClient, type Db } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI is not set');

const clientPromise = new MongoClient(uri).connect();

export async function db(): Promise<Db> {
  return (await clientPromise).db(process.env.MONGODB_DB ?? 'steading');
}
```

---

## T4 — Scoped data layer (`apps/api/src/db/scoped.ts`)

The only module exposing collections. Every filter is rewritten to include `orgId`; every insert has it stamped. No escape hatch.

```ts
import type { Db, Document, Filter, OptionalUnlessRequiredId, UpdateFilter } from 'mongodb';
import { db } from './client';

export const COLLECTIONS = [
  'mutations', 'flocks', 'birds', 'eggLogs', 'feedLogs', 'mortality',
  'predatorLogs', 'medications', 'equipment', 'hourReadings', 'maintenance',
  'tasks', 'inventory', 'photos',
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
      findMany: (f?: Filter<T>, limit = 500) => c.find(guard(f)).limit(limit).toArray(),
      changedSince: (since: Date, limit = 500) =>
        c.find(guard({ serverTs: { $gt: since } } as Filter<T>))
         .sort({ serverTs: 1 }).limit(limit).toArray(),
      insertOne: (doc: Omit<OptionalUnlessRequiredId<T>, 'orgId'>) =>
        c.insertOne({ ...doc, orgId } as OptionalUnlessRequiredId<T>),
      updateOne: (f: Filter<T>, u: UpdateFilter<T>) => c.updateOne(guard(f), u),
      upsertOne: (f: Filter<T>, u: UpdateFilter<T>) =>
        c.updateOne(guard(f), u, { upsert: true }),
      deleteOne: (f: Filter<T>) => c.deleteOne(guard(f)),
    };
  };

  return { col };
}
```

`bulkWrite` is deliberately absent — it cannot be transparently guarded, and sequential flush does not need it.

---

## T5 — Indexes (`apps/api/src/db/indexes.ts`)

Every collection gets a compound index led by `orgId`. Applied by `pnpm db:indexes`, never on the request path.

```ts
await database.collection('mutations').createIndexes([
  { key: { orgId: 1, serverTs: -1 } },
  { key: { orgId: 1, deviceId: 1, clientSeq: 1 } },
]);
await database.collection('eggLogs').createIndex({ orgId: 1, occurredAt: -1 });
await database.collection('birds').createIndex({ orgId: 1, archivedAt: 1 });
// ...one per collection, orgId first, always
```

---

## T6 — Lint guard (`eslint.config.mjs`)

```js
{
  files: ['apps/api/src/**/*.ts'],
  ignores: ['apps/api/src/db/**'],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [{ name: 'mongodb', importNames: ['MongoClient'],
                message: 'Use db/client.ts' }],
    }],
    'no-restricted-syntax': ['error', {
      selector: "CallExpression[callee.property.name='collection']",
      message: 'Raw collection access is forbidden. Use scoped(orgId).col().',
    }],
  },
},
{
  files: ['apps/app/src/**/*.{ts,tsx}'],
  ignores: ['apps/app/src/db/**'],
  rules: {
    'no-restricted-globals': ['error',
      { name: 'localStorage', message: 'Use SQLite or secure storage.' },
      { name: 'sessionStorage', message: 'Use SQLite or secure storage.' },
      { name: 'indexedDB', message: 'SQLite is the only client store.' },
    ],
  },
}
```

`pnpm lint` is a blocking CI step.

---

## T7 — Token auth

**Server** (`apps/api/src/auth/`) — no Auth.js; it is server-render oriented and the wrong shape for a static client.

- `POST /auth/login` → `{ accessToken, refreshToken }`. Access token: 15 min, claims `sub`, `orgId`, `role`. Refresh token: 90 days, rotating, stored hashed server-side so it can be revoked.
- `POST /auth/refresh` → rotates and returns a new pair. Reuse of a consumed refresh token revokes the family.
- Sign with `jose` (HS256 to start; EdDSA if you later split services).

```ts
export type Role = 'owner' | 'admin' | 'hand';

export interface Principal { userId: string; orgId: string; role: Role }

export async function requireAuth(req: FastifyRequest): Promise<Principal> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Unauthenticated');
  const { payload } = await jwtVerify(header.slice(7), key);
  return principalSchema.parse(payload);   // never trust unparsed claims
}

export function requireRole(role: Role, allowed: readonly Role[]): void {
  if (!allowed.includes(role)) throw new HttpError(403, 'Forbidden');
}
```

**Client** (`apps/app/src/auth/`) — tokens in `@capacitor/preferences` backed by the platform keystore. Never SQLite, never web storage. Decode the access token for cached claims to gate UX; treat them as a hint, never as permission. **An expired access token must never block a local log** — it only delays flush.

The 90-day refresh window is deliberate: a device can sit in a barn for weeks and still recover without a re-login that would be impossible offline.

---

## T8 — Capacitor shell

```bash
pnpm --filter app exec cap init Steading app.steading --web-dir=dist
pnpm --filter app exec cap add android
```

- Commit `apps/app/android/`. Treat it as source, not build output.
- Android network security config: cleartext disabled.
- `capacitor.config.ts`: `server.androidScheme: 'https'`.
- Root scripts: `cap:sync` (`build:app && cap sync`), `cap:run:android`.

Also verify the SQLite plugin opens a connection and survives a force-stop. That single check catches most native wiring mistakes early.

---

## T9 — Isolation test suite (`tests/isolation/`)

Runs against `mongodb-memory-server`. Table-driven over every route.

```ts
it.each(ROUTES)('%s denies cross-tenant access', async (route) => {
  const { orgA, orgB } = await seedTwoOrgs();
  const doc = await createIn(orgB, route);
  const res = await callAs(orgA, route, doc._id);
  expect(res.statusCode).toBe(404);          // not 403 — no existence disclosure
  expect(res.body).not.toContain(doc._id);
});

it('rejects payload-supplied orgId', async () => {
  const res = await callAs(orgA, 'POST', '/sync', { orgId: orgB.id, mutations: [] });
  expect(res.statusCode).toBe(400);
});

it('every collection has an orgId-leading index', async () => {
  for (const name of COLLECTIONS) {
    const idx = await database.collection(name).indexes();
    expect(idx.some((i) => Object.keys(i.key)[0] === 'orgId')).toBe(true);
  }
});
```

---

## T10 — Pipelines

- **API:** container build, env vars (`MONGODB_URI`, `MONGODB_DB`, `JWT_SECRET`, `REFRESH_SECRET`), TLS termination in front.
- **App:** CI runs `build:app` and `cap sync`; debug APK on every PR, release track deferred to Phase 4.
- CI greps the client bundle for known secret values and fails on a hit.

---

## Definition of Done

- [ ] `pnpm typecheck` clean, zero `any`
- [ ] `pnpm lint` clean, zero disables on the db or storage guard rules
- [ ] Isolation suite green across every existing route
- [ ] Every collection in `COLLECTIONS` has an `orgId`-leading index, asserted by test
- [ ] Login returns a working access/refresh pair; refresh rotates; reuse revokes the family
- [ ] Debug APK installs on a real Android device and shows an authenticated screen
- [ ] SQLite opens, writes, and survives a force-stop on that device
