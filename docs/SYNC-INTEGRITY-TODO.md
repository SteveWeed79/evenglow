# Sync integrity — outstanding work

**Written 14 August 2026 and extended 15 August, from static audits of the tree
at `4064c89`. No code has been changed.** This file is a work list, not a spec.
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

**Multi-device rollout should wait for P0-1 through P0-3.** Single-device
offline use is unaffected by all three.

---

## How to read the status column

| | |
|---|---|
| **Confirmed** | I read the code at the cited lines and reproduced the reasoning. Cited `file:line` refs are against `4064c89`. |
| **Trusted** | Reported by the audit, consistent with the code I did read, but not independently walked. Triage before scheduling. |

---

# P0 — release blockers

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

**To do**

- [ ] On a duplicate ID, project from the **stored** envelope rather than the
      request — or skip projection entirely and return the stored terminal
      result. One change at `apply.ts:139`.
- [ ] Make `retryRejected` mint a **fresh ULID** for the corrected payload
      instead of rewriting in place, so a correction is its own command with its
      own audit row. Keep the link to the original for the inbox UI.
- [ ] Decide what a duplicate ID carrying a *different* envelope should be. It is
      not `duplicate`; it is a client bug or an attack, and it should be
      `rejected` and logged as such.

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

**To do**

- [ ] Add a terminal `outcome` to the mutation document, written after
      `project()` returns — `applied | duplicate | rejected | conflict | noop`.
- [ ] Filter `readSnapshotPage` to accepted effects only. The watermark must
      still advance past the excluded rows, the way the unknown-entity skip at
      `snapshot.ts:99-104` already does.
- [ ] Decide whether the feed carries the outcome so clients can *show* a refused
      command, or simply omits it. Omitting is smaller; showing is friendlier to
      the inbox on the device that issued it. Do not do both by accident.
- [ ] Backfill `outcome` for existing rows. Anything already in the log predates
      the field and will otherwise be filtered out or let through wholesale
      depending on how the query is written — pick deliberately and write down
      which.

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

**To do**

- [ ] Replace the cursor with a server-assigned **monotonic per-org sequence**
      allocated at commit, not at request start.
- [ ] Whatever replaces it, the number must be assigned in the same operation
      that makes the row visible. Assigning it earlier is the whole bug.
- [ ] Tests: late insertion behind an advanced cursor, projection order reversed
      against log order, and a clock rollback.

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

**To do**

- [ ] Let the client skip unknown rows without failing the page, the way the
      server already does — or negotiate a capability set at pull time.
- [ ] Correct the comment at `mutation.ts:15` either way. It is currently load-
      bearing and wrong, which is worse than absent.

## P1-2 · A Farm Hand cannot finish a photo

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

**To do**

- [ ] Either permit `photo:update` for a hand when it sets only `uploadedAt`, or
      stamp `uploadedAt` server-side in `routes/photos.ts` and drop the client
      mutation. The second is smaller and removes a mutation from the wire.
- [ ] Add the cross-device hand workflow as one test: create, upload, and a
      second device fetching the bytes.

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

**To do**

- [ ] Keep `expiresAt` in the stored pair and refresh ahead of it.
- [ ] One refresh-and-retry path on 401, shared by every authenticated call.
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

**To do**

- [ ] Make auth state, org selection, store handle, and engine state one
      serialised transition with a generation number the engine checks before it
      flushes.
- [ ] Close or blank the outgoing store at sign-out rather than at next boot.

## P1-6 · An interrupted restore can leave an archived record live

**Trusted.** `packages/core/src/backup/restore.ts:282-313` recreates an archived
entry as two queued mutations — `create`, then `delete`. A crash, a full disk, or
a failed second transaction between them leaves the record **live**. On resume the
planner treats the key's presence as sufficient and skips the entry
(`restore.ts:216-252`) without comparing archive state, so the missing archive is
never repaired.

The interruption tests stop between entries, not between the two operations that
make up one entry.

**To do**

- [ ] Compare archive state, not just key presence, when resuming.
- [ ] Better: make an archived entry one mutation rather than two.

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

**To do**

- [ ] Enforce these in the database — unique partial indexes, or a transaction —
      rather than in the handler. A precheck and an act are two statements and
      something can always happen between them.

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

**To do**

- [ ] `exit 0` after the nothing-to-deploy branch. One line.

## P2-2 · APK promotion is not bound to the released commit

**Trusted.** CI starts a `preview-farm` EAS build, but deployment asks for the
newest finished Android build with no constraint on profile, branch, commit,
build ID, or workflow run (`scripts/deploy/deploy.sh:238-270`). `eas.json:8-27`
defines other APK-producing profiles including a development client.
`publish-apk.sh:71-101` checks the artifact is a ZIP holding an Android manifest,
but not its application ID, signing certificate, profile, or source commit.

**A manual, development, or unrelated-branch build can therefore become the APK
served at `/app`.**

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

**To do**

- [ ] A timer, a service, and an alert on absence — a backup nobody is told about
      is not a backup.
- [ ] Refuse a restore into a non-empty database unless explicitly forced.
- [ ] Restore-test on a schedule. Untested backups are a belief, not a control.

## P2-4 · `/health` does not check the database

**Trusted.** `apps/api/src/server.ts:53-58` reports process liveness only, and
Mongo connects lazily — so deploy gates and Fly checks can read healthy while
every data route is failing.

**To do**

- [ ] Split liveness from readiness; have readiness ping Mongo.

---

# P3 — worth fixing, not urgent

Carried from the audit, all **trusted**, none independently walked:

- **Google account binding.** A verified Google address is bound to an existing
  password account with no password or session confirmation
  (`apps/api/src/routes/auth.ts:284-303`). Risky for reassigned Workspace
  addresses. `googleSub` also has no unique index.
- **Referential integrity is schema-shaped, not enforced.** Parent IDs are
  accepted without checking the referent exists, so out-of-order sync or a
  crafted client creates permanent orphans.
- **No conflict token.** Concurrent updates are silent shallow last-writer-wins,
  with no base version or ETag. Concurrent hour readings do read-highest-then-
  insert with no serialisation.
- **History grows without bound.** Server mutations and applied outbox rows are
  never compacted; a new device eventually replays the entire farm history.
- **Backups load as whole JSON strings** with unbounded arrays — a large or
  hostile file can exhaust mobile memory.
- **Observability is thin.** Errors are logged; request IDs, metrics, queue age,
  rejection rate, and replication lag are not.
- **Fastify listens on `0.0.0.0`** while the Caddy docs describe it as loopback
  only. The host firewall covers it; an accidental port exposure would not be.
- **Photo uploads are not checked** against declared size or media type, and the
  download response is marked immutable though privileged users can replace bytes.
- **The local wipe skips the `tickets` table**, which can hold full record data.
  Sign-out does not currently call wipe, so this is latent rather than live.
- **Flush response parsing is loose** — it checks only that `results` is an array,
  unlike the strict pull boundary. Malformed entries read as rejections.
- **Unauthenticated support submissions** can inject Markdown and mentions into
  generated GitHub content and influence dedup fields. Billing notifications are
  also unauthenticated with no endpoint-specific limit.
- **CI pins mutable major tags** rather than revisions or digests.
- **No device-level CI.** Screen tests use non-rendering mocks and there is no
  Android instrumentation, so native SQLite behaviour, lifecycle races, secure
  storage, and camera recovery rest on manual testing.

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

**To do**

- [ ] A CI step that builds `apps/api/Dockerfile` and boots the container against
      `/health`. Turns an invisible runtime failure into a red check.

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

**To do**

- [ ] Correct the comment to name what is actually shared.
- [ ] Optional: give each file a uniquely named database and tear it down after,
      which removes the reason for the setting and returns the cores. Worth doing
      only once the comment is honest about why it is there.

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

**To do**

- [ ] Note the coupling in `DEPLOY-THE-SERVER.md` next to the proxy configuration.

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

## Already covered above

The audit's point about native mocks producing false confidence is real and is
already logged in **P3 — "No device-level CI."** Cross-referenced rather than
duplicated.

---

# Test gaps these expose

`tests/sync/idempotency.test.ts:54-79` asserts log row count and immutability. It
never inspects **projection state** after a duplicate, which is exactly where
P0-1 lives. The suite is large — 169 files, ~1,900 declarations — and strong on
static invariants; it is thin on interleavings.

Add, alongside the existing sync tests:

- [ ] Duplicate ID carrying a changed payload → projection unchanged, log unchanged.
- [ ] A rejected mutation observed from a **second** device → absent, not applied.
- [ ] A conflicted update against an archived record → stays archived everywhere.
- [ ] Late insertion behind an advanced cursor → still delivered.
- [ ] Projection order reversed against log order → server and clean replay agree.
- [ ] Crash between log write and projection → repaired, not duplicated.
- [ ] Farm Hand photo, end to end, across two devices.

---

## Provenance

Three audits have been reviewed against this tree, on 14 and 15 August 2026.

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

None of the three audits was able to run the test suite. Everything above is
static reading, which is exactly why the test gaps below are the part most likely
to be incomplete.
