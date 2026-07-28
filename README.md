# Steading

Offline-first farm operations — stock, iron, and chores under one roofline.

Next.js (App Router) · TypeScript strict · MongoDB · Auth.js (JWT) · IndexedDB · Vercel

**Status: Phase 3 — Core Domain, in progress.** Phase 2's exit gate passes:
mutations logged in airplane mode survive a hard browser restart and sync
exactly once. See [Phase status](#phase-status).

> **The stack line above describes this tree, not the destination.** The
> masterplan has settled on a Capacitor + SQLite + Fastify architecture
> (D8–D10) and that migration is in flight on a separate branch. The commands
> in this README are the ones that work today; the gap between the two is set
> out in [`docs/Steading-Masterplan.md` §0.1](docs/Steading-Masterplan.md).

Steading covers **everything a small mixed farm does** — the animals, the
growing, and the machinery that serves both.

**Animals:** poultry, ratites, ruminants and camelids, pigs, rabbits, equines,
and free-text *other*. The UI says *herd*, *drove*, or *gaggle* per species, and
egg logging is offered only where it applies.

**Growing:** beds and polytunnels, plantings and varieties, sowing, succession,
harvest by weight, and rotation history. The same person checks the hens and the
carrots on the same walk; they should not need two apps to write it down.

**Iron:** tractors and implements, hour meters, service intervals, and the
forecast that lets a filter be ordered before it matters.

Planning docs, which are the source of truth:

| Doc | What it settles |
|---|---|
| [`docs/Steading-Masterplan.md`](docs/Steading-Masterplan.md) | Decisions D1–D10, phases, security rubric, migration status |
| [`docs/UX-SPEC.md`](docs/UX-SPEC.md) | Rules R1–R10, tokens, voice |
| [`docs/COMPETITIVE-ANALYSIS.md`](docs/COMPETITIVE-ANALYSIS.md) | Why each feature exists |
| [`docs/PHASE-1-SPEC.md`](docs/PHASE-1-SPEC.md) | The task list, rewritten for the D8–D10 target |
| [`docs/MIGRATION-PLAN.md`](docs/MIGRATION-PLAN.md) | How this tree becomes that one, stage by stage |
| [`docs/NATIVE-PIVOT.md`](docs/NATIVE-PIVOT.md) | Why Capacitor rather than React Native |
| [`docs/BREED-AND-PURPOSE.md`](docs/BREED-AND-PURPOSE.md) | Proposal: what a flock is *for*, breed data, and crowdsourcing |
| [`CLAUDE.md`](CLAUDE.md) | Hard invariants |

There is one rubric, and it is version 3.0. The v2.x masterplan has been
removed rather than kept alongside it.

---

## Getting started

Node 22+ and pnpm. This is a pnpm workspace: internal packages are linked with
`workspace:*`, a protocol npm cannot resolve, so `npm install` fails here with
`EUNSUPPORTEDPROTOCOL`. That is not a broken tree — it is the wrong tool.

```bash
corepack enable                # installs the pnpm pinned in packageManager
```

If `corepack` is missing from your Node install, `npm install -g pnpm` works
too; the `packageManager` pin then keeps you on the version CI uses.

```bash
pnpm install
cp .env.example .env.local     # fill in MONGODB_URI and AUTH_SECRET
pnpm db:indexes                # apply orgId-leading indexes
pnpm db:seed "Hollow Farm" you@example.com 'a long passphrase'
pnpm dev
```

`AUTH_SECRET` ships blank. Generate one with `openssl rand -base64 32`.
`MONGODB_URI` defaults to a local mongod — `docker run -d -p 27017:27017
mongo:8` is enough if you do not have one installed.

There is no invite flow yet (D7 is single-farm-first), so the first org and
owner are created by `db:seed`.

## Commands

| Command | Does |
|---|---|
| `pnpm dev` | Development server |
| `pnpm build` | Production build |
| `pnpm test` | Vitest — unit, offline, isolation, and sync suites |
| `pnpm e2e` | Playwright — the Phase 2 exit gate (needs `pnpm build` first) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint, including the database guard |
| `pnpm db:indexes` | Apply index definitions |
| `pnpm db:seed` | Create the first org and owner |
| `pnpm check:secrets` | Fail if a secret reached the client bundle |
| `pnpm check:no-db-disables` | Fail on inline disables of the db guard |
| `pnpm check:chunks` | Fail if the native build lost its sqlite driver |
| `pnpm build:app` | Vite build of the Capacitor client → `apps/app/dist` |
| `pnpm cap:sync` | Build, then copy the bundle into the native project |
| `pnpm cap:run:android` | Build, sync, and deploy to a device or emulator |
| `pnpm cap:open:android` | Open the native project in Android Studio |
| `pnpm dev:api` | Fastify with watch — what the native build talks to |

## Android

The APK is the target (D8); the browser is the fast development loop. Everything
above the storage layer is identical between them — the one branch is in
`apps/app/src/platform.ts`, which decides between SQLite on device and IndexedDB
in a browser.

You need Android Studio, and either a handset with USB debugging on or an
emulator image. Then:

```bash
pnpm cap:run:android
```

That builds the web bundle, copies it into `apps/app/android`, and deploys.
`cap:sync` always builds first on purpose — syncing a stale `dist` puts the last
build in the APK and the change you are testing simply is not there.

### Reaching the API from a device

The APK serves the app from its own origin, so a relative `/sync` resolves to
the bundle rather than to a server. The native build needs an absolute one:

```bash
cp apps/app/.env.example apps/app/.env.local   # then edit VITE_API_BASE_URL
pnpm dev:api                                   # Fastify, port 3001
```

- **Emulator** — the host machine is `10.0.2.2`, never `localhost`.
- **Handset** — your machine's LAN address, e.g. `http://192.168.1.20:3001`.

Set it wrong and the app refuses to start rather than starting and never
syncing: a device that queues all morning and only admits it when someone
checks the sync chip is much the worse failure.

The API's `CORS_ORIGINS` must include the WebView's origin, which is
`https://localhost` — a different origin from the Vite dev server, so add it
alongside rather than replacing it.


The native project is committed, so Gradle files and manifest edits are
reviewable. The copied bundle and the generated Capacitor config are not: the
template's `.gitignore` excludes them, because they are build output.

**Verify on a device before calling any storage, camera, haptics or sync task
done.** A WebView over native SQLite does not behave like a browser over
IndexedDB, and the durability characteristics that D9 changed are exactly the
ones a dev server cannot show you.

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

**`src/client/sync/queue.ts`** enqueues in a single IndexedDB transaction:
mint the sequence number, write the outbox entry, advance the counter, and
update the local projection together. Assigning `clientSeq` outside the
transaction is how you end up with two mutations sharing a sequence number
after a crash mid-write — at which point ordering is broken and nothing says
so. If the counter is ever lost, the next sequence number is floored by the
highest one still in the outbox rather than restarting at zero.

**`src/client/sync/pull.ts`** is the read half of sync. Without it the app is
single-device: a reinstall or a second phone opens to an empty farm even
though the server holds everything. It ships the *mutation log* rather than
projected documents, because the client already knows how to turn a mutation
into a local record — one projection path (`src/client/db/project.ts`) used by
both enqueue and hydration, so the two cannot drift. A record with a pending
local edit is skipped: a queued change visibly reverting is the most alarming
thing an offline app can do.

**`src/client/sync/flush.ts`** is single-flight: concurrent callers share the
in-flight promise instead of starting a second batch, which is what makes
"never parallel" true when a timer, the `online` event, and a user action all
fire at once. A mutation leaves the outbox only when the server says
`applied` or `duplicate`; anything else parks in the rejected inbox, and a
batch the server will never accept is parked after six attempts rather than
looping forever.

### Local storage protections

The local store is the only copy of work that has not synced yet, so it is
treated as the most fragile thing in the system:

| Protection | What it prevents |
|---|---|
| Single-transaction enqueue | Two mutations sharing a `clientSeq` after a crash mid-write |
| Sequence floor from the outbox | Reusing sequence numbers when the counter is lost |
| Corruption quarantine | One unreadable row wedging every mutation behind it |
| Envelope migration ladder | A device offline across two deploys failing to sync (A7) |
| Quota detection | A full disk half-writing a log instead of failing loudly |
| Integrity check | Records vanishing without the server ever acknowledging them |
| Web Locks | Two tabs racing the pull watermark |
| Wipe on sign-out | The previous farm's records readable by the next user (C5) |
| Rejected inbox | Work the server refused evaporating unseen (A6) |

Nothing is deleted to make a problem go away. A corrupt row keeps its raw
value in quarantine, a rejection stays in the inbox until a human decides,
and a discard bumps the cleared counter so it is never later mistaken for
data loss.

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
- **`tests/offline/`** — no database. The outbox, flush loop, pull, and the
  storage protections against `fake-indexeddb`: sequence monotonicity, batch
  cap, single-flight, retry-vs-reject routing, poison-batch parking, the
  integrity check, corruption quarantine, envelope migration, and the wipe.
- **`tests/isolation/`** and **`tests/sync/`** — need a real mongod. These are
  the Phase 1 exit gate.
- **`tests/e2e/`** — needs a build and Chromium. The Phase 2 exit gate.

Without a database the mongod group **skips loudly**. CI sets
`STEADING_REQUIRE_DB=1` against a `mongo:8` service container, so the gate
cannot be met by a suite that quietly did not run.

### The Phase 2 exit gate

```bash
pnpm build && pnpm e2e
```

Real Chromium, a **persistent on-disk profile**, and a real process kill. The
profile matters: a fresh Playwright `BrowserContext` carries cookies and
localStorage but *not* IndexedDB, so restarting into one would be asserting
against an empty database. The gate is verified to fail — pointing the restart
at a different profile makes it report `Received: 0`.

It stubs `/api/sync` at the network layer, so no MongoDB is involved.

## Phase status

- [x] **Phase 1 — Foundation & tenancy.** Scoped data layer, indexes, lint
      guard, contracts, auth, isolation suite, design tokens.
- [x] **Phase 2 — Offline engine.** IndexedDB stores, mutation log, Service
      Worker, sequential flush, rejected-mutations inbox, storage persistence,
      diagnostics sheet. **Exit gate passes**: airplane mode → 50 mutations →
      hard restart → reconnect → zero loss, zero duplicates.
- [ ] **Phase 3 — Core domain.** *In progress.* Done: mutation projection into
      domain collections, archive-not-delete, hour-meter monotonicity,
      conflict-on-deleted-target, the mixed-livestock model, groups and egg
      logging read local-first, **medication with withdrawal tracking (W2)** —
      the wedge feature — and pull sync, so a second device or a reinstall
      hydrates. Remaining: individual animal screens, equipment
      and maintenance, photos, reporting. The charm layer is unlocked —
      Phase 2's gate passes.
- [ ] **Phase 4 — Hardening.** Rate limiting, origin/CSRF verification,
      envelope migration, quota UX, export, Core Web Vitals.

Deploy (Phase 1 spec T9) is not done: it needs Vercel credentials and a
MongoDB Atlas cluster.
