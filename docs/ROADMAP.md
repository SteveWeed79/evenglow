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

**§1 and three of §9 are now done as well**, and §1 is worth a word: it was
written as the plan and built in the same commit, and then sat here for a
month saying "nothing exists" about a screen that was in the app. A roadmap
that lies in the safe direction is still a roadmap somebody has to check the
code against before trusting.

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

## 1 — Export — **done**

**Parity floor P7 and P9 (the export half).**

The app shows two years of records, and until this landed it had no way to hand
any of them to an accountant, a vet, or somebody buying a tractor.
`COMPETITIVE-ANALYSIS.md` lists it twice, the masterplan mentions a Schedule F
export, and LookOver pitches "full maintenance history when you sell the
machine" as its headline.

**Cost of skipping it:** a farm that cannot get its data out is a farm that
cannot leave, and every review of every competitor says so.

- CSV per entity, from the same reads `History` uses — so it cannot disagree
  with what the screen shows.
- Shared through the OS share sheet. No server round trip; the records are
  already on the device and an export that needs a signal is an export that
  fails in a barn.
- A date range, because "everything" is the wrong default at year three.

Built in `packages/core/src/export/csv.ts` and `ExportScreen`.

**Not in scope here:** CSV *import* (P9's other half). Import means merge
conflicts against records that already exist and wants its own design.

---

## 2 — The four entities no screen can write — **all four now can**

`task`, `photo`, `shearing`, `feedPlan` were in `ENTITIES`, had payload schemas,
sync, and applied on the server, and nothing in the app could create one.

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

### 2d. `feedPlan` — **done, and it was not a refinement after all**

Rations. This was ranked lowest of the four on the argument that the feed *log*
works and a plan is a refinement of something already recorded. That was half
right and it missed the payoff: **`feedNeededUg` has been sitting in
`due/growout.ts` since it was written, tested, and called by nothing**, because
ration times head times days needs a ration.

So the plan is not the feature. The row is: *"Order Goat mix for The goats"*,
dated a week before the bin empties rather than on the morning it does.
`feedPlanShape` promised exactly that — *"a bag running out is discovered
rather than predicted"* — and it is the fourth builder to turn out to be
finished code waiting on a screen.

**Per animal per day, not per group**, because head count changes and the
ration does not: birds are sold, a doe kids, a fox visits. A per-group figure
would go silently wrong on every one of those days.

**Superseding rather than editing.** A new ration ends the old one, so a cost
read over last spring uses last spring's figure — the same reason `feedLog`
stamps its own cost at log time.

**It refuses more than it reports**, like cost-per-egg before it: no row for a
group with no ration, and no row for a sack the shelf counts in bales, because
nothing in this app knows what a bale weighs. That is the same condition
`FeedScreen` already uses before it will draw the shelf down.

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

## 7 — Getting in without an account — **built, except the billing**

**Decided as D13, D14 and D15; see `ACCESS-AND-BILLING.md`.**

**Cost of skipping it (as it was):** the wedge is offline-first and the first
launch was a login wall, which is indistinguishable from a cloud app on the
morning that decides whether somebody keeps the app. The market research is that nobody
ships full capability with nothing to sign up for — the hole is open and it is
the same hole §1 of the competitive analysis found in features.

Ordered by cost, cheapest first, and all four are now done:

1. ~~**Session lifetime and Google sign-in.**~~ **Done, and the first half was
   already true.** Refresh tokens have been ninety days and rotating since they
   were written, re-derived from the database on every rotation and refreshed
   at boot, on resume and on network regain — a farm opening the app daily was
   never going to be asked twice. What was missing was the second half.

   **Google sign-in and signup are one route**, because the device cannot know
   which it is doing: whether an address already has an account is exactly the
   question a sign-in screen must not be able to ask. A known Google account
   signs in, a known email has the Google identity bound to it, and neither
   claims the farm the device is holding.

   **The audience check is the part that carries the weight.** A valid Google
   ID token issued to somebody else's application is still a valid Google ID
   token, so a server checking only the signature would sign that person in as
   an owner. `email_verified` is required for the same class of reason: the
   linking path matches an existing account *by email*.

   **Inert until configured.** With no `GOOGLE_CLIENT_IDS` the route answers
   501 and the button is not drawn, so a farm running its own box without a
   Google project sees email and password and nothing broken.
2. ~~**Local-first first run.**~~ **Done, and it was the large one.** First
   launch mints an org ULID, opens `steading-{that}.db`, and the whole app
   works — with no server address configured at all, which is every fresh
   clone. `Boot` no longer has a signed-out state, because there is nothing to
   be signed out *of*.

   **The D2 question is answered as D15**: signup adopts the id. What settled
   it was that the defence is structural rather than remembered — `_id`
   uniqueness in MongoDB is the collection, not an index somebody can forget
   to create — so two farms cannot silently merge. §5 has the reasoning and
   the one crash case it turned up.

   **Nothing moves when a farm claims itself**, which is the whole point:
   `openLocalStore` finds its memoised handle and returns the same database.
3. ~~**Join by code.**~~ **Done.** Six Crockford characters, ten minutes, one
   use, one live code per farm, and the redeem route inside the same throttle
   as accepting an invite.

   **`invites.ts` says flatly that no rate limit makes a guessable invite
   safe, and it is right about what it describes** — a link that sits in a
   phone for a week. Every property that makes a join code a different object
   is enforced rather than hoped for, and asserted in `tests/unit/membership`.
   The long invite token stays for anyone who would rather send a link.
4. ~~**Instrument per-org storage and bandwidth.**~~ **Done, as `pnpm
   db:usage`** — an operator script, not a request path. Per-farm records and
   photo bytes counted separately, because the only ratio worth looking at is
   which of the two is growing; the outlier who uploads video gets a sentence
   rather than a number to notice; and the 10 GB signal from §4A.3 says when
   photo bytes should leave the database for S3.

   Bandwidth is a **proxy and is labelled as one**: recent photo bytes, which
   dominate everything else this app sends by two orders of magnitude. Real
   accounting would mean counting bytes on the hot path to answer a question
   asked once a quarter.

   **The number worth holding is break-even: three or four paying farms**, on
   the Oracle Always Free box that already exists. Free farms never touch the
   server, so they never move it. §4.1b.

   ~~**Before the first real farm syncs: a nightly `mongodump` to S3.**~~
   Done — `scripts/backup-mongo.sh`.

**D13, the billing, is now built to the edge of the store.** The rules, the
gate, the Play mapping and the copy are in; the purchase flow and a Play
Console are what remain, and both are configuration rather than design.

Three decisions in it are worth carrying forward:

- **Writing is the paid thing.** Pulling a snapshot is not gated, because a
  lapsed subscription must never be why a farm cannot get its records back.
- **402 is not a rejection.** A refused mutation goes to the inbox as something
  a person must look at, and there is nothing here for anybody to look at. A
  farm on the free tier would otherwise cross `MAX_ATTEMPTS` and have its whole
  history swept into the inbox as poison.
- **Grace is entitled.** A card expires and the store retries for thirty days;
  cutting sync on the first failed charge would be discovered as "the app is
  broken", not as "my card bounced".

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
- ~~**Steppers past 99** on Feed and Produce.~~ **Done, as a typed door rather
  than a bigger step.** A bigger step only moves the ceiling, and the farm that
  has to reach past it is always the one with the most animals. R5 already
  carried the exception — "steppers, never a keyboard, *unless the value can
  exceed 99*" — so the Tally now takes an optional typed entry and the steps
  stay on screen beside it, because a typed total that then needs one more pull
  should be a tap rather than a retype.

  **Off by default, and that matters more than the feature.** The egg tally is
  the control this app is judged on and a basket is three taps. Today offers
  the keyboard for milk and fibre and withholds it for eggs, on the same
  screen — which is where it had to be, since Today is the tally a farm
  actually opens.

  **Log Hours got it too**, unlisted: that panel had said "type what the meter
  says" since it was written, with nothing to type into, and 1,247 hours is
  twenty-three taps.
- ~~**P15, per-equipment inspection checklists.**~~ **Done.** A checklist is a
  list of things to look at carried on the **schedule** rather than on the
  machine — a greasing walks the nipples and an oil change looks at the plug
  and the filter seal, so one list per machine would be the union of every
  job's, which is a list nobody reads to the end of.

  **The preset brings its own**, which is the John Deere lesson in the
  competitive analysis: a maintenance plan nobody had to type in is one that
  gets used. A farm adds its own lines and takes off the ones that do not apply.

  **A failed check becomes a job, and that is what makes it more than a printed
  card.** Recording the service shows the list as toggles, ticking marks what
  was *wrong* rather than what passed — an ordinary morning costs no taps —
  and each ticked line writes a `task` against the machine. "Hydraulic hose
  weeping", noticed at eight with both hands dirty, still exists at four.
- **TypeScript 6.** Expo SDK 57 expects `~6.0.3`; this repo is on 5.9.3 and
  stays there for now. A major TypeScript across a strict codebase with
  `exactOptionalPropertyTypes` is its own piece of work with its own risk, not
  a line in a version-alignment commit. `expo install --check` will keep
  reporting it, which is correct — it is drift, deliberately held.
- **PR #2** — 134 commits behind, would resurrect the deleted web client, and a
  simulated merge produces 88 conflicts. Close it.
- ~~**Incubation stage guidance** — the date half only.~~ **Done.**
  `incubationStage` derives "day 18 of 21, lockdown" from the set date and the
  species, and the list of sets leads with the day count rather than the date a
  keeper was doing arithmetic *from*. Lockdown is `days - 3` rather than a
  second table: the three days are the constant across every bird in
  `INCUBATION_DAYS`, which is why a duck's is day 25 and a quail's is day 15.

  **Not a `Due`, deliberately** — candling and the hatch are the two rows worth
  interrupting a morning for and both already exist; a third saying "still
  incubating" every day for three weeks is how a list stops being read.

  **And no humidity figure**, which the tests assert rather than trust: the
  schools genuinely disagree, by more than this app could measure. Saying what
  the lockdown days are *for* is honest; naming a number to hold them at is not.
  It returns null for a bird it knows no term for, because a confident stage
  derived from a guessed term is worse than no stage.

---

## 10 — The support loop — **built**

**Designed in full in `docs/SUPPORT-LOOP.md`; S1–S7 there are the rules.**

**Cost of skipping it:** a farm that hits a defect has no way to tell anybody,
and the person who could fix it has no way to see what happened. There is no
email sender in this system, a screenshot cannot show a sync queue, and the
farm is in a barn. That is not a support gap — it is the app going quiet at the
exact moment it has broken somebody's morning.

What was built:

- **The bundle is machine-first** (S1). Structure and counts, never content:
  app build, schema version, queue depth, refused-mutation reasons, engine
  error signatures, a hashed org key. `.strict()`, so a field nobody described
  cannot ride along. One human line survives, which is whatever the farm chose
  to say.
- **The farm's records are the second half and travel only on a yes** (S2) —
  *"Do you want to send your farm data along with the ticket to help develop
  the correction?"*, asked when the ticket is raised, defaulting to no, and
  applying to that ticket only. They are the same sheets the Export screen
  hands out, deliberately: a farm consenting to send "your records" is entitled
  to have that phrase mean the same thing in both places.
- **Tickets arrive as GitHub issues** (S3), deduplicated by a fingerprint label
  so one device in a crash loop produces one issue with the evidence
  accumulating on it rather than four hundred. The records half rides as a
  secret gist the issue links (S4).
- **The opt-in half is refused server-side until the repository is private**
  (S5), by an environment variable that defaults to off. The gate is on the
  server because the app cannot know a repository's visibility and a build
  shipped today would be wrong about it forever.
- **A ticket is queued in its own SQLite table and survives everything** (S6) —
  migration v5, never the outbox.
- **Two doors** (S7), and the second is a button rather than an automatic
  fallback. If what is broken is sync, a report travelling over the sync
  transport cannot leave either; the share sheet needs no server, no account
  and no signal beyond whatever it is shared into.

**What is left:** the route is rate-limited per address rather than per
fingerprint, nothing deletes a gist once the fix ships, and there is no channel
to tell a farm their report mattered. All three are in §6 of `SUPPORT-LOOP.md`.
And none of it has been on a handset — the share sheet is a native intent, and
§6 above is the reason that matters.

---

## 11 — The design pass — **the settled half is in; the rest waits on Design**

Two handoff bundles from Claude Design (August 2026): screen frames in Charm
and Plain, a lamplight pass, a mark inventory, and an audit of what in the
prototypes has no React Native form. Everything in it that was *settled* — a
defect against a binding rule, or a change with one obvious right answer — has
landed. Everything that is a design decision is listed below it, unbuilt.

**What landed:**

- **The tally is no longer wrong on three of four screen sizes.** `TYPE.tally`
  was a bare fraction of the shorter edge, which put a **94px numeral on a
  430pt-tall screen** the moment a phone was turned sideways, and 183px on an
  iPad. Now `theme/tally.ts` — the same fraction, bounded by the column it has
  to share and by a floor and a ceiling. Design found this; it ships today and
  Android landscape is one rotation away.
- **R7 has the CI check its own Test column has always promised.**
  `tests/unit/contrast.test.ts`, tiered rather than flat: 7:1 for `ink`, 4.5:1
  for `muted`, 3:1 for marks and rules. A single flat number would have failed
  every accent and been disabled within a week.
- **Two colours it caught.** `leaf` was 2.97:1 on the daylight ground — under
  even the graphical floor, so the done tick and the healthy dot were the two
  marks in the app that could not be relied on to be seen. And nine components
  hardcoded dark loam on the brass fill, which is 8.7:1 in daylight and
  **3.9:1 in bright sun** — the least readable button in the app, in the theme
  that exists for reading a screen in a field. Both fixed; `lanternOn` is now
  the theme's own answer to what sits on brass.
- **Two sentences moved off an accent.** The trouble banner's heading and the
  Tally's failure line were both rowan, which is 3.1:1 on the lamplight ground
  — under AA, on the two messages that only appear when something has already
  gone wrong. Keep the bar, set the words in `ink`.
- **The mark set is 64 → 58.** Six with no call site anywhere —
  `mower`, `pump`, `hour-meter`, `fuel`, `in-water`, `injected`. Design's first
  pass proposed nineteen; ten of those turned out to be live, which is why this
  list is short and was verified call site by call site.
- **Round caps and joins on every mark**, which is a two-line diff and most of
  the available warmth without touching a path.
- **The arch can carry its own light.** `<Arch glow>` paints the lamp glow as a
  `RadialGradient` clipped by the same path that draws the door — one element
  rather than a second positioned layer that would spill past the arched head.
  The one gradient UX-SPEC §2 allows, on the Tally, which is the one control it
  is for.

**What is waiting on an answer, and what it is waiting for:**

- **Charm / Plain as a setting.** Public Sans as a second type set, framed as a
  legibility choice like bright sun rather than a taste one. Needs: whether the
  type ramp is shared or per-set (Public Sans has the larger x-height, so Plain
  reads a size bigger at the same numbers), and the font files. The work itself
  is one refactor — 157 `fontFamily` references live inside `StyleSheet.create`,
  which is evaluated at module load, so they move into the theme the way
  `colors` already has.
- **The Today layout.** Five cards to one, the arch on seven elements, the
  quick-add out of the header. The R3 violation is real — the quick-add is in
  `Screen.tsx` on every screen — but moving it is a layout decision per screen,
  not a fix.
- **`streak-plant`, `season` and `milestone` need two masters each.** All three
  are commissioned as drawings and all three ship at 24px somewhere.
- **`hung-lantern` is orphaned.** Its home was the sign-in screen, which is
  deleted. Either it moves to `AccountScreen` or it is a seventh cut.
- **16px is a size class with no rule.** `head-count` and `more` render at 16
  in `Notes.tsx`, below the manifest's 24-unit master.
- **The lift under the tally.** Design proposes `LIFT_HIGH`; UX-SPEC §2 says
  *no drop shadows*. A real contradiction, and not one to resolve unilaterally
  — note also that Android's `elevation` follows the *view* outline, so an
  arched SVG inside a rectangular View gets a rectangular shadow whatever is
  decided.
- **A Fraunces Black cut** for the 96px numeral. Cheap — the Bold face is 73 KB,
  the smallest of the four — but it needs the font binary.

---

## What is deliberately not on this list

- **A weather tab.** Answered by the Farm hub.
- **Humidity targets for incubation.** The farmer's call.
- **CSV import.** **Refused, not deferred** — see `COMPETITIVE-ANALYSIS.md`
  §2.1. Merging spreadsheet rows against records that already exist and already
  sync needs conflict rules, an id strategy for rows that have none, and a
  preview nobody reads. Every one of those is a way to quietly corrupt a farm's
  history. Export is the half that stops the app being a trap, and it is built.
- **Egg logging per individual bird** (P2). Refused: five hens share one roost,
  so a per-bird tally is a guess recorded as a fact. `eggLog.birdId` stays in
  the contract for a farm that genuinely traps nests; no screen writes one.
- **PDF manuals on equipment** (the second half of P6). Refused: a service
  manual is a hundred pages of 8pt type and nobody reads it on a handset in a
  barn. Photos and receipts — the half that cannot be reconstructed later — are
  built.
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
