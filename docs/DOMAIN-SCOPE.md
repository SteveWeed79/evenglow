# Steading — what a small farm actually needs

**This is the scope, written from what was asked for.** The previous rubric was
narrower than the request that produced it: crop planning was cut on a
competitive argument — someone else does it better — which is an opinion about
a market standing in for a product decision nobody asked for. That is reversed.
Animals, growing and equipment are all first-class, and none of them is a
module bolted to the side of another.

Three domains, named as they were asked for:

- **Animals** — needs, products, feeding, birthing and hatching
- **Plants** — by zone; when, how, where; the schedule
- **Equipment** — reminders, storage readiness, maintenance

---

## 0. The one thing that makes all three tractable

**Build one due-date engine, not three.**

A withdrawal window closing, a hatch date, a sow window opening after last
frost, a 250-hour service, a doe due to kid, a mower that wants winterising —
these look like six features and are one:

> Something becomes **due** at a date or at a meter reading, it appears on
> **Today** when it is near, and it is **cleared** by an event that is already
> being logged.

Everything else is data. Get this wrong and the app is three apps sharing a tab
bar; get it right and each domain is mostly a table of intervals.

**Built.** `packages/contracts/src/due/`, and it is pure — no store, no clock,
no network.

```ts
export interface Due {
  key: string;                          // stable across recomputations
  kind: DueKind;                        // withdrawal | service | sow | birth | hatch | …
  subject: { entity: Entity; id: string };
  title: string;                        // already in the farm's words
  /** Exactly one. A service is by date or by hours, never both. */
  at: number | null;
  atReading: number | null;
  /** When a meter target is expected to arrive, so it sorts against dates. */
  projectedAt: number | null;
  noticeDays: number;
}
```

Three properties it has, and each is a lesson from something already built:

1. **Derived, not authored.** A due row is computed from the records that imply
   it — a treatment implies a withdrawal, an hour reading implies a service, a
   planting implies a sow date. Nobody types a reminder in. Reminders people
   have to enter are reminders people stop entering, and an app whose alerts
   are only as good as its data entry quietly stops warning about anything.
2. **Recomputed locally, never pushed.** No notification server, no cloud
   scheduler. The device knows the last hour reading and the interval; it can
   do arithmetic with the radio off. This is not a limitation, it is the
   feature.
3. **Nothing is marked done** — a correction to the first sketch of this
   design, which had a `clearedBy` field. There is no completion flag. You log
   the service, and the next recomputation does not produce that row because
   the record it was waiting for now exists. A stored completion flag is a
   second source of truth about whether something happened, and the two drift.

Which is why `Due` is a projection and not a syncable entity: it never crosses
the wire, so it cannot conflict, cannot be rejected, and needs no schema on the
envelope.

**The two failure modes it is built against.** A row nothing can clear sits on
Today forever, and a list with a permanent resident is a list people stop
reading — so every builder returns nothing rather than an unclearable row (an
hours interval on a machine with no meter, a transplant for seedlings never
started, a harvest for a planting that failed in May). And a row that should
have cleared and did not — so each builder is tested with its clearing event
both present and absent.

**Notice is per-kind and it is the whole tuning surface.** `due/notice.ts`, one
table. Each number is a claim about how long the *preparation* takes, not about
importance: a withdrawal gets zero days because knowing on Tuesday that eggs
clear on Friday changes nothing you do on Tuesday; a sow window gets a
fortnight because seed has to be to hand; a birth gets six weeks because
someone has to build a pen and be around.

---

## 1. Animals

### 1.1 What exists

`flock` (any group — the UI says herd, drove, gaggle per species),
`animal` (an individual), `medication`, `eggLog`, `productionLog` (milk, fibre,
honey), `feedLog`, `mortality`, `predator`. Twenty species in `SPECIES_TRAITS`
across poultry, ratites, ruminants and other, each with its collective noun and
whether it lays or milks.

Stock is **mixed, not poultry**. That is settled and must not regress.

### 1.2 Built since this was written

**Birthing and hatching.** `breeding` and `incubation` in
`packages/contracts/src/entities/breeding.ts` — two entities, because they are
genuinely different events. A gestation is one animal carrying one pregnancy to
a date; an incubation is a batch with a candling step and a hatch rate. Forcing
them into one shape would leave half the fields meaningless in either case.

**The grow-out clock**, which is what "if they are meat birds, why do we not
display how long until they can be processed?" was asking for. Nothing knew
because nothing recorded a *purpose*. Now `flock.purposes` says why the group
is kept, `flock.breedId` says which bird, and the library says how long.

It refuses to guess three things, and each refusal is a test:

- **A purpose.** A hen can lay and can be eaten; which the keeper intends is a
  fact about the keeper. A processing countdown on a flock of pet bantams is
  not a helpful default, it is an offensive one — which is exactly what
  `companion`, `breeding` and `guarding` exist to prevent.
- **A start date.** `bornAt`, never `acquiredAt`. Day-old chicks bought on
  Tuesday hatched on Monday; point-of-lay pullets bought on Tuesday are sixteen
  weeks old, and counting from acquisition would say they are ready to process
  in six.
- **A figure for an unlisted breed.** Null, not an average.

The window is a window. The library says six to nine weeks because that is what
is true, and the due row anchors at the *start* — the decision is "book the
processor", and that has a lead time.

**`weight` and `shearing`**, both append-only. A growth curve is how a keeper
knows a bird is on track before the processing date arrives; one number says
almost nothing and the series says everything, which is why they are never
overwritten. A fleece is an annual event with a weight, not a daily tally,
which is why it is not a `productionLog`.

**`feedPlan`** — what a group *should* be fed, as distinct from what it was.
Without it there is nothing to check consumption against, so a bag running out
is discovered rather than predicted.

### 1.4 Needs — built

Worming, hoof trimming, minerals, vaccination, a parasite check. Not a
subsystem, exactly as this section said: one table of intervals
(`due/care.ts`), one append-only `careLog` that clears them, and twenty lines
of builder.

Keyed by **species group**, not species — hooves grow at the same rate on a
goat and a sheep, and neither is a hen. Keying per species would be fifty rows
repeating five answers. A handful of species override where they genuinely
differ: cattle feet at 182 days against a goat's 56, a horse at 42 with teeth
nothing else on the list has.

Two judgement calls worth arguing with:

- **A job never recorded is due now**, not one interval from today. A farm that
  has never logged trimming either is not trimming or is not recording it, and
  both are worth a row; starting the clock at install would tell someone their
  overdue herd is fine for another eight weeks.
- **The worming interval is a reminder to assess, not a schedule to dose on.**
  Blanket worming on a calendar is how resistance is built, and the honest
  thing an app can do is prompt a look rather than prescribe a drench.

### 1.5 What is still missing

**Screens.** All of the above is headless. None of it is reachable by a person
yet, and that is deliberate while the design is being reworked for React
Native.

---

## 2. Plants

**Nothing exists. This is a whole domain, not a feature.**

### 2.1 The model

Four entities, and the discipline is to stop there:

```ts
site       // where the farm is: zone, frost dates, units, rotation years
bed        // a place: name, size, sun, covered. Belongs to a site.
variety    // a thing you can plant: crop, cultivar, family, lifecycle,
           // days to maturity, sow depth, spacing, timing anchors
planting   // variety × bed × season. Planned and actual dates side by side.
harvest    // append-only, like eggLog: planting, date, mass or count
```

**Succession** is not a sixth entity — it is a planting with a repeat interval,
which generates the next one. **Rotation** is not a seventh — it is a query over
plantings by family.

### 2.2 Zone AND frost dates — both, because they answer different questions

**A hardiness zone is not a planting date.** It is the average annual minimum
winter temperature, and it decides *what survives here*: fruit trees,
asparagus, rhubarb, berry canes, perennial herbs — everything that stays in the
ground over winter. It says nothing about timing.

**Frost dates are the growing window**, and they decide *when the annuals go
in*: start indoors six weeks before last frost, direct-sow after it, count back
from first frost for autumn crops.

Neither can be computed from the other, so a site stores both.

The zone is stored as `{ system, value }`, never a bare string. "7a" means
nothing on its own — USDA 7a is a temperature band, RHS H4 is a different band
measured differently, and AHS heat zones count days *above* 30 °C and run the
other way entirely. A bare `zone: "7a"` column is a US-only column wearing a
general name. Stored this way, adding the UK or Australia is a table, not a
migration.

Where the values come from:

- **A bundled US hardiness-zone table** by postcode, so the app works offline
  from first launch for most users.
- **An online lookup at setup**, which refines the bundled answer and is the
  only route for anywhere outside the US. One call, cached to SQLite forever.
- **Manual override on both, always available.** A farmer knows their own frost
  dates better than a map does — a valley, a south wall, or three hundred
  metres of elevation all beat a postcode. The lookups exist so nobody has to
  type anything on day one, not because they are more authoritative.

Everything downstream is arithmetic on those two dates, and it is pure — no
server, ever. `packages/contracts/src/growing/schedule.ts`.

### 2.3 What multi-year planning changes

Planning several seasons ahead, including perennials that hold a bed for years,
changes three things:

1. **Beds have history, and occupancy is derived.** A planting occupies its bed
   from sowing until `removedAt`; a perennial simply never has one. Nothing
   stores "what is in this bed" — it would be wrong the moment anything was
   pulled.
2. **Plantings carry planned *and* actual dates.** A 2028 row exists with
   nothing sown in it. Keeping both is what lets the app say "you sowed this
   three weeks late last year" rather than overwriting the plan with reality
   and losing that they diverged.
3. **Varieties carry a plant family**, because that is what a rotation warning
   compares. Brassicas following brassicas build club root; solanaceae
   following solanaceae build blight. `rotationYears` is a site setting, not a
   constant — a farm with four beds physically cannot manage a four-year
   rotation.

### 2.4 Zone warns, it never blocks

A variety outside the site's zone shows a sentence — "figs usually will not
survive winter in your zone; grown here they want a pot brought in, a tunnel,
or treating as an annual" — and can still be planted. A south wall, a cold
frame or a pot wheeled into a shed all beat the map, and an app that tells a
grower no is an app that is wrong about that grower.

The same rule applies to season length: a 120-day melon in a 100-day season is
flagged, not hidden. People beat short seasons with tunnels and bought-in
transplants every year.

`unknown` is a real third answer and is returned whenever either side is
missing. A false "hardy" costs someone a tree; a false "tender" costs a
sentence they can ignore.

### 2.5 Where growing lives

Its own tab. It replaced More, which was never a place you go — it was a
drawer. Today · Stock · Growing · Iron, with settings pushed from the header.

---

## 3. Equipment

### 3.1 What exists

`equipment`, `hourReading`, `maintenance`. Hour meters, service intervals, and a
usage-per-day estimate so a filter can be ordered before it matters.

### 3.2 What is missing

**Storage readiness.** Winterising, fuel stabiliser, battery off, blades off,
put away dry. This is a seasonal checklist per machine, and it is a due row
keyed to a date rather than a meter — which is why the due engine takes either.

**Reminders that reach a person.** The `task` entity exists and nothing
schedules it. With the due engine, it does not need to: a reminder is a due row
surfacing on Today.

Notifications are a later question, and the reason given here used to be wrong.
It said push "needs a server, which is exactly the dependency this app is built
to avoid" — and there is a server. `api.swbuild.dev` has authenticated, synced
and served the APK since before this paragraph was written. **Offline-first is
a promise about the handset**, not a claim that the project has no back end;
D10 has described a separate Fastify service all along.

So the honest ordering is by what each thing costs, not by whether a server is
involved:

- **Local scheduled notifications need nothing new.** They are an OS API, they
  fire with the radio off, and the due engine already recomputes locally —
  which makes them the natural output of a system that is finished. This is the
  one to build.
- **Push needs a server *push* path** — device tokens, a scheduler, FCM — which
  is real work, and it earns nothing a local notification does not until
  something has to reach a farm that has not opened the app.

**Parts and consumables — built.** The schemas already carried the link:
`maintenance.partIds` names what a service consumes and `inventory.equipmentId`
ties a part to its machine. What was missing was the question, and the question
was the whole feature.

`due/parts.ts` raises a **separate row** for ordering rather than a flag on the
service, because they resolve differently: "order the filter" is done by
ordering and "change the filter" is done by changing it. Folded together, a
service would sit amber with no way to tell — at a glance, in a barn — whether
the job was waiting on a person or on the post.

The order is dated *ahead* of the service by its lead time. A part ordered the
day a service falls due is a part that arrives after it. And a service with no
parts linked is `unknown`, never `short`: a farm that has not linked its filters
is not a farm that is short of filters.

---

## 4. What this adds to the mutation envelope

New entities, in the existing two classes:

| Entity | Class | Notes |
| --- | --- | --- |
| `breeding` | mutable | Outcome is filled in months later, so it updates |
| `incubation` | mutable | Candling and hatch are updates to the same set |
| `weight` | append-only | A growth curve is a series of facts |
| `shearing` | append-only | Annual, with a weight |
| `feedPlan` | mutable | The ration; `feedLog` stays append-only |
| `site` | mutable | Zone, frost dates, units, rotation years |
| `bed` | mutable | A place, renamed and retired like a flock |
| `variety` | mutable | Editable, because the bundled numbers are a starting point |
| `planting` | mutable | Dates get corrected; a planting can fail |
| `harvest` | append-only | Exactly like `eggLog` |

Ten entities — all built. The append-only ones cannot conflict, which is most of the point
of classifying them that way. The mutable ones are archived, never deleted
(P13).

`due` is deliberately **not** in this table. It is derived from the others and
recomputed locally, so it is a projection, not a syncable entity — which means
it cannot conflict, cannot be rejected, and does not need a schema on the wire.

---

### 4.1 Units

**Imperial by default, metric one switch away, and neither is what is stored.**

Every measurement crosses the wire and hits SQLite as an integer in a canonical
base unit — micrometres, micrograms, microlitres, tenths of a degree Celsius —
and is converted only where a human reads or types it.

Two reasons, and the second is the load-bearing one:

1. A farm that switches display units must not rewrite its history. Storing
   what was typed means "4 lb" and "1.81 kg" are different rows describing the
   same basket, and any sum over both is wrong.
2. **Integers, so nothing drifts.** The bases are chosen so imperial is
   *exact*: one inch is 25,400 µm, one pound is 453,592,370 µg. At millimetre
   and milligram resolution — the obvious first choice — a quarter-inch sow
   depth read back as 0.236", and a one-pound harvest read back as 0.99999918
   lb and therefore displayed as "16 oz". Both of those were caught by tests
   before anything rendered them.

## 5. Reference data

**Built.** `packages/contracts/src/library/` — 65 varieties and 47 breeds.

A farm's own edits always win, and a farm can add anything the library does not
have. Both extremes fail: with nothing bundled, every new user faces an evening
of typing before the app does anything useful; with a large scraped catalogue,
wrong numbers are presented authoritatively, which is worse than no numbers
when someone is deciding when to process a bird.

**Ranges for breeds, points for varieties**, and that is not an inconsistency.
A breed's grow-out is genuinely a range — "eight to nine weeks" is true, "eight
weeks" is a claim about a specific bird on specific feed. A named cultivar's
days-to-maturity is a point because that is what the packet says and what the
grower compares against; the variation there lives between cultivars, which is
why they are listed separately.

**The library is data, not rows.** Picking an entry creates a farm's own
`variety` record with the numbers copied in. That is what makes the override
rule work: the farm edits its copy, and a later app version can revise the
library without silently rewriting anyone's records. It also means there is no
"library variety you have not added yet" cluttering the store, and no migration
when the library grows.

**Provenance, stated honestly.** These are the commonly published figures —
what breed associations, seed catalogues and extension guides broadly agree on,
assembled with our own structure. They are not transcribed from any single
compilation, and specifically not from commercial breeding companies'
performance objectives: those are the most precise figures available and the
most legally fraught, and `BREED-AND-PURPOSE.md` §5 leaves their licensing as an
open question nobody has answered. The `provenance` field records that rather
than implying a citation nobody checked.

### 5.1 What the data tests police

No test can check that a number is *correct*. What they check is the class of
typo that no type catches and that looks fine in review:

- Every entry converts into a valid record. An entry that cannot is decoration
  — browsable and unplantable.
- Every variety has at least one way into the ground, and never transplants
  before it was started indoors.
- Every range runs low-to-high. `[9, 6]` type-checks, reads fine, and produces
  a countdown that has already ended.
- **Every purpose has the figure it needs.** A breed that says `meat` must
  carry a grow-out, `milk` a yield, `fibre` an interval. This one found seven
  dual-purpose birds claiming meat with no clock to count — a label the app
  could not act on.

---

## 6. What this does NOT reopen

- **The contracts.** Same envelope, same versioning, same idempotency.
- **The sync semantics.** Client-minted ULIDs, `clientSeq` ordering, idempotent
  apply, per-mutation results, the rejected inbox.
- **Tenancy.** `scoped(orgId)`, role re-derived on every mutation.
- **Offline-first.** Every one of the features above works with the radio off.
  The zone lookup is the single exception and it is optional, one-time, and has
  a manual path.

---

## 7. Order

Storage and the engine first, then the domains on top of a queue that has been
proven rather than one being written underneath them. R1–R3 are done; R4 is the
screens and the design pass.

Within the domains, the order that gets a farm the most soonest:

1. **Growing**, because it is the whole missing half and the frost-date
   arithmetic is the due engine's first real customer.
2. **Birthing and hatching**, because it is the largest gap in a domain that
   otherwise works, and it is what the year is planned around.
3. **Storage readiness and parts**, because iron is closest to complete and
   these finish it.

---

## 8. Open questions

1. ~~**Multiple people on one farm.**~~ **Built.** `POST /invites` and
   `/invites/accept`, plus member listing, role changes and removal.

   The invite is **bound to an email**, not a bearer link. A link travels by
   text message and sits in a phone forever; binding means a leaked one is
   useless to anyone but the person it was for. The token is 256 bits, hashed
   at rest, single-use, and returned exactly once.

   Two lockouts are closed structurally: **the last owner cannot be demoted or
   removed**, and **nobody changes their own role** — which stops an admin
   promoting themselves and stops an owner demoting themselves out of the only
   role that could undo it. An admin cannot mint an owner, cannot act on an
   owner at all, and removal is a *disable* rather than a delete so a
   morning's egg logs stay attributable to the person who typed them.

   One thing deliberately refused: **an existing account cannot accept an
   invite.** A user belongs to exactly one org, so accepting would move them
   and strand every record they wrote behind a tenancy boundary their account
   no longer sits inside. Joining a second farm needs a membership model this
   schema does not have, and inventing one to make an error message go away
   would be the wrong place to decide it.
2. ~~**Push notifications.**~~ **Reframed — the question was wrong.** It asked
   whether "the app tells you" was wanted badly enough "to take a server
   dependency", and there is a server; that was never the trade. §3.2 has the
   corrected version. What remains open is narrower and worth answering: local
   scheduled notifications are cheap and should be built, and *push* only earns
   its keep for something that has to reach a farm which has not opened the app
   in days. Is there such a thing here?
3. **Units.** Imperial or metric, per farm or per field? Pounds and kilos both
   appear in the reference data, and guessing wrong on a medication dose is not
   a cosmetic error.
4. **How much of the growing year to plan ahead.** A single season, or
   multi-year rotation? Rotation needs bed history and is a materially larger
   model.
