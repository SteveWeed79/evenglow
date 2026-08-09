# Design Brief — the state of Steading before the next design run

**Audit date: 9 August 2026.** Six independent readers surveyed the codebase against
CLAUDE.md, UX-SPEC, the masterplan and the roadmap; every finding was then
adversarially re-checked by a separate reader against the code. 47 confirmed, 13
corrected as overstated, 1 refuted and dropped.

This document exists so the design run starts from what is true rather than from
what the docs claim. Where this disagrees with `ROADMAP.md`, this is newer.

---

## 0. The verdict in one paragraph

The hard parts are done and they are genuinely well built — the sync engine, the
tenancy mechanism, the auth rotation, the offline store. The app is close to
functionally complete for *writing* records and a long way from complete for
*correcting* them: sixteen entities are mutable in the contract, the UI can create
six and archive three. And there is nothing between "runs on the developer's
machine" and "an APK on somebody else's phone" — no launcher icon, no deploy
target, no Android build in CI.

The charm was not thought out of the app. **It was specified, framed, and then
left unbuilt.** Eleven empty states contain a literal empty `<View>` where a
hand-drawn mark was supposed to go. That is the whole complaint, in code.

---

## 1. What is good — do not let the design run break these

1. **The sync cursor is right, and it is the subtlest thing here.** Pagination
   seeks past the `(serverTs, _id)` pair rather than past the timestamp, so a page
   boundary landing mid-millisecond cannot silently drop sibling rows — the failure
   that surfaces months later as one device quietly missing records. The client
   persists both halves inside the same transaction as the records and re-sorts
   with a matching ULID tiebreak. `pull.test.ts:119` drives two pages sharing one
   `serverTs` and proves it.

2. **`scoped()` is a mechanism, not a policy.** `guardFilter` spreads the caller's
   filter first and `orgId` last; `assertSafeUpdate` walks every `$`-operator's
   field roots and refuses `orgId`/`_id`, closing the push-into-another-tenant hole
   a filter guard alone leaves open; `upsertOne` merges `orgId` into `$setOnInsert`
   so a lost upsert race still lands in the right tenant. No unscoped variant, no
   escape hatch, lint- and CI-enforced.

3. **Enqueue atomicity is real.** One transaction mints the sequence number,
   writes the outbox row, advances the counter and projects. When `nextClientSeq`
   is missing it takes `MAX(clientSeq)+1` from the outbox as a floor rather than
   restarting at zero — the difference between a lost counter and silently reused
   sequence numbers. The restart test abandons the handle rather than closing it,
   because closing flushes and a force-stop does not.

4. **Refresh rotation and family revocation.** `consumeRefreshToken` is one
   conditional update filtered on `usedAt` and `revokedAt` absent, so two
   concurrent exchanges cannot both win and the loser is treated as reuse.
   `rotateSession` re-derives `orgId` and role rather than carrying old claims, so
   a 90-day refresh token is not a 90-day snapshot of authority.

5. **D14 is real.** Boot has no signed-out branch — the only question is whether a
   database is open. The app opens with no account, no network and no server
   address. `ensureLocalOrgId` checks a retired-org list and adopts a lone database
   on disk before minting.

6. **Navigation is sound.** All 48 registered routes resolve and every screen file
   is referenced. Params are IDs everywhere, so process death restores correctly.
   No orphans.

7. **The screen titles are the best writing in the project.** "What happened."
   "Eggs under." "The shelf." "Your ground." "Needs a look." "What they gave."
   "Get your records out." Not one is a noun from the schema; every one is what a
   person standing in a yard would say; none is cute. **The design run must not
   touch these.**

8. **The due engine already speaks the farm's own names.** "Candle the Buff
   Orpington eggs." "Order layer pellets for the Nubians." "Eggs clear again after
   Baytril" — a specific animal, a specific drug, a specific relief. The machinery
   for a personal app exists and works.

9. **The second morning was reasoned about.** `careDues` sets a never-done job's
   due date to the group's creation plus grace days rather than to now, so a farm
   that adds three groups on Sunday does not open Monday to twelve overdue rows.

10. **All 26 entities have a client write path.** The "entities no screen can
    write" class is genuinely closed.

11. **Correction of append-only records is complete end to end** — the one thing in
    the app that is finished at every layer.

---

## 2. What is bad — defects, ranked

### Blockers

| # | Defect | Where |
|---|--------|-------|
| B1 | **Pulled mutations skipped for a pending `targetId` are discarded forever.** The watermark advances past them in the same pass, so they are never offered again. Silent, permanent, multi-device data loss. | `packages/core/src/sync/pull.ts` |
| B2 | **A single rejected mutation freezes that record's hydration permanently.** Rejected rows never leave the pending set, so every future pull skips that record for the life of the install. | `packages/core/src/sync/pull.ts`, inbox |
| B3 | **`resolveBatch` deletes outbox rows on success** — a direct contradiction of hard invariant 7 ("never delete a mutation row on success; mark it `applied`"). The audit trail and duplicate defence are both gone. | `packages/core/src/sync/flush.ts` |
| B4 | **`trustProxy: true`** makes every rate limiter in the service bypassable with one forged header. | `apps/api/src/server.ts` |
| B5 | **Under `NODE_ENV=production` a new `MongoClient` and connection pool is built on every `db()` call.** This falls over on first real traffic. | `apps/api/src/db/client.ts` |
| B6 | **The sync chip tells an account-less farm that N records are "waiting" — forever.** No account means `startSync()` never runs, so `syncHeld` is never written and the chip falls through to `queued`. It reads "3 waiting", then "1,400 waiting", in damson, on every screen. Per D13 this is a *supported permanent state*, and the app paints it as a fault. | `apps/mobile/src/components/SyncChip.tsx`, `sync/start.ts:132` |

### Major

- **A Play purchase token is not bound to one farm** — one subscription can entitle
  unlimited orgs.
- **The inbox is read-and-destroy.** A farmer can resend an identical payload or
  throw the record away, and never see what was wrong with it.
- **The conflict message tells the farmer to restore the record; nothing in the app
  can restore anything.**
- **Nothing removes a photo's bytes from the server or from other devices** —
  "Remove" deletes the local file only.
- **Milk and fibre render in raw storage units.** An imperial farm reads `3785 ml`
  beside its own summary in gallons.
- **Frost dates are typed from memory, and the screen's defaults are silently
  recorded as the farmer's own answer** — every growing date is then counted from a
  number nobody chose.
- **No way to remove a farm from a device.** `forgetDatabase` and `unsentCount`
  have no production callers.
- **The masterplan's session-hygiene rule contradicts the shipped code**, and the
  escape hatch it points to has no caller.
- **CLAUDE.md's mutation envelope is factually wrong** on the entity list and on
  append-only deletes (fixed for deletes as of this branch; the entity list is still
  14 of 26).
- **Load-bearing modules still carry comments describing Next.js, Capacitor and
  IndexedDB** — all three deleted.

---

## 3. What is missing — code that does not exist

Ranked by what blocks "fully functional" first.

1. **The edit half of the UI.** This is the largest gap in the product. Sixteen
   entities are mutable in the contract with `update`/`delete` schemas and server
   appliers; the UI can create six and archive three. Concretely: an **animal** can
   be created and never edited, archived or opened. A **treatment** cannot be
   listed, closed, corrected or removed — *and the withdrawal clock depends on it*,
   so a mistyped withdrawal period is permanent and the app will tell someone their
   eggs are safe when they are not. A **machine** cannot be renamed or retired
   (`AddMachineScreen` never even writes `model`). A **bed** cannot be opened,
   renamed or taken out of use. A **shelf item's** quantity is editable and nothing
   else is.

   > **Corrected while implementing this.** An earlier draft of this entry said an
   > unclosed course counts its withdrawal from *today*, so the produce it covers
   > never clears. That is wrong, and a failing test said so —
   > `tests/screens/treatments.test.tsx`. `withdrawalClearsAt` takes
   > `Math.max(administeredAt, treatmentEndsAt ?? 0)`, so a course left open counts
   > from the **first dose** and clears produce *early*, short by however long the
   > course actually ran. That is the dangerous direction rather than the merely
   > annoying one, and it makes the gap worse: a farm has no reason to go looking at
   > a withdrawal that has quietly expired ahead of time.
   >
   > **Treatments are done as of this branch** — a list on the group, the form
   > reused for editing, closing a running course, and removal.

2. **Births and hatches are dead ends.** The offspring exist in the world and
   nowhere in the app — no path from a `breeding` or `incubation` record to the
   animals or group it produced.

3. **Per-animal produce.** Milk and husbandry can only be recorded against a whole
   group, though the schemas and the reader already support the individual.

4. **You can only plant what the bundled library knows**, and the miss case renders
   a blank screen.

5. **The invite-acceptance client.** `POST /invites/accept` and `GET
   /invites/:token` are server-complete, tested, and have no caller. The email
   invite mints a token, calls it a link, shares it — and nothing can redeem it.

6. **No launcher icon and no splash.** An APK handed to anyone today wears the
   default Expo icon.

7. **No deployment target.** No container image, no process supervisor, no TLS, no
   reverse-proxy config. `pnpm --filter @steading/api start` runs TypeScript source
   through `tsx`, which is a devDependency. (Backup and self-hosted launchers do
   exist — the gap is the hosting layer specifically.)

8. **Nothing in CI compiles Android.** The native build is unverified by any
   automation, which is how the long-path failure reached a person instead of a
   runner.

9. **No password reset** for a password-only account whose owner is not on Google.
   The only recovery is an operator running `pnpm farm --new-password`. Adequate
   self-hosted, thin hosted.

10. **No way to pay.** The 402 gate is live and there is no billing library and no
    purchase flow, so the paid tier cannot be sold. (Promo redemption *is* built and
    tested, so a refused farm is not stranded.)

11. **UX-SPEC R9 — the Basic/Full toggle — has no implementation anywhere**, and
    the masterplan calls it the competitive differentiator.

12. **No boot assertion that the indexes exist**, and the signup duplicate-email
    guard depends on one.

---

## 4. Charm — the diagnosis

The owner's words: *"We have 'thought' all the charm out of the app."*

That is half right, and the half that is wrong matters more. The charm was not
reasoned away. **It was designed, scaffolded, and then never filled in.** Six
mechanisms, all of them code-level:

1. **Eleven empty states contain a literal empty `<View style={styles.spot}>`.**
   That container is where the hand-drawn spot mark goes. It is empty in all eleven.
   UX-SPEC §6 says "empty screens invite" and the invitation is a blank div. This is
   not taste — it is an unfinished feature with a placeholder still in it.

2. **The arch — the app's entire visual identity — is drawn on exactly one control
   in the whole app.** `Plaster`, `Worn`, `Arch` and `LampToggle` exist and are
   good. Forty-six screens render plain rows on plain panels.

3. **Nothing acknowledges a good thing happening.** All 36 `useSaver` call sites end
   in the same success haptic and no words at all; 24 of them then navigate away.
   `voice.ts` is small, tested and disciplined — `basketConfirmation` produces
   "Eighteen in the basket." — and it is wired to eggs at exactly **one** call site.
   `milestone`, `streak` and `leaderboard` return **zero matches across the entire
   repository**, though UX-SPEC §6 names all three.

4. **The app never says the farm's name**, though it collects and stores one. The
   personal machinery exists and works — the due engine and the history reader
   already say "Candle the Buff Orpington eggs" and "eggs clear again after Baytril"
   — but none of it reaches the screens a farmer looks at first, where the copy is
   generic.

5. **The copy drifted into an explanatory register.** The app explains its own
   architecture while somebody records a death. The screen *titles* stayed excellent;
   the body copy became a manual.

6. **Everything is one shape and one speed.** Every screen is title → panels → rows
   → one brass button. There is no in-screen motion: no component animates a state
   change, so every tally open, day expand and confirmation is a hard cut. (Screen
   transitions *are* animated natively — the gap is inside the screen.) The
   bright-sun theme is unreachable because `setTheme` is never called. The icon set
   contains no farm object, and the app's namesake lamp is an unfilled circle.

### Keep

- Every screen title.
- `voice.ts` and its restraint — it is the correct model for the missing
  acknowledgement layer: one module, one sentence per entity, opt-in rather than
  default.
- The `SyncChip` wording, and its refusal to paint the free tier red ("that is the
  nag").
- The `DueRow` "Tap again" fix — copy driven by an actual field report.
- The photo refusal: per-animal portraits were declined **on the record, with a
  reason** (`photos/store.ts:20`). A design run will reach for this as the obvious
  source of warmth. Reopening it is a product decision, not a bug fix.

### Cheapest charm per unit of work, ranked

| Payoff | Work | What |
|--------|------|------|
| High | Small | Fill the eleven spot marks. The container, the styles and the layout already exist. |
| High | Small | Say the farm's name — Today's header, the export, the backup, the account row. |
| High | Small | Wire `voice.ts` past eggs. One sentence per entity, on the screens that stay. |
| High | Small | Make the bright-sun theme reachable. `setTheme` exists and nothing calls it. |
| High | Small | Render milk and fibre in the farm's own units. |
| Medium | Small | Speak the species' own word — herd, drove, gaggle — instead of printing it as uppercase mono metadata. |
| Medium | Medium | The arch on more than one control. |
| Medium | Medium | Motion on expand/collapse and confirmation. |
| High | Large | Milestones and the streak. Named in UX-SPEC §6, absent from the repo. |
| Medium | Large | Icons of farm objects; a lamp that is lit. |

---

## 5. Sequence

### Before the design run

1. **The three data-loss defects: B1, B2, B3.** A design run layered on an engine
   that discards pulled records is wasted work.
2. **B4 and B5** — one-line-ish server fixes with disproportionate blast radius.
3. **B6, the "waiting forever" chip** — it is on every screen, and the design run
   will be looking at every screen.
4. **The edit half of the entity matrix**, at minimum treatment and animal. The
   withdrawal clock depending on an uncorrectable record is a safety issue, not a
   convenience one. The design run will be designing edit screens; they should
   exist first.

### The design run itself

Sections 4's cheap list, in order. The frame is built; this is filling it.

### After

Icon, splash, deploy target, Android build in CI, invite-acceptance client. None of
it blocks design, all of it blocks shipping.

---

## 6. Method, and what this audit does not know

Everything here is read from source. **Nothing in it was verified on a handset**,
which is exactly the class of evidence CLAUDE.md says to trust least. Half an hour
of actually logging eggs on a phone will say more about where the charm went than
this document does — and the audit's own strongest finding, the eleven empty
`<View>`s, is the kind of thing that is obvious in two seconds on a device and took
six readers to find in the source.

The MongoDB-backed suites (8 of 9 files) skip outside CI, so every server claim here
is read rather than executed.
