# Steading — D8–D10 Migration Plan

How the Next.js + IndexedDB implementation becomes the Capacitor + SQLite +
Fastify one described in `Steading-Masterplan.md`.

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

`src/client/db/port.ts` defines `LocalStore` — the storage dependency of the
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
`@steading/contracts` instead of `@/lib/contracts`. Regenerate
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

### S2 — Remaining guards repointed, before anything else moves

`eslint.config.mjs` moves to the two-project form in `PHASE-1-SPEC.md` T6
(`apps/api/src/**` for the collection guard, `apps/app/src/**` for the storage
guard, which also gains the `no-restricted-globals` ban on `localStorage`,
`sessionStorage` and `indexedDB`), and `CLIENT_DIRS` in `check-bundle-secrets`
follows the build output from `.next/static` to the Vite `dist`.

This stays early, because everything after it moves code the guards watch. Both
scripts now **fail when they scan nothing**, so a miss is loud — but only if
they are aimed correctly to begin with.

*Exit: guards fail on a deliberate violation in each new location; both scripts
report non-zero counts.*

### S3 — Fastify API alongside the Next routes

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

The real work. Implement `LocalStore` against SQLite: schema, migrations,
and the transactional `enqueue`.

Retarget `tests/offline/**` at the port interface and run the suite against
**both** implementations. Identical results is the bar.

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

Vite entry, `capacitor.config.ts`, committed `android/` project. Mount the
existing screens. Resume- and network-triggered flush via `@capacitor/app` and
`@capacitor/network`.

*Exit: debug APK installs on a device and shows an authenticated screen —
Phase 1's exit gate under D8.*

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
