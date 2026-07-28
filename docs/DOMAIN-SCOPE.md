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

The shape, concretely:

```ts
export const dueSchema = z.object({
  id: z.string().length(26),
  subject: z.object({                      // what it is about
    entity: entityEnum,
    id: z.string().length(26),
  }),
  kind: z.string(),                        // 'withdrawal' | 'service' | 'sow' | 'kidding' | …
  /** Exactly one of these two. A service is one or the other, never both. */
  dueAt: z.number().int().nullable(),      // epoch ms
  dueAtReading: z.number().nullable(),     // hour meter, for iron
  /** How early it starts appearing on Today. A frost window wants weeks; a
      withdrawal wants the day it clears. */
  noticeDays: z.number().int().nonnegative(),
  clearedBy: z.string().nullable(),        // mutation id of the event that closed it
});
```

Three properties it must have, and each is a lesson from something already
built:

1. **Derived, not authored.** A due row is computed from the records that imply
   it — a treatment implies a withdrawal, an hour reading implies a service.
   Nobody types a reminder in. Reminders people have to enter are reminders
   people stop entering.
2. **Recomputed locally, never pushed.** No notification server, no cloud
   scheduler. The device knows the last hour reading and the interval; it can
   do arithmetic with the radio off. This is not a limitation, it is the
   feature.
3. **Cleared by the event, not by a tick.** You do not "mark done" a service.
   You log the service, and the due row closes because the thing it was waiting
   for happened.

---

## 1. Animals

### 1.1 What exists

`flock` (any group — the UI says herd, drove, gaggle per species),
`animal` (an individual), `medication`, `eggLog`, `productionLog` (milk, fibre,
honey), `feedLog`, `mortality`, `predator`. Twenty species in `SPECIES_TRAITS`
across poultry, ratites, ruminants and other, each with its collective noun and
whether it lays or milks.

Stock is **mixed, not poultry**. That is settled and must not regress.

### 1.2 What is missing

**Birthing and hatching — nothing exists at all.** This is the largest gap in
the animal half, and it is the part of the year a smallholder plans everything
else around.

Two shapes, because they are genuinely different:

```ts
// Mammals. Kidding, lambing, calving, farrowing.
breeding: {
  damId, sireId (nullable — a borrowed buck often has no record),
  bredAt, method: 'natural' | 'ai',
  dueAt,                       // bredAt + gestation days for the species
  outcome: null | { bornAt, live, stillborn, notes },
}

// Birds. A set, not a pregnancy.
incubation: {
  flockId, setAt, eggsSet,
  source: 'own' | 'bought',
  candledAt, fertile,          // day 7-10, the cull that saves incubator space
  dueAt,                       // setAt + incubation days for the species
  outcome: null | { hatchedAt, hatched, culls },
}
```

Gestation and incubation periods are per-species constants and belong in
`SPECIES_TRAITS` beside `laysEggs` — 150 days for a goat, 21 for a chicken, 28
for a duck. Each of `dueAt` raises a due row with a long notice, because
"kidding in three weeks" is when someone builds a pen, not the morning it
happens.

**Feed plans, as distinct from feed logs.** `feedLog` records what was fed.
What is missing is what *should* be fed: a ration per group, so consumption can
be checked against it and a bag running out is predictable rather than
discovered. A feed plan plus a feed log is a due row for "order feed."

**Processing dates for meat stock.** Asked for directly and still absent: if a
group is meat birds, the app knows the species and the hatch date, so it can
say how long until they are ready. This is one field on the group (`purpose:
'eggs' | 'meat' | 'milk' | 'fibre' | 'breeding' | 'pets'`) and one lookup.

**Needs.** Water, minerals, shelter, worming, hoof trimming, shearing. Most of
these are recurring intervals, so they are due rows over a per-species default
that a farm can override — *not* a new subsystem.

### 1.3 Products

`eggLog` and `productionLog` (milk, fibre, honey) cover what comes off an
animal daily. Missing: **weights** (a growth curve is how you know a meat bird
is on track), and **fibre by shearing rather than by day** — a fleece is an
annual event with a weight, not a daily tally.

---

## 2. Plants

**Nothing exists. This is a whole domain, not a feature.**

### 2.1 The model

Four entities, and the discipline is to stop there:

```ts
bed        // a place: name, area, sun, notes. A raised bed, a row, a plot.
variety    // a thing you can plant: 'Sungold', species, days to maturity,
           // sow depth, spacing, indoor/direct, frost tolerance
planting   // variety × bed × date. The actual event.
harvest    // append-only, like eggLog: planting, date, quantity, unit
```

A planting carries the dates that fall out of the variety and the farm's frost
dates: `sowAt`, `transplantAt`, `firstHarvestAt`, `lastHarvestAt`. Each becomes
a due row. **Succession** is not a fifth entity — it is a planting with a repeat
interval, which generates the next planting when the previous one is sown.

### 2.2 Zone and frost dates

This is the decision the whole growing schedule rests on, and it is settled:

- **A bundled US hardiness-zone table** by postcode, so the app works offline
  from first launch for most users.
- **An online lookup at setup**, which refines the bundled answer and is the
  only route for anywhere outside the US. One call, cached to SQLite forever.
- **Manual override, always available.** Last spring frost and first autumn
  frost as two dates a farmer can simply type. This is the ground truth the
  schedule actually uses; the other two are conveniences that fill it in.

Storing the *frost dates* rather than the *zone* is what makes this work
everywhere. A zone is a proxy for those two dates and a lossy one — it does not
survive a valley, a south wall, or a farm three hundred metres above the town
the postcode names. Every farmer knows their own frost dates better than a map
does, and the map is only there so they do not have to type them on day one.

Everything else is arithmetic from those two dates: "sow indoors 6 weeks before
last frost" becomes a real date, which becomes a due row.

### 2.3 Where growing lives

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
surfacing on Today. Push notifications are a separate question and a later one —
they need a server, which is exactly the dependency this app is built to avoid,
so they are a convenience layered on top of a system that already works without
them.

**Parts and consumables.** `inventory` exists. What is missing is the link: this
filter fits that machine, so a service due in two weeks can say whether the part
is on the shelf.

---

## 4. What this adds to the mutation envelope

New entities, in the existing two classes:

| Entity | Class | Notes |
| --- | --- | --- |
| `breeding` | mutable | Outcome is filled in later, so it updates |
| `incubation` | mutable | Same — candling and hatch are updates |
| `weight` | append-only | A growth curve is a series of facts |
| `shearing` | append-only | Annual, with a weight |
| `feedPlan` | mutable | The ration; `feedLog` stays append-only |
| `bed` | mutable | A place, renamed and retired like a flock |
| `variety` | mutable | Editable, because the bundled numbers are a starting point |
| `planting` | mutable | Dates get corrected; a planting can fail |
| `harvest` | append-only | Exactly like `eggLog` |

Nine entities. The append-only ones cannot conflict, which is most of the point
of classifying them that way. The mutable ones are archived, never deleted
(P13).

`due` is deliberately **not** in this table. It is derived from the others and
recomputed locally, so it is a projection, not a syncable entity — which means
it cannot conflict, cannot be rejected, and does not need a schema on the wire.

---

## 5. Reference data

**A starter library, fully editable.** Roughly 40 common breeds and 60 common
vegetable varieties ship in the app with the numbers that matter — days to
maturity, spacing, sow depth, mature weight, laying rate, gestation. A farm's
own edits always win, and a farm can add anything the library does not have.

The reasoning is that both extremes fail: with nothing bundled, every new user
faces an evening of typing before the app does anything useful; with a large
scraped catalogue, wrong numbers are presented authoritatively, which is worse
than no numbers when someone is deciding when to process a bird.

Crowdsourced vetting layers on later. The open questions about how that is
verified are in `docs/BREED-AND-PURPOSE.md` and are not resolved here.

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

1. **Multiple people on one farm.** D7 built roles and never built invites. Two
   people logging the same morning is a real small-farm case and it is
   unaddressed. Does this land before or after the domains above?
2. **Push notifications.** A due row on Today is useful when the app is opened.
   Is "the app tells you" wanted badly enough to take a server dependency, or is
   opening the app in the morning the expected behaviour?
3. **Units.** Imperial or metric, per farm or per field? Pounds and kilos both
   appear in the reference data, and guessing wrong on a medication dose is not
   a cosmetic error.
4. **How much of the growing year to plan ahead.** A single season, or
   multi-year rotation? Rotation needs bed history and is a materially larger
   model.
