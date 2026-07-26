# CLAUDE.md — Steading

Steading — offline-first PWA for farm operations. Next.js App Router · TypeScript strict · MongoDB · Auth.js (JWT) · IndexedDB · Vercel.

Read `docs/Steading-Masterplan.md` before proposing architecture changes. Decisions D1–D7 there are settled; if a task appears to require breaking one, stop and say so rather than working around it.

Read `docs/UX-SPEC.md` before writing any component. Rules R1–R10 there are binding: ≥56px tap targets (64px primary), bottom-third placement for actions, steppers instead of numeric keyboards, no blocking spinner on a log path, 7:1 body contrast. Use the tokens as defined — do not introduce new colors or type scales.

`docs/COMPETITIVE-ANALYSIS.md` explains why features exist. Consult it before proposing to cut one.

---

## Hard Invariants

Violating any of these is a defect regardless of whether tests pass.

1. **Never call `db.collection()` outside `server/db/`.** All access goes through `scoped(orgId)`. Lint blocks this; do not add an eslint-disable to get past it.
2. **Never read `orgId` from a request payload.** It comes from the server session. Payload-supplied `orgId` → 400.
3. **Never mint an entity ID on the server.** Syncable entities carry a client-minted ULID as `_id`.
4. **Never trust `clientTs`.** Record it, order by `clientSeq` (intra-device) and `serverTs` (global).
5. **Never treat cached client claims as authorization.** The server re-derives identity, org, and role on every mutation.
6. **Never drop a rejected mutation.** It goes to the rejected inbox and stays user-visible.
7. **Never put a secret behind `NEXT_PUBLIC_`.**
8. **Never use `any`, `as unknown as`, or `!` on external data.** Parse with Zod at every boundary — API input, IndexedDB read, localStorage read.
9. **Never fail open on authorization.** Bounded fail-open applies to the rate limiter only.
10. **Never remove existing functionality to simplify a refactor.** If something looks dead, ask; do not delete.

---

## Layout

```
src/
  app/
    (auth)/                 # sign-in, callbacks
    (app)/                  # authenticated shell
    api/
      sync/route.ts         # batch mutation flush — the only write path for offline data
      [...]
  server/
    db/
      client.ts             # Mongo connection — the ONLY file importing MongoClient
      scoped.ts             # scoped(orgId) — the ONLY export exposing collections
      indexes.ts            # index definitions, applied on boot
    auth/
      session.ts            # requireSession(), requireRole()
    sync/
      apply.ts              # per-entity mutation appliers
  lib/
    contracts/              # Zod schemas — SHARED client + server, single source of truth
      mutation.ts
      entities/
    ulid.ts
  client/
    db/                     # IndexedDB (idb) — stores, migrations
    sync/                   # queue, flush loop, conflict + rejection handling
    hooks/
tests/
  isolation/                # cross-tenant tests — must exist before feature work
  sync/                     # idempotency, ordering, restart-survival
```

---

## Core Types

```ts
// lib/contracts/mutation.ts
export const MUTATION_SCHEMA_VERSION = 1;

export const mutationSchema = z.object({
  schemaVersion: z.number().int().positive(),
  id: z.string().length(26),        // ULID — idempotency key, becomes _id
  targetId: z.string().length(26),  // ULID — entity id, minted offline
  entity: z.enum(['flock', 'animal', 'eggLog', 'productionLog', 'feedLog',
                  'mortality', 'predator', 'equipment', 'hourReading',
                  'maintenance', 'task', 'photo']),
  op: z.enum(['create', 'update', 'delete']),
  payload: z.unknown(),             // validated per-entity in server/sync/apply.ts
  deviceId: z.string().uuid(),
  clientSeq: z.number().int().nonnegative(),
  clientTs: z.number().int(),       // recorded, NOT trusted
}).strict();

export type Mutation = z.infer<typeof mutationSchema>;
```

**Append-only entities** (`eggLog`, `productionLog`, `feedLog`, `mortality`, `predator`, `hourReading`) accept `create` only. An `update`/`delete` on them is a 400. They cannot conflict — sync is insert-if-absent.

**Mutable entities** (`flock`, `animal`, `equipment`, `maintenance`, `task`, `photo`) support update/delete and require conflict handling. They are **archived, never deleted** — a `delete` op sets `archivedAt` (P13).

Widening the entity enum is additive and does **not** bump `MUTATION_SCHEMA_VERSION`: the envelope shape is unchanged and an old client never emits a new value. The only constraint is deploy order — the server ships before a client that emits a new entity, since an old server answers 400 for one it does not know.

**Species are not just poultry.** `flock` is the wire name for any group of animals; the UI says herd, drove, or gaggle per species (`SPECIES_TRAITS` in `lib/contracts/entities/livestock.ts`). Do not reintroduce poultry-only assumptions — smallholdings are mixed, and egg logging is offered per species via `laysEggs()`.

---

## Sync Contract

Client:
- Enqueue to IndexedDB **before** optimistic UI update.
- Flush **sequentially**, ordered by `clientSeq`. Never parallel, never `Promise.all`.
- Hard cap: 100 mutations per batch.
- On 409/422 → rejected inbox. On 5xx/network → retry with backoff, keep queued.

Server (`/api/sync`):
- `requireSession()` → orgId, role. Reject role-forbidden ops per-mutation, not per-batch.
- Parse envelope, then per-entity payload schema.
- Apply via idempotent upsert:

```ts
const res = await mutations.updateOne(
  { _id: m.id, orgId },
  { $setOnInsert: { ...m, orgId, serverTs: new Date() } },
  { upsert: true },
);
if (!res.upsertedCount) return { id: m.id, status: 'duplicate' };
```

- Respond with a per-mutation result array: `applied | duplicate | rejected | conflict`. Never a bare 200.

---

## Testing Requirements

Every PR touching a data path adds:
- **Isolation test** — org A session + org B document ID → 404 (never 403; no existence disclosure).
- **Idempotency test** — batch applied twice → one record.
- **Restart test** for queue changes — mutations survive store close/reopen.

Run: `pnpm test`, `pnpm lint`, `pnpm typecheck` before declaring a task done.

---

## Style

- Server Components by default; `'use client'` only where interactivity or IndexedDB is required.
- Prefer explicit return types on exported functions.
- Comment *why*, not *what*. Document non-obvious sync/conflict logic thoroughly.
- No new dependency without saying what it replaces and why the platform primitive is insufficient.
- Concise output. Produce code, not narration.
