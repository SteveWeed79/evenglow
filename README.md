# Steading

Offline-first PWA for farm operations — birds, iron, and chores in one place.

Next.js (App Router) · TypeScript strict · MongoDB · Auth.js (JWT) · IndexedDB · Vercel

**Status: Phase 1 — Foundation & Tenancy Primitives.** The domain features and
the offline engine are not built yet; see [Phase status](#phase-status).

Planning docs, which are the source of truth:

| Doc | What it settles |
|---|---|
| [`docs/Steading-Masterplan.md`](docs/Steading-Masterplan.md) | Decisions D1–D7, phases, security rubric |
| [`docs/UX-SPEC.md`](docs/UX-SPEC.md) | Rules R1–R10, tokens, voice |
| [`docs/COMPETITIVE-ANALYSIS.md`](docs/COMPETITIVE-ANALYSIS.md) | Why each feature exists |
| [`docs/PHASE-1-SPEC.md`](docs/PHASE-1-SPEC.md) | The task list this repo implements |
| [`CLAUDE.md`](CLAUDE.md) | Hard invariants |

---

## Getting started

```bash
pnpm install
cp .env.example .env.local     # fill in MONGODB_URI and AUTH_SECRET
pnpm db:indexes                # apply orgId-leading indexes
pnpm db:seed "Hollow Farm" you@example.com 'a long passphrase'
pnpm dev
```

There is no invite flow yet (D7 is single-farm-first), so the first org and
owner are created by `db:seed`.

## Commands

| Command | Does |
|---|---|
| `pnpm dev` | Development server |
| `pnpm build` | Production build |
| `pnpm test` | Vitest — unit, isolation, and sync suites |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint, including the database guard |
| `pnpm db:indexes` | Apply index definitions |
| `pnpm db:seed` | Create the first org and owner |
| `pnpm check:secrets` | Fail if a secret reached the client bundle |
| `pnpm check:no-db-disables` | Fail on inline disables of the db guard |

## Architecture

The parts that are load-bearing rather than incidental:

**`src/server/db/scoped.ts`** is the only module that exposes a collection
handle. Every filter is rewritten to carry `orgId` and every insert has it
stamped. There is no escape hatch and no "unsafe" variant, because
"remember to include `orgId`" is exactly what this layer exists to make
impossible (D2). ESLint blocks `.collection()` everywhere else, and
`pnpm check:no-db-disables` blocks silencing that rule inline.

**`src/lib/contracts/`** is shared verbatim by client and server. Append-only
entities (D3) have no `update` or `delete` schema at all, so rejecting an
update to an egg log is a structural fact rather than a runtime check.

**`src/server/sync/apply.ts`** applies batches sequentially in `clientSeq`
order, never in parallel, using `$setOnInsert` so a replayed batch is a no-op.
Every mutation gets its own result — `applied`, `duplicate`, `rejected`, or
`conflict` — because a batch can be partly applied and nothing may be
silently dropped.

### Two deviations from `docs/PHASE-1-SPEC.md`

1. **No `bulkWrite`.** The spec exposes it with a note that callers must build
   guarded filters themselves. An escape hatch in the one module whose job is
   to have none defeats D2, and sequential flush does not need it. The spec's
   own note offers omitting it as the alternative; that is what is done here,
   and a test asserts the surface stays closed.

2. **Update operators are guarded too.** `guardFilter` stops you reaching
   another tenant's document; it does not stop `$set: { orgId }` pushing one of
   yours into another tenant. `assertSafeUpdate` rejects any operator touching
   `orgId` or `_id`.

## Testing

```bash
pnpm test                                    # skips db-backed suites if no mongod
MONGODB_TEST_URI=mongodb://localhost:27017 pnpm test    # runs everything
STEADING_REQUIRE_DB=1 pnpm test              # no database is a failure, not a skip
```

Suites split by what they need:

- **`tests/unit/`** — no database. The tenancy guard (against a fake driver),
  the contracts, the role matrix, index discipline, and the R7 contrast and
  R4 tap-target checks, which parse `globals.css` so they guard the tokens
  the app actually ships.
- **`tests/isolation/`** and **`tests/sync/`** — need a real mongod. These are
  the Phase 1 exit gate.

Without a database the second group **skips loudly**. CI sets
`STEADING_REQUIRE_DB=1` against a `mongo:8` service container, so the gate
cannot be met by a suite that quietly did not run.

## Phase status

- [x] **Phase 1 — Foundation & tenancy.** Scoped data layer, indexes, lint
      guard, contracts, auth, isolation suite, design tokens.
- [ ] **Phase 2 — Offline engine.** IndexedDB stores, mutation log, Service
      Worker, sequential flush, rejected-mutations inbox, sync dashboard.
      *Exit gate: airplane mode → 50 mutations → hard restart → reconnect →
      zero loss, zero duplicates.*
- [ ] **Phase 3 — Core domain.** Events, then entities, then photos. The charm
      layer unlocks here and **not before Phase 2's gate passes**.
- [ ] **Phase 4 — Hardening.** Rate limiting, origin/CSRF verification,
      envelope migration, quota UX, export, Core Web Vitals.

Deploy (Phase 1 spec T9) is not done: it needs Vercel credentials and a
MongoDB Atlas cluster.
