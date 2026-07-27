# Steading — Master Development Plan & Security Rubric

**Version:** 3.0 — Capacitor rewrite
**Status:** Pre-implementation spec
**Name:** Steading — the farmhouse and its working buildings taken together. Birds, iron, and chores in one place.

**Stack**
- **Client:** Capacitor 8 · Vite · React · TypeScript (strict) · SQLite (`@capacitor-community/sqlite`)
- **Server:** Fastify · MongoDB · JWT access + refresh tokens
- **Target:** Android first. iOS is a build target, not a rewrite.

**Companion docs:** `UX-SPEC.md` (interface and voice) · `COMPETITIVE-ANALYSIS.md` (why features exist) · `PHASE-1-SPEC.md` (what to build first) · `../CLAUDE.md` (invariants for Claude Code)

---

## 0. Load-Bearing Decisions

Settled before code, because retrofitting any of them is a rewrite.

| # | Decision | Rationale |
|---|---|---|
| D1 | **All entity IDs are client-minted ULIDs.** The server never mints an `_id` for a syncable entity. | Offline records must reference each other before sync; replayed batches must be no-ops. |
| D2 | **Tenancy scoping is a mechanism, not a policy.** All collection access goes through `scoped(orgId)`; direct `db.collection()` fails lint and CI. | "Every query must include orgId" is unenforceable by review. |
| D3 | **High-volume records are append-only events, not CRUD rows.** | Immutable observations cannot conflict. Sync becomes insert-if-absent. Free audit history. |
| D4 | **Cached claims gate local UX only.** The server re-authorizes identity, org, and role on every mutation at flush. | A client can always lie — doubly so when the bundle ships inside an APK. |
| D5 | **ID guessability is not a security control.** Authorization is org + role scoping. | ULIDs and ObjectIDs are both timestamp-prefixed and semi-sequential. |
| D6 | **Client clocks are recorded, never trusted.** Order by `clientSeq` per device and `serverTs` globally. | Device clocks drift badly across long offline periods. |
| D7 | **Single-farm-first tenancy.** `orgId` and the scoped layer from day one; org invites, billing, and cross-org admin deferred. | Keeps the isolation shape with none of the multi-tenant product tax. |
| **D8** | **Native shell, not a PWA.** Capacitor over a WebView, Android first. | The product's promise is that a log taken in the coop survives. Browser storage is a bucket the OS may evict; the app sandbox is not. Also unlocks haptics, the native camera, and resume-triggered flush. |
| **D9** | **SQLite is the client database, and the UI reads nothing else.** Network results land in SQLite first, then render. | Real transactions mean the queue and the local view cannot diverge — the failure IndexedDB made hard to prevent. One rendering path online and offline. |
| **D10** | **The client is a static bundle; the server is a separate Fastify service.** No SSR, no server components, no framework API routes. | A Capacitor app is static files in a WebView with no runtime server. Next.js would be paying framework cost for benefits that don't exist here. |

---

## 1. Development Plan

### Phase 1 — Foundation, Tenancy, and a Shell That Boots
pnpm workspace with `apps/app`, `apps/api`, `packages/contracts`. Fastify with the `scoped()` data layer, `orgId`-leading indexes, the ESLint guard, and token auth (short access JWT + rotating refresh). Vite + React client that builds, wraps in Capacitor, and launches on an Android device showing an authenticated screen.

**Exit gate:** the multi-tenant isolation suite passes, and a signed debug APK runs on real hardware. Both before the second feature exists.

### Phase 2 — The Offline Engine
SQLite schema and migrations, the mutation log, transactional enqueue-plus-projection, sequential flush, idempotent server upsert, pull sync via `/snapshot`, the rejected-mutations inbox, and the diagnostics sheet.

**Exit gate:** airplane mode → 50 mutations → force-stop the app → reopen → reconnect → zero loss, zero duplicates, and a second device reaches identical state from `/snapshot`.

### Phase 3 — Core Domain
Events first (egg collection, feed, mortality, predator, hour readings), then mutable entities (flocks, birds, equipment, maintenance, tasks, inventory), then the native camera and deferred photo upload.

The charm layer (milestones, streaks, leaderboard, spot illustrations) unlocks here and **not before Phase 2's exit gate passes**. Design tokens and the arch motif land in Phase 1 — those are decisions every component inherits.

### Phase 4 — Hardening & Release
Redis rate limiting, refresh-token rotation and revocation, envelope schema migration, backup/export, destructive-op confirmation, OTA update channel for the web layer, Play Store release track, and performance passes on a low-end device.

---

## 2. Feature Outline

### Identity & Access
- **Token auth** — short-lived access JWT carrying `sub`, `orgId`, `role`; long-lived rotating refresh token. Both in Capacitor secure storage, never in SQLite.
- **Long-offline tolerance** — refresh survives weeks without a connection. An expired access token never blocks local logging; it only delays flush.
- **RBAC** — Owner/Admin vs. Farm Hand. Enforced server-side; client enforcement is UX only.
- **Tenant isolation** — every document carries `orgId`; every access path is scoped.
- **Session hygiene** — the SQLite database is dropped and recreated on logout **and on org switch**.

### Poultry & Livestock
- **Multi-species from the schema up** — poultry (chickens, ducks, geese, turkeys, quail, guinea fowl, pigeons), ratites (emu, ostrich, rhea), ruminants and camelids (goats, sheep, cattle, alpacas, llamas), plus pigs, rabbits, donkeys, horses, and free-text `other`. Smallholdings are mixed; a model covering only poultry makes most of a working farm invisible. Poultry keeps the deepest features because that is where the wedge is, not because it is the only stock supported.
- **Species-aware vocabulary** — the UI says herd, drove, or gaggle by species. `flock` is the wire name only. Calling a cattle herd a flock tells the keeper the app was not built for them.
- **Flock management** — counts, breed profiles, integration timelines. *(mutable)*
- **Individual animal records** — photo, breed, traits, birth or hatch date, weights, tag. **Archive, never delete.** *(mutable)*
- **Production events** — daily egg collection by flock **or by individual bird**; feed consumption. *(append-only)*
- **Mortality log** — cause, trend, and **cull weights** for meat-yield math. *(append-only)*
- **Production log** — milk, fibre, and honey by group or individual. *(append-only)* Without it, ruminant support is head count and mortality only, which is not support. Records a volume, not a supply chain — dairy *workflows* stay out of scope.
- **Threat log** — predator sightings, time of day, losses. *(append-only)*
- **Health & medication** — treatments with **withdrawal-period tracking**. An active egg/meat withdrawal raises a persistent banner on the collection screen and requires confirmation to log through. *(Competitive wedge — requested by Flockstar users, unmet everywhere.)*
- **Breed presets** — expected lay rates and mature weights pre-filled on selection.
- **Leaderboard** — per-bird laying ranking by month.

### Equipment & Infrastructure
- **Fleet register** — tractors, implements, trailers, specs, serials.
- **Equipment presets** — select make/model, get factory service intervals pre-populated.
- **Hour-meter readings** — *(append-only)*; rejected if below the last recorded value.
- **Maintenance schedules** — **dual-trigger: engine hours OR calendar date**, whichever comes first.
- **Usage-rate forecasting** — "due in ~9 days at 1.4 h/day," so parts can be ordered in time.
- **Document attachments** — receipts, photos, PDF operator's manuals.
- **Inspection checklists** — custom per equipment type, completable offline.
- **Troubleshooting log** — searchable symptom → resolution history.
- **Machine history export** — full service record for one machine, for resale.

### Operations & Logistics
- **Daily task queues** — morning routine, feeding, structural checks; recurring templates.
- **Inventory** — feed levels, parts, reorder thresholds. **Part stock is linked to upcoming service intervals** so alerts fire before the window.
- **Cost tracking** — enough for **cost per egg** and cost per bird. Not accounting.
- **Photo capture** — native camera, file stored in the app sandbox, row in SQLite, deferred upload.
- **Sync dashboard** — network state, queue depth, last successful sync, rejected items, copyable diagnostics.
- **Reporting** — production graphs at week / month / quarter / year.
- **Import & export** — CSV in (migrating off a spreadsheet or Flockstar) and CSV/JSON out (Schedule F, no lock-in).

### Explicitly Out of Scope
Crop planning and field mapping, satellite/weather imagery, e-commerce and CSA orders, double-entry accounting, GPS telematics hardware, dairy workflows.

### Deferred to v2 (designed for, not built)
Incubation and hatch runs, fertility rates per pairing, three-generation pedigrees. iOS build target.

---

## 3. Overarching Rubric

| Domain | Pass Criteria |
|---|---|
| Architecture | Data access exists in exactly one layer per side. Contracts are shared, never redeclared. UI reads only the local projection. |
| UX & Reliability | Cold launch under 2s on a low-end Android. Network state and queue depth always visible. |
| Field Usability | Cold start to logged egg count in ≤5s, gloved, offline. Tap targets ≥56px. Body text ≥7:1 contrast. All release gates in `UX-SPEC.md` pass. |
| Comprehension | An untrained person logs a full day's chores with no instruction. Basic mode hides every optional field. *This is the competitive differentiator — treat a regression as P1.* |
| Data Flow | Mutations are atomic, transactional, and idempotent. Conflicts and rejections surface to the user, never silently drop. |
| Code Quality | `strict: true`, zero `any`, zero non-null assertions on external data. |
| Observability | A stuck queue is diagnosable on the device with no network. |
| Recoverability | Full export works offline. Destructive operations require typed confirmation. |

---

## 4. Sensitive Area Rubrics

### A — Offline Data Integrity (Sync Engine)
1. **Durability** — mutations live in the app sandbox, not browser storage. Survive force-stop, reboot, and OS memory pressure. Verified on hardware, not in a dev server.
2. **Atomicity** — enqueue and local projection write share one transaction. A failure rolls back both. The queue and the view cannot diverge.
3. **Idempotency** — a batch replayed N times produces exactly one record, via ULID `_id` and `$setOnInsert`.
4. **Ordering** — sequential flush by `clientSeq`, never parallel. Global order by `serverTs`.
5. **Conflict resolution** — updates targeting deleted or concurrently-modified records are logged as conflicts and routed to the inbox, never silently applied or dropped.
6. **Rejected-mutations inbox** — any rejection (role, validation, conflict) is user-visible and re-editable. Work never evaporates.
7. **Pull sync** — a fresh install or second device rebuilds full state from `/snapshot`, then resumes incrementally.
8. **Envelope versioning** — every mutation carries `schemaVersion`. Client migrates on open; server accepts N−1. A device offline three weeks across two releases syncs cleanly. **Sharper here than on the web: an APK can lag arbitrarily far behind if the user never updates.**
9. **Bounded fail-open** — if Redis is unavailable, authenticated sync proceeds, still gated by token, role, Zod, and a hard batch cap. Never extends to authorization.

### B — Security & API Defense
1. **Input validation** — 100% of payloads parsed through strict Zod schemas at the route boundary.
2. **Token discipline** — short access lifetime, rotating refresh, server-side revocation on logout. Tokens in secure storage only.
3. **Rate limiting** — auth routes **fail closed** on IP; authenticated sync **fails open** per A9.
4. **No secrets in the bundle** — the client ships inside an APK and is trivially unpacked. CI greps the build output.
5. **Authorization at every access** — role re-derived from the token on every mutation, never read from the payload.
6. **Transport** — TLS enforced; cleartext traffic disabled in the Android network security config.
7. **Upload safety** — photos size-capped, content-type sniffed server-side, stored outside the API origin.

### C — Multi-Tenant Data Isolation
1. **Structural scoping** — no collection handle is reachable outside `apps/api/src/db/`. Lint- and CI-enforced.
2. **Token binding** — `orgId` comes from the verified token only. A payload-supplied `orgId` is a hard 400.
3. **Index discipline** — every collection has a compound index led by `orgId`.
4. **Isolation test suite** — per endpoint, org A attempting org B's document ID returns 404 (not 403 — no existence disclosure). Runs on every PR.
5. **Device residue** — logout or org switch drops and recreates the local database, and clears cached photo files.
6. **Non-control** — ID format is *not* an isolation mechanism and is not listed as one.

---

## 5. Open Questions

- Photo storage target: S3/R2 vs. self-hosted. Affects Phase 3 upload.
- API hosting: same box as your other services, or a managed host?
- Does a Farm Hand write events (egg counts) while staying read-only on entities? Recommended: yes — it's the main reason a second user exists.
- Retention for event collections: unbounded, or roll up after N years?
- iOS: needs a Mac or cloud CI. Deferred, not designed out.
