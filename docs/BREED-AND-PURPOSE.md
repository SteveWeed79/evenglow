# Purpose, Breed, and the Grow-Out Clock

**Status: proposal.** Nothing here is settled. It exists to be marked up.

This document exists because of one question — *"if they are meat birds, why do we
not show how long until they can be processed?"* — and one observation that killed
the obvious answer: **cattle give milk and meat, sheep give wool and meat and milk,
goats give milk and meat and fibre.** A flock does not have *a* purpose.

---

## 1. What the rubric already settles, and what it does not

**Settled.** The masterplan covers the *output* side completely:

- Production log carries milk, fibre and honey by group or individual (§2).
- Mortality log carries cull weights, explicitly "for meat-yield math" (§2).
- W4 in the competitive analysis promises preset-driven onboarding: *"Add a breed,
  get expected lay rates and mature weights."*

So *recording what an animal produced* is decided, and *a breed preset library* is
already a stated intention.

**Not settled.** There is no concept anywhere of what a group is **for**. Not in
`SPECIES_TRAITS`, not on the flock contract, not in the masterplan's feature
outline. Which means nothing forward-looking is expressible: no processing date,
no expected onset of lay, no shearing interval, no "these three are staying for
breeding."

That is the gap. It is a modelling gap, not a missing screen.

---

## 2. Capability is not purpose

`SPECIES_TRAITS` currently carries `laysEggs` and `givesMilk`. Those are doing two
different jobs at once, and the seam is already visible in the code — `givesMilk`
carries the comment *"narrower than 'could physically be milked' — alpacas can be,
and nobody does."* That is not a fact about alpacas. It is a guess about what
people usually do with them.

The proposal separates the two:

**Capability** — a property of the species. What is physically possible, and
therefore what may be *offered*. Stays in `SPECIES_TRAITS`.

**Purpose** — a property of *this flock, on this farm*. What the keeper is
actually doing. Lives on the flock record, chosen by the keeper.

Capability gates what purposes can be selected. Purpose gates what the app shows.
A dairy herd and a beef herd are the same species and want different screens.

### Proposed purposes

```
eggs        chickens, ducks, quail, geese, turkeys, guinea fowl
meat        almost everything
milk        cattle, goats, sheep
fibre       sheep, alpacas, llamas, angora goats and rabbits
breeding    any — a group held back to reproduce rather than produce
work        donkeys, horses, oxen — draught, pack, riding
guarding    llamas, donkeys, geese, dogs if ever added
companion   any — the two hens nobody will ever eat
```

`breeding`, `guarding` and `companion` matter more than they look. They are how a
keeper says **"do not show me a processing countdown for these."** Without them the
only way to silence a wrong prediction is to lie about the species.

### Multi-select, not an enum

This is the whole point of the question that started this document. A single
`purpose` field cannot describe a Shetland flock kept for wool *and* meat, or a
house cow that is dairy *and* whose calf is beef.

```ts
purposes: z.array(purposeSchema).min(1)
```

**Open question 1.** Should purposes be *ordered*, so the first is primary? A
dual-purpose flock still has a headline — "these are mainly layers" — and the
Today screen has to decide what to show first. Ordering is free to store and
awkward to change later.

### Where purpose lives

| Option | For | Against |
|---|---|---|
| **A. On the flock, multi-select** | Matches how people talk. Cheap. Works with no individual records at all. | Cannot express "the house cow in the beef herd." |
| **B. On the individual animal** | Precise. | Individual records are optional by design (P2); most flocks will never have them. Purpose would be unset for most animals. |
| **C. Derived from breed** | Zero input. | Wrong often enough to be worse than nothing: people keep Leghorns for meat, and dual-purpose breeds exist *precisely* to be ambiguous. |

**Recommendation: A now, B as an override later.** Purpose on the flock, defaulted
from the breed preset when a breed is chosen, overridable per animal when
individual records land. C is rejected outright — a derived purpose that is wrong
produces a confidently wrong processing date, which is the failure mode this whole
feature has to avoid.

---

## 3. The clock

A countdown needs a start. The flock contract has `acquiredAt`, and it is the
wrong field: a bird bought at point of lay was not hatched the day it arrived.

### Proposed

```ts
bornAt?: number            // hatch or birth, epoch ms
bornAtEstimated?: boolean  // derived from an age, not a known date
```

One field for both hatch and birth. A hatch is a birth; two fields would only
create a question about which to read.

**When the date is known** — hatched here, or bought with paperwork — the keeper
enters it and `bornAtEstimated` is false.

**When it is not** — "about eighteen weeks old when I got them" — the app asks for
an approximate age at acquisition and stores the derived date with
`bornAtEstimated: true`. Storing the derived date rather than the age keeps every
downstream calculation identical, and the flag is what lets the UI hedge its
language: *"ready around mid-March"* rather than a date.

**When neither is known, there is no countdown.** Nothing is shown. This is the
most important rule in the document: an invented start date produces a confident
processing date that is wrong, and someone books an abattoir slot around it.

**Open question 2.** Poultry are usually bought as a batch of one age. Cattle and
goats arrive one at a time over years. Does `bornAt` on the flock hold up for
ruminants, or does it only make sense once individual animals exist? A herd's
"birth date" may be meaningless in a way a batch of broilers' is not.

---

## 4. The target

Species is far too coarse. Cornish Cross are processed at about eight weeks; a
heritage dual-purpose bird takes sixteen or more. A prediction keyed on "chicken"
is not a prediction.

So the target comes from **breed**, which makes the grow-out countdown the first
instalment of W4's preset library rather than a standalone feature.

### What a breed record needs to carry

```
species              which species this breed belongs to
name                 "Cornish Cross", "Rhode Island Red", "Jersey"
aliases              "Cornish X", "broiler" — people type what they say
purposes             default purposes, used to prefill the flock
growOutWeeks         range, not a point: meat birds
layOnsetWeeks        range: layers
layRatePerYear       range: layers
matureWeightKg       range, by sex where it matters
fibreIntervalMonths  shearing, for fibre breeds
conservationStatus   from the recognised registries — a genuine reason to choose
                     a breed, and cheap to carry
provenance           where each number came from (see §5)
```

**Ranges throughout, never points.** A single number implies a precision nobody
has. "Eight to nine weeks" is true; "eight weeks" is a claim about a specific bird
on specific feed.

---

## 5. Where the reference data comes from

Candidate sources, in rough order of usefulness. **Licensing here needs proper
verification before anything ships — this is a survey, not legal advice, and I am
not confident about the terms of several of these.**

**FAO DAD-IS** — the UN's Domestic Animal Diversity Information System. Global
breed registry with national records, structured and downloadable. The best
starting point for breed *identity* (names, species, countries, population status).
Weaker on performance figures.

**Oklahoma State University, Breeds of Livestock** — a long-standing academic
reference covering a very wide set of breeds. Descriptive rather than numeric.

**The Livestock Conservancy** (US) and **Rare Breeds Survival Trust** (UK) — breed
profiles and conservation priority lists. Good for `conservationStatus` and for
heritage breeds the commercial sources ignore entirely.

**Land-grant extension publications** (US) — state universities publish grow-out
guides, expected lay rates, feed conversion figures. Often the most *useful*
numbers for a smallholder, and frequently freely usable, though this varies by
institution.

**Breeding company performance objectives** — Aviagen (Ross), Cobb, Hendrix, Lohmann
publish detailed growth and lay curves for their commercial lines. These are by far
the most precise figures available and cover exactly the birds most people raise for
meat. Published for growers to use; redistribution inside a product is a different
question and needs checking.

### The legal shape of this

Individual facts are generally not copyrightable, but a *compilation* can be
protected for its selection and arrangement. The safe posture is therefore:

1. Derive each number from more than one source where possible.
2. Store our own compilation with our own structure.
3. Record provenance per field, not per breed — `growOutWeeks` may come from an
   extension guide while `conservationStatus` comes from a registry.
4. Ship the library as data we assembled, with sources credited.

**Open question 3.** Is anyone available to check the licensing on the commercial
performance objectives specifically? They are the highest-value and highest-risk
source in the list, and the feature is materially worse without them.

---

## 6. Crowdsourcing

The reference library will be wrong for real farms. Published grow-out figures
assume commercial feed, commercial housing, and a climate that is not yours. A
Cornish Cross on pasture in a wet Scottish spring does not hit the Aviagen curve.

So the proposal is to learn from what keepers actually record — carefully.

### 6.1 Observations, not opinions

**Do not ask people questions.** A survey — "how long do your broilers take?" —
collects recollection, selection bias, and rounding to the nearest fortnight.

Derive instead from what the app already holds. A flock with `purposes` including
`meat`, a `bornAt`, and a cull recorded in the mortality log with a weight is a
complete observation:

```
breed + bornAt + cull date + cull weight  →  one grow-out data point
```

Nobody fills in a form. The data is a by-product of using the app for its own sake,
which is the only kind of contribution that stays honest at scale.

The same shape works elsewhere: first egg logged against a flock with a known
`bornAt` gives a lay-onset observation; a fibre production log gives a shearing
interval.

### 6.2 What gets sent

Only what the aggregate needs, and nothing that identifies a farm:

```
breedId, species, purposes
ageAtEventDays, eventKind, measurement (weight, count)
coarse climate bucket   — see open question 4
schemaVersion
```

**Never**: farm name, `orgId`, user identity, precise location, free-text notes,
individual animal names, or anything from an entity not listed above. The
contribution payload gets its own Zod schema and its own test asserting that
nothing else can appear in it — the same posture as `check:secrets`, for the same
reason.

**Open question 4.** Climate is what makes local data better than the published
curve, and it is also the most identifying field on the list. A country is probably
safe; a postcode certainly is not. Köppen zone? First half of a postcode? This needs
a decision from someone comfortable with the privacy trade, not a default.

### 6.3 Consent

This is the part most likely to go wrong, so it gets the strongest language in the
document.

Aggregating farm data means **sending a user's records to a server for a purpose
that is not their own sync.** That is a different product doing a different thing,
and it requires:

- **Opt-in, off by default.** Not a pre-ticked box, not buried in onboarding.
- **Plain description of exactly what leaves the device**, in the same voice as the
  rest of the app: not "help improve Steading" but "send anonymous grow-out figures
  from your meat birds, so other keepers get better estimates."
- **Revocable at any time**, and revocation stops future contributions. Past
  contributions are already aggregated and cannot be withdrawn — say so *before*
  they opt in, not after.
- **Nothing gated behind it.** The app is not worse for saying no. The reference
  library ships offline regardless.

**This deserves its own decision line in the masterplan** (D12, alongside the D11
proposed below), because it changes what the product does with people's data and
that is not something to slide in as an implementation detail.

### 6.4 Vetting

Assume every number is wrong until several independent farms agree.

**Thresholds before publication.** No breed statistic is published until it has at
least **N farms** and **M observations** behind it — I would start at 5 farms and 20
observations and tune from real data. Below that the field simply reads "not enough
data yet", which is honest and costs nothing.

**One farm, one vote.** Aggregate per farm first, then across farms. A single
operation processing four thousand broilers a year must not outweigh forty
smallholders — and this is also the main defence against a farm trying to move the
number deliberately.

**Distributions, not points.** Publish median and interquartile range. The UI says
*"most keepers process these at 8–9 weeks"* and links to the sample size. A single
number would be a lie about the variance that is the entire reason for collecting
the data.

**Trim outliers before aggregating.** Standard IQR trimming. A cull at three weeks
is a sick bird, not a grow-out figure; a cull at forty is a bird someone forgot.

**The reference library is the guardrail.** A crowd median that diverges wildly from
the published figure does not get published — it gets flagged. That divergence is
usually a data bug (someone entering pounds as kilograms), occasionally a genuine
regional difference, and telling those apart is a human job.

**A named review step for flagged cases.** Automated checks catch the shape of a
problem; someone has to look. This is a real operational cost and the proposal
should not pretend otherwise — if nobody is going to do the reviewing, the honest
version of this feature is reference data only, with local overrides, and no
crowd layer at all.

**Provenance is always visible.** The UI distinguishes *"from the reference
library"* from *"from 47 farms"*, always. A keeper deciding whether to trust a
number is entitled to know where it came from.

### 6.5 The local override outranks everything

At any point, on any flock, a keeper can set their own target and the app uses it.
No warning, no "are you sure", no comparison to the crowd.

This is what makes the whole scheme safe to attempt. The shared library can be
wrong, stale, or missing and nobody is stuck — the person who has raised this breed
on this ground for eleven years simply types the number they already know.

---

## 7. Phasing

Each phase is useful on its own, and only the last has a privacy cost.

**Phase A — purpose and the clock.** `purposes` on the flock, `bornAt`, and a
per-flock manual target. The countdown works for anyone willing to type "eight
weeks". No breed data, no network, no new decisions beyond D11. This is small and
could ship next.

**Phase B — the bundled reference library.** Breed presets shipped inside the app.
Offline, versioned with the app, no server involvement, no privacy question. Fills
the target automatically when a breed is chosen. This is W4.

**Phase C — the crowd layer.** Opt-in aggregation, the vetting pipeline, the review
step. Everything in §6. **Gated behind Phase 2's exit gate like the charm layer**,
and for the same reason: this is a second server-side product, and building it
before the sync engine is proven on hardware would be building on sand.

---

## 8. Proposed decision lines

For the masterplan's §0 table, if this is accepted:

| D11 | **A flock has a set of purposes, not a type.** Capability stays on the species; purpose is chosen per flock and may be several. Grow-out and lay predictions are keyed on breed, never on species, and are shown only when a birth date is known. | Cattle give milk and meat; sheep give wool, meat and milk. A single-purpose field cannot describe a real smallholding, and a prediction from a guessed start date is worse than no prediction. |
| D12 | **Aggregated breed data is opt-in, anonymous, and never gates a feature.** Contributions derive from records the keeper already made, carry no identity, are published only above a farm-count threshold, and always as a distribution with its provenance shown. | Sending a farm's records anywhere for a purpose other than its own sync is a different product doing a different thing, and consent for one is not consent for the other. |

---

## 9. What I need from you

1. **Ordered purposes, or an unordered set?** (§2)
2. **Does `bornAt` on the flock work for ruminants**, or is it poultry-shaped? (§3)
3. **Can anyone check licensing** on the breeding-company performance objectives? (§5)
4. **How coarse must the climate bucket be** to be safe? (§6.2)
5. **Is there a person to do the review step** in §6.4 — and if not, do we ship
   Phases A and B only?

Question 5 is the one that decides whether §6 is a plan or a wish.
