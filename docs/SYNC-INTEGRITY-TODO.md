# Sync integrity — outstanding work

**Written 14 August 2026, extended 15 August, and verified against the code on
15 August. No code has been changed.** This file is a work list, not a spec.
Sync integrity is the bulk of it and gives it its name; the build and
infrastructure section at the end came from a separate audit. Each item was
either confirmed by reading the code named in it, or is carried on trust and
labelled as such — the distinction is the point of the file and should survive
any edit to it.

The headline is one sentence, and P0 through P2 are its consequences:

> **The server stores attempted commands, projects them conditionally, and
> clients replay them as unconditional truth.**

Three meanings live in the `mutations` collection — the audit log, the thing
that decides domain state, and the replication feed — and they are not the same
set of rows. Every P0 below is a symptom of that one confusion. None of them
needs an architectural change; the package boundaries are in the right places
and `scoped()` still holds the tenant line. The log just needs to distinguish
*attempted* from *accepted*.

**Multi-device rollout should wait for P0-2.** P0-1 and P0-3 are real and worth
fixing, but neither is reachable on the shipped app without a hand-built client,
a clock step, or concurrency the one-box deployment does not produce — see the
verification blocks under each. Single-device offline use is unaffected by all
three.

> **P0-2 and P0-1(a) have shipped, as one change.** The log now carries an
> `outcome` — `pending` on insert, the projection's own decision after — the
> feed withholds everything that did not change domain state, and a duplicate
> projects the stored envelope instead of the request. They were not two items:
> the same field and the same re-projection path solve both, and either alone
> leaves the other worse. `apps/api/src/sync/outcome.ts` is new;
> `apply.ts` and `snapshot.ts` changed; `tests/sync/outcome.test.ts` covers it.
> **Devices that already pulled a refused row still hold it** — the repair
> bullet under P0-2 is the outstanding half.

---

## How to read the status column

| | |
|---|---|
| **Confirmed** | The author read the code at the cited lines and reproduced the reasoning. Cited `file:line` refs are against `4064c89`. |
| **Trusted** | Reported by the audit, consistent with the code the author did read, but not independently walked. Triage before scheduling. |
| **Verified** | Re-derived from source in the 15 August pass against `3b37cc8`, by a reader told to try to refute it. Where that pass changed the finding, a **Verification** block says how. |

Every item below now carries a **Verification** block. An item with no
correction in its block held exactly as written; the blocks that matter are the
ones that move a severity or replace a prescription.

---

## What the verification pass changed

Twenty-four of twenty-five findings survived. The corrections that change what
somebody would *do*:

- **P0-1 is not a release blocker.** Its load-bearing sentence — "It changes,
  through our own UI" — is false. There is no correction editor in the app.
- **P0-3 is not a release blocker.** Both interleavings need concurrency the
  single-process box does not produce, or a clock step.
- **P0-2 is the one with live consequences**, and if anything it is understated.
- **Three of the prescriptions were wrong**, one of them dangerously: P0-1's
  "skip projection entirely" is a silent data-loss regression, P0-2's
  outcome-after-`project()` reintroduces the hole it closes, and P0-3's counter
  does not satisfy P0-3's own stated requirement.
- **Three defects appear nowhere in the original three audits.** They are
  recorded as N-1 to N-3.
- **The P3 photo bullet is itself mostly invented** — the failure mode this
  document's own provenance section warns about, inside this document.

---

# P0 — release blockers

**Only P0-2 is one.** The section keeps its name and its numbering because both
are referenced elsewhere; the re-ranking is recorded per item rather than by
renumbering.

## P0-1 · A duplicate mutation ID projects the *new* request

**Confirmed.** `apps/api/src/sync/apply.ts:122-139`.

The log write is `upsertOne({ _id: id }, { $setOnInsert: doc })`, so a replayed
ID leaves the stored envelope untouched — which is correct and is what
invariant A3 asks for. The next line then calls
`project(scope, claims, mutation, payload)` with the **current request's**
mutation and payload. The comment above it says the projection "is idempotent by
construction". That is true only while the payload for a given ID never changes.

**It changes, through our own UI.** `packages/core/src/db/sqlite-store.ts:499-515`
— `retryRejected(id, payload)` rewrites the payload in place and re-queues the
row under the same mutation ID. That is the "fix it and send it again" path out
of the rejected inbox.

Reproduction, entirely inside supported behaviour:

1. An hour reading below the last one recorded is logged at `apply.ts:122`, then
   refused at `projections.ts:180-186`. **The log row already exists, holding the
   wrong number.**
2. It lands in the rejected inbox. The keeper checks the meter and corrects it.
3. The corrected mutation is sent under the same ULID. `upsertedCount` is 0, so
   the log keeps the **wrong** reading; `project()` runs with the **corrected**
   one.
4. Mongo now has the right number, the log has the wrong one, and `/snapshot`
   ships the wrong one to every other device.

**Scope, which matters for the fix:** envelope and payload-schema rejections
return at `apply.ts:69-99`, *before* the log write, so retrying those is safe and
always has been. The divergence is specific to projection-stage outcomes — the
note-ownership rule, the hour-meter rule, and the missing/archived conflicts.

The same mechanism lets a buggy or hostile client reuse a known ID with a
different `targetId`, `op`, or payload and have it projected while the log shows
the original. That is a write with no audit row.

### Verification (15 August) — mechanism holds, reachability does not. **Re-ranked P2.**

**The step-2 sentence above is wrong, and it is the sentence the P0 ranking
rests on.** `apps/mobile/src/screens/InboxScreen.tsx:69` calls
`retryRejected(id)` with **no payload**. The screen offers exactly two actions,
"Send it again" (`:157`) and "Throw away" (`:162`), and contains no editor of
any kind. The payload-rewriting arm of `retryRejected` is reached only from
tests — `tests/offline/local-store.test.ts:368`, whose name *"replaces the
payload when the user edits before retrying"* describes a UI that was never
built, and `tests/offline/flush.test.ts:264`. A no-payload retry re-sends
byte-identical content through `toEnvelope` (`flush.ts:49-61`), so nothing
diverges. **"The keeper checks the meter and corrects it" cannot be performed on
the shipped app.**

Three things the original missed, two of which narrow it and one of which
widens it later:

- **Narrowing.** On a duplicate ID a `create` against an *existing* target is a
  `noop`, not a rewrite — `projections.ts:151-152` (append-only) and `:196-197`
  (mutable). So the divergence set needs either an `update` on a live mutable
  record, or a `create` whose target is **absent**. That is exactly why the
  hour-meter repro is the one that works: the first attempt was refused, so no
  `hourReadings` document exists and the retry takes `insert`.
- **Narrowing.** Cross-org ID reuse is already caught. `scoped.upsertOne` ANDs
  `orgId` into the filter (`db/scoped.ts:168-176`), so a foreign `_id` attempts
  an insert, hits duplicate-key 11000, and is rejected at `apply.ts:130-131` —
  and `tests/isolation/sync-tenancy.test.ts:177-190` covers it. Same-org reuse
  has no guard, but the caller already holds a token and a role permitting the
  write, so the gain is audit evasion, not authority — and even that is partial,
  since `apply.ts:171-175` still stamps `updatedBy`/`updatedByDevice` from the
  verified token.
- **Widening, and this is the one to watch.** `readOutboxBySeq` runs
  `migrateEnvelope()` on every queued row before it is sent
  (`sqlite-store.ts:570-578`). A mutation already logged server-side — response
  lost, or projection-rejected — and resent after a schema bump carries a
  *migrated* payload under the same ULID, and `apply.ts:32` accepts both N and
  N−1, so both versions get in. The ladder is empty today
  (`packages/core/src/db/migrate.ts:25`), so this is latent. **It is the path
  that turns P0-1 from theoretical into automatic the day v2 ships.**

Also: `retryRejected` rewrites the outbox payload without re-running
`projectOne` in the same transaction, so if that path were ever wired to a UI the
*local* projection would go stale too — against invariant 5, which the enqueue
path at `sqlite-store.ts:387-394` is careful about. And it JSON-stringifies the
payload straight in, bypassing the `payloadSchemaFor` validation `enqueue()`
enforces at `queue.ts:37-47`. Routing corrections through `enqueue()` fixes both
without new code.

**Test-gap claim is right in substance, wrong in citation** — see the corrected
test section at the end.

**Verdict:** real, cheap to fix, not a blocker. It is a loaded gun with no
trigger attached, and both the correction editor and the first envelope
migration attach one.

**To do** — *the first bullet as originally written is dangerous; see below.*

- [x] ~~On a duplicate ID, project from the **stored** envelope rather than the
      request — **or skip projection entirely** and return the stored terminal
      result. One change at `apply.ts:139`.~~
      **Corrected:** project from the **stored** envelope. Do **not** ship the
      skip-projection variant on its own — reasoning below.
- [x] The stored-envelope read is an external boundary (invariant 11). Re-parse
      `stored.payload` through `payloadSchemaFor(stored.entity, stored.op)`
      rather than casting, and decide what an unparseable stored row does. It
      should return `duplicate` without projecting, and log.
- [x] Take `entity`, `op` and `targetId` from the stored row too, not just the
      payload. `project()` reads all three (`apply.ts:158-161`); swapping only
      the payload fixes the least dangerous third of the bug and leaves a reused
      ID writing to a document the audit row does not name.
- [ ] Make `retryRejected` mint a **fresh ULID** for the corrected payload
      instead of rewriting in place, so a correction is its own command with its
      own audit row. Keep the link to the original for the inbox UI. **Defer
      until the correction editor is actually being built** — and note the size:
      the outbox primary key *is* the mutation id (`sqlite-store.ts:365-383`), so
      this needs a new terminal status (`superseded`, plus `supersededBy`), a
      migration on the additive ladder, and an audit of every status predicate —
      `readOutboxBySeq`'s `status != 'applied'` would otherwise resend it
      forever, plus `counts()`, `listRejected`, and `bumpCleared`, because
      `checkIntegrity` derives expected depth from enqueued-minus-cleared and a
      supersede that skips the counter is later reported as data loss.
- [ ] ~~Decide what a duplicate ID carrying a *different* envelope should be. It
      is not `duplicate`; it is a client bug or an attack, and it should be
      `rejected` and logged as such.~~
      **Corrected:** compare **identity**, not payload — `targetId`, `entity`,
      `op`, `deviceId`, `clientSeq`, `schemaVersion` against the stored row. A
      deep-equal of stored BSON against a freshly Zod-parsed payload produces
      false mismatches (defaults, Date-versus-string, absent-versus-undefined,
      key order), and `flush.ts:225-231` collapses anything that is not
      `applied`/`duplicate` into the rejected inbox — so a false mismatch is a
      farmer being told a correct record was refused. Log a warning with `orgId`
      and `deviceId`. Once the stored envelope is authoritative this is
      telemetry, not integrity; schedule it last.

**Why "skip projection entirely" must not ship alone.** The comment at
`apply.ts:136-139` is load-bearing. Lines 122 and 139 are two separate awaits
with nothing joining them, and standalone Mongo has no transaction to join them
with. Crash between them and the log row exists while the domain record does
not. The client got no HTTP response, so the row stays `queued`
(`flush.ts:112-116`) and is resent; on the resend `upsertedCount` is 0. If
projection is skipped, **nothing ever writes that record** — and the client is
told `duplicate`, which `resolveBatch` (`sqlite-store.ts:429-447`) treats
identically to `applied`: status flipped, `bumpCleared` incremented, row gone
from the outstanding set for good. Silent permanent loss on the happy path of a
process restart, and P2-1 restarts the API twelve times an hour. The variant
becomes correct only once a terminal outcome exists on the row (P0-2), because
then "duplicate with a terminal outcome" is proof the projection ran.

**Residual wart the stored-envelope fix does not close:** re-projecting a stored
envelope can produce a *different* decision than it did the first time, because
`decideProjection` is a function of current state. A replay of an applied
`update` against a record archived since returns `conflict`
(`projections.ts:209-214`), which `flush.ts:225-231` shows the farmer as a
refusal. That exists today; only returning the *stored terminal outcome* fixes
it, which is P0-2's field. This is the second place the two items turn out to be
one change.

## P0-2 · Rejected and conflicted commands replicate as accepted state

**Confirmed, and this is the worst of the three.** The chain is three files
long and every link is verifiable:

| Step | Where | What happens |
|---|---|---|
| 1 | `apps/api/src/sync/apply.ts:122-124` | The mutation is logged **before** `project()` at line 139 decides anything. Refused rows stay in the log for good. |
| 2 | `apps/api/src/sync/snapshot.ts:21-31` | `MutationDoc` has **no outcome field**, and `readSnapshotPage` applies no acceptance filter. Every row matching the cursor goes out. |
| 3 | `packages/core/src/db/sqlite-store.ts:715-726` | `applyPulled` calls `projectOne()` unconditionally on every row it receives. |

So a Farm Hand edits a note somebody else wrote. The server refuses it exactly
as intended at `projections.ts:112-125` — *"a hand editing somebody else's note
is not two people racing, it is one person doing something they are not allowed
to do"* — and that refused edit is then written into every **other** device's
SQLite. The hand's own phone shows it in the rejected inbox. Every other phone
on the farm shows it as the note.

The same shape, four ways:

- A lower hour reading is refused by the server and appears on every other device
  anyway, where it feeds the client-side service forecast.
- An update against an archived record conflicts server-side, but the client's
  `update` projection sets it live again — **the archive is undone on every
  device except the one that tried it.**
- A second `create` against an existing append-only target is a server no-op;
  clients overwrite their local record with the second payload.
- A first-time no-op reports `applied` to the caller though nothing was projected.

**This is not cross-tenant leakage.** `scoped()` holds the boundary and the
isolation tests still mean what they say. It is an authorisation and integrity
failure *inside* one farm, which is the harder kind to notice.

### Verification (15 August) — confirmed, all three links, and understated. **This is the blocker.**

Every cited ref is accurate at HEAD. The archive symptom is the sharpest and the
client half is worth naming precisely: `projectOne`
(`sqlite-store.ts:287-300`) writes `deleted = op === 'delete' ? 1 : 0` on every
row, so a pulled `update` unconditionally clears the deleted flag. The archive is
not merely "not re-applied" — it is actively undone.

Two of the four symptoms are reachable through the shipped UI with no hostile
client and no concurrency: a mistyped hour meter reading, which the screen's own
copy invites, and archive-plus-offline-edit, which is the core offline scenario.
Both leave every device on the farm except the one that acted holding state the
server refused, with an inbox entry visible only to the actor. Nobody else gets
any signal that anything was refused.

**Understated in one way the original does not say:** because hydration replays
the log, a reinstall *reproduces* the wrong state rather than repairing it. There
is no path back to truth on any device today.

`applyPulled` does have one mitigation, and it is not enough: it pauses on any
row whose `targetId` is still pending locally (`sqlite-store.ts:713-719`), so a
device with queued work for that record does not clobber it. That protects the
actor's own device, which is the one that already knows. It does nothing for
everybody else.

**To do**

- [x] ~~Add a terminal `outcome` to the mutation document, written after
      `project()` returns — `applied | duplicate | rejected | conflict | noop`.~~
      **Corrected:** `$setOnInsert` the row with `outcome: 'pending'` alongside
      the envelope, then stamp the terminal value after `project()` with
      `updateOne({_id: id, outcome: 'pending'}, ...)`. Writing the outcome only
      after `project()` is a second non-atomic write and reintroduces the hole
      this item exists to close: die in between and the row carries **no**
      outcome, and "no outcome" is genuinely ambiguous — it can mean applied and
      unstamped, or refused and unstamped. Filter those out and a genuinely
      applied row is dropped from the feed for ever, which is P0-2 inverted; let
      them through and a refused row replicates during exactly the window being
      fixed. `pending` means precisely "logged, not decided", and it self-heals
      through machinery that already exists — the client never got a response, so
      the row stays queued, the resend hits the duplicate branch, sees `pending`,
      and re-projects from the stored envelope (P0-1's fix, same code path).
- [x] Store the projection's own vocabulary, not the wire status.
      `ProjectionDecision['kind']` (`insert`/`update`/`archive`/`noop`/
      `conflict`/`rejected`) is already the honest answer. **Do not add `noop` to
      the wire enum**: `MutationResult['status']` is a contract, and
      `flush.ts:225-231` counts anything outside `applied`/`duplicate` as a
      rejection, so a new no-op status puts every replayed create and every
      repeated delete into a farmer's inbox. Log outcomes and wire statuses are
      two enums.
- [ ] Add a sweeper for `pending` rows older than about an hour whose client
      never came back. It runs the same stored-envelope re-projection.
- [x] Filter `readSnapshotPage` to accepted effects only. The watermark must
      still advance past the excluded rows, the way the unknown-entity skip at
      `snapshot.ts:99-104` already does.
      ~~**Put the filter in the query, not the read loop**, so
      `PULL_PAGE_SIZE + 1` still measures real rows and `more` stays
      meaningful.~~
      **Corrected while implementing — the filter went in the read loop.** The
      query form loses the watermark advancement the same bullet asks for: a
      page whose remaining rows are all withheld returns nothing, so `through`
      stays at `since` and every later pull rescans that run for ever. The loop
      form keeps the cursor moving past what it skips, and `more` is honest
      either way because it is measured on rows **read**, not rows kept. The
      cost is a page that can be short, which is exactly what the unknown-entity
      skip beside it already does.
- [x] Write the filter as **exclusion**, so legacy rows with no field pass
      through unchanged and no backfill is needed. Implemented as a total
      `Record<StoredOutcome, boolean>` in `apps/api/src/sync/outcome.ts` rather
      than a literal `$nin` list: the record makes the compiler demand a
      decision for every kind, so adding one to `ProjectionDecision` without
      classifying it fails `pnpm typecheck`. `tests/sync/outcome.test.ts` also
      asserts the split is total and disjoint at runtime. Exclusion fails open
      by default; those two together are what convert that into a guarantee,
      the same trick the tenancy lint rule uses.
- [ ] ~~Decide whether the feed carries the outcome so clients can *show* a
      refused command, or simply omits it.~~
      **Corrected: this is not open, it is blocked.** `pulledMutationSchema`
      extends the `.strict()` `mutationSchema` and `pullResponseSchema` is
      `.strict()` too (`packages/contracts/src/mutation.ts:200-229`). An extra
      field on the wire fails `safeParse` on every deployed client,
      `pull.ts:75-76` returns `deferred: 'unreadable'`, the page is discarded and
      the watermark never moves — **P1-1's failure mode, self-inflicted, on every
      device in the field at once.** Carrying the outcome is blocked on P1-1. The
      motive is weak anyway: the issuing device already learns the rejection from
      the flush response and already has the inbox row.
- [x] ~~Backfill `outcome` for existing rows.~~
      **Corrected: no backfill.** Written as exclusion, legacy rows have
      no field and pass through unchanged, which is current behaviour and
      therefore not a regression. No migration, no ambiguity. The original framed
      this as a convention to pick, but legacy rows and crashed rows both present
      as "field absent" and need *opposite* treatment, and no ordering of a
      backfill fixes that, because new crashes keep manufacturing field-absent
      rows after it has run.
- [ ] **Missing bullet — repair.** Filtering the feed stops future replication
      and repairs nothing. Every device that has already pulled a refused edit
      still holds it, including the undone archives. On the release that lands
      this, devices must re-hydrate from zero. Replaying only accepted mutations
      in `(serverTs, _id)` order reconstructs true state, because the accepted
      `delete` is in the log and gets re-applied; `applyPulled` already pauses on
      locally-pending targets so an offline device does not lose queued work
      doing it. Cost is a full replay per device, bounded by the P3 history item —
      **this is the moment that item stops being theoretical.**

**Cost note:** as originally proposed, apply goes to four strictly sequential
round trips per mutation (log upsert, projection read, projection write, outcome
write), up to 100 per batch.

## P0-3 · `(serverTs, _id)` is not a commit order

**Confirmed in mechanism.** `apply.ts:115` stamps `serverTs: new Date()` while
building the doc — **before** the `await` on the upsert at line 122, and before
projection at 139. `snapshot.ts:84-92` sorts and seeks on `(serverTs, _id)`,
where `_id` is a client-minted ULID.

The comment at `snapshot.ts:71-82` is right that the pair is a total order, and
the paging tests prove it over a **static** collection. It is not an order over
rows that can still arrive carrying earlier values.

Two interleavings, both ordinary:

1. Request A stamps T1 and stalls. B stamps T2, inserts, projects, and is pulled;
   the device advances its cursor past T2. A finally inserts at T1 — **behind
   that device's watermark, permanently. That mutation will never be pulled.**
2. A is logged first but stalls before projecting. B logs and projects. A
   projects last, so Mongo ends at A's value — while a fresh client replaying the
   log in cursor order ends at B's. The server and a clean rebuild disagree.

A wall-clock step backwards on the API host reproduces the first case with no
concurrency at all.

### Verification (15 August) — mechanism confirmed, frequency overstated. **Re-ranked P1.**

Both interleavings are real and the wall-clock case needs no concurrency. But
"both ordinary" oversells it: on the documented single-process box the
concurrency route needs two devices flushing the same farm in the same
millisecond-scale window, and batches are already applied sequentially
(`apply.ts:253-258`). The clock-rollback route fires perhaps once in
months-to-years and only if writes land in the rollback window.

The likeliest victim is an append-only row — `eggLog`, `mortality`, `feedLog` —
which then never appears on the second handset and never reconciles, because
append-only rows have no later update to overwrite them. A hostile client cannot
force it, since it cannot control `serverTs`. Multi-device only; single-device
farms are untouched.

**To do** — *the original prescription does not solve the original requirement.*

- [ ] ~~Replace the cursor with a server-assigned **monotonic per-org sequence**
      allocated at commit, not at request start.~~
      **Corrected: this reproduces the bug.** `findOneAndUpdate($inc)` on a
      counter document allocates the number in one operation and makes the row
      visible in another. A allocates 5 and stalls; B allocates 6, inserts, is
      pulled, the cursor is at 6; A inserts 5 behind the watermark. That is
      interleaving 1 verbatim, with an integer instead of a timestamp. It fixes
      only the clock rollback, and costs a serialization point and a collection.
- [ ] ~~Whatever replaces it, the number must be assigned in the same operation
      that makes the row visible.~~
      **Corrected: unsatisfiable on this deployment.** The one Mongo construct
      that makes an allocation and an insert one visible unit is a
      multi-document transaction, which requires a replica set —
      `scripts/deploy/setup-mongo.sh:13-21` and `DEPLOY-THE-SERVER.md:437-443`
      record a checked decision to run standalone precisely because nothing needs
      transactions or change streams. Taken literally the bullet is a demand to
      reverse a documented architectural decision, and the fix proposed beside it
      does not meet the bullet anyway. Change streams and the oplog need the same
      replica set; cluster time is unavailable on a standalone; `ObjectId` is
      minted driver-side and has the same stall problem. A commit-ordered
      collection does not help by itself — something still has to assign the
      order.
- [ ] **Restate the requirement** as a property of visible order rather than of
      operation count: *no row may become visible carrying a cursor value below a
      watermark already published to a client.* That is satisfiable without a
      replica set and without replacing the cursor.
- [ ] Serialize the critical section in-process, per org: an async mutex keyed on
      `orgId` held across stamp → log upsert → project → outcome stamp, for one
      mutation, with `serverTs` stamped immediately before the upsert instead of
      at doc-build time (`apply.ts:115`). Under one writer process, allocation,
      insertion and projection order become identical, which makes
      `(serverTs, _id)` a true commit order — **and closes interleaving 2, which
      no sequence number can.** The lock is uncontended at farm write volume;
      batches are already sequential, so the only thing it serializes is two
      devices flushing the same farm at the same moment.
- [ ] Clamp the stamp monotonically:
      `serverTs = new Date(Math.max(Date.now(), lastIssued + 1))` per org, seeded
      on the first write after boot from one indexed read
      (`findMany({}, {limit: 1, sort: {serverTs: -1}})`, which the existing
      `{orgId, serverTs, _id}` index serves as a seek). This kills the clock
      rollback across restarts, which an in-memory clamp alone would not.
- [ ] Hold back the horizon in the reader as defence in depth for the
      two-process case: `readSnapshotPage` returns only rows with
      `serverTs <= now - Δ`, Δ around five seconds. A stalled insert lands inside
      the unstable window and is picked up when the window passes it. Cost is Δ
      of second-device propagation delay, which nobody on a farm notices.
- [ ] Write down that this is exact under **one API process per farm** and
      Δ-bounded under more than one, next to the standalone-Mongo note rather
      than left as folklore. If a second API instance is ever run, the correct
      answer is a single-node replica set plus a transaction wrapping the
      allocation and the insert — at which point the original counter proposal
      becomes viable. That is the upgrade path.
- [ ] **Interleaving 2 is not a cursor problem and no cursor change fixes it.**
      It happens because the log write and the projection write for two
      concurrent mutations can interleave in opposite orders — `apply.ts:122` and
      `:139` are separate awaits. Only serializing the pair fixes it, which the
      mutex above does.
- [ ] **Wire hazard the original does not price:** replacing the cursor changes
      `through`/`throughId`/`serverTs` semantics on a `.strict()` response
      schema. A new server reading an old client's millisecond `since` as a
      sequence number skips the farm's entire history; a new field to
      disambiguate wedges every old client per P1-1. Any cursor replacement is a
      coordinated client release with a compatibility story.
- [ ] Tests: late insertion behind an advanced cursor, projection order reversed
      against log order, and a clock rollback. The mutex makes the first two
      deterministic instead of timing-dependent.

---

# P1 — before more farms, or more devices per farm

## P1-1 · Adding an entity breaks every older client

**Confirmed.** `packages/contracts/src/mutation.ts:15` says *"Widening this list
is additive and does not bump MUTATION_SCHEMA_VERSION."* Additive on the server;
breaking on the client.

`snapshot.ts:99-104` skips entities **the server** cannot parse, which protects a
server older than its own data. It does nothing for a client older than the
server: the server knows the new entity, so it forwards it, and
`packages/core/src/sync/pull.ts:75-76` fails `pullResponseSchema.safeParse` on the
strict enum, returns `deferred: 'unreadable'`, and drops the whole page. The
watermark never moves. **That install is stuck until it is upgraded**, and the
sentence in `mutation.ts` says it is fine.

### Verification (15 August) — confirmed as written.

The whole page is dropped, not the row; the watermark does not move; the failure
is reported as a deferral, so the app shows "Saved" and looks healthy. The
lagging phone stops receiving anything anyone else records — permanently,
silently — while continuing to send its own, so divergence grows until somebody
upgrades. This is the ordinary staggered-update path for an APK served manually
at `/app` with no auto-update, not a hostile-client path.

**This item now also gates P0-2**, which cannot put a new field on the wire until
clients tolerate unknown rows.

**To do**

- [ ] Let the client skip unknown rows without failing the page, the way the
      server already does — or negotiate a capability set at pull time.
- [ ] Correct the comment at `mutation.ts:15` either way. It is currently load-
      bearing and wrong, which is worse than absent.

## P1-2 · A Farm Hand cannot finish a photo

> **Fixed.** A hand may now stamp `uploadedAt` on a photo still waiting for its
> bytes, and nothing else. `canMutate` is unchanged, so the byte PUT goes on
> refusing a hand replacing an established image.

**Confirmed.** `packages/contracts/src/roles.ts:55` grants `photo:create` only.
`photo` is not append-only, not `task`, not `note` — so
`canMutate('hand', 'photo', 'update')` falls through to `return false`.

`apps/api/src/routes/photos.ts:107-148` correctly treats the first byte upload as
completing the create. But `packages/core/src/sync/photos.ts:198-200` then
enqueues a `photo:update` to stamp `uploadedAt`, and the server refuses it on the
role check. The hand's phone has already marked the photo uploaded optimistically;
the server metadata never gets `uploadedAt`; **no other device ever tries to
download the bytes.** The photo exists and is invisible.

Tests cover the optimistic local stamp and the hand's byte upload separately, so
neither fails.

### Verification (15 August) — confirmed, and it fires on every photo a hand takes.

Reachable through the plain UI with no hostility required, and hands taking
evidence photos is the stated reason `photo:create` was granted at all
(`roles.ts:30`). The bytes are not lost — an owner or admin device could fetch
them if anything asked — but nothing ever asks. Combined effect: hands accumulate
permanent unfixable inbox entries, and the farm's other phones show a growing set
of pictures that never arrive. High frequency in any farm with a hand.

**To do**

- [x] ~~Either permit `photo:update` for a hand when it sets only `uploadedAt`,
      **or stamp `uploadedAt` server-side in `routes/photos.ts` and drop the
      client mutation. The second is smaller and removes a mutation from the
      wire.**~~
      **Corrected: the second option does not work at all.** `/snapshot` ships
      the mutation log, so a field the server sets directly on the projection is
      invisible to hydration — no mutation, no replication. Dropping the client
      mutation would leave every other device exactly as blind as before, which
      is the bug. Synthesising a mutation server-side is not open either: a
      mutation carries a client-minted id, a `deviceId` and a `clientSeq`, and
      the server has none of them.
      **Shipped: the first option, narrowed twice.** `isUploadStamp`
      (`contracts/roles.ts`) recognises a `photo:update` carrying nothing but
      `uploadedAt`; `sync/apply.ts` combines it with the role failure;
      `decidePhoto` (`sync/projections.ts`) adds the half that needs the
      document — a stamp may finish an upload, not re-stamp a finished one —
      the same division `mayChangeNote` uses.
- [x] **`canMutate` itself is deliberately unchanged**, and that is the whole
      shape of the fix. It also gates the byte PUT at `routes/photos.ts:128`,
      so granting `photo:update` there would let a hand **replace the image on
      an established photo** — a refusal that route makes on purpose. The fix
      for an invisible photo must not become a way to overwrite somebody
      else's. `roles.test.ts` pins `canMutate('hand','photo','update') === false`
      so the tempting one-line version cannot come back.
- [x] Add the cross-device hand workflow as one test: create, upload, and a
      second device fetching the bytes. `tests/sync/photo-upload-stamp.test.ts`
      asserts it through the snapshot feed rather than the projection, because
      a stamp the other devices never receive would fix nothing.
      `tests/unit/photo-stamp-gate.test.ts` drives the applier against a fake
      `Db` so the line combining the two halves is proven without a mongod.

## P1-3 · Session expiry is not recovered while the app is open

**Trusted.** Access tokens last fifteen minutes (`apps/api/src/auth/tokens.ts:20-43`).
The mobile token-pair schema does not retain the expiry the server returns
(`apps/mobile/src/auth/session.ts:26-50`), so nothing is scheduled against it.
Refresh fires at boot, resume, and network regain; authenticated calls refresh
only when the token is **absent**, not on a 401
(`apps/mobile/src/auth/call.ts:47-80`). Sync treats 401/403 as a deferral for the
pass (`packages/core/src/sync/flush.ts:124-142`).

An app left open and online therefore stops syncing after fifteen minutes and
stays that way until a lifecycle or network event happens to occur.

### Verification (15 August) — confirmed and **understated**, with one mechanism correction.

TTL is 15 minutes (`tokens.ts:26`, `ACCESS_TTL_SECONDS = 15 * 60`).
`refreshSession` has exactly three callers in the whole tree — `call.ts:52`,
`boot/start.ts:78`, `sync/triggers.ts:49` — and there is no `setTimeout` or
`setInterval` anywhere in `session.ts`. The token lives in a module-level
variable (`packages/core/src/api.ts:119`) with no expiry tracking at all.
`call.ts:76-81` throws the server's message on `!res.ok` with no 401 retry.

**Mechanism correction:** the server does not return an expiry for `pairSchema`
to drop. `rotateSession` returns `{ accessToken, refreshToken }` (`refresh.ts:35`)
and there is no `expiresIn` anywhere in `routes/auth.ts`. The expiry is already
in the client's hands regardless — `parseClaims` (`session.ts:145-164`) decodes
the JWT payload, which carries the `exp` that `mintAccessToken` sets
(`tokens.ts:42`). So the first To-do bullet is easier than it reads: nothing
needs adding to the wire, only reading what is already decoded.

**Understated:** the loop does not sit quiet. `engine.ts:211` increments
`consecutiveFailures` on a deferral and `nextDelay` backs off to a
`MAX_BACKOFF_MS` of 60s (`flush.ts:30`), so it retries every 30–60s indefinitely,
401 every time — and `nudge()` on each new enqueue (`engine.ts:404-405`) resets
the counter and fires an immediate extra 401. Meanwhile `lastError` reads
*"Nothing is lost — sign in again to send the work waiting here"*, which tells a
farmer to sign in when they are already signed in and the session is refreshable
without them. No data is lost: `flush.ts:137-142` deliberately skips
`recordAttempt`, so `MAX_ATTEMPTS`/`rejectExhausted` never ripen.

On the normal path (boot signed in) a screen lock/unlock repairs it. **On the
sign-in-after-boot path it is unrecoverable without an app restart** — that is
the severity the Trusted label did not reach.

**To do**

- [ ] Keep `expiresAt` in the stored pair and refresh ahead of it — or simply
      read `exp` from the claims already decoded by `parseClaims`.
- [ ] One refresh-and-retry path on 401, shared by every authenticated call.
- [ ] Fix the `lastError` copy. It instructs a signed-in user to sign in.
- [ ] Check the cold-start ordering the audit flags at
      `apps/mobile/src/boot/start.ts:166-182` and `Boot.tsx:166-179` — the sync
      loop appears to start before the lifecycle triggers are installed.

## P1-4 · Refresh rotation leaves long-lived siblings

**Trusted.** `apps/api/src/auth/refresh.ts:126-199` — inside the thirty-second
reuse grace window, every presentation of a spent refresh token mints another
independent child in the same family. The exposure is therefore not bounded by
thirty seconds as the comments say: if an attacker takes one sibling during the
window and the real device holds another, both rotate independently for the
sliding session lifetime and **neither ever reuses the other's token, so reuse
detection never fires.**

Also flagged, same file: family revocation updates rows that already exist, so a
rotation landing concurrently inserts a child that escapes it. And on the client,
refresh is single-flight against other refreshes but not against sign-out, so a
response arriving after `clearCredentials()` can write credentials back
(`session.ts:695-757, 789-830`).

### Verification (15 August) — confirmed, all three parts.

Not reachable through the UI: (a) and (b) need an attacker who has already
extracted a refresh token from the device keystore or a backup. The harm is a
**persistence upgrade on an existing compromise** — without the fork, the theft
is caught at the device's next refresh and the family dies; with it, the attacker
keeps a silently-rotating parallel session with re-derived current role
(`refresh.ts:188-199`) for as long as the victim never signs out, and the victim
gets no signal.

**(c) is the reachable one and deserves promoting out of the "also flagged"
sentence.** An ordinary user tapping Sign Out on a shared tablet just after
unlocking the phone or regaining signal can end up still signed in, holding a
valid access token for up to 15 minutes (`refresh.ts:67`) — and if (b) also
fires, a refresh token too. It pairs directly with P1-5(a).

**To do**

- [ ] Bound a family to one live child. Re-presenting a spent token inside the
      grace window should return the *same* child, not mint a new one.
- [ ] Make revocation cover rows inserted after it — a family-level generation or
      a revoked-at floor rather than a bulk update of known rows.
- [ ] Fence the client refresh against sign-out.

## P1-5 · Farm switching is not one transition

**Trusted.** Sign-out clears tokens but deliberately leaves the tenant database
open, and `Boot.tsx:182-194` keeps rendering it with the sync engine running.

Two consequences. A signed-out shared tablet **keeps showing the employer farm's
records** until another farm is opened or the app restarts. And during sign-in to
a different org, the new access token can go live before `openLocalStore()` has
swapped the database (`apps/mobile/src/db/store.ts:71-107`) — so a sync timer can
flush the **old** tenant's queue under the **new** tenant's token.

The second is concurrency-sensitive and may be hard to hit, but there is no lock,
pause, or generation fence that would prevent it.

This also contradicts what the account screen promises: `ensureLocalOrgId()`
restores the device's own farm on a later boot, not on sign-out
(`apps/mobile/src/auth/local-org.ts:68-93`, `AccountScreen.tsx:494-500`).

### Verification (15 August) — confirmed, and the halves are the wrong way round.

**(a) is the serious one and the document presents it as the milder half.** It is
reachable by two taps by an ordinary user, and it hurts the exact person the
design is for: a hand signs out on the farm's shared tablet at the end of a
shift and the next person still sees the employer's animals, treatments and
mortalities until somebody restarts the app. That is a plain tenant-isolation
failure at the UI, not a nicety.

**(b) is uncommon but unbounded.** It needs a device already signed in and a
timer landing in a sub-second window. When it fires the failure is silent in
both directions: org B's database is contaminated with another farm's records —
medication doses, mortalities, hour readings, all attributed to a B user, because
the server re-derives `orgId` from the verified token and `scoped()` stamps it —
and org A loses that work permanently, because the rows come back `applied`.
Neither farm gets any signal. **`scoped()` does not save you here**: it is doing
exactly its job, stamping the org the token says. The boundary that failed is on
the device.

**Add to this item:** `openLocalStore` (`apps/mobile/src/db/store.ts:83-104`)
closes the outgoing store *before* `setLocalStore(next)` runs, so `localStore()`
returns a closed handle across that await window while the engine timer may still
tick. Not a separate finding — it sits inside this one, and the generation fence
below closes it — but it should be named, because the item currently describes
only the token half.

**To do**

- [ ] Make auth state, org selection, store handle, and engine state one
      serialised transition with a generation number the engine checks before it
      flushes.
- [ ] Close or blank the outgoing store at sign-out rather than at next boot.
- [ ] Cover the closed-handle window at `store.ts:83-104` with the same fence.

## P1-6 · An interrupted restore can leave an archived record live

**Trusted.** `packages/core/src/backup/restore.ts:282-313` recreates an archived
entry as two queued mutations — `create`, then `delete`. A crash, a full disk, or
a failed second transaction between them leaves the record **live**. On resume the
planner treats the key's presence as sufficient and skips the entry
(`restore.ts:216-252`) without comparing archive state, so the missing archive is
never repaired.

The interruption tests stop between entries, not between the two operations that
make up one entry.

### Verification (15 August) — confirmed, low severity, and the second remedy is the right one.

Reachable through the real UI (`BackupScreen`), no hostile client. Consequence is
a retired flock, animal or machine reappearing live on every screen — confusing
on setup morning, but not data loss, and the user can archive it again normally.
Frequency is low: per archived entry the window is one enqueue out of a restore
lasting seconds to minutes, so a random kill lands in it roughly
`archived/total` of the time.

The document offers two fixes and the second is clearly better. Comparing archive
state on resume repairs the symptom; making an archived entry one mutation
removes the window.

**To do**

- [ ] ~~Compare archive state, not just key presence, when resuming.~~ Secondary.
- [ ] Make an archived entry **one mutation** rather than two. This is the fix.

## P1-7 · Membership invariants are check-then-act

**Trusted.** Four places where a concurrent request defeats an application-level
precheck:

- Last-owner protection counts owners, then demotes or disables one
  (`apps/api/src/routes/members.ts:470-521`). **Two owners can remove each other
  simultaneously and leave the farm with none.**
- Join-code minting deletes current codes then inserts a replacement, with no
  unique active-code constraint (`apps/api/src/db/join-codes.ts:82-94`,
  `db/indexes.ts:213-226`). Concurrent requests leave several valid codes.
- Invites and join credentials are marked spent before the slow Argon2 hash and
  the user insert. A crash or an email-uniqueness race **burns the invite without
  creating the account.**
- Initial org claiming has the same shape around its memberless-org check.

### Verification (15 August) — (a) and (c) confirmed, (b) confirmed but low-harm, **(d) is wrong**.

All cited refs accurate at HEAD.

- **(d) is wrong as written.** Signup has both a genuine database constraint and
  a rollback that the invite and join paths lack. The right framing is the
  inverse: `auth.ts:212-218` is the *pattern* that (c) should copy, not another
  instance of the bug. Rewrite the bullet that way.
- **(a) is recoverable, which the item does not say.** A zero-owner farm is not
  unrecoverable on a self-hosted single-farm deployment — whoever runs the server
  can fix `role` directly in Mongo. `membership.ts:66-68` calls the recovery path
  *"a support request to a project that has no support"*, which is true of the
  product and false of the operator.
- **(b) has a mitigation the item missed:** `useSaver.save` refuses re-entry
  while a save is in flight (`Form.tsx:751-753`) and `mintCode` goes through it
  (`MembersScreen.tsx:134-141`), so one device cannot double-fire the mint. Also
  worth recording separately: the module comment claims *"Expired and redeemed
  rows are left alone: they are the audit trail"* (`join-codes.ts:87-88`), but
  the `deleteMany` filter is `redeemedAt: {$exists: false}` only — it **does**
  delete expired-unredeemed rows. The comment and the code disagree.
- **(c) is narrower than implied in one way and wider in another.** The email
  race is narrower: `findUserByEmail` and `insertUser` normalise identically
  (`identity.ts:108-114, 139-141`), so there is no deterministic case-mismatch
  path, only a true concurrent race. It is wider in that the same window is open
  to any transient Mongo error, not just an email race. And the ordering is a
  deliberate fail-closed choice, which the item should say.
- **Coverage:** no concurrency test exists for any of the four.
  `tests/unit/membership.test.ts` covers only the pure predicates with
  `ownerCount` passed in; `tests/isolation/claim.test.ts:420-441` covers
  sequential double-minting; `tests/isolation/invites.test.ts:303-315` covers
  sequential double-acceptance. The codebase already does concurrency correctly
  elsewhere and tests it with `Promise.all`, so the pattern exists to copy.

Ranked by real likelihood on a single-node Mongo serving one small farm:
**(c) first** (a transient error is far likelier than a race), then (a), then
(b), and (d) is not a defect.

**To do**

- [ ] Enforce these in the database — unique partial indexes, or a transaction —
      rather than in the handler. A precheck and an act are two statements and
      something can always happen between them.
- [ ] Make (c) copy the signup pattern at `auth.ts:212-218` — spend the credential
      *after* the account exists, or roll it back if the insert fails.
- [ ] Rewrite the (d) bullet: signup is the model, not another instance.
- [ ] Reconcile the `join-codes.ts:87-88` comment with what `deleteMany` does.

---

# P2 — operational

## P2-1 · The deploy timer restarts the API when nothing changed

**Confirmed.** `scripts/deploy/deploy.sh:84` prints
`already on $TARGET — nothing to deploy` inside an if/elif/else and **does not
exit**. Execution falls straight through to `corepack pnpm install` at line 112
and `systemctl restart steading-api` at line 213, both unconditional. The timer
runs every five minutes (`steading-deploy.timer`), so an unchanged production box
reinstalls dependencies and bounces the API about **twelve times an hour**.

Beyond the availability cost, each restart is an opportunity for the in-flight
retry path that P0-1 makes unsafe. These two bugs make each other worse.

### Verification (15 August) — confirmed, and the timer's own comment is why nobody noticed.

Control flow traced: nothing between line 84 and line 213 guards the restart. The
only branch in between is a Caddy `if` that closes first. No trap, no early
return, no `set -e` interaction.

**`steading-deploy.timer` states the opposite of what happens:** *"A run that
finds nothing new costs one `git fetch` and exits before touching anything —
`deploy.sh` compares the commit before and after and says 'already on <sha>'."*
That comment describes the intended design accurately and the actual behaviour
not at all, which is exactly how this survived. Correct it in the same change.

This is the cheapest fix in the file and it should ride along with the first P0
push, because the restart loop is what turns the crash window between
`apply.ts:122` and `:139` from a theoretical interleaving into something a farm
actually hits.

**To do**

- [ ] `exit 0` after the nothing-to-deploy branch. One line.
- [ ] Correct the comment in `steading-deploy.timer`, which currently asserts the
      behaviour the missing `exit` prevents.

## P2-2 · APK promotion is not bound to the released commit

**Trusted.** CI starts a `preview-farm` EAS build, but deployment asks for the
newest finished Android build with no constraint on profile, branch, commit,
build ID, or workflow run (`scripts/deploy/deploy.sh:238-270`). `eas.json:8-27`
defines other APK-producing profiles including a development client.
`publish-apk.sh:71-101` checks the artifact is a ZIP holding an Android manifest,
but not its application ID, signing certificate, profile, or source commit.

**A manual, development, or unrelated-branch build can therefore become the APK
served at `/app`.**

### Verification (15 August) — confirmed, latent.

Requires somebody to run a non-`preview-farm` cloud build. Not routine — CLAUDE.md
directs local device builds through `pnpm mobile:android` — but `eas.json:8-14`
exists precisely so a cloud `development` build can be made, and the moment one
is, the next timer tick publishes it. The failure is a colleague running the
wrong `eas build` line, and the damage lands on whoever downloads `/app` next: a
dev-client APK that demands Metro, or a preview APK pointed at nothing.

**To do**

- [ ] Promote by build ID captured from the CI run that produced it.
- [ ] Verify application ID and signing certificate before publishing.

## P2-3 · Backups are designed but not operationally closed

**Trusted.** `scripts/backup-mongo.sh` is good work — strict shell settings,
tight permissions, `age` encryption, offsite upload, oplog-aware consistency. But
the tree carries **no timer, no service, no monitored schedule, and no alert for a
backup that did not run.** Provisioning prints a manual command; the project docs
still list automated nightly backup as outstanding.

The restore path also does not require an empty target, so an operator can merge a
backup into live data by accident.

### Verification (15 August) — first half confirmed and serious, **second half overstated**.

The scheduling gap is exactly as bad as stated: a farm's only off-box copy
depends on somebody remembering to type a command, with nothing that notices when
they stop. `ACCESS-AND-BILLING.md` §4.1a-i is quoted in two scripts as calling
this a condition of the first real farm.

**The docs disagree with each other, which is worse than reported and is its own
bug.** `PICK-UP-HERE.md:125` says it is "waiting on an S3 bucket and an `age`
key"; `ROADMAP.md:478` says **"Done — `scripts/backup-mongo.sh`"**. A roadmap line
reading "Done" is how an unscheduled backup stays unscheduled.

**The restore half is a stated decision, not an oversight.**
`backup-mongo.sh:125-127` says so outright: *"Restore is deliberately awkward: it
names one archive, refuses to guess, and does not drop anything. Recovering into
a fresh database and switching MONGODB_URI is safer than overwriting the one that
is still serving farms."* And the mechanics are gentler than "merge into live
data" suggests — `mongorestore` at `:148` runs without `--drop`, so duplicate
`_id`s are rejected and counted rather than overwritten. An accidental restore
into a live database cannot clobber current records; it can only resurrect
documents that are no longer there, which for this schema means un-archiving
(P13 archives rather than deletes). `:145` prints the target URI before acting.
P3 nicety at most, and it should not be listed beside the scheduling gap.

**To do**

- [ ] A timer, a service, and an alert on absence — a backup nobody is told about
      is not a backup.
- [ ] Reconcile `ROADMAP.md:478` with `PICK-UP-HERE.md:125`. One of them is
      telling the next reader the job is finished.
- [ ] ~~Refuse a restore into a non-empty database unless explicitly forced.~~
      Optional. It contradicts a documented decision and the harm is bounded to
      un-archiving; if it is done, do it as a confirmation prompt rather than a
      refusal.
- [ ] Restore-test on a schedule. Untested backups are a belief, not a control.

## P2-4 · `/health` does not check the database

**Trusted.** `apps/api/src/server.ts:53-58` reports process liveness only, and
Mongo connects lazily — so deploy gates and Fly checks can read healthy while
every data route is failing.

### Verification (15 August) — confirmed and **understated**, with one ref correction.

The health route is the single line `server.ts:58`
(`app.get('/health', async () => ({ ok: true }))`); `53-56` is the error handler.
`db/client.ts:16-66` connects lazily from `db()` at `:94-96`, per request.
`env.ts:21` requires `MONGODB_URI` to be non-empty at startup, so a *missing* URI
crashes the boot — but a *wrong* one (unreachable host, bad credentials) does
not. The process comes up, `/health` returns `{ok:true}`, and every data route
fails at a 5-second server-selection timeout.

**The sharpest evidence is in `deploy.sh` and the audit missed it.** At
`:216-220` the script says its post-deploy poll exists because *"the two failures
most likely here (**a bad `MONGODB_URI`**, a syntax error in something that only
loads at boot) both take a second or two to surface. Without this check a deploy
that killed the server reports success."* The poll at `:334-341` hits `/health`.
A bad `MONGODB_URI` does not kill the process and does not fail that check — so
the check demonstrably does not do the first of the two things its own comment
says it exists for.

**Mitigation the audit missed:** the Fly side is a deliberate documented choice.
`fly.toml:63-64`: *"`/health` touches nothing — it does not open a database
connection — so a red check means the process is down rather than that Atlas is
slow."* That is a defensible liveness/readiness split. The finding is really
"readiness was never added alongside it". `DEPLOY-THE-SERVER.md:845` already
carries the symptom in its troubleshooting table — known and written down, just
not gated on.

**To do**

- [ ] Split liveness from readiness; have readiness ping Mongo.
- [ ] Point `deploy.sh:334` at `/ready` rather than `/health`, so the script does
      what its own comment claims. Leave the Fly liveness check alone.

---

# P3 — worth fixing, not urgent

Carried from the audit, all **trusted**, none independently walked — **except the
six spot-checked in the 15 August pass, which are annotated inline.**

- **Google account binding.** A verified Google address is bound to an existing
  password account with no password or session confirmation
  (`apps/api/src/routes/auth.ts:284-303`). Risky for reassigned Workspace
  addresses. `googleSub` also has no unique index.
  → **Verified: mechanism confirmed, "account-takeover shaped" overstated.** The
  minted session carries the victim's `orgId` and `role`, owner included — but
  the precondition is control of a verified Google identity at the victim's
  address, which most SaaS treats as sufficient proof anyway. **P3 is right for
  the binding.** **Split the missing `googleSub` index out as its own cheap
  item:** it is a one-line addition to `indexes.ts:140`, it is currently a
  collection scan on every Google sign-in, and its absence is exactly the
  structural guarantee that `indexes.ts:160-176` argues for at length one
  collection over — *"a check in a route is a thing somebody can refactor past."*
- **Referential integrity is schema-shaped, not enforced.** Parent IDs are
  accepted without checking the referent exists, so out-of-order sync or a
  crafted client creates permanent orphans.
- **No conflict token.** Concurrent updates are silent shallow last-writer-wins,
  with no base version or ETag. Concurrent hour readings do read-highest-then-
  insert with no serialisation.
  → **Verified: confirmed but materially overstated; rewrite the wording.** The
  accurate claim is *"no base-version token; updates are per-field
  last-writer-wins, whole-form on form screens"* — a much smaller thing than
  "silent shallow last-writer-wins" implies. Update clobbering needs two people
  editing the same record on the same screen within one flush interval; the loss
  is one form's worth of fields, recoverable by re-typing. The hour-reading race
  needs two devices logging the same machine simultaneously and is already
  correctable through the archive escape hatch `highestHours` exists to support
  (`apply.ts:216-230`). **P3 is right for both.**
- **History grows without bound.** Server mutations and applied outbox rows are
  never compacted; a new device eventually replays the entire farm history.
  → **Verified: confirmed, urgency overstated, and the doc missed the cheap
  mitigation.** Server storage is a non-issue at every realistic scale (250k docs
  ≈ 250 MB). The cost is entirely **cold-start time on a reinstall or a new
  device**, invisible below roughly three years or 50,000 mutations. Measured
  shape: a smallholding runs 4,000–7,000 mutations/year, a market operation
  15,000–30,000. Hydration is paced at 4,000 per 30 seconds, because
  `pull.ts:60` stops after `MAX_PAGES_PER_PASS = 20` pages of 200 and
  `nextDelay` (`engine.ts:303-317`) fast-paths to zero delay only when the
  **outbox** has work — a pull with `more: true` and an empty outbox falls to
  `IDLE_MS`. So a five-year market farm is ~16 minutes of app-open time and a
  ten-year one ~31 minutes, presenting as "the new phone is empty and stays
  empty," which a farmer reads as the app being broken. **A one-line
  `nextDelay` fast-path on `more` cuts that to the time of N sequential
  requests — minutes, not half an hour, with no compaction at all.** Try that
  before designing a snapshot format. P3 today; P2 the first time a farm crosses
  ~3 years of daily use. Note this item is also the cost ceiling on P0-2's repair
  bullet.
- **Backups load as whole JSON strings** with unbounded arrays — a large or
  hostile file can exhaust mobile memory.
- **Observability is thin.** Errors are logged; request IDs, metrics, queue age,
  rejection rate, and replication lag are not.
- **Fastify listens on `0.0.0.0`** while the Caddy docs describe it as loopback
  only. The host firewall covers it; an accidental port exposure would not be.
- ~~**Photo uploads are not checked** against declared size or media type, and the
  download response is marked immutable though privileged users can replace bytes.~~
  → **Verified: two thirds of this bullet is false and the surviving third names
  the wrong cause. Replace it.** Media type *is* checked, twice:
  `photos.ts:71` defines `ACCEPTED = ['image/jpeg','image/png','image/webp']` and
  `:81-85` registers a raw-body parser only for those three, so anything else
  gets Fastify's 415 before the handler runs; the stored type is re-validated
  against the same whitelist with a hard fallback at `:130-133`. Size *is*
  enforced: `photos.ts:69` sets `MAX_BYTES = MAX_PHOTO_BYTES` as the parser's
  `bodyLimit` (`:82`), imported from the contract precisely so it cannot drift
  from `ops.ts:62`; empty bodies are refused at `:92-95`. What survives is
  narrow: the *declared* `byteSize` is never compared to `bytes.byteLength`, so a
  record claiming 40 KB can be satisfied with 2.9 MB — both under the ceiling, a
  consistency gap rather than a resource one. And the immutable-cache claim is
  mis-diagnosed: `photos.ts:180` does send `immutable`, but the cache header is
  not the mechanism — `packages/core/src/sync/photos.ts:148` only fetches bytes
  the device does not already hold, so a device that downloaded a photo once
  never asks again, header or no header. **Replacement bullet:** *"a replaced
  photo is never re-downloaded by a device that already holds the original
  (`sync/photos.ts:148`)"*. Photo replacement is not offered by the client at all
  (`:141-144` uploads only when `uploadedAt === undefined`), so reaching it needs
  a hand-rolled PUT, and the effect — other devices keep the original image — is
  arguably the safer outcome. **This bullet is the clearest example of the
  failure the provenance section warns about, and it was inside this document.**
- **The local wipe skips the `tickets` table**, which can hold full record data.
  Sign-out does not currently call wipe, so this is latent rather than live.
  → **Verified: confirmed, correctly filed.** Nobody is affected today. But if
  sign-out wiping is ever restored on the shared-tablet argument — which P1-5(a)
  argues for — a barn tablet handed to the next farm keeps the previous farm's
  full record export in `tickets.records`, invisible because the wipe appears to
  have run. Fix it as a one-line list addition now rather than scheduling it,
  **and fix it before P1-5, not after.**
- **Flush response parsing is loose** — it checks only that `results` is an array,
  unlike the strict pull boundary. Malformed entries read as rejections.
  → **Verified: confirmed, and P3 undersells it if P0-2 is scheduled.** Not
  reachable from a hostile third party (TLS), so the population at risk is farms
  running a client older than the server. When it bites, correctly-applied
  records appear in the rejected inbox as refusals and the farmer either retries
  them (harmless) or discards them believing they never landed. **Order matters:
  add `syncResponseSchema`, ship the client, *then* add any new server status.**
- **Unauthenticated support submissions** can inject Markdown and mentions into
  generated GitHub content and influence dedup fields. Billing notifications are
  also unauthenticated with no endpoint-specific limit.
- **CI pins mutable major tags** rather than revisions or digests.
- **No device-level CI.** Screen tests use non-rendering mocks and there is no
  Android instrumentation, so native SQLite behaviour, lifecycle races, secure
  storage, and camera recovery rest on manual testing.

---

# N — found in the verification pass

Three defects that appear nowhere in the three original audits. Each was
re-derived from source and, where noted, confirmed by running code.

## N-1 · A rejected `create` leaves a phantom record on the device for ever — **P0**

> **Fixed for the create case.** `discardRejected` now takes the optimistic
> projection back in the same transaction that resolves the row
> (`sqlite-store.ts`, `dropRefusedCreate`). The refused `update` and `delete`
> residue is still open — see the third bullet under **To do**.

**Verified, and confirmed by running it.** This is the mirror image of P0-2 and
it is arguably as bad.

`discardRejected` (`packages/core/src/db/sqlite-store.ts:523-540`) clears the
inbox row and bumps the cleared counter, but **never reverts the local
projection**. Neither does `resolveBatch`'s rejection branch
(`sqlite-store.ts:450-453`) — it marks the outbox row `rejected` and leaves the
record exactly as the optimistic enqueue wrote it. Nothing else will ever fix it:
a pull only overwrites a record when the server *has* a mutation for that
`targetId`, and for a mutation the server refused there is no server-side row and
never will be. The phantom is invisible to `checkIntegrity` too, because
`clearedCount` was bumped, so the arithmetic at `:640-667` reports a healthy
queue.

Concrete case, entirely inside supported behaviour. A Farm Hand tries to add a
group. `canMutate('hand', 'flock', 'create')` returns `false`
(`packages/contracts/src/roles.ts:66`), so the server rejects it. The hand's phone
has shown the group since the moment they tapped save. They open "Needs a look",
read that it was refused, and discard it. **The group stays in their group list
for ever.** They can log egg tallies against it. No other device has ever heard
of it, and no amount of syncing removes it.

Reproduced end to end against `freshStore()`: enqueue a `flock:create`, flush
against a transport returning `status: 'rejected'`, confirm one record;
`discardRejected`; confirm the inbox is empty and the record is still there with
its payload intact; run a `pullOnce` with an empty page; the record survives.
**The test passed on the first run, which is the wrong kind of passing.**

Unlike P0-2, **no server change fixes this.** It is the same confusion — a device
treating an attempted command as an accepted one — approached from the other
side, and it should be scheduled beside P0-2 for that reason.

**To do**

- [x] ~~`discardRejected` **and `resolveBatch`'s rejection branch**~~ must revert
      the projection in the same transaction that resolves the row (invariant 5).
      **Corrected while implementing: `discardRejected` only.** Reverting at
      rejection time is wrong twice over — a rejected mutation is a decision the
      user has not made yet, so hiding the record leaves them reading an inbox
      entry about a group they can no longer see, and `retryRejected` would have
      nothing left to re-project. Discard is the point at which they have
      decided. `tests/offline/refused-create.test.ts` pins the retry case so the
      timing cannot be quietly changed back.
- [x] ~~Reverting means replaying the surviving outbox history for that
      `targetId`~~ — or, for a rejected `create` with no prior history, deleting
      the record row outright.
      **Corrected: replay is wrong and only the create case shipped.** Replaying
      this device's outbox history reconstructs the record from local mutations
      alone, which drops everything that arrived from another device by pull: a
      group created on phone B and then edited-and-refused on phone A would
      replay to nothing and be deleted off A. A `create` is the one op whose
      target owes its whole local existence to this device — the ULID is minted
      here — so it is the one that can be taken back without a base value.
      Guarded on no `applied` row for the same target, so a record the server
      accepted after all is never removed.
- [ ] **The residue, which is now the open half.** A refused `update` leaves its
      merged fields in place, and a refused `delete` leaves the record hidden;
      neither is repaired by a later pull, because the server has no mutation
      for a command it refused. `delete` is exactly revertible (only the
      `deleted` flag moved, `nextRecordValue` keeps the value) but needs
      guarding against a second, accepted delete. `update` needs a stored
      last-server-confirmed value per record — a second column, and the only
      thing that would make the revert exact. Asserted as-is in
      `refused-create.test.ts` so the limit is visible rather than assumed.
- [ ] Make `checkIntegrity` able to see this: a record with no server-side
      provenance and no queued mutation is a phantom, and the counter arithmetic
      cannot tell. **Still open** — the revert stops new phantoms, but a device
      that already has one gets no help, and nothing reports it.
- [x] Test: hand creates a group, server rejects, hand discards → the record is
      gone. Then the same with `retryRejected` → the record survives. Both in
      `tests/offline/refused-create.test.ts`, along with the pull-does-not-bring-
      it-back case. Four of the eight fail without the revert, checked by
      disabling it.

## N-2 · One `undefined` from `expo-network` stops automatic sync for the life of the process — **P1**

> **Fixed.** The listener now reports only what the OS actually said, so a
> silent event leaves a working device alone.

**Verified.** `apps/mobile/src/sync/triggers.ts:104` is:

```ts
setOnline(event.isConnected === true);
```

`packages/core/src/sync/engine.ts:137` defaults `online` to `true`, and its own
comment at `:132-136` is explicit about why: *"The cost of a wrong `true` is one
flush that fails and backs off… The cost of a wrong `false` is a queue that never
sends. Only one of those is recoverable without a person noticing."* The `nudge`
documentation at `:373-380` goes further and names this exact hazard:
`addNetworkStateListener` *"leaves it `undefined` on some configurations, and
`undefined === true` is false — so the engine can sit believing it is offline on
a phone showing four bars."*

**The listener then does precisely that.** `event.isConnected === true` collapses
`undefined` and `false` into one answer, and it is the unrecoverable one. Once
`online` is `false`, `tick()` takes the branch at `engine.ts:159-163`: schedules
another tick in 30 seconds, publishes, and returns **without flushing or
pulling**. The only ways out are a later event reporting `isConnected === true` —
which never comes on a configuration where the field is always `undefined` — or
`nudge({force: true})`, which is a human pressing "Try sending now". `startSync`
does not reset it, and `AppState` resume calls `wake()` → `nudge()` **without**
`force` (`triggers.ts:47-50`), so it schedules a tick that immediately takes the
offline branch again.

So on an affected device the app boots online, syncs normally, receives one
network event, and then silently stops syncing for ever behind a chip that says
whatever `currentState()` says. **The manual button works, which is exactly why
this survives testing: the person who checks presses it.**

Nothing in the suite catches it — `tests/unit/online.test.ts` and
`tests/offline/manual-sync.test.ts` both call `setOnline` directly with booleans,
so the translation from `NetworkStateEvent` to boolean is untested.

**To do**

- [x] `if (event.isConnected !== undefined) setOnline(event.isConnected)` —
      report only what the OS actually said. The `nudge` comment already argues
      for this; the listener never got the memo.
- [x] Test the translation, not just `setOnline`.
      `tests/unit/network-trigger.test.ts` drives the registered listener with a
      mocked `expo-network` and asserts that a silent event says **nothing** to
      the engine — the assertion that was missing, since both existing suites
      call `setOnline` directly with booleans and never exercise the line that
      chooses which boolean.

## N-3 · `medication:update` can produce a treatment the withdrawal engine ignores — **P1, latent**

**Verified, all three legs, with a throwaway contracts test.**

`packages/contracts/src/entities/livestock.ts:402-406` enforces the subject
invariant on create:

```ts
.refine((v) => (v.flockId === undefined) !== (v.animalId === undefined), {
  message: 'A treatment needs exactly one of flockId or animalId.',
});
```

`medicationUpdateSchema` at `:409` is `z.object(medicationShape).partial().strict()`
— **the refine is not carried over.** `payloadSchemaFor('medication','update')`
returns that schema, and it is the only validation on the update path at both
ends (`queue.ts:37-47` client-side, `apply.ts:83-87` server-side). `apply.ts:190`
then does `$set: {...payload, ...stamp}`, which merges into the existing
document. So one update carrying both fields — or an update adding `animalId` to
a treatment that already had `flockId` — produces a stored treatment carrying
both.

`packages/contracts/src/withdrawal.ts:84` then resolves the subject as
`treatment.flockId ?? treatment.animalId`. **`flockId` wins unconditionally, so
the treatment holds produce for the group and holds nothing for the animal it
also names.** `read/withdrawals.ts:83-85` filters by
`t.flockId === subjectId || t.animalId === subjectId` — the OR — so
`treatmentsFor(animalId)` *lists* the treatment while `activeWithdrawals` at
`:89` skips it and `holding` comes back empty. The screen shows a treatment
against the animal and reports no withdrawal in force.

**Honest scoping: this is latent, not live.** `TreatmentScreen.tsx:154` always
writes `flockId: groupId` and never sets `animalId`, and every reader queries by
group id, so today's app cannot reach it. It is worth recording anyway because
the server accepts it from any client right now, and the direction of the error
is the one this codebase repeatedly says it must never make —
`read/withdrawals.ts:51-61`: *"it errs in the dangerous direction… That is the
error this app is written to never make."* A false clear on milk or meat is a
regulatory event, not a UI glitch. The schema has supported per-animal treatments
since it was written, so this goes live in the feature that is specifically about
individual animals.

**To do**

- [ ] Make `withdrawal.ts:84` return **every** subject the treatment names rather
      than the first one. This is the safer default because it errs long.
- [ ] Re-apply the subject invariant on update. It cannot be expressed on a
      partial, so it needs a check against the *merged* document — an
      applier-level assertion in `projections.ts`.
- [ ] Audit the other `.partial().strict()` update schemas for refines dropped
      the same way.

## Checked and found sound

Recorded so nobody re-walks them:

- Every payload schema in `packages/contracts/src/entities/` is `.strict()`, so
  no client can write `archivedAt`, `createdBy` or `orgId` through `$set`.
  `apply.ts:171-186` stamps `createdBy` after spreading the payload, so it cannot
  be forged even if a schema slipped.
- `mayChangeNote` (`entities/notes.ts:139-146`) returns `false` for a hand when
  `createdBy` is `undefined`, so legacy notes are not editable by everyone. The
  `authorId` field in `noteCreateSchema` is display-only and never consulted by
  the applier.
- `verifyAccessToken` (`auth/tokens.ts:56-75`) passes a `Uint8Array` key to
  `jwtVerify`, which restricts algorithms to HMAC — no `alg: none` confusion.
- `scoped.findMany`'s default `limit: 200` (`db/scoped.ts:151`) is a real footgun
  but both call sites pass an explicit limit.
- The `'sending'` outbox status (`db/schema.ts:18`) is read in two places
  (`sqlite-store.ts:695`, `sync/photos.ts:126`) and **written nowhere**. Harmless
  — both readers are conservative in the safe direction — but it is dead, and the
  two comments reasoning about it read as though it is live.

---

# Build, packaging and infrastructure

A third audit, reviewed 15 August 2026, covered ground none of the above touches:
the container, the workspace linker, the test topology, and the host config. It
is kept as its own section rather than folded into P0–P3 because its scope is
disjoint — nothing here is a sync defect, and nothing above is a build defect.

Severity is noted per item against the same scale.

## B-1 · CI never builds or boots the container — **P2**

**Confirmed.** `.github/workflows/ci.yml` has no docker step of any kind. The
image is therefore completely unexercised until Fly boots it.

That matters because of what `.npmrc` gives up. `node-linker=hoisted` flattens
the tree, and the file says so plainly: *"A flat tree means a package can
`import` something it never declared — pnpm's strictness is the thing being
given up, and it is a real guarantee."* That is a deliberate trade for being able
to build the Android app on Windows at all, and it is the right trade. But the
Docker build then runs `pnpm install --frozen-lockfile --filter "@steading/api..."`,
so an undeclared import resolves everywhere a developer looks — local dev, `pnpm
test`, CI — and is **absent only in the container**.

There is no compile step to catch it, so the failure is `MODULE_NOT_FOUND` at
boot. The `/health` check in `fly.toml` with its `grace_period` means a release
that crashes this way fails rather than replacing a working machine, so the blast
radius is a failed deploy, not an outage. It is still the only gate.

**Do not fix this by unwinding the hoisting.** That re-breaks the Windows build
for a problem CI can catch directly.

### Verification (15 August) — the gap is confirmed, but two claims in it are wrong.

- **"Absent only in the container" is wrong.** `deploy.sh:112` runs the *same*
  filtered install on the Oracle box: `corepack pnpm install --frozen-lockfile
  --filter "@steading/api..."`. The box's tree is narrow for the same reason the
  image's is, so the primary production host has the identical hole. The image
  narrows further — `--prod` at `Dockerfile:75` also strips devDependencies,
  which the box keeps — so there is a second class of failure that reaches only
  the container.
- **"The blast radius is a failed deploy, not an outage" is refuted for the live
  path.** That reasoning holds for Fly, but Fly appears not to be the live
  deployment: `eas.json:25` compiles `https://api.swbuild.dev` into the APK,
  `deploy.sh:197` defaults `STEADING_DOMAIN` to the same, and `fly deploy`
  appears exactly once in the docs (`OPERATOR.md:328`). On the real path
  `deploy.sh:213` restarts the service, `:334-341` polls ten times, and
  `:343-351` then **explicitly refuses to roll back** — *"Rolling back
  automatically would be worse than stopping"* — and exits 1. The API stays down
  until a human intervenes. **That is an outage.**
- **Understated in the audit's favour: there is no current violation.** Every
  non-relative import in `apps/api/src` — `@node-rs/argon2`, `@steading/contracts`,
  `fastify`, `jose`, `mongodb`, `ulid`, `zod`, plus `node:` builtins — is declared
  in `apps/api/package.json`. This is a latent gap, not a live defect, and
  "Confirmed" could be read as "something is currently broken". Nothing is.

**To do**

- [ ] A CI step that builds `apps/api/Dockerfile` and boots the container against
      `/health`. Turns an invisible runtime failure into a red check, and also
      catches the devDependency class the box does not have.
- [ ] Correct this item's blast-radius sentence: on the Oracle path the failure
      mode is a hard outage requiring manual recovery, not a failed deploy.

## B-2 · The Dockerfile comment closes off an option it never evaluated — **P3**

**Confirmed.** The image runs the TypeScript source through `tsx`
(`CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/server.ts"]`), which is why
`tsx` sits in `dependencies` rather than `devDependencies`.

The reasoning is documented at length and considers exactly two alternatives —
Node's own type stripping and `tsc` output — rejecting both because extensionless
imports under `moduleResolution: bundler` defeat them. It then concludes *"Either
route means rewriting every import in the service."*

**There is a third route, and it does not.** A bundler built for Node — `esbuild`,
`tsup` — resolves extensionless specifiers as a matter of course, strips the
types, and emits plain JavaScript. The conclusion is true of the two options
examined and false in general.

The comment is the correction here, independent of whether the runtime changes.
In this repo comments are read as the architectural record, and one that forecloses
an option it never tested is worse than silence — it stops the next person looking.

Whether to *act* on it is a genuine preference call, and the Dockerfile's real
argument deserves to be weighed rather than skipped: *"the deployed process and the
local one are the same code path — worth more here than a build step, in a repo
whose expensive failures have all been environment drift."* That is defensible.
Re-decide it against a bundler; do not assume the answer changes.

### Verification (15 August) — fair characterisation, zero operational impact.

Nothing breaks and nothing is at risk. This is a documentation-completeness
finding in a repo whose comments are treated as the architectural record; the
harm is a future engineer reading the comment and not looking further. P3 is
right. The "same code path" argument is genuinely strong and the audit is correct
to say it should be re-weighed rather than assumed to lose.

**To do**

- [ ] Correct the comment so it names the bundler route and says why it was not
      taken.
- [ ] Optional, separately: evaluate `esbuild`/`tsup` against the same-code-path
      argument. Image size is a weaker motive than it first appears — the image
      already carries production dependencies only.

## B-3 · The vitest parallelism comment contradicts itself — **P3**

**Confirmed.** `vitest.config.ts:117` sets `fileParallelism: false`, explained as:
*"Each file gets its own database harness, so let them run in isolation rather
than racing for the same collections."*

**Both halves cannot be true.** If every file genuinely had its own harness there
would be nothing to race for. Something is shared — almost certainly the database
name — and the comment hides which, so the constraint reads as inherent when it is
incidental.

### Verification (15 August) — **the central claim is wrong. Both halves are true.**

Traced rather than inferred. `startTestDb(dbName = 'steading')`
(`tests/support/mongo.ts:42`) has two modes. With `MONGODB_TEST_URI` set
(`:43-46`, which is how CI runs it — `ci.yml:67`) every file connects to *one
shared mongod* and picks a database by name. Without it (`:48-53`) each file
spawns its own `mongodb-memory-server` and is genuinely isolated.

The twelve call sites do not all pass distinct names. Seven do
(`steading_promo`, `steading_claim`, `steading_purchase`, `steading_invites`,
`steading_photo_bytes`, `steading_stock`, `steading_sync`). **Five share one
name, `steading_isolation`:** `removed-member.test.ts:28`, `sign-in.test.ts:15`,
`refresh.test.ts:15`, `sync-tenancy.test.ts:24`, `auth-routes.test.ts:15`. And
those five destroy shared state — `sign-in.test.ts:31-34` is a `beforeEach` doing
`deleteMany({})` on `users` and `orgs`. Run two of them concurrently against a
shared `MONGODB_TEST_URI` and one file's `beforeEach` wipes the other's fixtures
mid-test. That is precisely, literally "racing for the same collections."

So both halves hold simultaneously: every file *does* get its own harness (own
`TestDb`, own `MongoClient`, own `stop()`), and five of them *do* race for the
same collections, because the harness is per-file while the database *name* is
not. **The comment is imprecise, not self-contradictory**, and the audit reasoned
from a contradiction that does not exist to "something is hidden". Its guess at
what is shared happens to be right, arrived at by rejecting a premise that holds
— worth recording as the same shape of error the provenance section warns about.

A second shared item argues for the setting independently and both the audit and
the original item missed it: all twelve files mutate `process.env.MONGODB_URI`.

**To do**

- [ ] Correct the comment to say the harness is per-file but the database name is
      not always, and that it bites only when `MONGODB_TEST_URI` points several
      files at one server. Name the `process.env` sharing too.
- [ ] Give the five `steading_isolation` files distinct names and tear them down,
      which removes the collection race. Note it does **not** remove the reason
      for `fileParallelism: false` on its own, because of the `process.env`
      mutation.
- [ ] Correct this item: "both halves cannot be true" is false.

## B-4 · `TRUSTED_PROXY_HOPS` is coupled to deployment topology — **P3, ops note**

**Confirmed, and working as designed.** `fly.toml` sets `TRUSTED_PROXY_HOPS = "1"`
for Fly's single forwarding hop, and explains exactly why a count rather than
`true`. `tests/unit/guards.test.ts:268-291` refuses a non-count value at startup
rather than at request time.

The hazard is real but future: put Cloudflare or a load balancer in front and the
hop count becomes two. Miss the update and `request.ip` collapses to the proxy for
every caller, so **one failed sign-in throttles the whole farm** — every limiter in
the service keys on that address.

No code change. This belongs written down where somebody adding a proxy layer will
see it.

### Verification (15 August) — confirmed, correctly filed.

Zero impact today; reachable only by a future topology change. The proposed fix is
the right one, with one addition: the note should name **both** failure
directions. Too few hops throttles the whole farm; too many lets a caller spoof
`request.ip` through a forged header, which is the invariant-10 breach and the
more dangerous of the two.

**To do**

- [ ] Note the coupling in `DEPLOY-THE-SERVER.md` next to the proxy configuration,
      naming both the too-few and too-many failure directions.

## Reviewed and rejected — the tenancy guard critique

The same audit argued that lint-enforced tenancy scoping is brittle and that the
Mongo driver should be moved out of the API's dependency tree into
`packages/core`. **Rejected, for three reasons, recorded so it is not re-opened:**

1. It is not regex matching. `eslint.config.mjs` uses `no-restricted-syntax` AST
   selectors, which is a parsed match against the syntax tree.
2. It does not fail silently. `tests/unit/guards.test.ts:241` asserts the rule
   still bans raw collection access, so a parser or ESLint change that disarmed it
   fails the suite. That is the config's own stated point: the tests are *"what
   makes them guarantees rather than intentions."*
3. **`packages/core` is the client package.** It ships inside the APK. Moving the
   Mongo driver there aims a server dependency at the client bundle, against
   invariant 12.

And the decisive one: **the proposed fix is defeated by B-1.** Dependency-tree
encapsulation enforces nothing under `node-linker=hoisted`, because a flat tree
lets any file import anything regardless of what its manifest declares. A separate
data-access package may still be worth having for clarity. It would buy no
enforcement, and must not be mistaken for a security boundary.

**Verification (15 August):** reason 3 checked and confirmed — `apps/mobile`
imports `@steading/core` directly, so `packages/core` does ship inside the APK.
The rejection stands.

## Already covered above

The audit's point about native mocks producing false confidence is real and is
already logged in **P3 — "No device-level CI."** Cross-referenced rather than
duplicated.

---

# Test gaps these expose

**Measured 15 August at `3b37cc8`, not estimated.** `pnpm vitest run` reports
**159 passed, 11 skipped (170 files); 2,249 passed, 136 skipped (2,385 cases)**,
from 1,994 textual `it(`/`test(` declarations and 517 `describe` blocks. The
original figure — "169 files, ~1,900 declarations" — was accurate when written
and has drifted by one file.

Two things the original does not say and should:

- **136 of those cases do not run without a mongod, and that set is exactly the
  security-critical one** — every `tests/isolation/*` suite and both
  `tests/sync/*` suites. `tests/support/mongo.ts:57-61` makes
  `STEADING_REQUIRE_DB=1` a hard failure and `ci.yml` sets it against a `mongo:8`
  service container, so CI genuinely runs them. But a developer's local green run
  is 136 tests lighter than it looks, and the lightest part is tenancy.
- **The harness has no concept of a second device at all.** Not a helper, not a
  fixture, not one test. `tests/support/fixtures.ts:4` hardcodes a single
  `DEVICE_ID` and a module-level `seq`; `tests/support/store.ts` drives one store
  through the module-global `setLocalStore`. **Every claim in this document about
  what device B sees is therefore untested from both ends**, and building that
  harness is a prerequisite for four of the seven tests below.

**Correction to the P0-1 test claim.** The original cites
`idempotency.test.ts:54-79` and says the file "never inspects projection state
after a duplicate". The first half is right — the tamper test is at **`:66-80`**,
and it asserts `after?.payload` and `after?.serverTs` against the log only. The
second half is wrong as a statement about the file: the second describe block
(`:164-278`) inspects projection state after duplicates repeatedly — `:185-202`
replays `[created, removed]` and asserts `eggLogs` still holds one document,
`:223-255` drives the hour-meter lockout through `hourReadings`, `:262-277`
asserts a hand's rejected update left `count` at 12.

**The gap is the intersection, not the projection**: no test replays a duplicate
ULID with a *changed* payload and *then* looks at the projection. `:66-80` changes
the payload and reads only the log; `:185-202` reads the projection and replays an
identical payload. That is a sharper statement and it is the one that tells you
what to write — and note that per P0-1's verification block, adding a projection
assertion to `:66-80` as it stands would **pass**, because an append-only create
against an existing target is a `noop`. A test that bites has to use the
hour-reading reject-then-correct shape, or an `update`.

**What the suite is good at**, recorded because "thin on interleavings"
undersells it: nearly every test names the failure it prevents and those failures
are real; the seams are tested rather than mocked around (`tests/support/sqlite.ts`
runs the real `LocalStore` on real SQLite, and the `expo-sqlite` fake opens a
genuine second connection because `withExclusiveTransactionAsync` does);
`simulateRestart()` (`tests/support/store.ts:43-49`) abandons the handle rather
than closing it and `freshStore()` uses a file rather than `:memory:` so the
distinction exists at all; and injury helpers (`corruptRow`, `corruptRecordRow`,
`deleteOutboxRow`, `deleteMetaKey`) let a test write behind the store's back.
Single-process ordering is also well covered — `pull.test.ts:143-182` proves a
reversed page is re-sorted and ties break on the ULID.

It is a suite built by someone fixing bugs one at a time and writing a test per
bug. Excellent at "this exact thing must not happen again", structurally unable
to express "two devices disagree".

Add, alongside the existing sync tests:

- [ ] **A two-device harness first.** `openSqliteStore(driver, ids)` is already
      callable directly with an independent driver, so the pieces exist; what is
      missing is a second `DEVICE_ID`, a per-device `seq`, and a way to drive two
      stores without the module global. Four of the tests below depend on it.
- [ ] Duplicate ID carrying a changed payload → projection unchanged, log
      unchanged. **Use the hour-reading or `update` shape, not an append-only
      create.**
- [ ] A rejected mutation observed from a **second** device → absent, not applied.
- [ ] A conflicted update against an archived record → stays archived everywhere.
- [ ] Late insertion behind an advanced cursor → still delivered.
- [ ] Projection order reversed against log order → server and clean replay agree.
- [ ] Crash between log write and projection → repaired, not duplicated. **Needs
      a seam that does not exist**: `applyMutation` takes no clock and no hook.
- [ ] Farm Hand photo, end to end, across two devices.
- [ ] N-1: hand creates a group, server rejects, hand discards → record gone.
- [ ] N-2: a `NetworkStateEvent` with `isConnected: undefined` → the engine does
      not go offline.
- [ ] N-3: `medication:update` carrying both `flockId` and `animalId` → refused,
      or the withdrawal holds for both subjects.
- [ ] Concurrency tests for P1-7 (a), (b) and (c). None exist; the codebase
      already does concurrency correctly elsewhere and tests it with
      `Promise.all`, so the pattern is there to copy.

---

# Suggested order

From the verification pass, with the dependencies that force it:

1. **P0-2 merged with P0-1's stored-envelope fix, as one server-only change.**
   They are not two items: the same `outcome` field and the same re-projection
   path solve both, and shipping either alone leaves the other worse —
   skip-projection without the outcome field loses records, and the outcome field
   written naively after `project()` reintroduces an ambiguous absence that
   P0-1's duplicate branch is the natural place to repair. Server-only means it
   reaches every handset already in the field on deploy: no APK, no migration, no
   wire change. Carry **P2-1's `exit 0`** in the same push — the restart loop is
   what turns the crash window into something a farm hits.
2. ~~**N-1**, beside it. Same confusion, opposite direction, and no server change
   fixes it.~~ **Done for the create case**; the `update`/`delete` residue and
   the `checkIntegrity` phantom detection remain.
3. ~~**P1-2** and **N-2**. Both cheap, both high-frequency, both invisible to the
   person affected.~~ **Both done.**
4. **P1-1**, which unblocks ever putting a new field on the wire — including
   P0-2's optional outcome — and is a prerequisite for the P3 flush-parsing fix
   shipping in the right order.
5. **P0-3**, after the outcome work has settled underneath it, since the mutex
   wraps the same critical section.
6. **P1-5(a)** with the `tickets` wipe fix ahead of it, then P1-3, P1-4(c).
7. **P0-1's fresh-ULID work**, with the correction editor it exists to support.

---

## Provenance

Four passes have been made over this tree, on 14 and 15 August 2026.

The first was **not accurate** and is recorded here only so it is not acted on
later by mistake: it reported queue head-of-line blocking (refuted by
`MAX_ATTEMPTS` and `rejectExhausted` in `flush.ts:27`), brittle migrations
(refuted by the additive ladder in `db/migrations.ts`), no merge strategy
(refuted by per-field `$set` at `apply.ts:201`), and no API versioning (refuted by
`MIN_ACCEPTED_SCHEMA_VERSION` at `apply.ts:32`). It appears to have been written
from `CLAUDE.md` rather than from the source.

The second produced P0-1 through P3. Six of its findings were tested against the
code and six confirmed — all three P0s and P1-1, P1-2, P2-1. The unverified
remainder is carried on that record and marked **Trusted** throughout. It was
explicit about its own limits, and correct about them: it could not run `tsc`,
ESLint, Vitest, or Metro, and guessed that the missing `pnpm-lock.yaml` was an
artifact of its snapshot rather than a repository defect. It is.

The third produced the build and infrastructure section, and sits between the two
on accuracy. Every item in B-1 to B-4 was checked against the file it names and
confirmed. Its tenancy argument is rejected above. Two smaller things are worth
recording, because they are the shape of error to watch for in anything else from
the same source: it labelled AST selectors as regex, and it asserted a specific
development CPU that appears nowhere in this repository. **Invented supporting
detail alongside correct findings is the hardest kind to catch** — the findings
check out, so the details get read as though they were checked too.

The fourth is the 15 August verification pass, and it is the first that could run
the suite. Every finding above was re-derived from source by a reader instructed
to refute it; the test counts are measured, N-1 and N-3 were confirmed by running
code, and B-3's premise was traced through all twelve `startTestDb` call sites
rather than inferred. Twenty-four of twenty-five findings survived. What it
changed is listed at the top.

**It also found the warning above coming true inside this document.** The P3
photo bullet asserted that uploads are unchecked for size and media type; both
are enforced, twenty lines above the code the bullet was evidently written from,
and the one surviving claim named the wrong mechanism. Correct findings sat
beside it, which is exactly why it read as checked. The lesson holds in both
directions: **a document that grades its own sources still needs somebody to
grade it.**
