# The blind-spot phases

**A running order for [`UNCONSIDERED.md`](UNCONSIDERED.md).** That document is
150 items and deliberately unordered, because a blind spot ranked is one
somebody has already started arguing about instead of reading. This is the
argument, held once, in a separate file.

**It does not supersede `ROADMAP.md`.** The roadmap orders the *product* — what
a farm gets next. This orders the *gaps* — what nobody wrote down. They are
different lists with different readers and they interleave: most of what follows
is small, and several phases are prose and configuration rather than code.

**Numbering.** Phases are lettered A–O so they never read as
`Steading-Masterplan.md` Phases 1–4. Everything here sits inside or after that
document's **Phase 4 — Hardening & Release**, which is where the app is now.

**Every item is in exactly one phase**, except `[15]`, which is explained at the
foot of this document. Nothing was dropped for being awkward to place.

**Item numbers in brackets** — `[16]`, `[29–35]` — refer to `UNCONSIDERED.md`.
Nothing is restated here; if a line is terse, the item explains it.

---

## The order at a glance

| | Phase | Shape | Blocks a store release | Depends on |
|---|---|---|---|---|
| **A** | Start the clocks | Prose, admin | **Yes** | Nothing |
| **B** | Ship it legally | Config, prose, some code | **Yes** | A |
| **C** | Time | Code | No | Nothing |
| **D** | The update path | Code, server | No, but the *next* one | B |
| **E** | Survive the device | Code | No | Nothing |
| **F** | Survive the year | Ops, scripts | No | Nothing |
| **G** | Be answerable for the advice | Prose, schema | No | A |
| **H** | Reach | Code | No | Nothing |
| **I** | Scale | Code | No | C |
| **J** | Input in a barn | Code, deps | No | H |
| **K** | Where things are | Domain | No | C |
| **L** | Growing, deeper | Domain | No | K |
| **M** | The farm as a business | Domain, prose | No | K |
| **N** | Know whether it works | Prose, small code | No | B |
| **O** | What the suite cannot reach | Test infrastructure | No | Concurrent with all |
| **P** | The documents as a set | Prose | No | Concurrent with all |

**A and C can run at the same time** and should. A is waiting — forms, accounts
and a review queue — and C is the only phase here that is pure engineering with
no external dependency, so it is what fills the wait.

**Three phases have no successor and can be started any week:** E, F and H. They
are listed after the release phases because they are not on the release path,
not because they are less urgent. F in particular is the one that becomes
irreversible: a farm's records are lost or they are not.

---

## Phase A — Start the clocks

**Everything here is prose or a form, and every one of it has a queue behind
it.** This is the only phase whose cost is calendar rather than effort, which
is why it is first: none of it gets shorter by being started later, and two of
the items cannot be compressed at all.

| Item | What |
|---|---|
| `[10]` | Open the Play Console account, complete identity verification, enrol the closed test |
| `[1]` | Write the privacy policy, publish it at a stable URL |
| `[2]` | Write the terms of service and the EULA |
| `[16]` | Write the "not veterinary advice" line and place it — Settings, and beside the withdrawal banner |
| `[13]` | Clear the name: Play listing, trademark, the farm products already using the word |
| `[14]` | Decide the business entity, because Play needs a payee |
| `[12]` | Decide whether the EU is a distribution target at all |

**Why first.** The Play account's closed-test requirement is a fixed number of
testers for a fixed continuous period, and production access is granted at the
end of it, not the beginning. Every other phase can be worked on while that
runs; nothing can shorten it. `[13]` is here rather than later for the same
reason in miniature — a name conflict found after the icon, the splash, the
typography and the domain all carry it is a week nobody has.

**`[16]` is in this phase and it is two sentences.** It sits with the legal
work because that is what it is, not because it is hard. It is the item on this
list with the worst ratio of exposure to effort.

**Exit gate.** Production access granted on the Play Console; the policy and
terms URLs resolve; the disclaimer is on a screen in a build.

**Cost of skipping.** There is no release. Not "a worse release" — the store
will not take the app.

---

## Phase B — Ship it legally

**A is the paperwork; B is what the paperwork obliges.** Half of this is a
Gradle task and half is a route nobody has written.

| Item | What |
|---|---|
| `[8]` | Add the AAB target to `apk.yml`, alongside the APK the shelf needs |
| `[9]` | Decide Play App Signing versus the farm's own key, and write down which install a farm gets |
| `[4]` | Account deletion: in-app, plus a web URL reachable without the app |
| `[5]` | Decide what deletion means on the server, in backups, and for a lapsed farm |
| `[3]` | Fill in the Data Safety declaration to match what the app actually does |
| `[7]` | Name the processors — Oracle Cloud (the box), S3, GitHub, Google, weather.gov, the geocoder. **Not Atlas**: the database is on the box and that cluster is deleted |
| `[6]` | Decide the shape of a subject access request, even if the answer is "export plus a manual step" |
| `[11]` | Verify target API level and 16 KB page support against the current Play rules |

**`[9]` is the one with a trap in it.** Play re-signs, so a Play install and a
shelf install carry different certificates, and `PICK-UP-HERE.md` §3's rule —
one route per device, because a mismatched signature forces an uninstall and an
uninstall takes the farm — stops being about EAS versus the runner and becomes
about Play versus `/app`. Decide it before a farm has both offered to them, not
after.

**`[5]` is a decision, not a feature.** Backups hold a deleted farm until the
retention window rolls, which is a correct behaviour and an undeclared one. One
paragraph settles it and it has to be the same paragraph the Data Safety form
says.

**Exit gate.** An AAB on a closed track, installed by a tester who is not the
author, over the previous build, with the records surviving — the same test
`PICK-UP-HERE.md` §3 sets for the shelf, run on the other route. And the
deletion URL answers.

**Cost of skipping.** Same as A, plus the enforcement kind: an inaccurate Data
Safety declaration is not a rejection, it is a suspension after launch.

---

## Phase C — Time

**One piece of engineering, and every number the app shows depends on it.**

| Item | What |
|---|---|
| `[29]` | Define the day — the farm's, the device's, or the server's. Pick one, write down why |
| `[34]` | Store the zone a record was written in, so this decision can be revised later |
| `[30]` | Replace fixed-millisecond calendar arithmetic in `withdrawal.ts`, `frost.ts`, `due/tasks.ts` |
| `[31]` | Sanity-check the device clock against `serverTs` at flush, and say something when it is wrong |
| `[33]` | Settle the frost-date year rule at the winter wrap |
| `[32]` | Decide what a farm that straddles or moves zones sees |
| `[35]` | Sunrise, sunset and day length — the forecast service already carries them |

**Why this early, and above phases that look more urgent.** `[34]` is the
reason. A record written today without its zone cannot have one added later —
the information is gone. Everything else in this phase is fixable whenever;
that one is a clock running against every row a farm writes between now and
when it lands.

**Why it is not a release blocker.** Because the app is wrong in a way nobody
has noticed yet rather than in a way that fails a review. That is an argument
about sequencing, not about severity.

**`[35]` is in this phase because it is the same arithmetic**, not because it
is the same importance. It is the one item here a farm would notice as a
feature.

**Exit gate.** A DST-crossing withdrawal test, a device-clock-skew test, and a
day-boundary test that fails if the definition changes without the document
changing.

**Cost of skipping.** A tally that belongs to the wrong day, a withdrawal
declared clear an hour early, and no way to reconstruct which — because the
zone was never stored.

---

## Phase D — The update path

| Item | What |
|---|---|
| `[24]` | A minimum client build the server can require, and the refusal that carries it |
| `[23]` | An in-app check against the shelf, and a notice |
| `[25]` | Say *why* an update matters — a security fix and a new icon look identical from a barn |
| `[26]` | A rollback that works, given the signature answer Phase B settled |
| `[28]` | Publish the APK's hash beside it, and the install instructions that go with sideloading |
| `[27]` | Tell the farm what `allowBackup: false` means, and name the local backup beside it |

**Why after B.** `[26]` cannot be designed until `[9]` is answered, and `[23]`
looks different depending on whether the farm is on Play or the shelf. Doing
this first means doing it twice.

**Why it matters more than its position suggests.** Envelope versioning accepts
N−1 by design (A8). Nothing currently stops a device three releases behind from
meeting a server that will not take its mutations, and the farm's experience of
that is a queue that stops draining with no explanation. `[24]` is the
mechanism A8 assumes exists.

**Exit gate.** An old build, on a real handset, told to update — and a server
that refuses its flush with something a person can act on.

**Cost of skipping.** Every farm not on Play is frozen at whatever it installed,
permanently, and the first security fix reaches nobody.

---

## Phase E — Survive the device

**No dependencies, no gate in front of it, and it is the phase most likely to
be the difference between a bug report and a lost farm.**

| Item | What |
|---|---|
| `[39]` | An error boundary in the React tree, with a route to the support screen that survives it |
| `[40]` | A crash breadcrumb written to SQLite, sent on the next successful launch — no third-party SDK |
| `[36]` | Check free space before capture; handle the write failure inside the transaction |
| `[37]` | `PRAGMA integrity_check` on open, a user-visible answer, and a prompt to take the local backup |
| `[43]` | Keep typed form state across process death |
| `[44]` | The interrupted-photo cases: permission revoked, killed between capture and row |
| `[38]` | Decide the journal, checkpoint and vacuum policy, or write down that the defaults are the decision |
| `[45]` | Assert EXIF is stripped rather than trusting the re-encode |
| `[46]` | A wifi-only setting for photo upload, and a warning on the 92 MB shelf download |
| `[42]` | Decide what an OS-killed mid-flush means, and test it at an arbitrary point rather than a chosen one |
| `[41]` | Accept that native crashes and ANRs are invisible off Play, or find the route to them |
| `[60]` | An app lock, because a farmhouse tablet is a shared device |
| `[47]` | Measure cold launch on the low-end device the rubric names |

**Why `[39]` and `[40]` lead.** The support loop is entirely user-initiated and
lives inside the same React tree it would report on. An app that crashes on
launch produces no bundle, no ticket and no evidence — and that is precisely the
crash worth having.

**Exit gate.** A deliberately thrown render, a deliberately filled disk and a
deliberately corrupted database, each producing something a farm can read and
something the author can receive.

**Cost of skipping.** The failures this app was built to prevent, arriving by a
route nobody instrumented.

---

## Phase F — Survive the year

**Operational, unglamorous, and the only phase where skipping produces losses
that cannot be recovered by shipping a fix later.**

| Item | What |
|---|---|
| `[50]` | Run the restore. Then decide the RPO and RTO it implies |
| `[51]` | A second custody location for the `age` private key |
| `[52]` | A second custody location for the keystore, and a note saying what losing it costs |
| `[49]` | Watch the box — an uptime check and an alert that does not travel over the box |
| `[53]` | A secret-rotation procedure, with the dual-secret window that stops it signing every farm out |
| `[54]` | Monitor the domain and the DNS zone, not just the certificate |
| `[55]` | Dependency scanning, and a license inventory beyond the fonts |
| `[59]` | Decide what is logged, for how long, and whether a payload ever reaches a line |
| `[56]` | A per-org storage guard, so one farm cannot fill the box's disk for everybody |
| `[57]` | Write down the connection-pool answer for the `mongod` on the box |
| `[67]` | `SECURITY.md`, and an address a researcher can use that is not a public issue |
| `[61]` | A device list and "sign out my other devices", for the handset left in a market car park |
| `[64]` | Run the photo isolation suite against the derived S3 key before the bytes move there |
| `[65]` | A per-org rate limit on sync, which the batch cap bounds a request of and not a rate |
| `[63]` | Bound join-code attempts per org, and work out what grinding every org at once yields |
| `[66]` | A lifecycle for the support gist — unlisted is not private, and a URL outlives a closed issue |
| `[62]` | Decide about rooted and emulated devices, probably to refuse detection, in writing beside D4 |
| `[48]` | Design what a farm sees during a multi-day outage |
| `[58]` | Time a snapshot for a ten-year farm, before one exists |

**`[50]` first, and it is already named as a condition of the first real farm.**
What that note does not carry is the second half: nightly means up to a day of
records lost, and nobody has said whether that is acceptable for a medicine
record. The restore drill is what turns that from an assumption into a number.

**Exit gate.** A restore performed into a scratch database and verified against
`pnpm db:verify`; an alert that fires when the box is stopped on purpose.

**Cost of skipping.** The one category on this list where the loss is permanent.

---

## Phase G — Be answerable for the advice

**A's disclaimer is the shield; this is the substance behind it.**

| Item | What |
|---|---|
| `[18]` | The medicine-book fields: batch, expiry, supplier, prescribing vet, quantity, who administered |
| `[17]` | A check on entered withdrawal periods — a vetted table, a confirm-against-the-label step, or a warning on suspiciously short windows |
| `[19]` | State a retention floor for treatment records, and make the app hold to it |
| `[20]` | Distinguish correcting a mistyped egg count from taking back a treatment with a live withdrawal |
| `[21]` | A provenance line on each heat, cold and THI threshold |
| `[22]` | A route to correct bad bundled library data on devices that already copied it |

**Why after A and not before.** The disclaimer is what makes the current
behaviour honest; this phase is what makes it good. In that order, because the
first is two sentences and the second is schema.

**`[18]` has a subtlety worth stating.** The app is already close enough to a
medicine book that a farm will use it as one, and short enough that it will not
stand up as one. That gap is worse than not offering it, which means this phase
is not optional in the way most feature work is — either close it or say plainly
in the app that this is not that record.

**Exit gate.** A treatment record a vet would accept, and a test that fails if a
withdrawal shorter than the shortest real one is accepted silently.

---

## Phase H — Reach, and the screens it arrives on

| Item | What |
|---|---|
| `[68]` | Handle font scaling — the rail has already clipped its labels twice at the default scale |
| `[69]` | Walk the screen-reader flow: reading order, focus after navigation, the Tally's announcement |
| `[70]` | Stop colour carrying meaning alone in due states and the sync chip |
| `[73]` | Format numbers and dates by locale, not by hand |
| `[71]` | Verify one-handed reach on a large handset, gloved |
| `[75]` | Reconsider the icon-only controls and what the warm voice costs a struggling reader |
| `[72]`, `[74]` | Decide whether anywhere outside the Anglophone world is a target — and if so, keep RTL possible |
| `[89]` | Look at a rotated phone, which gets the compact layout in a landscape window |
| `[86]`, `[87]` | Foldables, multi-window and a resize mid-form; desktop modes on a monitor with a mouse |
| `[88]` | Reverse `supportsTablet: false` when iOS happens, or record why a tablet layout does not apply there |
| `[90]` | Decide about Chromebooks, where every input assumption in J is wrong |

**Why the form factors are in this phase and not a layout one.**
`LANDSCAPE-PLAN.md` handles width classes and stops at the window. A fold, a
split-screen resize and a rotated phone are all the same thing — a window that
changes shape while somebody is using it — and they are reach in exactly the
sense the rest of this phase means: a person whose device is not the one the app
was drawn against.

**Why here.** `[68]` is the item that will produce a support ticket first, and
it is a defect rather than a feature: a farm running Android's largest font is
using an accessibility setting the app ignores. Everything else in this phase
follows from taking that seriously.

**`[72]` is a product decision, not work.** The species vocabulary, both
libraries, the zone systems and the weather provider are all US-shaped. Answer
it before J, because a scanning and voice layer built for one language is
cheaper to widen than to retrofit.

**Exit gate.** The release gates in `UX-SPEC.md` §7, re-run at 200% font scale
and with TalkBack on.

---

## Phase I — Scale

| Item | What |
|---|---|
| `[130]` | Virtualise the lists that grow — there is no `FlatList` anywhere today |
| `[134]` | Search: notes, records, machines |
| `[135]` | Bulk operations, for the week logged against the wrong flock |
| `[133]` | Charts across multiple years |
| `[131]` | Time and size the first snapshot page for a farm with photos |
| `[132]` | Answer the rollup question the masterplan leaves open |

**Depends on C** because every one of these groups by day, and grouping by an
undefined day at volume just makes the wrongness harder to see.

**`[130]` is not "add a FlatList".** It is deciding where the line is: a tally
is right as it is, and History is not. `Screen` scrolls and screens render rows
into it, which is the correct default and the wrong one in three places.

**Exit gate.** A generated ten-year farm on the low-end device, opening History
and Trend without a stall.

---

## Phase J — Input in a barn

**The phase with the best fit to the product's own thesis and the least written
about it.**

| Item | What |
|---|---|
| `[76]` | Voice: "twelve eggs from the big coop", on-device, one-handed, in the dark |
| `[77]` | Barcode and QR: medicine bottles, machine stickers, seed packets, the join code |
| `[78]` | EID tag numbers, which sheep keepers are already legally required to carry |
| `[80]` | Bluetooth scales, writing into the `weight` entity that already exists |
| `[79]` | NFC on a coop door or a machine, which removes navigation entirely for the most repeated task |
| `[81]` | A home-screen tally widget, and the quick-settings tile |
| `[84]`, `[85]` | Printing, and dues as an ICS feed |
| `[83]` | External keyboards on a tablet in an office |
| `[82]` | Decide about Wear OS, probably to refuse it |

**Why after H.** Every item here is an input path, and an input path built
against one language and one set of assumptions is the expensive kind to widen.

**Why it is a phase rather than a feature list.** These share a dependency —
each needs a permission, a native module and a device to prove it, and the whole
project's evidence is that a native module is only real once a handset has run
it. Batching them means one device day rather than six.

**Exit gate.** One of them, on the tablet, logging a real record. The rest
follow the path the first one cuts.

---

## Phase K — Where things are

**The domain phase that unblocks the other two.**

| Item | What |
|---|---|
| `[91]` | Paddocks and grazing: rotation, rest days, stocking density, which field a group is in |
| `[93]` | Water: troughs, tanks, harvesting — the freeze warning already fires with nothing to attach to |
| `[92]` | Hay, silage and stored forage, which are produced and consumed on the same farm |
| `[114]` | Buildings, fences, gates and water lines — `equipment` assumes an hour meter and a fence has none |
| `[94]`, `[95]`, `[96]` | Movement records, statutory identifiers, fallen-stock disposal |
| `[97]` | Quarantine for incoming stock, which is a due row that does not exist |
| `[98]`, `[99]` | Processing day, and the feed conversion both halves already imply |
| `[101]` | Working and companion animals that are not stock |
| `[102]`, `[103]` | Biosecurity, and where an egg or a carcass went |
| `[100]` | Beekeeping past the one honey field: a hive, an inspection, a queen, a winter weight |
| `[115]` | Fuel bought and burned, which makes cost per machine hour out of two things already recorded |
| `[118]` | Storage readiness — already written down in `DOMAIN-SCOPE.md` §3.2 and still unbuilt |
| `[117]` | Warranty and registration: three fields and one due row |
| `[116]` | Small tools, and what was lent to a neighbour |

**Why it leads the domain phases.** *Place* is the missing dimension. The app
knows what a farm has and when things happened and has no way to say where
anything is — which is what `[91]` and `[114]` are, and what `[94]` needs to
point at. Growing already has beds; the animal half has nothing equivalent, and
L and M both read from it.

**`[98]` closes a loop that is currently open.** Grow-out counts down to
processing day and stops. Without the record of what actually happened, the
whole meat-purpose feature ends one day before the number worth keeping.

**The iron items at the foot of the table are here for one reason**, and it is
`[114]`: a coop, a fence and a water line are places as much as they are
assets, and once a register exists for them the fuel, the warranty and the
winterising all hang off it. They are the remainder of the iron half, and it is
the closest of the three domains to complete.

**Exit gate.** A group can be put somewhere, moved, and its history says where
it was.

---

## Phase L — Growing, deeper

| Item | What |
|---|---|
| `[107]` | Spray and pesticide records, with the statutory field list |
| `[105]`, `[106]` | Soil tests, amendments, and the compost the animal half produces |
| `[104]` | Irrigation, consuming the rainfall the forecast already knows about |
| `[108]`, `[109]` | Seed as a stock, and the six weeks between sown and transplanted |
| `[110]`, `[111]` | Perennial and orchard work; a polytunnel as a thing rather than a boolean |
| `[113]` | Weeds, pests and disease — the growing half of the threat log |
| `[112]` | Decide whether other enterprises fit at all, since `ENTERPRISES` is not that list |

**`[107]` leads** for the same reason `[18]` leads G: it is a legal
record-keeping obligation with a defined field list, and `DOMAIN-SCOPE.md`
covers the harvest-interval half while calling it the whole thing.

**`[106]` is why this phase is worth doing as a phase.** Compost is the animal
half feeding the growing half, and it is the first place the two domains meet as
anything other than a shared tab bar.

---

## Phase M — The farm as a business, and the people in it

| Item | What |
|---|---|
| `[119]` | Decide the sales event — out loud, either way |
| `[125]` | Owner transfer, for the farm that is sold or inherited |
| `[126]` | A guest or time-limited role: the vet, the contractor, the neighbour for a fortnight |
| `[127]` | Show the farm its own audit trail; the author is already recorded |
| `[128]` | Offboarding that reaches the removed person's device |
| `[121]` | Have an accountant look at the Schedule F export |
| `[122]`, `[123]` | Insurance and valuation; certification schemes this app is three fields from satisfying |
| `[120]` | Labour, which is nearly derivable already |
| `[124]` | Decide whether one org holds two sites |
| `[129]` | Decide what a farm that stops looks like |

**`[119]` first because it is a decision and the rest is work.** Costs are
bounded to cost-per-egg deliberately; the consequence — the app can say what a
farm spent and never whether it made anything — is not written down anywhere,
and a single append-only sold event completes every ratio already computed
without becoming a ledger. Refuse it or build it; the current state is neither.

**`[125]` is the one with a structural trap.** The last owner cannot be demoted,
which is correct and which means an owner who dies or sells takes the farm's
records into an account nobody can reach.

---

## Phase N — Know whether it works

**Last in the list and it should start the day Phase B's closed track opens.**

| Item | What |
|---|---|
| `[146]` | Use Play's closed track as the first real users this app has ever had |
| `[150]` | Decide what success is — farms still logging in month six, not revenue |
| `[145]` | Decide about analytics, including deciding to refuse it, and write down which |
| `[147]` | In-app help, so the first question does not need a human |
| `[148]` | A channel to tell a farm anything — release notes, a fixed defect, an outage |
| `[149]` | A sample farm somebody can poke at before typing in their own |

**Why it is last and also concurrent.** Nothing here blocks anything, and
everything here changes what the other phases are worth doing. `[150]` in
particular: without it, every item in this document is prioritised by argument,
including the order it is in.

**`[148]` is the same mechanism as `[25]` and `[48]`** wearing a third hat, and
building it once for all three is the reason it is worth naming here rather than
solving three times.

---

## Phase O — What the suite cannot reach

**Concurrent with everything, listed last because it has no natural moment and
therefore keeps being nobody's turn.** 134 test files, and the gaps are all of
one kind: the suite tests decisions and does not test the app.

| Item | What |
|---|---|
| `[136]` | An end-to-end run on a device or emulator — nothing currently drives the app |
| `[138]` | A layout engine in the suite, so every width branch above 600dp stops depending on a held tablet |
| `[137]` | Screenshot or visual regression, since the two rail defects were found by a human looking at one image |
| `[139]` | Property-based testing of the sync engine, whose correctness claims are universal and whose evidence is examples |
| `[141]` | A concurrent multi-device flush, which is what P0-3's ordering work exists for |
| `[140]` | Clock skew and DST — follows Phase C, because there is nothing to test until it lands |
| `[144]` | Assert the accessibility tree, so Phase H cannot regress invisibly |
| `[142]` | A performance budget and a bundle-size gate |
| `[143]` | Build and boot the container in CI — B-1, known and unmoved |

**`ROADMAP.md` rule 3 is the argument for this phase and it has not been acted
on.** "What only a device can prove comes before what a test can", written after
a day on a handset found eight defects a thousand passing tests missed — and
described there as a gap in the suite rather than bad luck. The suite has not
changed shape since. `[136]` and `[138]` are that gap.

**Why it is concurrent rather than sequenced.** Each item belongs to the phase
that creates the thing it tests — `[140]` is Phase C's exit gate, `[144]` is
Phase H's, `[141]` is F's. Listing them together is how they stop being an
invisible tax on every other phase; building them together is not the intent.

**Cost of skipping.** Every exit gate in this document is a manual check
performed once by the person who wrote the code.

---

## The second sweep, placed

`UNCONSIDERED.md` §20–§28 added items 151–207 after these phases were written —
the code rather than the documents, version skew, the seams, the physical yard,
and the service as a promise. They are placed here rather than by editing
fifteen tables, so the diff stays readable and no phase silently changes shape.

**Two of them move a phase's centre of gravity**, and those are called out
below rather than left to be noticed.

| Phase | Gains | Note |
|---|---|---|
| **A** | `[158]` | Google's OAuth consent verification is a **second queue with a calendar**, needing the privacy policy and a verified domain. It belongs beside `[10]` and nothing counted it |
| **B** | `[157]`, `[160]`, `[181]`–`[189]` | `[157]` is the sharpest item in either sweep and it is a Phase B decision: both install routes mean both signing fingerprints registered. The billing mechanics are the inside of the purchase flow already documented as unbuilt |
| **C** | `[196]` | Week start is one line and a setting today, and a data-comparison question later |
| **D** | `[151]`–`[156]` | **This is the phase that changed.** It was the update path; it is now version skew in both directions, and `[152]` is why — the backup guard is correct and tells the farm to do the one thing the product cannot |
| **E** | `[161]`, `[168]`–`[170]`, `[198]`, `[199]`, `[200]` | Survival now includes the cold, the battery, and the diagnosis with nowhere to go |
| **F** | `[159]`, `[162]`, `[163]`, `[164]`, `[165]`, `[195]` | `[159]` is the one to look at first: a nightly full dump copies every photo, and §4.1a prices the storage against records |
| **G** | — | Unchanged |
| **H** | `[167]`, `[171]`, `[172]`, `[173]` | **This is the other phase that changed.** Reach was accessibility and screens; it now opens with the fact that a wet glove does not register a tap at all, which is the physical precondition of every rule in `UX-SPEC.md` §1 |
| **I** | `[178]`, `[197]` | Normalisation before search, and the knowledge that the scroll is one component |
| **J** | — | Unchanged, and `[167]` and `[173]` are now its argument rather than its nice-to-have |
| **K**–**M** | `[166]`, `[174]`–`[177]`, `[179]`, `[180]` | Entry-quality work sits with the domains, because a plausibility check is per-figure and the figures are domain-shaped |
| **N** | `[190]`–`[194]` | Knowing whether it works, and whether it survives the person who built it |
| **O** | `[153]`, `[154]`, `[201]` | The ladder that has never run, the migration test with no real file, and the ordering "probably" |
| **P** | `[202]`–`[207]` | New. See below |

### Phase P — The documents as a set

**New phase, and the cheapest one here.** Twenty files and eleven and a half
thousand lines that are the best thing about this project, missing the six
things that make a set of documents usable by somebody who did not write them:
an index `[202]`, a check that they do not contradict each other `[203]`, a map
from a decision number to the file that owns it `[204]`, a freshness marker on
the nineteen that do not have one `[205]`, a contributing path `[206]`, and a
glossary `[207]`.

**Why it is a phase rather than a chore.** `[203]` has already been paid for
once — two documents disagreeing about whether a farm had backups, caught by
hand. And `[206]` is the cheap half of `[192]`: the expensive half is custody of
the keystore and the accounts, and the cheap half is a second person being able
to build the thing at all.

**Concurrent with everything, like O.** Neither has a natural moment, which is
why both keep being nobody's turn.

---

## What this document does not do

It does not estimate. Every phase above is sized by shape — prose,
configuration, code, domain — because that is knowable, and hours are not.

It does not claim the order is right beyond the dependencies it states. Four
constraints are real and the rest is judgement:

1. **A gates B** — no store account, no store release.
2. **B gates D** — the update path is different on Play than on the shelf.
3. **C gates I** — grouping at volume by an undefined day hides the problem.
4. **K gates L and M** — both need somewhere for things to be.

**And one item is not in any phase**, deliberately: `[15]`, the reference-data
licensing question that `BREED-AND-PURPOSE.md` §5 opens and leaves unanswered.
It is the only legal item already documented as open, it sits in the path of a
release, and it belongs to whoever answers the other five questions in that
document rather than to a phase in this one.
