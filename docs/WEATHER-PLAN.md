# Weather — a proposal, not a settled decision

Status: **proposed**. Nothing here is built.

This document exists because the ask — "roll a weather tab into the plan" —
collides with two things already written down, and CLAUDE.md says to stop and
say so rather than work around them.

- `docs/Steading-Masterplan.md` §"What we are not building" lists **"Satellite
  and weather imagery — an integration surface, not a record."**
- `docs/UX-SPEC.md` §4: **"Everything else is one level below these four. If a
  feature needs a fifth tab, it needs a rethink."**

So a weather tab needs either an amendment to both, or a different shape. What
follows argues for a different shape, and then states plainly what is still the
farm's call.

---

## 1. Weather is three things wearing one word

Conflating them is why "a weather tab" feels obvious and is wrong.

| | what it is | where it belongs |
| --- | --- | --- |
| **Forecast** | future, external, network-dependent | a cache, and a source for warnings |
| **Observation** | past, local, measured in your own yard | a farm record, append-only, syncable |
| **Location** | the coordinates both of the above need | one new field on `site` |

The half that fits this product is the one nobody means when they say weather
tab: **your own observations**. Two inches in the gauge by the barn is a farm
record. It is append-only, it is client-minted, it works with the radio off,
and it is yours — no provider, no key, no licence, no coordinates.

The half everyone means — the forecast — is the most perishable data
imaginable, and this app's whole premise is that it works in a barn with no
bars.

## 2. The decision

**Ship observation first. Add the forecast second, as a cache that feeds
warnings. Build no forecast screen, and no fifth tab.**

### 2a. `weatherLog` — a new append-only entity

Joins `eggLog`, `feedLog` and the rest in `APPEND_ONLY_ENTITIES`: rainfall, a
temperature reading, a note about the day. Create only; it cannot conflict.
This needs nothing external and could ship this week.

Why it earns its place: a rain total is the thing a farm actually goes back to.
"Was that dry spring the year the beans failed?" is answerable from records the
farm made. A forecast from last April is worth nothing to anyone.

### 2b. The forecast is a **cache**, not an entity

It is not authored by anyone, nobody edits it, it cannot conflict, and two
devices fetching the same site would mint two ULIDs for one fact. It is
therefore:

- a new additive SQLite table, one immutable row per provider model run;
- **never** in the outbox, never in `records`, never on the wire;
- wiped on sign-out with the rest of the farm's cache;
- the same category the codebase already grants a zone lookup, and the same
  reasoning that keeps `Due` off the wire.

### 2c. Provider: Open-Meteo, **through the Steading server**

Open-Meteo is the only provider that gives what a farm needs — soil temperature
at four depths, FAO-56 reference evapotranspiration — without a key, and it is
global where the US National Weather Service is not.

**Two facts decide the shape:**

1. Its keyless endpoint is licensed **non-commercial only**. Its own terms name
   "apps that have subscriptions or display advertisements" as commercial. The
   masterplan has a Play Store track. That is a **licence cliff, not a rate
   limit**, and no amount of caching avoids it.
2. Its commercial tier authenticates with an `apikey` query parameter — a
   secret, which invariant 12 forbids in a bundle that ships inside an APK.

The migration from free to paid is a hostname and one query parameter. Behind a
server proxy that is a deploy. From the device it is an APK rollout to users who
may never update. **So the proxy gets built first, before there is a bill.**

The proxy reads the caller's own site rather than accepting coordinates from the
request — consistent with invariant 2, and it keeps a farm's position out of
query strings and logs.

Attribution: Open-Meteo requires it. It goes on the screen that shows the data,
not buried in a licences page.

### 2d. Location — the blocking dependency

**No lat/long exists anywhere in the repo today.** The site carries frost dates
and a hardiness zone; neither yields coordinates. Nothing in 2b or 2c is
buildable until this exists, and it is the only new stored field on the mutable
side.

**Stored rounded, deliberately.** A farm's coordinates identify a family's home.
Two decimal places is about a kilometre — ample for a forecast, useless for
finding a door. The app should never hold better than it needs.

How it is obtained is a real choice with a privacy cost either way:

- **A one-time manual pin** — no permission prompt, no background access,
  nothing the OS can leak. Slower to set up. **Recommended.**
- **Device GPS** (`expo-location`) — one tap, but a runtime permission and a
  new dependency, and Play Store data-safety disclosure.

## 3. What it shows, and what it deliberately does not

**No forecast screen.** A five-day forecast is a thing every phone already has,
better. Steading's only claim is that it knows what the weather *means for this
farm*, and that is a warning, not a table.

**A conditional strip on Today**, present only when there is something to say.
Silent on an ordinary day.

### The warnings that are buildable today

From data the app already holds — species, head count, birth dates:

- water freezing
- poultry heat stress
- ruminant heat stress (temperature-humidity index)
- a cold snap landing on an imminent birth
- a wet day blocking shearing

### The one everybody asks for, and cannot have yet

**"Frost tonight — bring the seedlings in" is not buildable.** Of 70 library
varieties only 15 carry a cold floor, and all 15 are perennials. The app cannot
currently tell you which of your plantings tonight's frost kills.

A frost row that protects the asparagus and ignores the tomatoes is **worse than
no row** — and it would be wrong in May, the one month it matters. This waits on
cold floors for the 55 annuals and biennials, which is a data task, not a
weather task.

## 4. Staleness

A three-day-old forecast displayed as current is worse than none.

- Rendered **only with its age attached**.
- Degrades through named steps rather than fading silently.
- **Past 48 hours it is not shown at all** — it vanishes rather than lying with
  a confident number.
- Eligibility for a warning is judged on the provider's **issuance** time, not
  on when the device fetched it.

**A stale forecast raises no warning in v1.** The first version of a
network-dependent warning on a screen whose entire promise is that it works
offline should err toward silence.

## 5. Fetching

Rides the existing AppState-resume and network-regain listeners in
`sync/triggers.ts`. **Outside the flush loop** — a forecast must never delay a
mutation, and a failed forecast must never look like a failed sync. At most once
an hour per device.

## 6. The tab question, which is the farm's to answer

The research and both existing documents point the same way: a strip on Today
plus, later, a screen hung off Growing. Not a fifth tab.

If a genuine fifth tab is still wanted, that is a **UX-SPEC amendment and a
masterplan amendment**, and it should be made deliberately rather than arrived
at. Both documents currently say the opposite of the ask, and leaving that
contradiction in place is the failure the masterplan says it deleted its own v2
to avoid.

## 7. Order of work

1. `weatherLog` — append-only observations. No provider, no key, no location.
2. Coordinates on `site`, rounded, manually pinned.
3. The server proxy, before there is a bill.
4. The cache table and the staleness rule.
5. The five buildable warnings.
6. Cold floors for 55 varieties — **then** the frost row.

Steps 1 and 2 are useful on their own and commit to nothing. Nothing past step 3
should start before a farm has used step 1 for a season and said what it
actually wanted.

## 8. Risks worth restating

**A wrong warning costs more than itself.** A keeper who houses stock on a bad
forecast and loses the evening stops trusting every row on Today — including the
withdrawal rows, which W2 calls the highest-value safety surface in the app.
Weather warnings share a list with the one feature that must never be doubted.

**This is the first due-adjacent surface that depends on the network.** Even as
a strip rather than a due row, it puts something on Today that is empty in a
barn. That has to look deliberate, not broken.
