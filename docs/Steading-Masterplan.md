# Steading — Master Development Plan & Security Rubric

**Version:** 2.0
**Status:** Pre-implementation spec
**Name:** Steading — the farmhouse and its working buildings taken together. Birds, iron, and chores in one place.
**Stack:** Next.js (App Router) · TypeScript (strict) · MongoDB · Auth.js (JWT) · IndexedDB · Vercel · Upstash Redis

**Companion docs:** `docs/UX-SPEC.md` (interface and voice) · `docs/COMPETITIVE-ANALYSIS.md` (why features exist) · `docs/PHASE-1-SPEC.md` (what to build first) · `CLAUDE.md` (invariants for Claude Code)

---

## 0. Load-Bearing Decisions

These are decided before code, because retrofitting any of them is a rewrite.

| # | Decision | Rationale |
|---|---|---|
| D1 | **All entity IDs are client-minted ULIDs.** Server never mints an `_id` for a syncable entity. | Offline records must reference each other before sync; replayed batches must be no-ops. |
| D2 | **Tenancy scoping is a mechanism, not a policy.** All collection access goes through `scoped(orgId)`. Direct `db.collection()` outside `server/db/` fails lint and CI. | "Every query must include orgId" is unenforceable by review. |
| D3 | **High-volume records are append-only events, not CRUD rows.** Egg counts, feed, mortality, predator sightings, hour readings. | Immutable observations cannot conflict. Sync becomes insert-if-absent. Free audit history. |
| D4 | **Offline auth gates local UX only.** The server re-authorizes every mutation (identity, org, role) at flush time. | A client can always lie. Cached claims are a convenience, never a control. |
| D5 | **ID guessability is explicitly not a security control.** Authorization is org + role scoping. | ObjectIDs and ULIDs are both timestamp-prefixed and semi-sequential. |
| D6 | **Client clocks are recorded, never trusted.** Ordering is `clientSeq` per device (intra-device) and `serverTs` (global). | Device clocks drift badly across long offline periods. |
| D7 | **Single-farm-first tenancy.** Build `orgId` + the scoped layer on day one; defer org invites, billing, and cross-org admin until a second farm actually signs up. | Keeps the isolation shape with none of the multi-tenant product tax. Revisit if this becomes a SaaS. |

---

## 1. Development Plan

### Phase 1 — Foundation & Tenancy Primitives
Next.js App Router, MongoDB connection pooling, Auth.js with **JWT session strategy** (not DB sessions — required for offline claims), the `scoped()` data layer, shared Zod contracts, ULID utilities, `orgId`-leading compound indexes on every collection, and the ESLint guard banning raw collection access.

**Exit gate:** the multi-tenant isolation test suite exists and passes *before the second feature is written*.

### Phase 2 — Offline Engine
IndexedDB stores, the mutation log, Service Worker (app shell precache + network-first API), sequential flush ordered by `clientSeq`, idempotent server upsert, the **rejected-mutations inbox**, `navigator.storage.persist()`, quota accounting, and the sync/diagnostics dashboard.

**Exit gate:** airplane-mode → 50 mutations → hard device restart → reconnect → zero loss, zero duplicates.

### Phase 3 — Core Domain
Events first (egg collection, feed, mortality, predator, hour readings), then mutable entities (flock profiles, equipment, tasks), then photo capture and deferred upload.

The charm layer (milestones, streaks, leaderboard, spot illustrations) unlocks here and **not before Phase 2's exit gate passes**. Design tokens and the arch motif land in Phase 1 — those are decisions every component inherits, not features.

### Phase 4 — Hardening
Redis rate limiting, origin/CSRF verification, envelope schema migration, quota-exhaustion UX, backup/export, destructive-op confirmation, Core Web Vitals.

---

## 2. Feature Outline

### Identity & Access
- **Cached-claims offline mode** — session claims cached for local UX gating; server re-authorizes on flush.
- **RBAC** — Owner/Admin vs. Farm Hand (read-only or write-limited). Enforced server-side; client enforcement is UX only.
- **Tenant isolation** — every document carries `orgId`; every access path is scoped.
- **Session hygiene** — IndexedDB is wiped on logout **and on org switch**.

### Poultry & Livestock
- **Multi-species from the schema up** — chickens, ducks, quail, turkeys, geese, other.
- **Flock management** — counts, breed profiles, integration timelines. *(mutable entity)*
- **Individual bird records** — photo, breed, traits, hatch date, weights. **Archive, never delete** — history survives. *(mutable entity)*
- **Production events** — daily egg collection logged **by flock or by individual bird**; feed consumption. *(append-only)*
- **Mortality log** — separate from flock count; cause, trend, and **cull weights** for meat-yield math. *(append-only)*
- **Threat log** — predator sightings, time of day, losses. *(append-only)*
- **Health & medication** — treatment records with **withdrawal-period tracking**. An active egg/meat withdrawal raises a persistent banner on the collection screen and requires confirmation to log through. *(Competitive wedge — requested by Flockstar users, unmet by every competitor.)*
- **Breed presets** — expected lay rates and mature weights pre-filled on breed selection.
- **Leaderboard** — per-bird laying ranking by month. Cheap to build, drives daily logging.

### Equipment & Infrastructure
- **Fleet register** — compact utility tractors, implements, trailers, specs, serials.
- **Equipment presets** — select make/model, get factory service intervals pre-populated. Removes the setup burden that kills adoption.
- **Hour-meter readings** — *(append-only)*; the basis for real maintenance intervals. Rejected if below the last recorded value.
- **Maintenance schedules** — **dual-trigger: engine hours OR calendar date**, whichever comes first.
- **Usage-rate forecasting** — "due in ~9 days at 1.4 h/day," not just "overdue." Lets parts be ordered before the window.
- **Document attachments** — receipts, photos, and PDF operator's manuals per machine.
- **Inspection checklists** — custom per equipment type, completable offline.
- **Troubleshooting log** — searchable symptom → resolution history, photo-attachable.
- **Machine history export** — full service record for a single machine, for resale.

### Operations & Logistics
- **Daily task queues** — morning routine, feeding, structural checks; recurring templates.
- **Inventory** — feed levels, replacement parts, reorder thresholds. **Part stock is linked to upcoming service intervals** so a low-stock alert fires before the service window, not after.
- **Cost tracking** — enough for **cost per egg** and cost per bird. Not accounting; no double-entry.
- **Photo capture** — offline Blob in IndexedDB, deferred multipart upload, quota-aware.
- **Sync dashboard** — online state, queue depth, last successful sync, rejected items, copyable diagnostics.
- **Reporting** — production graphs at week / month / quarter / year.
- **Import & export** — CSV in (migrating off Flockstar or a spreadsheet) and CSV/JSON out (Schedule F, no lock-in).

### Explicitly Out of Scope
Crop planning and field mapping, satellite/weather imagery, e-commerce and CSA orders, double-entry accounting, GPS telematics hardware, dairy workflows. Farmbrite owns these and we will not beat it there.

### Deferred to v2 (designed for, not built)
Incubation and hatch runs, fertility rates per pairing, three-generation pedigrees. Schema should not preclude them.

---

## 3. Overarching Rubric

| Domain | Pass Criteria |
|---|---|
| Architecture | Clear server/client component split. Data access exists in exactly one layer. Modular, reusable hooks. |
| UX & Reliability | Instant shell load. Offline state and queue depth always visible. Core Web Vitals green on mid-tier Android over 3G. |
| Field Usability | Cold start to logged egg count in ≤5s, gloved, offline. Tap targets ≥56px. Body text ≥7:1 contrast. All release gates in `docs/UX-SPEC.md` pass. |
| Comprehension | An untrained person logs a full day's chores with no instruction. Basic mode hides every optional field. *This is the competitive differentiator — treat a regression here as a P1.* |
| Data Flow | Mutations are atomic and idempotent. Conflicts and rejections surface to the user, never silently drop. |
| Code Quality | `strict: true`, zero `any`, zero non-null assertions on external data. Complex functions documented. |
| Observability | A stuck queue is diagnosable from inside the app, on the device, with no network. |
| Recoverability | Full export works offline. Destructive operations require typed confirmation. |

---

## 4. Sensitive Area Rubrics

### A — Offline Data Integrity (Sync Engine)
1. **Persistence** — mutations survive hard refresh, tab kill, and device restart while offline.
2. **Storage durability** — `navigator.storage.persist()` requested on first write; quota checked before photo capture; eviction risk surfaced to the user. *(Safari evicts non-persisted IndexedDB after ~7 idle days.)*
3. **Idempotency** — a batch replayed N times produces exactly one record. Enforced by ULID `_id` + `$setOnInsert` upsert, verified by test.
4. **Ordering** — flush is sequential per device, ordered by `clientSeq`. Never parallel. Global ordering uses `serverTs`.
5. **Conflict resolution** — updates targeting deleted or concurrently-modified records are logged as conflicts and routed to the inbox, never silently applied or dropped.
6. **Rejected-mutations inbox** — any server rejection (role, validation, conflict) is user-visible and re-editable. Work never evaporates.
7. **Envelope versioning** — every queued mutation carries `schemaVersion`. Client migrates on open; server accepts N−1. A device offline for three weeks across two deploys syncs cleanly.
8. **Bounded fail-open** — if Redis is unavailable, authenticated sync proceeds; it remains gated by session, role, Zod, and a hard batch-size cap. Fail-open never extends to authorization.

### B — Security & API Defense
1. **Input validation** — 100% of payloads parsed through strict Zod schemas (`.strict()`, no passthrough) at the route boundary.
2. **Origin verification** — all state-changing requests validate `Origin` against `Host` and require a custom header.
3. **Rate limiting** — public auth routes **fail closed** on IP; authenticated sync **fails open** per 8 above. The two policies are stated together to prevent drift.
4. **Secret hygiene** — zero sensitive values behind `NEXT_PUBLIC_`. CI greps the build output.
5. **Authorization at every access** — role checked server-side on every mutation, re-derived from the session, never read from the payload.
6. **Upload safety** — photo uploads size-capped, content-type sniffed server-side, stored outside the app origin.

### C — Multi-Tenant Data Isolation
1. **Structural scoping** — no collection handle is reachable outside `server/db/`. Lint-enforced, CI-enforced.
2. **Session binding** — `orgId` is derived from the server session only. A payload-supplied `orgId` is a hard 400, not a fallback.
3. **Index discipline** — every collection has a compound index led by `orgId`.
4. **Isolation test suite** — for each endpoint, org A's session attempting org B's document ID returns 404 (not 403 — no existence disclosure). Runs on every PR.
5. **Client-side residue** — org switch or logout clears all IndexedDB stores and cached Blobs.
6. **Non-control** — ID format is *not* an isolation mechanism and is not listed as one.

---

## 5. Open Questions

- Photo storage target: Vercel Blob vs. S3/R2. Affects Phase 3 upload path.
- Retention policy for event collections: unbounded, or roll up after N years?

---

## 6. Resolved Questions

Kept rather than deleted: the reasoning is the useful part, and a rejected idea
that isn't written down gets re-proposed every few months.

### Q1 — Redundant local storage for offline durability. **Rejected.**

*Proposed:* write every record to two local stores, compare them on open, and
offer a full re-download when they diverge.

The mechanism does not address the failure it is aimed at, and it makes that
failure more likely:

| # | Problem |
|---|---|
| 1 | **The failure is correlated, so redundancy doesn't pay.** Browser eviction is per-origin: IndexedDB, Cache Storage, and localStorage are discarded together. A second copy inside the same origin does not survive the event that destroys the first. |
| 2 | **It raises the eviction probability.** Eviction is driven by how much the origin is using. Doubling consumption — with photos, the dominant consumer — increases the risk of exactly the event being defended against. |
| 3 | **It spends the release gates.** Every write doubles and a compare-on-open is an O(n) read at cold start, against R1 (≤3 taps, ≤5s from cold launch) and R6 (nothing waits). |
| 4 | **The recovery path contradicts its trigger.** "Re-download everything" needs the network, but divergence is detected offline — the condition in which the app is expected to run. |

**The reframe.** The server is already the second copy, and it is the only one
stored independently. Everything flushed is durable server-side, so the real
exposure is the *unflushed window* — mutations recorded since the last
successful sync, typically one morning's chores and a few KB. The problem is
not "store everything twice", it is "shrink and protect that window", which
the plan already does:

- `navigator.storage.persist()` (§4 A2) is the actual defence against eviction — a persisted origin is not evicted under pressure. One API call, and the only lever that materially moves this.
- D1 + D3 + `$setOnInsert` make re-sending free and non-duplicating, so the cheap mitigation is to flush *more eagerly* — redundancy over the network, where the copy is genuinely independent. Idempotency is what buys that.
- Phase 2's exit gate (50 mutations → hard restart → zero loss) is what proves durability. Local redundancy would let that gate be passed without earning it.

**Salvaged from the proposal** — three parts are worth keeping, none of which
require a second store:

1. **Cheap loss detection.** *(Built — `checkIntegrity()` in `src/client/sync/queue.ts`, surfaced in the diagnostics sheet.)* `clientSeq` increments exactly once per enqueue, so it doubles as the lifetime enqueue count; subtracting what the server acknowledged gives the expected queue depth, and a shortfall means records vanished. Two integers, O(1), detecting what comparing two full copies would have detected. Note that applied mutations are removed from anywhere in the range, so the outbox is legitimately non-contiguous — counting is correct where hunting for holes in the sequence would produce false alarms.
2. **Offline export as the real second copy.** Recoverability already requires a full offline export. Writing that snapshot out through the file system or share sheet places it *outside* the origin, which is the only version of this idea that survives eviction.
3. **A manual "re-download everything"** in the diagnostics sheet — an operator tool for a device whose local state is suspect, not an automatic integrity system.

**The one honest counter-argument:** a botched IndexedDB migration in our own
code *is* a failure mode independent of eviction, and is the single case a
second store would cover. It is cheaper to address at the source — A7 envelope
versioning, plus never destructively migrating an append-only log — than by
carrying a parallel store and its reconciliation logic year-round.

### Q2 — Farm Hand write access to events. **Yes.**

A Farm Hand may create every append-only observation (eggs, feed, mortality,
predator sightings, hour readings) and is read-only on the entities that define
the farm (flocks, equipment, maintenance schedules). Recording what happened is
the main reason a second user exists; defining what things *are* is not.

Two exceptions, both required for a hand to work a morning: completing an
assigned chore (`task:update`) and attaching a photo (`photo:create`). Neither
lets them define new work — only discharge and document work already assigned.
Implemented in `src/lib/contracts/roles.ts`.
