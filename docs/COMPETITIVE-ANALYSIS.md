# Steading — Competitive Analysis

Researched July 2026; §6 added August 2026. Purpose: define the parity floor (what we must match to be taken seriously) and the wedge (what nobody does well).

---

## 1. The Landscape

The market splits into three camps. Nobody occupies the intersection, which is exactly where this app sits.

### A. All-in-one farm platforms

**Farmbrite** — the closest direct competitor. ~5,000+ customers, aimed at small diversified farms and homesteaders. Covers livestock records across species, crop planning, equipment maintenance logs, task management, inventory, finances, and direct sales. Mobile apps for iOS/Android include an offline mode for scouting and record keeping. Unlimited users with pre-built roles; users report giving kids and service managers scoped logins. Equipment records accept receipts, photos, and operator's manuals as attachments. Audit logs are a selling point for certifiers.

> **The recurring complaint is the learning curve.** Reviewers describe a lot of sections and small details to stay on top of, and occasional glitchiness. One review flatly calls it difficult to figure out. This is the single most important finding in this document — the market leader's weakness is comprehension, not capability.

**FarmKeep** — poultry-focused within a broader platform. Multi-species (chickens, ducks, quail, turkeys, geese), incubation and hatching records, per-species customized record keeping.

**Cloud Farmer / FOG Tracker / MyFarmImpress** — smaller offline-capable field companions to web platforms. Confirms offline sync is now table stakes, not a differentiator.

### B. Poultry specialists

**Flockstar** — the strongest bird-level product. Per-bird profiles with photos, breeds, traits, colors, weights; daily egg logging by flock or individual layer; bulk create/update of hundreds of birds; three-generation pedigrees and per-pairing fertility/hatch rates; archive without losing history; CSV import of egg history; cost tracking. Tiered plans (Backyarder / Keeper / Breeder). Reviewers specifically praise **cost per egg** analysis and the **monthly laying leaderboard**, which families apparently bet on.

> Two feature requests appear directly in Flockstar's own reviews and are unmet: **medication dispensing tracking** (e.g. treating a waterer) and double-yolk logging. The medication gap is ours to take.

**My Poultry Manager** — batch-oriented, broiler growth and feed usage, reports. Open request in reviews: cull bird weights to compute meat produced per flock.

**ChookBook / Flockmaster / Count Your Eggs** — the simple end. Per-hen page with photo, one-tap daily egg tally, production graphs over week/month/quarter/year. These win on speed of entry and nothing else, and they win a lot of users that way.

### C. Equipment / CMMS

**LookOver** — built by a rider who couldn't find a fit. Works offline by design, tracks by engine hours, photo attachment per service, and pitches **exporting full maintenance history when you sell the machine** as a headline benefit. Positions itself as usable with greasy hands. Closest thing to a philosophical sibling.

**CroTrack** — service intervals by hours, mileage, or date; free tier caps at 3 machines.

**SimplyFleet** — intervals by hours/mileage/time, custom inspection checklists per equipment type, offline logging with sync, assignable repairs.

**John Deere Equipment Mobile** — the onboarding lesson. **Factory maintenance plans are pre-installed per machine model** and auto-assigned when you add equipment; logging hours then drives the reminders. Zero setup burden.

**UpKeep / Maintainly** — the industrial framing that matches farm reality: most farm maintenance is triggered by engine hours, not calendar time (oil at 250 hours, not every three months), while hour-meter-less assets like pumps and augers still need date-based intervals. Parts inventory with low-stock alerts before a service window.

---

## 2. Parity Floor

Ship these or the app reads as a toy. Ordered by how visible their absence is.

| # | Capability | Set by | Status in our plan |
|---|---|---|---|
| P1 | Per-bird profiles with photo, breed, hatch date, traits | Flockstar, ChookBook | **ADD** — plan had flocks, not birds |
| P2 | Daily egg logging by flock **and** by individual bird | Flockstar | **REFUSED** — see §2.1 |
| P3 | Cost per egg / cost per bird | Flockstar | **ADD** — no financial tracking in plan |
| P4 | Production graphs: week / month / quarter / year | ChookBook, Flockstar | **ADD** |
| P5 | Maintenance intervals by hours **or** date, whichever first | All CMMS | Already in v2 plan |
| P6 | Attach receipts, photos, and PDF manuals to equipment | Farmbrite, LookOver | **Built for photos; PDF manuals REFUSED** — see §2.1 |
| P7 | Full maintenance history export when selling a machine | LookOver | Covered by general export |
| P8 | Parts inventory with low-stock alerts tied to upcoming service | UpKeep | Partially planned — needs the service linkage |
| P9 | CSV import **and** export | Flockstar | Export built; **import REFUSED** — see §2.1 |
| P10 | Multi-species (chickens, ducks, quail, turkeys, geese) | FarmKeep | **ADD** — plan assumed chickens |
| P11 | Multiple users, scoped roles, no per-seat fee | Farmbrite | Planned |
| P12 | Offline logging with automatic sync | Everyone now | Planned (and our core strength) |
| P13 | Archive a bird without deleting its history | Flockstar | **ADD** — soft-archive semantics |
| P14 | Incubation / hatch runs with fertility rates | Flockstar, FarmKeep | **ADD as v2** — defer, but don't design it out |
| P15 | Per-equipment inspection checklists | SimplyFleet | **ADD** |

### 2.1 — Three of these are refused, and the reasons are the farm's own

A refusal nobody wrote down becomes a thing somebody rebuilds. These were on
the parity floor, were reachable, and were turned down after the app existed —
which is the only point at which you can tell whether a competitor's feature is
a real want or a screenshot.

**P2 — egg logging per individual bird.** Refused, and the argument is one
sentence from the farm: *"I have 5 laying hens currently, they all use the same
roost."* Nobody can attribute an egg to a hen without trap-nesting, so a
per-bird tally is either a guess recorded as a fact or a chore that produces
one. `eggLog` keeps `birdId` in the contract — it costs nothing, the server
applies it, and a farm that genuinely traps nests could use it — but no screen
writes one, and that is deliberate rather than unfinished.

This is the same refusal as P1's, one level along. Per-bird identity matters at
the pet-chicken end of the market, which is Flockstar's and not the
masterplan's.

**P6 — PDF manuals on equipment.** The photo half is built and is the half that
was worth having: a receipt cannot be reconstructed later, and LookOver's
headline is the history you hand over with the machine. The manual half is
refused because *"it won't work on most phones"* — a service manual is a
hundred pages of 8pt type, and the honest reading experience on a handset in a
barn is that nobody reads it there. `photoShape` stays images-only, so there is
no half-supported document type sitting in the contract inviting an attempt.

**P9 — CSV import.** Refused as a liability, and that is the right word. Import
means merging rows somebody edited in a spreadsheet against records that
already exist and already sync: it needs conflict rules, an id strategy for
rows that have none, and a preview nobody will read — and every one of those is
a way to quietly corrupt a farm's history. **Export is the half that matters**,
because it is what stops the app being a trap, and it is built. Getting data
*out* has no failure mode worse than a bad spreadsheet; getting it *in* does.

---

## 3. The Wedge

Where we win. Each is a real gap, not a spin on parity.

**W1 — Offline-first, not offline-tolerant.**
Competitors bolt offline onto a cloud app. Ours is a native app over a local SQLite database that happens to sync — the data sits in the app sandbox, not in a browser storage bucket the OS is permitted to evict. Concretely: cold start to logged egg count in under five seconds with the radio off, and a visible, diagnosable queue. Nobody advertises what happens when sync *fails*, because in their apps it fails silently.

**W2 — Medication and withdrawal tracking.**
Requested in Flockstar reviews, unmet. Log a treatment, get an automatic egg/meat withdrawal window, and see a blocking warning on the egg-collection screen while the window is open. This is compliance-grade and nobody at homestead scale does it. **Highest-value single feature in this document.**

**W3 — One app for birds and iron.**
Flockstar users needing equipment tracking run LookOver too; Farmbrite users get both but pay in complexity. Today's chores don't sort themselves by module — the morning list is "feed birds, check waterer, grease loader."

**W4 — Preset-driven onboarding, Deere-style.**
Add a Kubota B7800, get its service intervals pre-populated. Add a breed, get expected lay rates and mature weights. Setup burden is why record keeping gets abandoned; extension guidance is blunt that overly complicated systems lead to mistakes or abandonment.

**W5 — Hour-meter forecasting.**
Everyone alerts when you cross 250 hours. We say "due in about 9 days at 1.4 h/day" — the number that lets you order the filter before it matters, which is precisely the failure UpKeep describes.

**W6 — Comprehension as the headline feature.**
The market leader's weakness is that it's hard to learn. We ship a Basic/Full disclosure toggle per module, and treat "a farm hand can log a day's work without training" as a release gate.

**W7 — Delight, borrowed honestly.**
Flockstar's laying leaderboard drives daily engagement and costs almost nothing to build. Adopt it. Add streak tracking on morning chores.

---

## 4. Explicitly Out of Scope

**This section previously excluded crop planning, and that was wrong.** The
reason given was that a competitor covers it and "we will not beat it there" —
a competitive opinion, standing in for a product decision nobody had asked for.
Steading covers what a small mixed farm actually does, animals and growing
alike. The scope now lives in the masterplan's Feature Outline, and growing is
half of it.

What remains out is out because it is a **different product**, not because
someone else sells one: field mapping and GPS boundaries, satellite and weather
imagery, e-commerce and CSA order management, full double-entry accounting, GPS
telematics hardware, and dairy processing workflows. Cost tracking stays at the
level needed for cost-per-egg, cost-per-bed, and a Schedule F export.

**What this document is for.** It records what competitors do and why features
earn their place. It does not get to decide what the product is. Where the two
conflict, the masterplan wins.

---

## 5. Feature Additions Adopted

Merged into the master plan:

- Individual bird records with photos, traits, weights, archive-not-delete
- Per-bird and per-flock egg logging, with a per-bird leaderboard
- Multi-species support from the schema up
- Cost tracking sufficient for cost-per-egg and cost-per-bird
- Medication log with automatic withdrawal windows and a blocking egg-screen warning
- Mortality with cause, plus cull weights for meat-yield math
- Equipment document attachments (manuals, receipts) and inspection checklists
- Equipment presets by make/model; breed presets by species
- Hour-meter usage-rate forecasting
- Parts inventory linked to upcoming service intervals
- ~~CSV import as well as export~~ — **contradicted by §2.1 and superseded.**
  Export is built; import stays refused for the reasons P9 gives. What was
  built instead is a **backup file**, which is the app's own output going back
  into an empty farm: nothing to merge against, every row carrying the ULID it
  was minted with, and nothing to preview. See `ROADMAP.md` §12.
- Deferred to v2, but not designed out: incubation and hatch runs, pedigree/lineage

---

## 6. Onboarding and Access

Researched August 2026. **The first five sections are entirely about features
and say nothing about what a farm has to do before it sees one.** That gap
mattered: the wedge is offline-first, and an app that cannot be opened without
a login is indistinguishable from a cloud app on the first morning.

### A. Account and subscription before anything

**Farmbrite** — 14-day trial, no credit card to begin, but a full account
before any screen. No permanent free tier; the trial ends in a plan and a card.
Paid tiers meter **active animals** — Lite 100, Rancher 250, Plus 1,250,
Complete 2,500, with archived, sold and deceased not counting. Roughly
**$29–109/month** depending on plan and source.

**Flockstar** — requires an active subscription, 14-day trial across web, iOS
and Android. **$29.99/year.** Cloud sync is the pitch: "automatically synced to
the cloud and backed up securely."

Neither lets a farm log one egg without an account.

> **The pricing spread is the finding, not the wall.** Farmbrite is priced like
> business software and Flockstar like a consumer app — an order of magnitude
> apart. We sit between them in capability, and our buyer is unambiguously
> Flockstar's buyer.

### B. No account at all, advertised as the feature

**FlockPlenty** — "No registration or login required," data on the device. Free.

**Egg Inventory** — "stored locally on your device with no account required, no
cloud sync, no data collection, works completely offline, and has no ads."

**PoultryPal** — offline logging with **iCloud** sync. Worth noting on its own:
sync with *zero app account*, because the platform already knows who you are.

§1.B already observed that this camp "wins on speed of entry and nothing else,
and they win a lot of users that way." That was read as a feature finding. It
is also an onboarding one — there is nothing to sign up for — and the two are
not separable.

**These apps are free because they have no server.** Their marginal cost per
user is zero. That is the whole explanation, and it is the one that decides our
own pricing line.

### C. The middle, which is one product

**LookOver** — already named in §1.C as the closest philosophical sibling. Its
access answers are the interesting ones:

- **Sign in with Google or Apple.** No password. Advertised at "less than 60
  seconds."
- Fully offline; syncs on return.
- **Free tier is one machine, forever, full features** — a scope limit, not a
  countdown.

That last is the strongest single finding in this section. A 14-day trial
started in February expires before lambing; farm software is seasonal and a
clock is hostile to it.

### D. What nobody does

**Full capability with nothing to sign up for.** Camp A has capability behind a
wall; camp B has no wall and no capability. This is the same hole §1 found in
features, in a different wall — and the app is already architecturally most of
the way through it, because D1 has the client minting every id.

The response is `ACCESS-AND-BILLING.md`.

### E. One cautionary finding, pointing the other way

A Flockstar reviewer reports **losing data after upgrading devices and logging
in**. That is the cloud-account failure mode W1 claims to beat — and equally an
argument that people need real accounts and real recovery. Camp B's "all local,
no account" has no answer for a phone in a water trough.

Recovery, not sync, is what an account is for. It should be sold that way.

### Sources

Farmbrite [pricing](https://www.farmbrite.com/pricing) ·
[FAQ](https://www.farmbrite.com/faq.html) ·
[animal counts](https://help.farmbrite.com/help/how-are-active-animals-counted-for-my-farmbrite-subscription-plan) ·
[reviews](https://www.capterra.com/p/136765/Farmbrite/reviews/) ·
Flockstar [pricing](https://www.flockstar.com/pricing) ·
[Google Play](https://play.google.com/store/apps/details?id=com.flockstarpro&hl=en_US) ·
[FlockPlenty](https://farmplenty.com/) ·
[Egg Inventory](https://apps.apple.com/us/app/egg-inventory/id6753229803) ·
[PoultryPal](https://apps.apple.com/us/app/poultrypal-chicken-egg-log/id6743654509) ·
[LookOver](https://lookover.app/farm-equipment-maintenance-app/) ·
[LookOver on Google Play](https://play.google.com/store/apps/details?id=com.lookoverpowersports.app)
