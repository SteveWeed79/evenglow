# Steading — Competitive Analysis

Researched July 2026. Purpose: define the parity floor (what we must match to be taken seriously) and the wedge (what nobody does well).

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
| P2 | Daily egg logging by flock **and** by individual bird | Flockstar | **ADD** — individual-level was missing |
| P3 | Cost per egg / cost per bird | Flockstar | **ADD** — no financial tracking in plan |
| P4 | Production graphs: week / month / quarter / year | ChookBook, Flockstar | **ADD** |
| P5 | Maintenance intervals by hours **or** date, whichever first | All CMMS | Already in v2 plan |
| P6 | Attach receipts, photos, and PDF manuals to equipment | Farmbrite, LookOver | **ADD** — PDF manuals not planned |
| P7 | Full maintenance history export when selling a machine | LookOver | Covered by general export |
| P8 | Parts inventory with low-stock alerts tied to upcoming service | UpKeep | Partially planned — needs the service linkage |
| P9 | CSV import **and** export | Flockstar | Export planned; **import ADD** |
| P10 | Multi-species (chickens, ducks, quail, turkeys, geese) | FarmKeep | **ADD** — plan assumed chickens |
| P11 | Multiple users, scoped roles, no per-seat fee | Farmbrite | Planned |
| P12 | Offline logging with automatic sync | Everyone now | Planned (and our core strength) |
| P13 | Archive a bird without deleting its history | Flockstar | **ADD** — soft-archive semantics |
| P14 | Incubation / hatch runs with fertility rates | Flockstar, FarmKeep | **ADD as v2** — defer, but don't design it out |
| P15 | Per-equipment inspection checklists | SimplyFleet | **ADD** |

---

## 3. The Wedge

Where we win. Each is a real gap, not a spin on parity.

**W1 — Offline-first, not offline-tolerant.**
Competitors bolt offline onto a cloud app. Ours is a local-first database that happens to sync. Concretely: cold start to logged egg count in under five seconds with the radio off, and a visible, diagnosable queue. Nobody advertises what happens when sync *fails*, because in their apps it fails silently.

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

Say no now so it stays no: crop planning and field mapping, satellite/weather imagery, e-commerce and CSA order management, full double-entry accounting, GPS telematics hardware, and dairy-specific workflows. Farmbrite covers these and we will not beat it there. Cost tracking stays at the level needed for cost-per-egg and Schedule F export.

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
- CSV import as well as export
- Deferred to v2, but not designed out: incubation and hatch runs, pedigree/lineage
