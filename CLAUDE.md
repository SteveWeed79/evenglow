# CLAUDE.md — Steading

Offline-first farm operations app. **Capacitor 8 (Android first) · Vite + React · TypeScript strict · SQLite on device · Fastify + MongoDB on the server.**

There is no PWA and no Next.js. If a suggestion assumes SSR, server components, or Next API routes, it is aimed at the wrong project.

> ## ⚠️ Read this before acting on the invariants below
>
> **The stack above is the target, not the tree you are looking at.** `main`
> still carries the pre-D8 implementation: Next.js App Router, IndexedDB, and
> Auth.js. The D8/D9/D10 migration is in flight on a separate branch.
>
> This means parts of the working code **knowingly** contradict invariants 5–7
> below — the offline engine is built on IndexedDB, and its projection writes
> use IndexedDB transactions rather than SQLite ones. That is expected, and it
> is not a defect to fix in passing.
>
> **Do not delete or rewrite the offline engine to comply with this file.** It
> is the only implementation that has ever passed the Phase 2 exit gate, it is
> covered by 248 tests, and the migration's job is to port it — not to lose it
> and start again (invariant 13).
>
> Until the migration lands, treat the invariants as: **binding wherever the
> code is already framework-agnostic** (contracts, tenancy, sync semantics,
> auth, roles), and **aspirational where they name a storage or framework
> choice** (invariants 5, 6, and the `apps/` layout).

Read `docs/Steading-Masterplan.md` before proposing architecture changes. Decisions D1–D10 there are settled; if a task appears to require breaking one, stop and say so rather than working around it.

Read `docs/UX-SPEC.md` before writing any component. Rules R1–R10 are binding.

`docs/COMPETITIVE-ANALYSIS.md` explains why features exist. Consult it before proposing to cut one.

---

## Hard Invariants

Violating any of these is a defect regardless of whether tests pass.

**Data & tenancy**

1. **Never call `db.collection()` outside `apps/api/src/db/`.** All access goes through `scoped(orgId)`. Lint blocks this; do not disable the rule.
2. **Never read `orgId` from a request payload.** It comes from the verified access token. Payload-supplied `orgId` → 400.
3. **Never mint an entity ID on the server.** Syncable entities carry a client-minted ULID as `_id`.
4. **Never trust `clientTs`.** Record it; order by `clientSeq` (per device) and `serverTs` (global).

**Device storage**

5. **Never write to a projection table outside the same transaction that enqueues its mutation.** The queue and the local view must not diverge. One `BEGIN`, both writes, one `COMMIT`.
6. **Never use `localStorage`, `sessionStorage`, or IndexedDB.** SQLite via `@capacitor-community/sqlite` is the only store. Tokens live in secure storage, never in SQLite or web storage.
7. **Never delete a mutation row on success.** Mark it `applied`. History is the audit trail and the duplicate defence.

**Auth**

8. **Never treat cached claims as authorization.** They gate local UX only. The server re-derives identity, org, and role on every mutation at flush.
9. **Never drop a rejected mutation.** It goes to the rejected inbox and stays user-visible.

**General**

10. **Never fail open on authorization.** Bounded fail-open applies to the rate limiter only.
11. **Never use `any`, `as unknown as`, or `!` on external data.** Parse with Zod at every boundary — API responses, SQLite reads, secure-storage reads.
12. **Never put a secret in the client bundle.** It ships inside an APK and is trivially extractable.
13. **Never remove existing functionality to simplify a refactor.** If something looks dead, ask; do not delete.

---

## Layout

pnpm workspaces. Two apps, one shared contract.

```
apps/
  app/                      # Vite + React + Capacitor
    src/
      db/                   # SQLite: schema, migrations, queries
        client.ts           # connection — ONLY file importing the sqlite plugin
        migrations/
        mutations.ts        # enqueue + flush state machine
      sync/                 # flush loop, pull sync, conflict + rejection handling
      auth/                 # token storage, refresh, cached claims
      screens/
      components/
      hooks/
    android/                # Capacitor native project — committed
    capacitor.config.ts
  api/                      # Fastify + MongoDB
    src/
      db/
        client.ts           # Mongo connection — ONLY file importing MongoClient
        scoped.ts           # scoped(orgId) — ONLY export exposing collections
        indexes.ts
      routes/
        auth.ts             # login, refresh
        sync.ts             # POST batch flush
        snapshot.ts         # GET pull sync
      auth/                 # token issue + verify, requireAuth, requireRole
      sync/apply.ts         # per-entity mutation appliers
packages/
  contracts/                # Zod schemas + inferred types. Imported by BOTH.
    src/mutation.ts
    src/entities/
tests/
  isolation/                # cross-tenant — must exist before feature work
  sync/                     # idempotency, ordering, restart survival
```

`packages/contracts` is the single source of truth for every shape that crosses the wire or hits SQLite. Never redeclare a type that lives there.

---

## Mutation Envelope

```ts
export const MUTATION_SCHEMA_VERSION = 1;

export const mutationSchema = z.object({
  schemaVersion: z.number().int().positive(),
  id: z.string().length(26),        // ULID — idempotency key, becomes _id
  targetId: z.string().length(26),  // ULID — entity id, minted offline
  entity: z.enum(['flock', 'animal', 'medication', 'eggLog', 'productionLog',
                  'feedLog', 'mortality', 'predator', 'equipment',
                  'hourReading', 'maintenance', 'task', 'inventory', 'photo']),
  op: z.enum(['create', 'update', 'delete']),
  payload: z.unknown(),             // validated per-entity in sync/apply.ts
  deviceId: z.string().uuid(),
  clientSeq: z.number().int().nonnegative(),
  clientTs: z.number().int(),       // recorded, NOT trusted
}).strict();
```

**Append-only entities** (`eggLog`, `productionLog`, `feedLog`, `mortality`, `predator`, `hourReading`) accept `create` only; `update`/`delete` on them is a 400. They cannot conflict.

**Mutable entities** (`flock`, `animal`, `medication`, `equipment`, `maintenance`, `task`, `inventory`, `photo`) support update/delete and need conflict handling. They are **archived, never deleted** — `delete` sets `archivedAt` (P13).

**Stock is mixed, not poultry.** `animal`, not `bird`: goats and cattle die, get treated, and get weighed too. `flock` is the wire name for any group; the UI says herd, drove, or gaggle per species via `SPECIES_TRAITS`. Egg logging is offered per species through `laysEggs()`, and `productionLog` carries milk, fibre, and honey so ruminants are not head-count-only. Do not reintroduce poultry-only assumptions.

---

## Sync Contract

**Client**
- Enqueue the mutation and update the local projection in **one SQLite transaction**. Never one without the other.
- Flush **sequentially**, ordered by `clientSeq`. Never parallel, never `Promise.all`.
- Triggers: app resume (`@capacitor/app`), network regain (`@capacitor/network`), manual pull, and on enqueue when already online.
- Cap 100 mutations per batch.
- `409`/`422` → rejected inbox. `5xx`/network → backoff, stay queued, increment `attempts`.

**Server — `POST /sync`**
- Verify access token → `orgId`, `role`. Reject role-forbidden ops **per mutation**, not per batch.
- Parse the envelope, then the per-entity payload schema.
- Apply idempotently:

```ts
const res = await mutations.upsertOne(
  { _id: m.id },
  { $setOnInsert: { ...m, orgId, serverTs: new Date() } },
);
if (!res.upsertedCount) return { id: m.id, status: 'duplicate' };
```

- Respond with a per-mutation result array: `applied | duplicate | rejected | conflict`. Never a bare 200.

**Pull — `GET /snapshot?since=<serverTs>`** returns changes since a cursor so a second device or a reinstall can rebuild local state. Full snapshot when `since` is absent.

---

## Commands

```
pnpm dev:app          # Vite dev server in the browser (fast loop)
pnpm dev:api          # Fastify with watch
pnpm build:app        # Vite build → apps/app/dist
pnpm cap:sync         # copy web build into the native project
pnpm cap:run:android  # build + deploy to device or emulator
pnpm test             # vitest, all packages
pnpm typecheck
pnpm lint
```

Develop in the browser for speed, but **verify on a real device before calling any storage, camera, haptics, or sync task done.** WebView and native SQLite behave differently from the dev server.

---

## Testing Requirements

Every PR touching a data path adds:
- **Isolation test** — org A token + org B document ID → 404 (never 403; no existence disclosure).
- **Idempotency test** — batch applied twice → one record.
- **Transaction test** — a failed enqueue rolls back the projection write.
- **Restart test** for queue changes — mutations survive process death.

Run `pnpm test`, `pnpm lint`, `pnpm typecheck` before declaring a task done.

---

## Style

- Function components and hooks. No class components.
- Data access lives in `src/db/` and `src/sync/`. **Components never call `fetch` or touch SQLite directly** — they read through hooks over the local store.
- The local SQLite projection is the only thing the UI renders. Network results land in SQLite first, then render.
- Explicit return types on exported functions.
- Comment *why*, not *what*. Document sync and conflict logic thoroughly.
- No new dependency without saying what it replaces and why the platform primitive is insufficient.
- Concise output. Produce code, not narration.
