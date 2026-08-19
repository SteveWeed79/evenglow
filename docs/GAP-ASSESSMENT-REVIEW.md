# Review of the Product Gap Assessment

**A response to `Steading_Product_Gap_Assessment.md` (16 August 2026), read on
its own terms.** Its stated method — project documents are evidence of intent,
not binding requirements — is the right method, and it is applied here to the
assessment itself. Nothing below defers to a decision because it is written
down, including our own.

**Every factual claim in it was checked against the code before being judged.**
That is the part worth doing first: three of its defect claims are real and one
of them is a silent data-corruption bug we have been shipping. A document that
gets that right has earned a careful reading of its opinions.

**Summary verdict.** It is a good assessment with a narrow blind spot. Its
defect findings are largely correct, its structural recommendation — reusable
detail-and-timeline screens rather than more screens — is the best single idea
anyone has put in writing about this app's next year, and its scope is
**product completeness only**. It has nothing to say about time, platform,
operations, or the physical conditions the app is used in, which is where
`UNCONSIDERED.md` lives. The two are complements, and neither is a superset.

---

## 1. Its defect claims, checked

| # | Claim | Verdict |
|---|---|---|
| 1 | Withdrawal can clear too early on an open course | **Real, diagnosis imprecise, fix correct** |
| 2a | Site edit starts from hardcoded frost dates | **Confirmed. Silent corruption. Fix first** |
| 2b | Clearing an optional group value leaves the old one stored | **Confirmed, and the same bug was already fixed elsewhere** |
| 2c | A group's breeding screen shows other groups' records | **Confirmed** |
| 2d | Harvest and reporting do not honour the units setting | **Not verified either way** |
| 3 | Recurring completion history is overwritten | **Confirmed, and it breaks a named feature** |
| 4 | Photo restore can skip re-uploading bytes | **Already known** — `ROADMAP.md` §12c |
| 5 | No password recovery, no account deletion | **Confirmed, and the first one we had missed** |

### 1.1 Withdrawal — the arithmetic is right and the hole is real anyway

`withdrawalClearsAt` counts from `Math.max(administeredAt, treatmentEndsAt ?? 0)`
— the last dose, not the first — and says so in a comment that names getting it
backwards as "the classic way to sell too early". So the calculation is not the
defect.

The defect is what happens when there is no end date. `TreatmentScreen`
carries a **"The course is still running"** toggle, and the code beneath it
already states the consequence in full:

> *"With no end date `withdrawalClearsAt` counts from the first dose, so an open
> course under-states the window by however long it ran — it clears produce
> early, which is the one direction this must never err in."*

**It is written down, and then the produce clears anyway.** A ten-day course
logged on day one with the toggle on shows eggs clear on day eight, while the
bird is still being dosed. Knowing about a safety defect in a comment is not
mitigating it.

**The assessment's fix is right, and it is safe** — which needed checking,
because "an open course holds indefinitely" would be a disaster if most
treatments were open by default. They are not: `stillGoing` initialises to
`false`, so a single dose is recorded closed and clears normally. Only a course
somebody explicitly marked as running would hold, which is exactly the set that
should.

**One addition it does not make.** Closing a course currently dates it *today*
(`existing?.treatmentEndsAt ?? now`). Somebody who finishes a course on Tuesday
and closes it on Friday gets three days of withdrawal they do not owe — the
safe direction, but still a wrong number in a record that may have to satisfy a
regulator. Closing should ask for the last dose date and offer today as the
default.

### 1.2 The frost dates — fix this before anything else on either list

`SiteSetupScreen` initialises its four date fields to constants:

```ts
const [lastMonth, setLastMonth] = useState(4);   // May
const [lastDay, setLastDay] = useState('15');
const [firstMonth, setFirstMonth] = useState(9); // October
const [firstDay, setFirstDay] = useState('5');
```

Nothing seeds them from the site record the screen has already loaded. A farm
that entered 20 April and 28 September re-opens the screen, sees 15 May and
5 October, and saving writes those over the real ones — stamped
`source: 'entered'`, so downstream logic treats the defaults as the farmer's own
answer.

**This is worse than it first reads**, and the reason is elsewhere in our own
documents: frost dates drive every sow window, every transplant date, the
autumn count-back, chick brooding and the cold-birth warning. Corrupting them
silently mis-times a season's planning and nothing anywhere says a number
changed. It is the single most damaging bug either list has found.

The irony is on display in the same function: the save is *carefully* written to
avoid clobbering the weather screen's position, with a comment explaining why.
The values the screen itself owns get no such care.

### 1.3 Clearing an optional value — the same bug, already solved next door

`EditGroupScreen` builds its payload as
`...(current.breedId === null ? {} : { breedId: current.breedId })`. Updates
merge, so an omitted field keeps its old value: clearing a breed leaves the
breed.

**`TreatmentScreen` fixed exactly this and explained it:**

> *"An update MERGES on both sides, so a field the person cleared would keep its
> old value — a withdrawal revised down to nothing would go on holding the
> produce. Every optional field is therefore named explicitly on an edit, with
> `undefined` where it is now absent."*

So this is not an unknown failure mode, it is a known one that was fixed in one
screen and not swept for. That makes it a **class** to audit — every edit screen
— rather than one defect to patch, and the assessment is right to file it under
data integrity rather than polish.

### 1.4 Breeding records cross group boundaries

```ts
const names = new Map((animals ?? []).map((a) => [a.id, a.name]));
const mine = (breedings ?? []).filter((b) => names.has(b.damId));
```

`names` is built from **every animal on the farm**, so `mine` means "the dam
exists here", not "the dam is in this group". A goat's mating appears on the
sheep's breeding screen. The line above it filters dams correctly by
`flockId`, which makes this a slip rather than a misunderstanding — and one no
test caught.

### 1.5 Completion history — confirmed, and it breaks a feature we advertise

`task.completedAt` is a single optional field; `maintenance.lastDoneAtHours`
and `lastDoneAtDate` are two more. Every completion overwrites the last, so a
recurring job has a *current state* and no history.

**`Evenglow-Masterplan.md` lists "machine history export — full service record
for one machine, for resale" as a feature.** There is no full service record to
export. A machine serviced every 250 hours for six years can show one date.
That is not a missing nicety, it is a promise the schema cannot keep.

The assessment's fix — append-only `taskCompletion` and `serviceCompletion`
events, schedules stay mutable — is exactly right and is the same shape as
every other append-only entity here. **Adopt as written.**

### 1.6 Password recovery — a genuine miss on our side

There is no password reset. `AccountScreen` says so in a comment: recovery
needs `pnpm db:password`, which needs a shell on the server. A farm that
forgets its password is locked out of sync until the author personally runs a
script.

`UNCONSIDERED.md` catalogued account deletion `[4]` and never asked about
recovery. The assessment caught it; it belongs in Phase B beside deletion, and
it is arguably more urgent, because a lockout happens to farms who are *paying*
and doing nothing wrong.

---

## 2. Its recommendations, each on merit

### ADOPT — and one of these changes how the next year is spent

**Reusable detail and timeline screens** (its central structural idea).
**Adopt, and treat it as the headline.** The observation underneath it is
correct and uncomfortable: several entities stop at creation and a static list.
An animal can be created and never meaningfully read. The proposal — one shared
pattern of status, primary actions, upcoming work, timeline, edit and archive,
used for animals, groups, beds, varieties, plantings, machines and inventory —
converts perhaps a dozen screens-worth of work into one component and a set of
queries. It is the cheapest large improvement available and it makes almost
every other item on both lists smaller.

**Named locations without maps.** Adopt. `UNCONSIDERED.md` `[91]` and `[114]`
reach the same gap from two directions (paddocks, and buildings that are not
machines); the assessment's framing is better than either, because "a named
place things can be moved between, with a dated history" covers pastures, pens,
coops, storage and beds in one model and answers *where are they now* without a
polygon. It also gives `[94]` movement records somewhere to point.

**Append-only completion events.** Adopt, as above.

**Local notifications, opt-in.** Adopt, and note that it corrects a framing
error of ours — **two of them, stacked.**

`DOMAIN-SCOPE.md` §8.2 filed push notifications as an open question because
they "need a server, which is exactly the dependency this app is built to
avoid".

The first error is the distinction: that is true of *push* and false of *local
scheduled* notifications, which are an OS API, fire with the radio off, and are
the natural output of a due engine that already recomputes locally.

**The second is the premise, and it is the one worth catching, because it was
load-bearing under the first.** There is a server. `api.swbuild.dev` has
authenticated, synced, billed and served the APK since long before that
sentence was written, and D10 describes a separate Fastify service as a settled
decision. Offline-first is a promise about the handset — records land in local
SQLite and the app opens with no signal — not a claim that the project has no
back end. Treating "it needs the server" as disqualifying is a rule this
project has never actually held, and it has been quietly ruling things out on
those grounds.

Both are now corrected in `DOMAIN-SCOPE.md` itself. A withdrawal clearing, a
hatch date and a service due are precisely the events worth a notification, and
the local ones need nothing that does not already exist.

**Individual-animal lifecycle.** Adopt. The record exists and terminates
nowhere: no outcome, no location history, no linked timeline. This is the same
hole as `[98]` processing and `[94]` movement, and the assessment is right that
it wants to be one coherent record rather than three features.

**One inventory model.** Adopt. Feed, seed, medicine, fuel, parts and packaging
are the same shape, and inventory movements linking to the event that consumed
them is what makes feed cost per group real rather than assumed.

**One adaptable animal-outcome flow** for death, cull, sale, transfer,
processing and predator loss. Adopt — it is a simplification that also closes
`[98]`, and it is better than adding four screens.

**Crop input and pesticide records.** Adopt, and it independently found what
`[107]` did. Two reviewers arriving separately at "the statutory field list is
missing" is as close to confirmation as this gets.

**Reports that carry human-readable names beside stable identifiers.** Adopt,
cheap, and the difference between an export an accountant can use and one they
cannot.

**Progressive disclosure — minimum fields, then "More details".** Adopt the
positive half. Its framing assumes a Basic/Full mode exists to be replaced;
no such setting appears in the code, so what this actually is is a request to
*build* the comprehension rubric rather than to restructure it. Worth saying,
because the masterplan calls Basic mode the competitive differentiator and
treats a regression in it as P1 — a thing that does not exist cannot regress,
and that gap deserves to be named rather than assumed shipped.

### ADOPT, CHANGED

**Targeted CSV import.** This is the assessment's strongest challenge to a
settled decision, and **the challenge lands.**

Our refusal (`COMPETITIVE-ANALYSIS.md` §2.1) rests on three hazards: merging
against records that already exist and already sync, an id strategy for rows
that have none, and a preview nobody reads. Every one of those is about
importing **historical events into a populated farm**.

The assessment proposes something different: current animals, equipment,
varieties, plantings and inventory, into a farm adopting Steading. Check the
hazards against *that*:

- Nothing to merge against — the farm is empty.
- The id problem is not a problem — every imported row is a create, and the
  client mints a ULID exactly as it does when somebody types the animal in.
- The preview is not load-bearing — a bad import into an empty farm is undone
  by starting over, which is a thing a farm can actually do on day one and
  cannot do in year two.

**So the refusal is correct about what it examined and does not cover this.**
The distinction is not "current versus historical", though — it is **empty
versus populated**, which is the same boundary `ROADMAP.md` §12 already used to
justify backup restore over the identical objection. Bound the import to a farm
with no records of that entity type, and the whole argument for refusing it
falls away.

The cost of holding the line is real and it is named in the assessment's own
terms: an established farm with 60 ewes retypes 60 ewes, or does not adopt.

**Meat processing and freezer inventory.** Adopt the processing record without
reservation — it closes the grow-out clock that currently counts down to a day
nothing records. Treat the freezer half as optional and off by default, which
the assessment itself suggests; a farm that wants to track packages will, and
one that does not should never see it.

**Basic farm economics.** Adopt the direction, which agrees with `[119]`, and
keep our boundary rather than its wider one. "Amount, category, vendor or
customer, date, related entity, notes, exported" is the right model. Feed cost
per group and yield per bed are already derivable. What neither document should
authorise is anything that starts to look like a balance.

**Individual production records for identified breeders.** Adopt narrowly. Our
refusal of per-bird egg logging is sound — five hens on one roost make a
per-bird tally a guess recorded as a fact — and it does not apply to a trap nest
or an individually housed animal. `eggLog.birdId` is already in the contract for
this case. Optional, never the default, and never offered on the ordinary
flock screen.

### REJECT

**The universal farm-event structure** — one reusable event carrying date,
person, location, notes, photos and relations to animals, groups, beds, crops,
equipment and inventory, replacing the shapes used by feed, care, treatment,
harvest, production, weighing, shearing, hours, adjustments and service.

**Reject as an entity; adopt as a field set.**

The distinction between append-only and mutable entities is not an
implementation detail — it is what makes sync conflict-free. An append-only
record is immutable in value, so two devices cannot disagree about it, so
applying it is insert-if-absent and replay is a no-op. A single event type
spanning both classes has to be mutable, because service completion and
inventory adjustment behave differently from an egg count, and a mutable
everything-entity puts conflict resolution back into the middle of the daily
logging path. That trade buys consistency of *form* and pays for it in the one
property the whole architecture is built around.

What is genuinely right inside the proposal is that these events should share a
**common set of optional fields** — an actual date and time that can be
backdated, who did it, where, a note, a photo — and that today they do not.
Adding those five fields to the existing entities gets every benefit the
assessment describes, with no change to the sync contract and no rewrite.

**Its delivery order.** Reject the ordering, keep the content. It puts account
requirements and Play release at step 10 of 10. Those are the items with a
**calendar** attached rather than an effort estimate: a new Play developer
account must serve a closed-test period before production access, an OAuth
consent screen needs verification, and a privacy policy is a prerequisite for
both. Sequencing them last means the work finishes and the release then waits
weeks for paperwork that could have run in parallel from the first day.

Its steps 1 and 2 — the defect fixes, then append-only history and safe
correction — are correctly placed and should start immediately.

**"Steading needs opt-in local alerts"** is adopted above; the sub-item
*"inventory reorder or expiry"* is worth a caution rather than a rejection. An
alert nobody can act on from a barn at 6am trains people to dismiss the ones
they can, and reorder thresholds are the classic source of that. Ship it last of
the eight, and only if the due engine's notice-days discipline is applied to it.

### ALREADY TRUE, or already refused for reasons that hold

- **Keep the three-tab navigation** — agreed, and already settled.
- **Its out-of-scope list** — satellite imagery, e-commerce, double-entry
  accounting, telematics, dairy processing, per-bird leaderboards as default,
  and a PDF management subsystem. Every one matches a decision we reached
  independently, which is worth noting: an outside reviewer with no access to
  the reasoning drew the same boundary.
- **Photo restore** — a known TODO, `ROADMAP.md` §12c.
- **Generic file attachment rather than a PDF subsystem** — agreed, and it is a
  cleaner statement of our position than our own.

---

## 3. Where the assessment is blind

Its method is product completeness, and within that it is thorough. Outside it,
it says nothing at all. Nothing in it touches:

- **Time.** No timezone handling exists in this codebase and no item mentions
  it. Every "actual date and time, including backdating" it asks for lands on
  an undefined day boundary.
- **The update path.** It asks for a Play release and does not ask how a farm
  that installed from the shelf ever gets a fix.
- **Google sign-in against Play App Signing**, which will fail in production on
  the day the store route opens.
- **Operations.** Backups, restore drills, key custody, monitoring, the bus
  factor, what farms get if this stops.
- **The physical yard.** A wet glove does not register a capacitive tap. Every
  "quick event entry" recommendation assumes it does.
- **Entry-quality.** It asks repeatedly for records to be correctable and never
  asks for a wrong number to be caught at the moment it is typed.

**This is a fair division of labour rather than a criticism.** Used together the
two documents cover the product and the platform. Used alone, either would ship
something that fails for a reason the other predicted.

---

## 4. What to do

**The agreed subset is a checklist: [`APPROVED-WORK.md`](APPROVED-WORK.md).**
It merges what is adopted here with what was agreed from `UNCONSIDERED.md`,
marks every line with where it came from, and carries the rejections at its foot
so nothing refused gets picked up later by accident. What follows is the order.

**Immediately, and none of it is a feature:**

1. **Seed `SiteSetupScreen` from the site record.** One bug, silent, corrupting
   the input every growing calculation reads.
2. **Hold produce on an open course**, and ask for the real last-dose date when
   closing one.
3. **Audit every edit screen for the merge-clearing class**, using
   `TreatmentScreen`'s fix as the pattern. `EditGroupScreen` is one instance;
   nobody has checked the rest.
4. **Filter breeding records by group.**
5. **Add password recovery**, beside account deletion in Phase B.

**Then the structural work, in this order:** append-only completion events;
the reusable detail-and-timeline screen; named locations and movement; the
animal outcome flow; one inventory model. That sequence is roughly the
assessment's own, and each step makes the next one smaller.

**And start Phase A's paperwork on the same day as item 1**, because it is the
only work here that cannot be compressed by doing it well.

---

## 5. On the assessment itself

It found four real defects in a codebase whose own documentation is unusually
careful, two of which are in code that comments on the exact failure it then
permits. That is the most useful kind of review: it read what the code does
rather than what the comments say it does.

Its central recommendation — build a small reusable product system rather than
more screens — is right, and it is the thing neither of our own sweeps said,
because both were looking for absences and this was looking at shape.

Where it is wrong, it is wrong in one direction: it treats the app as a set of
workflows to complete, and a farm's records live on a device, in a yard, on a
platform, run by somebody. That is the other document's job.
