# Steading

Offline-first farm operations — stock, iron, and chores under one roofline.

React Native (Expo SDK 57, Android first) · TypeScript strict · SQLite on device · Fastify + MongoDB on the server

**Status: Phase 3 — Core Domain, in progress.** Phase 2's exit gate passes on
native SQLite: mutations logged in airplane mode survive process death and sync
exactly once. See [Phase status](#phase-status).

> **The migration is done.** This tree is React Native over Expo — the
> Capacitor/Vite client and the Next app are retired and deleted, and the
> framework-agnostic half of the old client is `packages/core`. There is no
> PWA and no Next.js; a suggestion that assumes SSR, server components, or
> framework API routes is aimed at a different project.

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
| [`docs/Steading-Masterplan.md`](docs/Steading-Masterplan.md) | Decisions D1–D14, phases, security rubric |
| [`docs/UX-SPEC.md`](docs/UX-SPEC.md) | Rules R1–R10, tokens, voice |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | What is left, in the order it should be built |
| [`docs/COMPETITIVE-ANALYSIS.md`](docs/COMPETITIVE-ANALYSIS.md) | Why each feature exists, and what a farm must do before it sees one |
| [`docs/ACCESS-AND-BILLING.md`](docs/ACCESS-AND-BILLING.md) | How a farm gets in, and where the money is |
| [`docs/REACT-NATIVE-PLAN.md`](docs/REACT-NATIVE-PLAN.md) | The live client plan |
| [`docs/WEATHER-PLAN.md`](docs/WEATHER-PLAN.md) | Forecast, warnings, and the licence cliff |
| [`docs/BREED-AND-PURPOSE.md`](docs/BREED-AND-PURPOSE.md) | Proposal: what a flock is *for*, breed data, and crowdsourcing |
| [`CLAUDE.md`](CLAUDE.md) | Hard invariants |

Superseded, kept for the reasoning rather than the conclusion:
[`NATIVE-PIVOT.md`](docs/NATIVE-PIVOT.md) argued for Capacitor;
[`MIGRATION-PLAN.md`](docs/MIGRATION-PLAN.md) and
[`PHASE-1-SPEC.md`](docs/PHASE-1-SPEC.md) describe a route already taken.

There is one rubric. The v2.x masterplan has been removed rather than kept
alongside it.

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
pnpm dev:api
```

Or `pnpm farm`, which does all of the above from nothing — see below.

`AUTH_SECRET` ships blank. Generate one with `openssl rand -base64 32`.
`MONGODB_URI` defaults to a local mongod — `docker run -d -p 27017:27017
mongo:8` is enough if you do not have one installed.

`db:seed` makes a farm from the command line, which is the quickest way to get
a server-side account for development. It is no longer the only way in: the app
opens on an org it mints itself and claims it at signup (D14, D15), and a
second person joins with a six-character code or an invite link.

`pnpm db:usage` reports what each farm is holding, in bytes. Read-only and safe
against a live database — it is for capacity and for knowing when photo bytes
should leave the database for S3, not for pricing, which is settled.

## Commands

| Command | Does |
|---|---|
| `pnpm farm` | Dev back end from nothing: database, first account, API |
| `pnpm dev:api` | Fastify with watch |
| `pnpm mobile` | Metro for the development build — install it first with `pnpm mobile:android` |
| `pnpm mobile:android` | Prebuild, compile, deploy to a device or emulator |
| `pnpm mobile:export` | Metro bundle — the quickest check that resolution is sound |
| `pnpm test` | Vitest — unit, screens, offline, isolation, and sync suites |
| `pnpm typecheck` | Both programs: root, and `apps/mobile` |
| `pnpm lint` | ESLint, including the database guard |
| `pnpm db:indexes` | Apply index definitions |
| `pnpm db:seed` | Create the first org and owner |
| `pnpm db:verify` | Exercise the server data path end to end |
| `pnpm check:icons` | The icon set against its manifest |
| `pnpm check:secrets` | Fail if a secret reached the client bundle |
| `pnpm check:no-db-disables` | Fail on inline disables of the db guard |
| `pnpm verify:alerts` | Run the alert parser over every warning live in the US — see below |
| `scripts/backup-mongo.sh` | Encrypted nightly dump to S3, and the restore — runs on the server |
| `pnpm bench:store` | Store benchmarks |

### `pnpm verify:alerts`

Not in CI, and deliberately: it depends on live weather and on
`api.weather.gov` being reachable, and a red build because a government service
was slow teaches people to ignore red builds.

Run it before shipping anything that touches alerts. `fetchAlerts` drops what
it cannot parse — one unusable feature must not take the tornado warning beside
it down — which means **a schema mismatch is silent**, and an alert the app
cannot read looks exactly like an alert nobody issued. This asks for every
alert in force in the United States, runs the real parse over all of them, and
says what fell out. Exit code 1 if the contract refused a live warning.

## The client (`apps/mobile`)

Expo SDK 57, React Navigation, `expo-sqlite` under the `LocalStore` port in
`packages/core` — see `docs/REACT-NATIVE-PLAN.md` for what the move cost.

```bash
pnpm farm                                      # server + database + first account
pnpm mobile:android                            # ONCE: builds and installs the app
                                               # (first run is slow — Gradle)
pnpm mobile                                    # Metro, second window
```

`pnpm farm` is the development back end for a machine with nothing installed on
it. It generates `.env.local` with a random `AUTH_SECRET`, starts a MongoDB
against `.steading-data/` (downloading one on first run — it does **not** need
MongoDB installed, and it does **not** use the throwaway in-memory engine, so
your farm survives closing the window), seeds the first owner account, and then
runs Fastify on port 3001. If a MongoDB is already listening it uses that
instead. On Windows, `scripts/windows/Start the farm server.bat` does the same
by double-click.

`pnpm farm --new-password` (`Reset my password.bat`) sets a new password on an
existing account. There is no reset flow in the product yet, so without it a
development account whose password was stored wrong is unopenable. Values reach
both it and the seed through the **environment**, never argv — a shell must not
get a chance to rewrite a password, and argv shows up in a process list.

The longhand, when you want the pieces separately:

```bash
cp apps/mobile/.env.example apps/mobile/.env   # then edit EXPO_PUBLIC_API_URL
pnpm dev:api                                   # Fastify, port 3001
SEED_ORG=Farm SEED_EMAIL=you@example.com SEED_PASSWORD='a good password' pnpm db:seed
SEED_EMAIL=you@example.com SEED_PASSWORD='a new one' pnpm db:password
pnpm mobile:android                            # build and deploy to a device
```

**You need the server running to sign in**, and only to sign in. Once a device
has a session it works entirely offline — that is the point of the thing. A
device that has never signed in has no orgId, so it has no database to open —
**which is the thing D14 changes**, and why it is on the roadmap: an
offline-first app that cannot be opened offline is only offline-first from the
second morning.

| Command | What it does |
| --- | --- |
| `pnpm mobile` | Metro for the development build — install it first with `pnpm mobile:android` |
| `pnpm mobile:android` | Prebuild, compile, and deploy to a device or emulator |
| `pnpm mobile:export` | Bundle with Metro — the quickest check that resolution is sound |
| `pnpm typecheck:mobile` | Typecheck against `expo/tsconfig.base`, which has no DOM in it |

`apps/mobile/android` is **not** committed: it is generated from `app.json` by
`expo prebuild`, and nothing in it is hand-edited. A committed copy drifts from
`app.json` until the two disagree about what the app is.

Emulator hosts are `10.0.2.2`, never `localhost` — a physical handset needs
this machine's LAN address instead. The Windows scripts in `scripts/windows/`
create the `.env` for you and the phone one fills in the LAN address itself.

`.env` is gitignored, so a fresh clone has none. **That does not stop the app,
and there is no longer any case where it does.** Without `EXPO_PUBLIC_API_URL`
it opens, reads and records normally — the screen renders a local SQLite file —
but the sync loop is never started and the chip reads *Not set up* rather than
reporting the ordinary offline story. A device with nobody signed in used to be
the one fatal case; it now opens the farm it minted itself (D14). See
`apps/mobile/src/boot/config.ts`.

## Android

The APK is the target (D8). You need Android Studio, and either a handset with
USB debugging on or an emulator image:

```bash
pnpm mobile:android
```

`android/` is generated by `expo prebuild` and is **not committed** — it is
build output, and a committed copy drifts from `app.json` until the two
disagree about what the app is.

### Reaching the API from a device

The app is not served from a web origin, so the API base must be absolute:

```bash
pnpm farm        # database, first account, API, from nothing
```

- **Emulator** — the host machine is `10.0.2.2`, never `localhost`.
- **Handset** — your machine's LAN address, e.g. `http://192.168.1.20:3001`.

Set it wrong and the app refuses to start rather than starting and never
syncing: a device that queues all morning and only admits it when somebody
checks the sync chip is much the worse failure. See
`apps/mobile/src/boot/config.ts`.

**Verify on a device before calling any storage, camera, haptics or sync task
done.** The bundler is not a handset, and an emulator is not one either — it
reaches neither haptics, nor the camera, nor signal loss and regain, nor doze.
Every serious bug in this project so far has been one only a device could show.

## Architecture

The parts that are load-bearing rather than incidental:

**`apps/api/src/db/scoped.ts`** is the only module that exposes a collection
handle. Every filter is rewritten to carry `orgId` and every insert has it
stamped. There is no escape hatch and no "unsafe" variant, because
"remember to include `orgId`" is exactly what this layer exists to make
impossible (D2). ESLint blocks `.collection()` everywhere else, and
`pnpm check:no-db-disables` blocks silencing that rule inline.

**`src/lib/contracts/`** is shared verbatim by client and server. Append-only
entities (D3) have no `update` or `delete` schema at all, so rejecting an
update to an egg log is a structural fact rather than a runtime check.

**`apps/api/src/sync/apply.ts`** applies batches sequentially in `clientSeq`
order, never in parallel, using `$setOnInsert` so a replayed batch is a no-op.
Every mutation gets its own result — `applied`, `duplicate`, `rejected`, or
`conflict` — because a batch can be partly applied and nothing may be
silently dropped.

**`packages/core/src/sync/queue.ts`** enqueues in a single SQLite transaction:
mint the sequence number, write the outbox entry, advance the counter, and
update the local projection together. Assigning `clientSeq` outside the
transaction is how you end up with two mutations sharing a sequence number
after a crash mid-write — at which point ordering is broken and nothing says
so. If the counter is ever lost, the next sequence number is floored by the
highest one still in the outbox rather than restarting at zero.

**`packages/core/src/sync/pull.ts`** is the read half of sync. Without it the app is
single-device: a reinstall or a second phone opens to an empty farm even
though the server holds everything. It ships the *mutation log* rather than
projected documents, because the client already knows how to turn a mutation
into a local record — one projection path (`packages/core/src/db/project.ts`) used by
both enqueue and hydration, so the two cannot drift. A record with a pending
local edit is skipped: a queued change visibly reverting is the most alarming
thing an offline app can do.

**`packages/core/src/sync/flush.ts`** is single-flight: concurrent callers share the
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

The gate is that mutations logged with the radio off survive **process death**
and then sync exactly once. It was first earned under Chromium against
IndexedDB; D9 changed the durability characteristics it was proving, so it was
re-earned on device against native SQLite rather than carried over. A gate
proved on a storage layer you no longer ship is not a gate.

## Phase status

- [x] **Phase 1 — Foundation & tenancy.** Scoped data layer, indexes, lint
      guard, contracts, auth, isolation suite, design tokens.
- [x] **Phase 2 — Offline engine.** SQLite stores, mutation log, sequential
      flush, rejected-mutations inbox, diagnostics sheet. **Exit gate passes on
      device**: airplane mode → 50 mutations → process kill → reconnect → zero
      loss, zero duplicates.
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

Deploy is not done: the API needs a host and a MongoDB. That is now also a
pricing question — see `docs/ACCESS-AND-BILLING.md` §4.1, which cannot be
answered until per-org storage is instrumented.

**D13 and D14 — free on one device, and opening before authenticating — are
decided and unbuilt.** They are §7 of the roadmap.
