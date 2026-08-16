# Approved work

**The decided subset, as a checklist.** Everything here has been argued
somewhere else and agreed; this file is what to do, not why. The reasoning
lives in `UNCONSIDERED.md` (items `[n]`), `UNCONSIDERED-PHASES.md` (phases
A–P), `GAP-ASSESSMENT-REVIEW.md` (the outside assessment, checked) and
`SYNC-INTEGRITY-TODO.md` (the audit and its verification pass).

**Provenance is marked** so any line can be traced back and re-argued:

| Mark | Source |
|---|---|
| `[n]` | `UNCONSIDERED.md`, item number |
| **GA** | The August 2026 product gap assessment, verified against the code |
| **GA-c** | Same, adopted in changed form — the change is stated |
| **SI** | `SYNC-INTEGRITY-TODO.md`, carried rather than re-decided — §7 |

**What this file is not.** Not a roadmap and not an estimate. `ROADMAP.md`
still orders the product; the phases file still holds the dependency argument.
Nothing here is sized in hours, because shape is knowable and hours are not.

**Rejections are at the foot**, named with reasons, so the boundary of "agreed"
is unambiguous and nothing on the reject list gets quietly picked up later.

**There are three states, not two, and the third one used to be invisible.**
Approved is above, refused is at the foot, and the two together cover perhaps
forty of the two hundred and seven items in `UNCONSIDERED.md`. Everything else
is *undecided* — considered, written down, and not yet argued to a conclusion.
Silence in this file has never meant refusal, and the foot of it says so about
the reject list without saying it about the rest. **§8 names the undecided
clusters** so nobody has to infer their status from an absence.

**Checked against the code, 16 August.** Every unticked item below was re-read
against the source. Where the code contradicted the line, the correction sits
under the original wording and is marked *corrected 16 August*, so the claim
that was wrong stays visible rather than being edited away. Two ran the way
nobody expects — the clearing defect is live in shipped screens rather than
latent, and the reports item turned out to describe the opposite of the code.
Nothing already ticked was re-opened.

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
- [x] **Give the wire a way to say "clear this field".** *(found while fixing
      the item above; built 16 August)*
      **Done.** `contracts/clearing.ts` is the mechanism: `null` at the top
      level of an update payload means *remove this*, `updateSchemaOf` makes
      exactly the omittable fields accept it — never a required one, never one
      with a default — the applier splits the payload into `$set` and `$unset`,
      and `db/project.ts` deletes the key rather than storing a null, so no
      reader ever meets a value its schema forbids. A create still refuses null
      outright. The three screens that were losing clears now send them.
      **One consequence, named rather than discovered later:** the log carries
      the null, so a device still running the previous build projects it into
      its own record, where its create schema will not parse it and the reader
      drops that one row until it is upgraded. It is the ordering `mutation.ts`
      already sets out for a widened entity list — server first, then clients —
      and this is the cheapest week it will ever be, with one farm and no store
      release. It is also the first concrete case for the minimum client version
      in §6.

      *The diagnosis, kept as it was written, because the shape of the bug is
      the reason the contract change looks the way it does:*
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
      **Wider than filed, and it is not only latent** *(corrected 16 August)*.
      The three fields named above are the ones nobody has a screen for yet.
      The ones that ship today:
      - **`task.completedAt`.** The *Need to redo this* confirm on
        `JobsScreen` sends `{ completedAt: undefined }` — a button a farm
        presses whenever somebody ticks a chore they had not actually done.
        The tick clears on that handset and nowhere else: every other device
        on the farm goes on showing the job done, and a rehydration replays
        the log and marks it done again on the handset that undid it.
      - **`medication.reason`, `dose`, `withdrawalDays`, `treatmentEndsAt`.**
        `TreatmentScreen`'s own `cleared` object — the pattern this item is
        named after. A withdrawal revised down to nothing frees produce on the
        handset that revised it while the server and every other device go on
        holding it. The two answers disagree about a record a regulator may
        read, and the lenient one is the one in the hand of the person deciding
        whether to sell.
      **Two comments in `packages/contracts` assert the mechanism that does not
      happen**, and both will mislead whoever does this work: `namesOneSubject`
      and the note above `mergedUpdateProblem` each say a client clearing a
      field sends `undefined` and the driver stores it as null. No such value
      arrives — `JSON.stringify` dropped the key before it left the handset.
      Implementing `null` → `$unset` makes those two sentences true for the
      first time, and they should be corrected in the same commit rather than
      read as a description of today.
- [x] **Filter breeding records by group.** **GA**
      `names` is built from every animal on the farm, so the filter means "the
      dam exists here" rather than "the dam is in this group".
- [ ] **Build the mail sender, and password recovery on top of it.** **GA** —
      *designed:* [`PASSWORD-RECOVERY.md`](PASSWORD-RECOVERY.md)
      There is no password reset; `AccountScreen` says so in a comment, and
      recovery means a shell on the server. **The deliverable is a sender, not
      one flow** — it also finishes the invite feature, which binds a token to
      an email address and has never had anything to send it with, and it opens
      `[148]` and `SUPPORT-LOOP.md` §6. A code the person types, not a link, on
      phishing and cross-device grounds. Postmark behind a `sendEmail` port.
      **SPF, DKIM and DMARC are part of the work, not follow-up** — large
      providers reject unauthenticated mail outright now, so getting the DNS
      wrong is a farmer who never receives their code.
- [ ] **Decide what domain Steading's mail comes from.** *(raised by the design
      above)*
      The domain is `swbuild.dev` and the app is called Steading. A password
      reset from a domain the farm has never heard of is indistinguishable from
      phishing, and ignoring it is the correct user response. Cheaper to settle
      before the sending DNS exists than after.
- [ ] **Verify email addresses at signup.** *(raised by the design above)*
      Password signup accepts whatever is typed; only the Google path carries
      `email_verified`. Harmless while an address does nothing — and once an
      address can receive a password reset, a typo at signup is a recovery
      route that reaches a stranger. Same token machinery, one more route,
      immediately after the sender exists.
- [x] **Verify units on Harvest and reporting.** **GA**
      *Confirmed true and fixed.* `HarvestScreen` offered pounds to everybody
      and converted with `poundsToUg` whatever the farm had set. The entry
      units moved to `contracts/units.ts` so `WeighScreen` and this one read
      one table.
- [x] **Finish photo restore re-upload.** `ROADMAP.md` §12c, **GA** — *built 16
      August*
      Restored metadata retained its uploaded flag, so bytes the server does not
      have were never re-sent. `restore.ts` now drops `uploadedAt` from a photo
      payload as it restores it — photo-specific and named as such, since every
      other entity wants its payload back exactly as it was — so the transfer
      loop sees a photo whose bytes are not up yet and the device still holding
      the file offers them again. The restore panel says out loud that the
      pictures come back only from a phone that still has them.
      **Still open, and it is the interesting half:** the rehearsal nobody has
      run — build a file on a device that has synced photos, wipe the server,
      restore, and watch the bytes arrive. And `ACCESS-AND-BILLING.md` §4.1a-i
      is now wrong in the app's favour and wants the correction §12c asks for.

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
- [ ] **Acknowledge a Play purchase inside three days.** `[181]` — *added 16
      August; entailed by §2's Play items rather than a new decision*
      Google auto-refunds and revokes a subscription nobody acknowledges within
      72 hours, and neither half of the acknowledgement exists: there is no
      billing library on the client to call `acknowledgePurchase`, and
      `billing/play.ts` verifies a token against `purchases.subscriptionsv2`
      and stops — `acknowledge` appears nowhere in this repository.
      **Not a gap in the running server.** `A2.8` is deliberate that no farm can
      buy anything yet; grants and promotion codes carry every one of them, and
      `playConfig === null` means the question is never asked. It goes live on
      the day the closed test in §2 sells its first subscription, which is why
      it belongs beside the purchase flow rather than after it — a refund that
      arrives 72 hours later looks like a farm that changed its mind.

## 4. Structural — the highest-leverage work

- [ ] **Append-only `taskCompletion` and `serviceCompletion` events.** **GA**
      Schedules stay mutable; completions become history. Today
      `task.completedAt`, `maintenance.lastDoneAtHours` and `lastDoneAtDate`
      each overwrite, so a machine serviced for six years can show one date —
      and `Steading-Masterplan.md` advertises a full service record for resale
      that therefore cannot be produced.
      **It also removes one of §1's two live clearing symptoms** *(noted 16
      August)*. An un-complete is `{ completedAt: undefined }` today, which is
      the field that never reaches the server; against an append-only
      completion it is a `delete` of the event, which does. That does not make
      the wire fix optional — the medication fields still need it — but it does
      mean these two items should be sequenced, not done twice.
- [ ] **One reusable detail-and-timeline screen.** **GA**
      Status, primary actions, upcoming work, full timeline, edit and archive.
      Used for animals, groups, beds, varieties, plantings, machines and
      inventory. *The best single idea from the assessment: several entities
      stop at creation and a static list, and this makes almost every other
      item on every list smaller.*
      **Its first commit is a read, not a screen** *(added 16 August)*.
      `read/history.ts` is farm-wide and has no notion of a subject:
      `listHistory` takes none, and `HistoryEvent` carries the record's own id
      and its entity but not what the record is *about*. So nothing today can
      answer "what has happened to this animal", and the screens that want it
      filter by hand — `WeighScreen` sorts and slices the weight list itself to
      put the last three weighings beside the form. A subject key on
      `HistoryEvent` and a filter on the read is what makes one screen reusable
      instead of seven screens each re-implementing that pane. Three of the
      seven have a detail route today — `Group`, `Machine` and `Planting`, with
      `Incubation` beside them off-list. Animals, beds, varieties and inventory
      items go from a list straight to an edit form.
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
      **The shelf is mostly built; the link is the item** *(corrected 16
      August)*. `inventory` and `stockAdjustment` are both in the contract and
      both have screens — five kinds (`feed`, `bedding`, `medicine`, `part`,
      `other`) against the seven above, and six reasons a quantity moved. Seed,
      fertiliser, fuel and packaging have nowhere to go, and **the one movement
      the app already makes for itself records no reason at all**: logging feed
      writes a `feedLog` and then an `inventory` update that lowers `quantity`,
      with no `stockAdjustment` beside it. `stockAdjustment` exists because
      every non-consumption reason *looked* like consumption; the inverse now
      holds, and a sack's history reads as purchases and losses with the
      feeding invisible between them. Whether that pair should also become one
      transaction is a separate call — `enqueueAll` is the tool, and
      `FeedScreen` argues out loud for the opposite, that the feed is the fact
      and the shelf is bookkeeping derived from it.
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
      **The reasons are written; the sources are not, and neither reaches a
      farm** *(clarified 16 August)*. `contracts/warnings.ts` argues every
      number it uses — why 33–36 °F rather than freezing, why poultry pant at
      29 °C, why an alpaca gets a heat index and a cow gets THI, and it prints
      the THI formula. What none of them carries is where the figure came from,
      and none of the reasoning is visible outside the source file: the farmer
      sees *"Dangerous heat today for the goats"* with no way to ask why. So
      this is two things — a citation per threshold, and a decision about
      whether any of it is shown.
- [ ] **Crop input and pesticide records** with the statutory field list —
      product, registration number, rate, area, date, operator, re-entry
      interval. **GA**, `[107]`
      *Two reviewers reached this independently.*
- [x] **Reports carrying human-readable names beside stable identifiers.** **GA**
      — *built 16 August: every sheet now ends with `Subject id` and `Record
      id`, appended in one place rather than written into twelve headers.*
      **Adopted the wrong way round, and the missing half is the cheaper one**
      *(corrected 16 August)*. Every sheet `export/csv.ts` writes already
      resolves a ULID to a name — `named(groupName, v.flockId)`, printing
      `(archived)` when the subject is gone — and not one of them prints an
      identifier. So the line as agreed describes the opposite of the code. What
      an accountant cannot use is not a column of ULIDs; it is two groups both
      called *Big coop* with nothing to tell them apart, and a season's rows
      that cannot be joined back to anything. One column per sheet, beside the
      name that is already there.
- [ ] **Opt-in local notifications.** **GA**
      Treatment doses, withdrawal clearance, birth and hatch, succession sowing,
      harvest windows, service due, recurring chores. **This corrects
      `DOMAIN-SCOPE.md` §8.2 twice over** — local scheduled notifications are an
      OS API that fires with the radio off, *and* the "server dependency" that
      parked them was never a real constraint, because there is a server. Today
      stays usable without them. Ship inventory reorder alerts last, if at all —
      an alert nobody can act on from a barn trains people to dismiss the ones
      they can.
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
      **The first half is built** *(16 August)*: the client states its version
      in `x-steading-client`, `MINIMUM_CLIENT_VERSION` sets a floor that is
      empty and inert on every server today, and a batch from below it gets a
      426 and the `appTooOld` refusal — **held exactly as an unsubscribed farm
      is held**, queued and uncounted, because the mutations are valid and only
      the APK is old. A floor the server cannot parse is ignored rather than
      enforced: a typo in a config file must not be this server breaking a
      working app.
      **The second half is not**: nothing tells a farm an update exists. That
      wants a version the shelf can be asked for and a screen to say it on,
      which is its own piece of work — and until it exists the refusal above is
      the only thing that will ever mention it.
- [x] **Guard against a database from the future.** `[151]` — *built 16 August*
      `migrate()` silently no-opped when `user_version` exceeded
      `SCHEMA_VERSION`, reporting the higher number as a success and handing
      back a store shaped to a schema this build has never seen. It now throws
      `DatabaseFromTheFutureError`, which `Boot` already renders in words. The
      message names the fix rather than the fault and is tested for what it must
      never say: clearing app data is the one action that would turn a temporary
      refusal — a downgrade, which `[156]` calls the only route back from a bad
      release — into the loss the guard exists to prevent.
- [x] **An error boundary and a crash breadcrumb.** `[39]`, `[40]` — *built 16
      August*
      `components/Boundary.tsx` sits above the providers in `App.tsx`, so it
      catches the store and the theme as well as the screens, and draws a
      fallback that answers the only question a farm has at that moment —
      nothing logged has been lost — with a retry and the build it happened on.
      It is the one class component in the app, because React has no hook form
      of `componentDidCatch`; `CLAUDE.md` now names that exception rather than
      leaving the rule quietly broken.
      **The crumb is what closes `[40]`.** A crash report held in memory is not
      a crash report, so the fallback writes one small file — not SQLite, which
      may be what failed — and the next launch that works picks it up into the
      trouble history, where a support bundle carries it. Reading clears it, so
      one crash rides on one ticket.
- [x] **Free-space check before photo capture; `integrity_check` on open.**
      `[36]`, `[37]` — *built 16 August*
      A full phone was met in the worst possible order: open the camera, let
      somebody frame a wound they are worried about, take it, then fail while
      writing. `capture` now refuses before the picker opens, with a floor
      well above one photo — the resize writes a temporary beside the original
      — and a device that will not say how much room it has counts as having
      room, because refusing a photograph on a guess is worse than the bug.
      The file check is `quick_check` rather than `integrity_check`: the full
      one is O(database) on every cold start, and the cheap half catches what
      actually happens, which is a torn page from a battery pull. **It reports
      and does not refuse** — a damaged file still holds most of a farm's
      records, and the one thing somebody needs then is to get them out, so an
      app that will not start is an app that cannot hand anything over. It
      repairs nothing either: every automatic repair here is destructive in
      some case, and a device that has just reported damage is the last place
      to run one unattended.
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
- [ ] **Correct the two documents the code has outgrown.** `[203]`, `[205]` —
      *added 16 August*
      Both were found by checking this file against the source, which is the
      failure mode `[203]` predicted: nothing checks the documents against each
      other.
      - **`CLAUDE.md`'s Mutation Envelope section lists 14 entities and there
        are 26**, and its append-only set names six of the eleven in
        `APPEND_ONLY_ENTITIES`. Everything growing, `breeding`, `incubation`,
        `weight`, `shearing`, `feedPlan`, `careLog`, `stockAdjustment` and
        `note` are absent from the file every agent and every new reader is told
        to start from. *Highest leverage per line in this document*: a wrong
        invariant list in the instruction file is wrong in every task that
        reads it.
      - **`DESIGN-BRIEF.md` says "where this disagrees with `ROADMAP.md`, this
        is newer"** and is dated 9 August. Three of its stated gaps have since
        closed — there is a launcher icon, there is a splash, and `apk.yml`
        compiles Android in CI — so on those points it is now the older
        document asserting priority over the newer one. It wants the staleness
        line `PICK-UP-HERE.md` carries.

## 7. Carried from the sync integrity list — **SI**

**Pointers, not decisions.** These were argued and agreed in
`SYNC-INTEGRITY-TODO.md` and are unticked there. They are repeated here because
that file was not in this one's source table until 16 August, so the repository's
highest-severity open work was invisible from the checklist that is supposed to
say what to do. **The file remains the authority; do not re-argue them here.**

- [ ] **A sweeper for `pending` mutation rows.** P0-2's last open box. The
      outcome field, the accepted-only feed and the repair have shipped; what
      is missing is the hourly pass over rows whose client never came back,
      running the same stored-envelope re-projection. Until it exists a row
      logged at the moment a device dies stays `pending` for ever, and
      `pending` is withheld from the feed — so that record reaches no other
      device on the farm.
- [ ] **Mint a fresh ULID in `retryRejected`.** P0-1(b). Reusing the id of a
      refused mutation means the corrected payload meets the duplicate branch
      and is answered as already-done.
- [ ] **Restate P0-3 as a property of visible order**, rather than replacing the
      cursor. The verification pass re-ranked it and refused the original
      prescription; the restatement is what it left open.
- [ ] **The two-device harness**, and the six assertions listed under it. Every
      symptom P0-2 describes is invisible to a suite that runs one device, and
      the fix shipped without a test that could have caught the bug.

## 8. Undecided, and not refused

**Named so an absence stops reading as a judgement.** None of this is agreed and
none of it is rejected; it is the part of `UNCONSIDERED.md` that has not been
argued to a conclusion. Listed as clusters rather than items because the
decisions are cluster-shaped — one argument settles each group.

- **Entry quality** — `[174]`–`[180]`. Plausibility of a typed figure, the
  double-log at 6:02 and 6:04, undo on the screen that just wrote, duplicate
  entities, unnormalised free text. **`GAP-ASSESSMENT-REVIEW.md` §3 names this
  as one of the six things the assessment is blind to, and then nothing carries
  it** — §5's withdrawal sanity check is the only entry-quality line in this
  file, and it covers one field on one screen. Nothing in the app checks a
  figure anywhere: the schemas bound it (an egg count stops at 10,000) and
  `WeighScreen` shows the last three weighings beside the form on a wide window,
  which is context rather than a check.
- **Data protection beyond the two policies** — `[6]` subject access, `[12]` the
  EU trader declaration, `[15]` the bundled reference data's licensing, `[19]` a
  retention floor for medicine records. §2 and §3 carry the launch-blocking
  paperwork; these four are the same kind of work and were not argued.
- **Security posture** — `[53]`–`[67]`. Secret rotation, dependency
  vulnerabilities, per-org quota, app lock, a lost device, `SECURITY.md` and a
  disclosure address. Two of them are narrower than they read and worth saying
  so: `[64]` is about the S3 successor rather than today — GridFS is covered by
  `tests/isolation/photo-bytes.test.ts`, in both directions — and `[65]` is
  specifically `/sync`, which is the one route with no `@fastify/rate-limit`
  scope on it; auth, billing and members all have one.
- **Accessibility and language** — `[69]`–`[75]`. Screen-reader flow, colour as
  the only carrier of meaning, locale formatting, English-only. §6 carries font
  scaling `[68]` alone, because the rail has already clipped its labels twice.
- **The domain phases** — `[91]`–`[135]`, which are phases K, L and M in
  `UNCONSIDERED-PHASES.md`. §4 and §5 take the parts the gap assessment reached
  independently; grazing, forage, water, soil, quarantine, biosecurity, labour
  and the rest are untouched by either sweep's conclusions.
- **Device and platform reach** — `[77]`–`[90]`. Barcode, EID, Bluetooth
  scales, printing, calendar export, foldables, Chromebooks. `[76]`, voice, is
  argued in §6's wet-glove item and is still undecided as work.

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
