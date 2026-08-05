# Roadmap

What is left, in the order it should be built, and why that order.

Written after a day on a handset that found eight device-only defects and
finished the record. It supersedes nothing: `Steading-Masterplan.md` still holds
the settled decisions, `UX-SPEC.md` the binding rules, `COMPETITIVE-ANALYSIS.md`
the reason each feature exists, `ACCESS-AND-BILLING.md` how a farm gets in and
where the money is. This says what has not been done yet.

**Updated August 2026.** Sections 4, 5 and 2c now describe work that shipped;
6, 7 and 8 are new. The device day named above happened *before* charts, cost
per egg, shearing, alerts, photo upload and the units switch — so rule 3 has
been quietly unobserved for six features, which is what §6 is for.

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

### 2b. `shearing` — **done**

Under More on a group, and **only where the keeper said fibre** — offering it on
a flock of layers would be the same mistake the egg tally made before
`productsOf`: a row nobody will ever fill in, every time they open the group.

Greasy weight, and the screen says so: a fleece loses a quarter to a half at
scouring, and a farm comparing years needs both measured the same way. It asks
how many were shorn so the per-animal figure — the one a fleece is actually
judged on — means something.

### 2c. `photo` — **two of the three cases built**

Parity P6, and P1 refused. The value is uneven across the three cases people
mean by "photos", so two were built and one was turned down — recorded here
because a refusal nobody wrote down becomes a thing somebody rebuilds.

| | worth | note |
| --- | --- | --- |
| **Receipts and manuals on kit** (P6) | real | LookOver's headline is the history you hand over with the machine, and a receipt cannot be reconstructed later |
| **Evidence** — a wound, a kill, a diseased leaf | real, and time-critical | the one a keeper actually reaches for |
| **Per-animal portraits** (P1) | **refused** | you tell six hens apart with a leg ring, not a photograph; this matters at the pet-chicken end, which is Flockstar's market and not the masterplan's |

**The cost is not mainly space.** A photo compressed for the purpose is 200–400
KB, so a hundred is roughly forty years of records — real but survivable. What
it actually costs is that photos are **the first thing in this app that is not
small**, and that touches five settled things at once: the mutation envelope
carries JSON and a base64 blob does not belong in one; the server grows a
storage bill and a lifecycle; a device-only photo vanishes on reinstall while a
synced one needs a transfer path that resumes; Play Store data-safety
disclosure changes; and it is the first runtime permission the app asks for.

**What was built.** A strip on a machine and on a group — not a grid, because a
grid says "browse me" and invites a farm to treat the app as a photo library,
which is the thing that would actually cost the space.

Resized to 1600px on the long edge and saved at quality 0.7. A phone camera
gives 4–8 MB a frame and a receipt is legible at 1600px, so this is the
difference between a hundred photos costing 30 MB and costing 600 MB.

**The bytes stay on the device and the record syncs**, which is exactly what
`photoShape` has said since it was written — *"metadata only, the Blob is
uploaded separately, which is why `uploadedAt` is optional"*. A second phone
knows a photo exists and says which device has it, rather than showing a grey
box that reads as a bug.

**The upload is now built** — `uploadedAt` is set on completion and a miss
fetches. It runs on the idle tick rather than in the mutation batch: twenty-five
megabytes in a JSON flush would blow the hundred-mutation cap into a request
nothing can retry sensibly, and one failed photo would take a morning's egg
tallies with it. Bytes live in GridFS behind `db/blobs.ts`, which mirrors
`db/scoped.ts` exactly — one module opens the bucket, every write stamps
`orgId`, every read filters on it, 404 and never 403 in both directions.

**Still open:** the copy that upload made false, and a two-device transfer.
Both are in §6.

### 2d. `feedPlan`

Rations. Lowest of the four: the feed *log* works, and a plan is a refinement of
something already recorded rather than a hole.

---

## 3 — Device parity — **done, and not the way this said**

**Cost of skipping it:** two days, already, once.

`crypto.randomUUID` does not exist in Hermes. `window` exists without
`addEventListener`. `navigator` exists without `onLine`. Every one passed a
thousand tests and failed on the first handset, because the test runtime is more
generous than the phone.

This planned a vitest project that reshaped `globalThis` and ran the suites
against it. **A lint rule turned out to be the better instrument**, and the
reason is worth keeping: it fires on the *reference*, so it does not depend on
a test happening to exercise that line. `crypto.randomUUID` sat on a path four
suites touched and not one of them ran it against a missing global. It also
runs on every `pnpm lint` rather than in a project somebody has to remember to
add a file to.

`no-restricted-globals` covers `crypto`, `Buffer`, `TextEncoder`,
`TextDecoder`, `structuredClone`, `atob` and `btoa` in `packages/core` and
`apps/mobile`. `window.addEventListener` and `navigator.onLine` need a
`no-restricted-syntax` selector instead, because those globals **exist** on a
handset — a ban on the name would never fire, which is exactly why the boot
crash got through. Every rule names its replacement, because a guard that says
no without saying what instead gets disabled.

`tests/unit/guards.test.ts` runs ESLint against a deliberate violation of each,
so the coverage is asserted rather than assumed.

**It found one immediately.** `openSqliteStore` still defaulted to
`crypto.randomUUID()` — the reasoning being that Node and the browser both have
it and only the handset does not. That is backwards: the platform that lacks it
is the only one that ships to a farm. The default is gone; the one production
caller already passed `expo-crypto`, and the tests now say what they use.

**And it caught its own regression.** Adding the new selectors silently
replaced the tenancy ones for every file in core and the client —
`no-restricted-syntax` overwrites rather than merges. The guard test failed
within a minute. The selectors are hoisted and composed now.

**Related, and cheap:** the fake SQLite now opens two real connections, which
proved that `foreign_keys` is enforced in tests and silently ignored on device.
No table declares one today. Whoever adds the first will need the write
connection owned and `BEGIN IMMEDIATE` driven on it.

---

## 4 — Weather

The tab question answered itself: the Farm hub means a **row on Today** above the
tallies and a pushed screen behind it. No fifth tab, no UX-SPEC amendment.

**Done.**

1. ~~**`weatherLog`**~~ — **not built, and deliberately.** *"I want a weather
   forecast not weather user logged."* Nothing in the app asks anybody to type
   in the weather. The plan had this first on the argument that a rain total is
   what a farm goes back to; the farm's answer was that a forecast is what it
   opens the app for. It can still be added later — it commits to nothing.
2. **Coordinates on `site`** — rounded to two decimals (~1 km) **on the way in**,
   so nowhere in the app holds better. Both doors: GPS via `expo-location`, and
   a typed address through the US Census geocoder for a refused permission.
3. ~~**The server proxy**~~ — **no longer a condition of shipping.**
   `api.weather.gov` is a work of the US government and in the public domain:
   no key, no licence tier, nothing invariant 12 could object to. The proxy
   becomes an optimisation for sharing one fetch across a farm's devices.
4. **The cache table and the staleness rule** — one row, never in the outbox,
   never on the wire, and not shown at all past 48 hours. Judged on the
   service's issuance time, not on when the device fetched.
5. **The screen** — the rest of today by the hour, then seven days with a rain
   column. The plan argued against a forecast screen; that was overruled.

**What it costs, stated plainly:** NWS is the **United States only**, publishes
about seven days and no more, and gives a chance of rain rather than an amount.
The screen says the first of those honestly rather than showing an empty box.

6. **The warnings** — five of the six. This is the half that makes the forecast
   Steading's rather than the phone's: a seven-day table is a thing every phone
   already has, better, and what this app can say is what the weather means for
   the animals and beds *this* farm has.

   | | fires when | why that number |
   | --- | --- | --- |
   | **frost** | low ≤ 2°C **and** something is in an uncovered bed | NWS advises at 33–36°F: on a still clear night the ground reaches freezing while the thermometer does not |
   | **water freezing** | low ≤ 0°C **and** there is stock | no judgement in this one |
   | **poultry heat** | high ≥ 29°C, escalating at 35°C | birds have no sweat glands; 29°C is where intake drops and 35°C is where heavy breeds die |
   | **ruminant heat** | THI ≥ 72 cattle, ≥ 79 sheep and goats | temperature alone lies — 32°C at 30% is a warm day and at 80% it is dangerous |
   | **camelid heat** | °F + humidity ≥ 120, emergency at 150 | the rule alpaca keepers use; running them through THI puts them alongside sheep, which is the mistake that kills alpacas |
   | **cold birth** | a `birth` due within 7 days **and** low ≤ 0°C | a newborn is wet and cannot keep itself warm |

   **Silent on an ordinary day, and that is the design.** A strip that appears
   every morning is one nobody reads by the second week — and then it is not
   read on the morning it matters.

   **A stale forecast raises no warning.** Handled in exactly one place, which
   is why these are not `Due` rows: the due engine's second property is that it
   recomputes with the radio off, and a warning cannot. Making these dues would
   push staleness into every consumer of the engine.

   **Humidity** was added to the forecast as an **optional** field. THI needs
   it; it arrived after the cache table did, so requiring it would make every
   forecast written by an older build fail to parse. Absent means the THI
   warning stays silent, which is the right failure — inventing a humidity
   produces a confident number nobody measured.

7. ~~**A wet day blocking shearing**~~ — **built.** It was blocked on the app
   having no idea a clip was planned, and that was the real gap:
   `fibreIntervalMonths` had been in the breed library since it was written and
   nothing read it. A shearing due kind came first, then the warning hangs off
   it — so only a farm with a clip actually coming is told about the rain.

8. ~~**Official NWS alerts**~~ — **built**, and not on this list when it should
   have been. `/alerts/active` was the last piece of `api.weather.gov` unused,
   and a tornado warning outranks anything this app has an opinion about.

   **These do not degrade by showing their age**, unlike the forecast and the
   station reading. A cancellation arrives as an *absence* from the next
   response, so an hour-old set may still hold a warning called off fifty
   minutes ago. Silence is survivable; a lapsed tornado warning shown as live
   is not.

   **Never checked against a live payload.** See §6 and `pnpm verify:alerts`.

9. **Cold floors for the 55 annual varieties**, which buy a *better* frost row
   (*"your tomatoes will not survive this"*) rather than the only one.

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

## 5 — Numbers a farm can look at — **done**

**Parity P3 and P4, both built.**

- **P4, graphs** — production against feed over twelve weeks or twelve months,
  with a sentence under each. The first charts in the app.
- **P3, cost per egg** — a price on a sack, a cost stamped on each feeding,
  spend charted, the figure. It **refuses more than it reports**: under four
  fifths of a window's feedings priced, it says what is missing rather than
  showing a number. Half-priced feed over all the eggs reports roughly half the
  true cost — low, plausible, and the fastest way to make somebody stop
  trusting the screen. It also always says *"in feed"*, because feed is 60–75%
  of what a laying flock costs, and an unqualified figure would be a lie.

**Found on the way, and worth remembering:** `subscribe()` published to every
listener, so a screen with five `useLive` hooks did twenty-five reads on mount.
That was waste until a reader's dependencies came from another read's result —
then it closed a cycle and the render loop never settled. The trend screen hung
with no error and no failing assertion; the test run simply never finished.

**Still owed:** none of it has been on a handset. See §6.

---

## 6 — What only a device can prove, again

**Cost of skipping it:** rule 3 above, ignored. A day on a handset found eight
defects a thousand tests could not. Everything since has been merged on CI
alone.

Charts, cost-per-egg, shearing, official weather alerts, photo upload and the
units switch all landed after the device day. They are exercised by mounted
screens against a real SQLite store — which is what caught the units entry
defect — but a mounted screen is not a phone.

**Three of these cannot be closed at a desk, and one cannot be closed by
waiting.**

- **The photo copy.** The gallery used to say photos were "kept on this phone,
  not sent anywhere". Upload made that false and it now says they are shared
  with the farm's other phones. That is the app changing what it promises about
  where a farm's photos go, and the sentence should be read on a handset by
  somebody willing to stand behind it. **Needs one device, not two** — the
  wording is readable today; only the transfer needs a second.
- **Photo transfer between two devices.** One org, two devices signed into the
  same account — a phone and the emulator will do. The scenario is a farm's
  second phone, not a second farm.
- **Weather alerts against live payloads.** Tested only against response bodies
  we wrote. **Do not wait for local weather**: `pnpm verify:alerts` asks
  `/alerts/active` for every alert in force in the United States and runs the
  real parse over all of them. A few hundred live products across every event
  type is far better evidence than one thunderstorm, and it finds the failure
  that matters — a real warning dropped by a schema mismatch, which looks
  exactly like a quiet day. Point the farm's coordinates at active weather
  afterwards to see one render.
- **The tallies, on a phone, with a glove.** Haptics, camera, signal loss and
  regain, doze. An emulator reaches none of it.

---

## 7 — Getting in without an account

**Decided as D11 and D12; see `ACCESS-AND-BILLING.md`. Nothing built.**

**Cost of skipping it:** the wedge is offline-first and the first launch is a
login wall, which is indistinguishable from a cloud app on the morning that
decides whether somebody keeps the app. The market research is that nobody
ships full capability with nothing to sign up for — the hole is open and it is
the same hole §1 of the competitive analysis found in features.

Ordered by cost, cheapest first:

1. **Session lifetime and Google sign-in.** No architecture change. An app
   opened at 5am every day should never ask twice, and a farm should not type
   a password with a glove on.
2. **Local-first first run.** The large one. Blocked on the D2 question in
   `ACCESS-AND-BILLING.md` §5 — whether signup may adopt a client-minted
   `orgId`. That answer is wanted before the work starts, not during.
3. **Join by code**, so a hand is added by six characters at the gate rather
   than an email invitation built for distributed teams.
4. **Instrument per-org storage and bandwidth.** D11 cannot be priced until
   this number exists, and it cannot be guessed. Photos dominate it.

---

## 8 — iOS

**Deferred, not designed out — and the Mac is not the blocker it looks like.**

**Cost of skipping it:** roughly half the US smartphone market, which is the
hardest ceiling on the project's reach.

Metro bundles JavaScript and produces no Apple build. What is actually needed
is Xcode to compile the native shell, an Apple Developer account, and the
platform behaviour that genuinely differs — **no hardware back button**, which
the navigation assumes; safe areas; permission dialogs; and most importantly
different background and foreground rules, which is where `sync/triggers.ts`
should be expected to break first.

**EAS Build compiles on hosted macOS workers and removes the Mac requirement
entirely.** That is likely cheaper than maintaining a build machine, and it is
the "or cloud CI" half of the masterplan's own open question.

If existing hardware is used instead, two things to check before counting on
it: whether the Mac can run an Xcode new enough for SDK 57, and whether the
iPad is above its minimum deployment target. An iPad tests iOS but not the
phone form factor, and the tally sizes itself off the shorter edge.

---

## 9 — Loose ends

Small, named so they stop being remembered at the wrong moment.

- ~~**Units are hardcoded.**~~ **Done.** Fixed in two passes, and the second
  was needed because the first only covered the screens being touched at the
  time. Today, Trend, Produce and History were left reading millilitres while
  the weather row four lines above read °F — the defect a screenshot caught.
  Both display and entry now read the setting, and `formatVolume` grew the
  quart and gallon scale that had made it uncallable.
- **Steppers past 99** on Feed and Produce — a farm milking a herd cannot reach
  its total by tapping. **Unchanged by the units work and still the right
  complaint:** an imperial farm's five-gallon morning is twenty taps of the
  largest step. The fix is a larger step or a different control, not a
  different unit.
- **P15, per-equipment inspection checklists** — never started.
- **TypeScript 6.** Expo SDK 57 expects `~6.0.3`; this repo is on 5.9.3 and
  stays there for now. A major TypeScript across a strict codebase with
  `exactOptionalPropertyTypes` is its own piece of work with its own risk, not
  a line in a version-alignment commit. `expo install --check` will keep
  reporting it, which is correct — it is drift, deliberately held.
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
