# Steading — D8–D10 Migration Plan

How the Next.js + IndexedDB implementation becomes the Capacitor + SQLite +
Fastify one described in `Evenglow-Masterplan.md`.

Companion to masterplan §0.1, which states the gap. This states the route
across it.

---

## 1. Why this restarts rather than continues

A first attempt at this migration exists (`b1d033c`, "WIP: restructure to the
v3.0 workspace — DOES NOT BUILD"). It is being abandoned rather than repaired,
for reasons worth recording so the same shape is not produced again.

It moved the entire tree, deleted the Next.js surface, deleted the PWA surface,
deleted the IndexedDB layer, deleted Auth.js, deleted the Playwright harness,
and removed seven dependencies **in one commit**. The result:

- **Nothing could be reviewed.** 99 files, +7428/−4389, with structural moves
  and semantic deletions interleaved. A reviewer cannot tell a file that moved
  from a file that moved *and changed*.
- **Nothing could be run.** No SQLite implementation, no Fastify server or
  routes, no Vite entry, no Capacitor project. The tree had no working state to
  return to and no test that could execute.
- **The safety rails came off silently.** The eslint tenancy rules stayed
  scoped to `src/**`, `check-no-db-disables` kept walking `src`, and
  `check-bundle-secrets` kept scanning `.next/static`. All three then covered
  nothing. `check-bundle-secrets` reported *"passed (0 client assets scanned)"*
  — a green check over an unscanned bundle. Rubric C1 was enforcing nothing and
  CI could not say so, because it died at `pnpm install` first.

The lesson is not "be more careful." It is that **a migration must never have a
step where nothing runs.** Every stage below keeps a working tree and a passing
suite. The old stack is deleted last, and only once the new one has replaced it
under test.

---

## 2. The correctness oracle

The migration has an unusually good answer to "is the port correct?", and it
should be used rather than re-derived.

`apps/app/src/db/port.ts` defines `LocalStore` — the storage dependency of the
entire sync engine, expressed as **atomic domain operations rather than
key-value primitives**. That distinction is the whole point: `enqueue` mints a
sequence number, writes the outbox row, advances the counter and updates the
projection *as one unit*. Exposing those four separately would let a SQLite
implementation quietly lose the guarantee that a crash mid-write cannot
duplicate a `clientSeq`.

**A new storage implementation is correct exactly when it passes the existing
suite.** `tests/offline/` — queue, flush, pull, protections — is written
against behaviour, not against IndexedDB. Retarget it at the port, run it
against both implementations, and the port is proven.

This is why `port.ts` was written before the pivot was decided, and it is why
the existing engine must not be deleted early: it is the reference the port is
checked against.

**The oracle is not automatically right, and S4b proved it.** `applyPulled`
still took a single `through: number` — because the port was written before the
same-millisecond cursor fix. Implementing it faithfully would have persisted a
watermark without its ULID and silently reintroduced that data loss on the
SQLite path alone. An oracle written before a fix does not know about the fix,
so when the two disagree, check which one is stale before assuming the
implementation is wrong.

---

## 3. What moves unchanged, and what is genuinely rewritten

Most of the codebase is already framework-agnostic. Sizing the real work
honestly matters, because "rewrite the app" and "rewrite the storage layer and
the HTTP shell" are very different jobs, and this is the second one.

### Ports unchanged — copy, retarget imports, done

| What | Why it survives |
|---|---|
| `lib/contracts/**` | Pure Zod. Already shared client/server; becomes `packages/contracts`. |
| `lib/withdrawal.ts`, `lib/ulid.ts` | Pure functions, no platform surface. |
| `server/db/scoped.ts`, `indexes.ts`, `identity.ts` | Mongo driver only. Framework-free. |
| `server/sync/apply.ts`, `projections.ts` | Take a `Scoped` and plain data. No `next/*` import. |
| `server/auth/password.ts`, `credentials.ts` | argon2 and a user document. `credentials.ts` was extracted from the Auth.js provider precisely so it could be tested — and now, moved. |
| `client/sync/{queue,flush,pull,inbox,engine}.ts` | The state machine. Storage-shaped, not browser-shaped. |
| `client/read/**`, `lib/withdrawal.ts` consumers | Pure reads over records. |
| Every component and screen | React. The Tally does not care what is underneath it. |

### Genuinely rewritten

| What | From | To | Risk |
|---|---|---|---|
| Local store | IndexedDB (`client/db/open.ts`, `migrate.ts`) | SQLite via `@capacitor-community/sqlite` | **High** — durability semantics differ |
| HTTP shell | Next route handlers | Fastify routes | Low — handlers are thin |
| Auth | Auth.js JWT strategy | `jose` + rotating refresh | **Medium** — new revocation logic |
| Build | Next | Vite + Capacitor | Low |
| E2E harness | Playwright + Chromium profile | Device/emulator | **High** — see §5 |

### Deliberately dropped

The service worker, the web manifest, `client/sync/lock.ts` (Web Locks), and
`client/sync/storage.ts` (`persist()`/quota). These exist only to work around
browser storage and have no meaning in an app sandbox (D8, D9).

**Web Locks needs a replacement, not just a deletion.** It was added to stop two
tabs racing the pull watermark. A single WebView has one context, so the tab
race is gone — but confirm that before removing the guard, rather than assuming
it.

---

## 4. Stages

Each stage ends with a green tree. No stage may be merged red.

### S1 — Workspace, contracts extracted ✅ done

Move `lib/contracts/**`, `lib/ulid.ts`, `lib/withdrawal.ts` into
`packages/contracts`. **The Next app keeps working**, importing
`@homefarm/contracts` instead of `@/lib/contracts`. Regenerate
`pnpm-lock.yaml` — a stale single-importer lockfile is what killed CI on the
first attempt.

Two notes on how this landed, against the plan as first written:

- **`apps/app` and `apps/api` were not created.** Empty scaffolding proves
  nothing and cannot be verified. They arrive in S3 and S5, when there is
  something to put in them.
- **The guard work for the moved code happened here, not in S2.** Moving
  contracts out of `src/` immediately un-scoped the rule keeping server-only
  imports out of shared code, which was pinned to `src/lib/**` — the exact
  failure this plan is written against, reproduced by the plan's own first
  stage. A stage must not open a hole for a later stage to close, so the
  guards were extended to `packages/*/src/**` and verified in the same step.

The package ships TypeScript source with no build step. It is consumed only
inside the workspace, and compiling between the schemas and their consumers
would buy nothing and cost a stale artifact. Next needs `transpilePackages`;
Vite will resolve the same source through the workspace link.

*Exit, met: typecheck, lint, 248 unit tests, `pnpm build`, `check:secrets`
(13 assets), and all 5 e2e including the Phase 2 exit gate — green through the
new package boundary. The tenancy guard was exercised against a deliberate
violation placed inside `packages/contracts` and fires.*

### S2 — Guards pre-armed and proven ✅ done

**This stage was mis-sequenced as originally written, and the correction is the
interesting part.** The plan said to repoint `eslint.config.mjs` at
`apps/api/src/**` and `apps/app/src/**`. Those directories do not exist until
S3 and S5 — so doing that literally would have aimed every rule at nothing,
which is the exact defect this plan was written against, committed in the name
of preventing it. Two of the three items were likewise premature: `CLIENT_DIRS`
cannot follow a Vite build that does not exist, and banning `indexedDB` would
flag the working offline engine, which is IndexedDB by design until S4.

The underlying mistake was treating "the config lists this directory" as the
unit of work. It is a convention, and conventions do not survive a tree move.
So S2 became: make coverage **executable**, and arm it ahead of the code.

- The guard globs now include `apps/*/src/**`, and the storage-globals ban is
  scoped to `apps/app/src/**`. Both cover directories that do not exist yet.
  That is deliberate: the rule is in force the moment the first file lands,
  rather than being remembered afterwards. The `indexedDB` ban therefore
  arrives with the new client and never touches the old one.
- `tests/unit/guards.test.ts` runs ESLint against deliberate violations and
  requires each rule to fire. ESLint resolves config from a file's *path*, not
  its existence, so the guard for `apps/api` is proven before `apps/api`
  exists. It also asserts the db layer stays exempt, and that the storage ban
  does **not** fire on the pre-migration client.
- `CLIENT_DIRS` lists both build outputs, so the secret scan spans the
  migration instead of being repointed on the day the client changes — the day
  it is most easily forgotten.

*Exit, met: 12 guard assertions pass. Verified against the historical failure
by deleting the `apps/*` globs, which fails exactly the two pre-armed cases and
nothing else.*

### S3 — Fastify API alongside the Next routes

Split into three, because "stand up a second server" turned out to bundle a
move, a new auth scheme, and new routes into one reviewable unit — which is the
shape this plan exists to avoid.

**S3a — the API becomes a package ✅ done.** `src/server/**` moves to
`apps/api` and the Next routes import it. No new behaviour, no second server
yet: this is the step that makes a second server *possible*, since two
implementations must share one applier or they will drift.

What stayed behind, and why it is not an oversight: `auth/config.ts` and
`auth/session.ts` are Auth.js and Next-session plumbing, and Fastify will not
use them. `SessionClaims` moved into the package as `auth/claims.ts` — the
appliers take that shape and do not care how it was established, so a second
declaration is exactly how the Auth.js path and the token path would drift.
`http.ts` split on the same line: `HttpError` and `errorBody` are shared, the
`NextResponse` conversion is an adapter.

*Exit, met: 267 unit tests, 6 e2e, build, and both guard scripts green through
the new package boundary. The tenancy guard was exercised against a real file
in `apps/api/src/sync` and fires; `apps/api/src/db` is exempt.*

**S3b — token auth ✅ done.** The Fastify service, `jose` access tokens, and
rotating refresh with family revocation (`PHASE-1-SPEC.md` T7).

Two decisions worth finding here rather than in review:

- **`refreshTokens` is a third non-tenant-scoped collection**, alongside
  `users` and `orgs`. A refresh happens before any `orgId` exists, so
  `scoped()` cannot serve it. It follows `identity.ts` — narrow purpose-built
  functions, no handle escapes the module, and it sits in `db/` so the lint
  exemption covers it. It is safe for a specific reason rather than by
  assumption: every row is keyed by the hash of a 256-bit secret, so no query
  in that module takes an org or a user that a caller could widen. Presenting
  the token *is* the lookup.
- **Only Fastify gets refresh semantics.** Auth.js keeps its JWT-only session
  until S7 removes it, so the two live servers genuinely differ in session
  behaviour for the duration. That is a real divergence, not a cosmetic one,
  and it is bounded by the fact that no client talks to both.

Reuse detection is a conditional update, not a read-then-write: two concurrent
exchanges of one token cannot both win, and the loser is treated as theft —
which, from the server's position, is exactly what it cannot be distinguished
from.

*Exit, met: 284 unit tests locally; the 24 new db-backed tests covering
rotation, family revocation, and the routes run in CI.*

**S3c — the routes, and the two-server proof ✅ done.** `/sync` and `/snapshot`
on Fastify, with the tenancy assertions run against both implementations.

The important move was not writing the Fastify handlers, it was **extracting
what they do**. `sync/batch.ts` and `sync/snapshot.ts` now hold the batch
handling and the hydration cursor, and both servers' routes are adapters over
them. A second copy of the cursor is the last thing this migration should
carry: a difference between the two would only surface after a reinstall, on
whichever server that device happened to talk to.

That makes the parity suite sharper than it looks. What it actually exercises
is the part that is *not* shared — the two auth paths, and the two ways a
request becomes a scope.

*Exit, met: 310 unit tests; 24 db-backed parity assertions (12 × two servers)
in CI.*

Stand up `apps/api` with `server.ts` and `routes/{auth,sync,snapshot}.ts`
wrapping the already-ported appliers. Token auth per `PHASE-1-SPEC.md` T7.

**Keep the Next routes running.** Two servers over one database, briefly. The
isolation suite runs against both, which is the cheapest possible proof that
the Fastify port did not weaken tenancy.

Carry over what the Next routes learned: `orgId` from the token only, per-mutation
role rejection, the `(serverTs, _id)` cursor on `/snapshot`, and 404-not-403 on
cross-tenant reads.

*Exit: isolation and idempotency suites green against Fastify. `db:verify`
green.*

### S4 — SQLite `LocalStore`

The real work. Split in two, because the schema and the store are separately
testable and the first is a prerequisite for the second.

**S4a — the SQL seam, schema, and migration ladder ✅ done.**

`SqlDriver` is a deliberately narrow interface with two backings:
`@capacitor-community/sqlite` on device (S5), and `node:sqlite` under test. The
split is not tidiness — the storage layer is the highest-risk part of this
migration, and a layer that can only be exercised on a handset is one that gets
exercised rarely and late. Everything clever lives above the driver, where it
is testable, rather than in two implementations that then have to agree.

**Concurrent transactions are serialised, and nesting is refused.** A SQLite
connection holds one transaction, so two overlapping calls are not two
transactions — they are one, with either caller able to roll back the other's
writes. For enqueue that means a committed half-write: a sequence number
consumed with no outbox row, or a projection updated for a mutation that is not
queued. Two taps on the Tally is enough to reach it. The first version of the
driver tried to nest with savepoints and the concurrency test caught it
unwinding into "no such savepoint" — the polite version of that failure.

Migrations are additive only, enforced by a test rather than remembered: a
`DROP` or `DELETE` in a migration discards work that exists nowhere else until
it flushes. Each migration commits together with its version bump, so a failure
part-way leaves the database at the previous version rather than claiming to be
migrated and not being.

*Exit, met: 15 schema and transaction assertions against real SQLite in Node.
The `indexedDB` ban S2 pre-armed on `apps/app/src/**` fires now that the
directory exists — verified against a deliberate violation.*

**S4b — the store itself ✅ done.** `LocalStore` implemented over the driver,
covered by a contract suite asserting the MUSTs `port.ts` documents.

**Writing it found the oracle out of date.** `applyPulled` took
`through: number` — a single timestamp — because `port.ts` predates the
same-millisecond cursor fix. Implementing it verbatim would have persisted the
watermark without its ULID and silently reintroduced that data loss on the
SQLite path only, visible only after a reinstall. The port is corrected to a
`SnapshotWatermark` pair. Worth stating plainly: *"implement the port"* is only
as correct as the port, and an oracle written before a fix does not know about
it.

The stored shapes moved to `apps/app/src/db/schema.ts` and the IndexedDB module
re-exports them, so both engines validate against one declaration rather than
two that can drift.

*Exit, met: 23 contract assertions plus the 15 schema ones, against real SQLite
in Node.*

**S4c — one suite, both stores ✅ done.** The IndexedDB `LocalStore` adapter,
and 23 assertions run against each implementation. The faults are expressed per
backing so the assertions can stay shared.

It found a latent bug in the *existing* engine: `enqueue`'s rollback relied on
the transaction failing as a unit, which is only true when the failure arrives
through the request. A synchronous throw from `put()` leaves IndexedDB to
auto-commit the outbox row and counter without the projection — queue-and-view
divergence, in the code whose comment said it could not happen.

**S4d — the engine on the port ✅ done.** `queue.ts`, `flush.ts`, `pull.ts` and
`inbox.ts` now go through `LocalStore`. `tests/offline/engine-on-sqlite.test.ts`
swaps the implementation and drives the real paths — enqueue, sequential flush,
the rejected inbox, retry, hydration — proving the engine is storage-agnostic
rather than asserting it.

The port grew `markSynced` in the process: stamping the sync time and clearing
the last error are one call, because a successful sync and a stale error on the
diagnostics sheet must not be able to coexist, which is exactly what happens
when a caller remembers one and forgets the other.

Rewiring also dropped a guard, and the existing suite caught it:
`discardRejected` must apply only to *rejected* rows. Without the status check
a stray call deletes queued work that has never been sent.

Specific things to get right, each of which the IndexedDB version already
handles and a fresh implementation tends not to:

- `enqueue` is one `BEGIN`/`COMMIT`: mint seq, write outbox, advance counter,
  write projection (invariant 5).
- A missing or corrupt sequence counter floors from the highest seq still in
  the outbox — **never** from zero.
- An unreadable row is quarantined with its raw value, not thrown past. One bad
  record must not block every mutation behind it.
- Quota exhaustion surfaces as `StorageFullError` with the transaction aborted
  whole, so no sequence number is consumed.
- The envelope migration ladder runs on read and persists the upgrade.
- `discardRejected` bumps the cleared counter, or the integrity check later
  reports the user's own deletion as data loss.

*Exit: `tests/offline/**` green against the SQLite implementation, in Node.*

### S5 — Vite + Capacitor shell

**S5a — the client moves into `apps/app` ✅ done.** `db/`, `sync/` and `read/`
now live in the app package; the Next app imports them. Same shape as S3a: move
first, where it is verifiable, then stand up the new shell against code that is
already in place.

Components and hooks stay in `src/client` for now. They are React and Next
still renders them, so moving them buys nothing until Vite can serve them —
and moving them early would mean the Next app importing its own screens across
a package boundary for no gain.

The `no-unused-vars` convention block had never been extended past
`packages/*`, so the moved code came back with warnings the rest of the repo
does not produce. Same failure as always, caught by the same habit of reading
the counts.

*Exit, met: 379 unit tests, 6 e2e including the Phase 2 exit gate, build, lint,
typecheck, guard scan (82 files).*

**S5b — the Vite client ✅ done.** Entry, `vite.config.ts`, the components and
styles moved across, and `pnpm build:app` producing a static bundle — 320 kB of
JS, 16 kB of CSS.

Both shells now render the same modules. Next imports them from the package and
`main.tsx` mounts them; the only thing that differs is where they mount, which
is the one genuine difference between a server-rendered page and a static
bundle in a WebView.

The package's `exports` map needed explicit per-directory patterns. A fallback
array (`["./src/*.ts", "./src/*.tsx"]`) reads well and Vite honours it, but
webpack does not follow it for wildcards, so the Next build could not resolve a
single component. Worth knowing before the same trick is reached for again.

`CLIENT_DIRS` needed no change: S2 pre-armed it with `apps/app/dist` before that
directory existed, so the Vite bundle came under the secret scan the moment it
appeared — 13 assets became 16 with nothing to remember.

*Exit, met: 379 unit tests, 6 e2e including the Phase 2 exit gate, both builds,
lint, typecheck, guard scan, secret scan across both outputs.*

**Sign-out on the Vite entry is deliberately partial.** It clears the device,
which is the half that matters for a shared barn tablet (C5). It does not
revoke the refresh token, because there is no token client on this entry to
hold one — when that lands it calls `POST /auth/logout`, which S3b already
built and tested.

**S5c — the native shell — built, not yet verified.** Capacitor 8:
`capacitor.config.ts`, the committed `android/` project (53 files; the
template's own `.gitignore` already excludes the copied bundle, the generated
config and the Gradle build directories), `openCapacitorSqlDriver`, platform
selection on the Vite entry, and resume/network triggers via `@capacitor/app`
and `@capacitor/network`.

**This is the first stage that cannot be finished in this environment.** The
code is written, typechecked, linted and bundled, and `pnpm cap:sync` copies it
into the native project — but nothing here can install an APK. The exit
condition below is the developer's to meet, and until they do, S5c is *written*
rather than *done*.

Three decisions worth recording:

*The device driver mirrors `tests/support/sqlite.ts` statement for statement,*
including the serialised transaction chain and the refusal to nest. The two
drivers are held to one suite, so any behaviour that differs between them is
behaviour the suite cannot see — which makes it precisely what surfaces on a
handset at 6am with a morning's counts queued. Two things are deliberately
*not* mirrored: `journal_mode = WAL` and `synchronous = FULL`, which is what
keeps a committed transaction committed through an Android force-stop. Under
`node:sqlite` in a process that exits cleanly they would prove nothing; here
they are the whole claim S6 tests.

*The plugin wraps `run` and `execute` in their own transaction by default,* and
every call passes `transaction: false`. Left on, each statement inside our
`BEGIN` opens a nested one and invariant 5 — outbox row and projection write
committing as a unit — quietly stops holding.

*The driver is dynamically imported.* A static import would pull the sqlite
plugin into the browser bundle, where it cannot work; the split also keeps
`capacitor-driver.ts`, the only file allowed to touch the plugin, out of every
build with no plugin to touch. `pnpm build:app` shows it as its own 15 kB
chunk, which is the check that this stayed true.

*Exit: debug APK installs on a device and shows an authenticated screen —
Phase 1's exit gate under D8. Not yet met.*

### S6 — Re-earn the Phase 2 exit gate on hardware

Airplane mode → 50 mutations → **force-stop** → reopen → reconnect → zero loss,
zero duplicates, and a second device reaching identical state from `/snapshot`.

Not transferable from the Chromium run. D9 changes the durability
characteristics the gate was proving, and a `SIGKILL` against native SQLite is
a different question from one against IndexedDB.

*Exit: the gate passes on a real device, recorded.*

### S7 — Delete the old stack

Only now: Next.js, the service worker and manifest, `client/db/open.ts`,
`migrate.ts`, `lock.ts`, `storage.ts`, Auth.js, and the seven dependencies.

Last, because until S6 passes, the IndexedDB engine is the only implementation
known to survive a process kill — and deleting it earlier is how a migration
ends up with no working state and no way back.

---

## 5. The gap this plan does not close

**There is no automated device gate.** The Playwright harness could kill a real
browser process against a real on-disk profile; the equivalent for a Capacitor
app needs an emulator in CI, and none is configured. Until it is, S6 is a
manual check — which means it can rot, exactly as `db:indexes` and `db:seed`
rotted while nothing invoked them.

Treat automating S6 as part of Phase 4 hardening, not as optional polish. A
durability gate nobody runs is a durability claim nobody has tested.
