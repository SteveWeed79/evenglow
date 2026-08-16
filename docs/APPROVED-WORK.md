# Approved work

**The decided subset, as a checklist.** Everything here has been argued
somewhere else and agreed; this file is what to do, not why. The reasoning
lives in `UNCONSIDERED.md` (items `[n]`), `UNCONSIDERED-PHASES.md` (phases
A–P) and `GAP-ASSESSMENT-REVIEW.md` (the outside assessment, checked).

**Provenance is marked** so any line can be traced back and re-argued:

| Mark | Source |
|---|---|
| `[n]` | `UNCONSIDERED.md`, item number |
| **GA** | The August 2026 product gap assessment, verified against the code |
| **GA-c** | Same, adopted in changed form — the change is stated |

**What this file is not.** Not a roadmap and not an estimate. `ROADMAP.md`
still orders the product; the phases file still holds the dependency argument.
Nothing here is sized in hours, because shape is knowable and hours are not.

**Rejections are at the foot**, named with reasons, so the boundary of "agreed"
is unambiguous and nothing on the reject list gets quietly picked up later.

---

## 1. Fix now — verified defects

Each of these was confirmed by reading the code. Two are in files that comment
on the exact failure they then permit.

- [x] **Seed `SiteSetupScreen` from the site record.** **GA**
      It opens on hardcoded May 15 / Oct 5 and writes them over the farm's real
      frost dates on save, stamped `source: 'entered'`. Silent, and every sow
      window, transplant date, autumn count-back, brooding date and cold-birth
      warning reads those numbers. *Fix before anything else on any list.*
- [x] **Hold produce indefinitely on an open treatment course.** **GA**
      `withdrawalClearsAt` counts from the first dose when there is no end date,
      which clears produce while the animal is still being dosed. Safe to do
      because `stillGoing` initialises `false` — only an explicitly-open course
      would hold.
- [x] **Ask for the real last-dose date when closing a course.** **GA-c**
      Not in the assessment. Closing stamps today, so a course finished Tuesday
      and closed Friday invents three days of withdrawal — the safe direction,
      still a wrong number in a record a regulator may read.
- [x] **Audit every edit screen for the merge-clearing class.** **GA**
      *Done for the half that can be done, and the audit found the pattern was
      wrong.* `EditGroupScreen` now always sends `purposes`, so removing the
      last one works. See the item below for the rest.
- [ ] **Give the wire a way to say "clear this field".** *(found while fixing
      the item above)*
      `TreatmentScreen`'s established fix — name every optional field, with
      `undefined` where it is now absent — **clears the device and never
      reaches the server.** `JSON.stringify` drops an `undefined` value, so the
      mutation arrives at `apply.ts` without the key and its `$set` leaves the
      old value standing: the device reads cleared, the server reads unchanged,
      and the next snapshot puts it back. An empty array or string survives the
      journey, which is why `purposes` was fixable and `breedId`, `bornAt` and
      `processAtWeeks` were not.
      **Needs a JSON `null` meaning "clear", mapped to `$unset` in the
      applier** — a contract change, deliberately not swept in with the defect
      fixes. Until then those fields keep the conditional spread, because
      consistently stale beats silently divergent.
- [x] **Filter breeding records by group.** **GA**
      `names` is built from every animal on the farm, so the filter means "the
      dam exists here" rather than "the dam is in this group".
- [ ] **Add password recovery.** **GA** — *designed, not built:*
      [`PASSWORD-RECOVERY.md`](PASSWORD-RECOVERY.md)
      None exists; `AccountScreen` says so in a comment. Recovery currently
      needs a shell on the server, and a lockout hits farms who are paying and
      doing nothing wrong. **The delivery channel is decided: Steading gains an
      email sender**, which adds a processor to name in `[1]` and `[3]`. The
      design is researched and written; the build is the next piece.
- [x] **Verify units on Harvest and reporting.** **GA**
      *Confirmed true and fixed.* `HarvestScreen` offered pounds to everybody
      and converted with `poundsToUg` whatever the farm had set. The entry
      units moved to `contracts/units.ts` so `WeighScreen` and this one read
      one table.
- [ ] **Finish photo restore re-upload.** `ROADMAP.md` §12c, **GA**
      Restored metadata retains its uploaded flag, so bytes the server does not
      have are never re-sent. Already tracked; the assessment confirms it
      independently.

## 2. Start on the same day — the only work with a calendar attached

None of this gets shorter by being started later, and two items are a waiting
period rather than a task.

- [ ] **Open the Play Console account and enrol the closed test.** `[10]`
      Production access is granted at the end of a fixed testing period.
- [ ] **Start Google OAuth consent verification.** `[158]`
      A second queue. Unverified apps are capped and show a warning screen.
- [ ] **Register both signing fingerprints for Google sign-in.** `[157]`
      Play re-signs, so the certificate an OAuth client is keyed to differs
      between the store route and the shelf. Passes every test available today
      and fails in production, for everybody, on the day the store opens.
- [ ] **Write the privacy policy.** `[1]` — also a prerequisite for both queues.
- [ ] **Write the terms of service and EULA.** `[2]`
- [ ] **Write the "not veterinary advice" line and place it.** `[16]`
      Settings, and beside the withdrawal banner. Two sentences.
- [ ] **Clear the name.** `[13]` — Play listing, trademark, the farm products
      already using the word.
- [ ] **Decide the business entity.** `[14]` — Play needs a payee.

## 3. Release mechanics

- [ ] **Add an AAB target** to `apk.yml`, alongside the APK the shelf needs. `[8]`
- [ ] **Decide Play App Signing versus the farm's own key**, and write down
      which install a farm gets. `[9]`
      Interacts with `PICK-UP-HERE.md` §3 — one route per device, because a
      mismatched signature forces an uninstall and an uninstall takes the farm.
- [ ] **Account deletion, in-app and as a web URL** reachable without the app. `[4]`
- [ ] **Decide what deletion means** on the server, in backups, and for a
      lapsed farm. `[5]`
- [ ] **Complete the Data Safety declaration.** `[3]`
- [ ] **Name the processors** — Atlas, S3, GitHub, Google, weather.gov, the
      Census geocoder. `[7]`
- [ ] **Verify target API level and 16 KB page support.** `[11]`

## 4. Structural — the highest-leverage work

- [ ] **Append-only `taskCompletion` and `serviceCompletion` events.** **GA**
      Schedules stay mutable; completions become history. Today
      `task.completedAt`, `maintenance.lastDoneAtHours` and `lastDoneAtDate`
      each overwrite, so a machine serviced for six years can show one date —
      and `Steading-Masterplan.md` advertises a full service record for resale
      that therefore cannot be produced.
- [ ] **One reusable detail-and-timeline screen.** **GA**
      Status, primary actions, upcoming work, full timeline, edit and archive.
      Used for animals, groups, beds, varieties, plantings, machines and
      inventory. *The best single idea from the assessment: several entities
      stop at creation and a static list, and this makes almost every other
      item on every list smaller.*
- [ ] **A common event field set** — backdated date and time, who, where, note,
      photo — added to the entities that already exist. **GA-c**
      This is the universal-event proposal adopted in the one form that does not
      touch the sync contract; see the rejection at the foot for why not as an
      entity.
- [ ] **Named locations and dated movement history.** **GA**, `[91]`, `[94]`, `[114]`
      Pastures, paddocks, pens, coops, beds, storage. Answers "where are they
      now", gives movement records something to point at, and needs no map.
- [ ] **One adaptable animal-outcome flow** — death, cull, sale, transfer,
      processing, predator loss. **GA**, `[98]`
- [ ] **Individual-animal lifecycle** — location history, weights, health,
      breeding links, outcome, full linked timeline. **GA**
- [ ] **One farm-wide inventory model** — feed, seed, medicine, fertiliser,
      fuel, parts, packaging — with movements linked to the event that consumed
      or produced them. **GA**, `[116]`
- [ ] **Meat processing record.** **GA**, `[98]`
      Closes the grow-out clock, which counts down to a day nothing records.
      Freezer and package tracking optional and off by default.
- [ ] **Progressive disclosure** — minimum fields first, secondary under
      *More details*. **GA-c**
      The assessment frames this as replacing Basic/Full modes; no such setting
      exists in the code, so this is *building* the comprehension rubric the
      masterplan calls the competitive differentiator, not restructuring it.
      Worth naming: a thing that does not exist cannot regress.

## 5. Domain and safety records

- [ ] **Medicine-book fields** — batch or lot, expiry, supplier, prescribing
      vet, quantity administered, who administered. **GA**, `[18]`
- [ ] **A sanity check on entered withdrawal periods.** `[17]`
      A vetted table, a confirm-against-the-label step, or a warning on
      implausibly short windows.
- [ ] **A provenance line on each heat, cold and THI threshold.** `[21]`
- [ ] **Crop input and pesticide records** with the statutory field list —
      product, registration number, rate, area, date, operator, re-entry
      interval. **GA**, `[107]`
      *Two reviewers reached this independently.*
- [ ] **Reports carrying human-readable names beside stable identifiers.** **GA**
- [ ] **Opt-in local notifications.** **GA**
      Treatment doses, withdrawal clearance, birth and hatch, succession sowing,
      harvest windows, service due, recurring chores. **This corrects
      `DOMAIN-SCOPE.md` §8.2**, which parks notifications as needing a server —
      true of push, false of local scheduled ones, which are an OS API that
      works with the radio off and are the natural output of a due engine that
      already recomputes locally. Today stays usable without them. Ship
      inventory reorder alerts last, if at all — an alert nobody can act on from
      a barn trains people to dismiss the ones they can.
- [ ] **Targeted CSV import, bounded to an empty farm.** **GA-c**
      Current animals, equipment, varieties, plantings, inventory. The refusal
      in `COMPETITIVE-ANALYSIS.md` §2.1 rests on three hazards that are all
      about historical events merging into a *populated* farm; none survives
      contact with an empty one, on the same empty-versus-populated boundary
      `ROADMAP.md` §12 already used for backup restore. **The bound is the
      approval** — not "current versus historical" but "no records of that
      entity type yet".
- [ ] **Decide the sales event, out loud, either way.** `[119]`, **GA**
      Costs with no revenue means the app can say what a farm spent and never
      whether it made anything. One append-only sold event completes every ratio
      already computed and stays far short of a ledger.
- [ ] **Optional individual production for identified breeders.** **GA-c**
      `eggLog.birdId` already exists for this. Never the default, never offered
      on the ordinary flock screen — the refusal of per-bird tallies stands for
      five hens sharing a roost and does not apply to a trap nest.

## 6. Platform and operations

- [ ] **Define the day, store the zone, stop calendar arithmetic in
      milliseconds.** `[29]`–`[34]`
      There is no timezone handling in this codebase at all. `[34]` is the
      urgent half: a record written today without its zone can never have one
      added.
- [ ] **A minimum client version the server can require**, and an in-app update
      check against the shelf. `[23]`, `[24]`
- [ ] **Guard against a database from the future.** `[151]`
      `migrate()` silently no-ops when `user_version` exceeds `SCHEMA_VERSION`.
- [ ] **An error boundary and a crash breadcrumb.** `[39]`, `[40]`
      A launch crash currently reports nothing, because the support screen is
      inside the tree that failed.
- [ ] **Free-space check before photo capture; `integrity_check` on open.** `[36]`, `[37]`
- [ ] **Run the restore drill, and decide the RPO it implies.** `[50]`
- [ ] **Second custody location for the `age` key and the keystore.** `[51]`, `[52]`
- [ ] **Stop the nightly `mongodump` copying every photo every night.** `[159]`
      GridFS shares the database, so each dump is a full copy of every image
      ever uploaded, and §4.1a prices that storage against records.
- [ ] **Watch the box** — an uptime check and an alert that does not travel over
      the box. `[49]`
- [ ] **Handle font scaling.** `[68]`
      The rail has clipped its labels twice already, at the default scale.
- [ ] **Design for a wet glove.** `[167]`
      Capacitive touch does not register through wet or muddy gloves, and rain
      on the screen registers taps nobody made. This is the precondition under
      every field-usability rule in `UX-SPEC.md` §1, and the real argument for
      voice entry `[76]`.

---

## Rejected, and why

Named here so the boundary is unambiguous and nothing below gets picked up
later by accident.

- **The universal farm-event structure, as an entity.** The append-only/mutable
  split is what makes sync conflict-free: an immutable record cannot be
  disagreed about, so applying it is insert-if-absent and replay is a no-op. One
  event type spanning both classes must be mutable, which puts conflict
  resolution back into the daily logging path — the one property the whole
  architecture exists to protect. **Adopted as a field set instead**, §4.
- **The assessment's delivery order**, which places account and Play
  requirements at step 10 of 10. Those are the only items whose cost is calendar
  rather than effort. Its steps 1 and 2 are correctly placed and are §1 here.
- **Per-bird egg logging as a default workflow.** Five hens share a roost, so a
  per-bird tally is a guess recorded as a fact. The narrow breeder case is
  approved in §5 and is a different thing.
- **Satellite imagery, GPS field boundaries, e-commerce and CSA orders,
  double-entry accounting, payroll, vehicle telematics, dairy processing
  workflows, and a dedicated equipment-PDF subsystem.** The assessment reached
  every one of these independently and agrees. A generic file attachment covers
  manuals.
- **Inventory reorder and expiry alerts as an early item.** Not refused —
  deferred to last of the notification set, because an alert nobody can act on
  from a barn is how a farm learns to dismiss the ones that matter.
