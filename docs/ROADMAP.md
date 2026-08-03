# Roadmap

What is left, in the order it should be built, and why that order.

Written after a day on a handset that found eight device-only defects and
finished the record. It supersedes nothing: `Steading-Masterplan.md` still holds
the settled decisions, `UX-SPEC.md` the binding rules, `COMPETITIVE-ANALYSIS.md`
the reason each feature exists. This says what has not been done yet.

Every item names what it costs if it is skipped, because that is the only
honest way to order a list nobody has time to finish.

---

## How this is ordered

Three rules, applied in this order:

1. **A farm's records must be able to leave.** Everything else is a feature; an
   export is the difference between a tool and a trap.
2. **A promise already made outranks a new idea.** Four entities exist that no
   screen can write. The schema says the app does something it cannot do.
3. **What only a device can prove comes before what a test can.** Eight defects
   this week were invisible to a thousand passing tests. That is a gap in the
   suite, not bad luck.

---

## 1 — Export

**Parity floor P7 and P9. Nothing exists.**

The app now shows two years of records and has no way to hand any of them to an
accountant, a vet, or somebody buying a tractor. `COMPETITIVE-ANALYSIS.md` lists
it twice, the masterplan mentions a Schedule F export, and LookOver pitches
"full maintenance history when you sell the machine" as its headline.

**Cost of skipping it:** a farm that cannot get its data out is a farm that
cannot leave, and every review of every competitor says so.

- CSV per entity, from the same reads `History` uses — so it cannot disagree
  with what the screen shows.
- Shared through the OS share sheet. No server round trip; the records are
  already on the device and an export that needs a signal is an export that
  fails in a barn.
- A date range, because "everything" is the wrong default at year three.

**Depends on:** nothing. `read/history.ts` already gathers every append-only
entity with names resolved.

**Not in scope here:** CSV *import* (P9's other half). Import means merge
conflicts against records that already exist and wants its own design.

---

## 2 — The four entities no screen can write

`task`, `photo`, `shearing`, `feedPlan` are in `ENTITIES`, have payload schemas,
sync, and apply on the server. Nothing in the app can create one.

**Cost of skipping it:** the schema claims the app does things it cannot do,
and two of the four are visible holes a keeper will find.

### 2a. `task` — the one authored due kind — **done**

Jobs, on the Farm hub. A date puts it on Today; no date keeps it on the list
and it never nags. Recurrence counts from **when it was done**, not when it was
due, so a weekly job finished late does not stack up overdue rows for a farm
that is merely busy.

It carries `completedAt`, which is the completion flag the due engine refuses
everywhere else — and the exception is exact. Every other row is waiting for a
record; this one is not. Fixing a gate produces nothing to log, so `completedAt`
is not a second source of truth, it is the only one.

### 2b. `shearing`

The app offers **fibre** as a purpose, filters species by whether they carry it,
and has nowhere to record a clip. A keeper who ticks fibre is promised something
that does not exist.

### 2c. `photo` — parity P1 and P6

Per-animal photos, and receipts and manuals on equipment. Needs a decision about
where the bytes live (device only, or synced) before any of it is built —
photos are the first thing in this app that is not small.

### 2d. `feedPlan`

Rations. Lowest of the four: the feed *log* works, and a plan is a refinement of
something already recorded rather than a hole.

---

## 3 — A device-parity test project

**Cost of skipping it:** two days, already, once.

`crypto.randomUUID` does not exist in Hermes. `window` exists without
`addEventListener`. `navigator` exists without `onLine`. Every one passed a
thousand tests and failed on the first handset, because the test runtime is more
generous than the phone.

A vitest project that reshapes `globalThis` to what RN 0.86 / Expo 57 actually
provide, and runs the existing suites against it.
`tests/offline/no-crypto-global.test.ts` is the first instance of the idea; this
makes it the default rather than one file somebody remembered to write.

**Related, and cheap:** the fake SQLite now opens two real connections, which
proved that `foreign_keys` is enforced in tests and silently ignored on device.
No table declares one today. Whoever adds the first will need the write
connection owned and `BEGIN IMMEDIATE` driven on it.

---

## 4 — Weather, in the order `WEATHER-PLAN.md` sets out

The plan is written and its tab question has since answered itself: the Farm hub
means a strip on Today and later a row under the Farm, no fifth tab, no UX-SPEC
amendment.

1. **`weatherLog`** — append-only observations: rainfall, a temperature, a note.
   No provider, no key, no coordinates, no decisions. Ships on its own.
2. **Coordinates on `site`** — rounded to two decimals (~1 km) on purpose, and
   manually pinned rather than taken from GPS. A farm's coordinates identify a
   family's home; the app should never hold better than it needs.
3. **The server proxy** — *before there is a bill*. Open-Meteo's keyless tier is
   non-commercial only and the Play Store track makes this commercial; the paid
   tier authenticates with a query-string key, which invariant 12 forbids in an
   APK. Behind a proxy that migration is a deploy. From the device it is a
   rollout to people who never update.
4. **The cache table and the staleness rule** — never in the outbox, never on
   the wire, and not shown at all past 48 hours.
5. **The warnings** — water freezing, poultry heat stress, ruminant THI, a cold
   snap on an imminent birth, a wet day blocking shearing, **and frost**.

**Frost was on this list as not-buildable, and that was wrong.** The objection
— only 15 of 70 library varieties carry a cold floor, all perennials — is only
true of a row that names *which* plantings die. It says nothing about the row a
farm actually asked for:

> Frost tonight. You have 6 plantings in uncovered beds.

`bed.covered` already exists, is already asked on Add Bed, and already defaults
to false. Outdoors versus under cover is modelled and populated today. The
warning defers the judgement to the person who can make it — a keeper knows
their own beds; what they cannot do is watch the forecast every night in May.

Cold floors for the 55 annuals are still worth having. They buy a *better* row,
not the only one.

---

## 5 — Numbers a farm can look at

**Parity P3 and P4.** There is not one chart in the codebase, and no cost
tracking of any kind.

- **P4, graphs** — a lay curve, feed against production, a season. The data is
  all there; History proved the reads work.
- **P3, cost per egg / per bed** — needs money on records that have none. A
  larger change than it sounds, and worth doing after graphs so there is
  somewhere to show the answer.

**Cost of skipping it:** a farm has a season of records and cannot see a trend.
This is the difference between a logbook and a tool, and it is the thing
Flockstar is bought for.

---

## 6 — Loose ends

Small, named so they stop being remembered at the wrong moment.

- **Units are hardcoded.** The site carries a `units` preference and every
  screen that formats a mass ignores it — `WeighScreen`, `GroupScreen`,
  `AnimalsScreen`, `HistoryScreen` all say `'imperial'` in the source. One
  change in one place, and it has to be all of them at once or two screens
  disagree about the same weight.
- **Steppers past 99** on Feed and Produce — a farm milking a herd cannot reach
  its total by tapping.
- **P15, per-equipment inspection checklists** — never started.
- **PR #2** — 134 commits behind, would resurrect the deleted web client, and a
  simulated merge produces 88 conflicts. Close it.
- **Incubation stage guidance** — the date half only. The app knows the species'
  incubation length and the set date, so "day 18 of 21, lockdown" is derivable.
  Deliberately carries **no humidity figure**: there are several schools and the
  farm's own judgement beats a number this app invents.

---

## What is deliberately not on this list

- **A weather tab.** Answered by the Farm hub.
- **Humidity targets for incubation.** The farmer's call.
- **CSV import.** Wants its own design; see item 1.
- **Google Drive backup or sync.** Raised and parked deliberately. Worth
  saying what it would and would not be: the farm's records already sync
  between devices through the Steading server, so Drive would be a *third*
  copy — useful as somewhere a farm controls, not as the sync path. It also
  means an OAuth flow, a Google API dependency, and a second place a farm's
  data lives. Export covers the "get a copy out" want today; revisit when
  somebody has wanted the automatic version for a season.
- **Emailing the records out yearly and deleting them.** Asked for directly,
  and the answer is no — but the instinct behind it is right and export is what
  it wanted.

  **The storage worry is measured and it is not real.** A busy year — eggs and
  feed logged twice daily, a weekly care note, monthly losses and weighings,
  1,540 records — is **884 KB on disk**, including the mutation log. Ten years
  is under 9 MB. One phone photo is three to five times a decade of records.

  **What the deletion would cost is the app's whole second-year value.** "Was
  that the dry spring the beans failed?" and a lay curve against last season
  are the questions History exists for, and P4's production graphs are a year
  of comparison or they are nothing.

  **Two harder blocks.** Medication and withdrawal records are the kind of
  thing a farm may be required to retain for years, and the app must not be the
  one deciding that on a timer. And invariant 7 — never delete a mutation row —
  makes a yearly purge a fight with the sync engine: the rows are the audit
  trail and the duplicate defence, and a device that deleted them would pull
  them back on the next snapshot.

  **There is also no email sender in this system** (see `MembersScreen`), so
  "email it out" means either new server infrastructure carrying a farm's
  records through a mail provider, or handing a file to the OS mail client —
  which is export with extra steps and no proof it was sent.

  Export gives the copy off the device, which is the real want.
  `forgetDatabase` already exists for the case that genuinely needs it: handing
  the tablet on.
- **Anything in `Steading-Masterplan.md` §"What we are not building".** That
  section is a decision, not an oversight.
