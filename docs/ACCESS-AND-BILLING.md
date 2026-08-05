# Steading — Access and Billing

How somebody gets into the app, and where the money is. Researched August 2026.

The masterplan deferred billing at D7 — *"org invites, billing, and cross-org
admin deferred"* — which was right at the time. It is no longer, because the
question has started deciding other things: the weather licence, where photos
live, whether there is a server bill at all. This document settles the shape,
the number, and where the photo bytes belong.

---

## 1. The Problem

**The app cannot be opened without a login, and that undercuts the wedge at the
front door.**

W1 is "offline-first, not offline-tolerant". But `steading-{orgId}.db` is one
file per org and `orgId` comes from a verified token, so the *first* launch is
identical to a cloud app's: a wall. An offline-first app that cannot be opened
offline is only offline-first from the second morning onward, and the first
morning is where people are lost.

The competitive picture (see `COMPETITIVE-ANALYSIS.md` §6) is that the market
is split between free apps with no server and no capability, and capable apps
behind a signup wall. **Nobody ships full capability with nothing to sign up
for.** That is the same hole the feature analysis found, in a different wall.

---

## 2. The Shape

### A2.1 — Local-first first run. No account until it buys something.

First launch mints an org ULID on device, opens `steading-{that}.db`, and the
app works: tallies, dues, weather, photos, the lot. Mutations queue exactly as
they do now. Nothing flushes, because there is no token and none is needed.

This is D1 applied one level out. The client already mints every entity id;
an org is the outermost case of the same argument.

### A2.2 — Signup adopts the client's orgId rather than assigning one.

The server takes the id the device already has. Claiming is then a no-op:
same file, same rows, same ids, and the queue simply begins to flush.

The alternative — a provisional id renamed at claim time — was rejected. A
rename plus a token write is two operations that must both survive a crash,
and a half-claimed org is precisely the divergence invariant 5 exists to
prevent. Adoption has no such window.

**This is the one open question in this document. See §5.**

### A2.3 — The account is asked for at three moments, and no others.

Not a timer, not a nag, not a modal. An account buys exactly three things, so
it is offered exactly when one of them is wanted:

| Moment | What the account buys |
|---|---|
| A second device | The same farm on two phones |
| A farm hand | Somebody else logging work |
| Enough data to hurt losing | Recovery |

The third is the honest one and must not be buried. A Flockstar reviewer
reports losing data on a device upgrade; the free local-only apps have no
answer at all for a phone in a water trough. **Recovery is what the account is
actually for**, and it should be sold as that rather than as "sign up".

### A2.4 — Google sign-in, not email and password.

Android first, one tap, nothing to type with a glove on, no password to store,
reset, or forget. LookOver — the nearest philosophical sibling — does exactly
this and advertises sixty seconds.

Email and password stays as the fallback for people who will not use Google.
OAuth client ids are public by design, so invariant 12 is untouched: the
secret stays server-side.

### A2.5 — A hand joins by code, not by email invitation.

The owner shows six characters; the hand types them. Both are standing at the
same gate — email invitation flows are built for distributed teams, and a farm
is not one.

**This is the one flow that must be online**, and correctly so: a hand's
device is joining an org it did not mint, so the orgId can only come from a
token. The asymmetry with A2.2 is deliberate.

---

## 3. Where The Money Is

**Free forever on one device. Paid when the server holds your data.**

This is not a crippled tier. It is the whole app, every feature, on one phone —
and it costs nothing to serve, because nothing is synced, no photo blob is
stored, and no bandwidth is spent.

The free competitors are free *because they have no server*. FlockPlenty and
Egg Inventory carry zero marginal cost per user. Farmbrite and Flockstar charge
because they run infrastructure. So the natural line for Steading is neither a
feature split nor a countdown, but the point where a cost is actually incurred:

> **The only thing that costs money to provide is the only thing worth
> charging for.**

That alignment is rare and it also does the distribution work. In a market
discovered through forum threads and feed-store conversation rather than app
store browsing, *"try Steading"* costing the listener nothing is most of the
conversion. A recommendation that ends in a signup form is a recommendation
that mostly does not land.

### 3.1 — What this rules out

- **No countdown trial.** A fourteen-day trial started in February expires
  before lambing. Farm software is used seasonally and a clock is hostile to
  that.
- **No per-seat pricing.** Already settled as P11.
- **No metering by animal count.** Farmbrite meters active animals; it punishes
  exactly the growth we want, and it does not fit a model whose unit is the
  group rather than the head.
- **No feature crippling in the free tier.** The free tier is the product. That
  is the whole argument.

---

## 4. How The Price Gets Determined

**$39 a year, one tier, per farm, unlimited people.** $4.99 a month alongside
it if a monthly option is wanted, priced so annual obviously wins.

An earlier draft of this section said the price could not be set until the cost
floor was measured. That was wrong, and the reason it was wrong is the useful
part: **the cost floor does not bind.**

### 4.1 — The cost floor, which turns out not to matter

The measurement this section used to demand had already been half done, in the
roadmap:

> A busy year — eggs and feed logged twice daily, a weekly care note, monthly
> losses and weighings, 1,540 records — is **884 KB on disk**.
>
> A photo compressed for the purpose is **200–400 KB**.

So a synced farm is roughly **1 MB of records and ~30 MB of photos a year** at a
hundred photos. A thousand paying farms is about **31 GB a year** — on S3 that
is roughly **$0.70 a month for all of them**. §4A.4 covers why that is S3
rather than the marginally cheaper R2.

**Storage is not a constraint at any scale this reaches.** The 25 MB ceiling is
a ceiling, not a typical, and the app already shrinks photos for the purpose.

That changes what the instrumentation is for. Per-org bytes are still worth
measuring — for capacity planning, for spotting the farm that uploads video,
and for knowing when photos should leave the database — but **not for setting a
price.** This is priced on what a smallholder will pay, not on cost-plus, and
the two are three orders of magnitude apart.

### 4.1a — What the paid tier actually costs to serve

Roughly nothing, per farm, which is the point. The real costs are fixed rather
than marginal: an API host, a MongoDB, and whoever answers the mail. Those are
covered by a few hundred paying farms at any sane price, and are not reached
faster by charging more per farm than the market bears.

### 4.2 — The competitive anchors, which are what actually decide it

| | Price | Per year | Shape |
|---|---|---|---|
| FlockPlenty, Egg Inventory | **$0** | $0 | No server, no account, no capability |
| **Flockstar** | **$29.99/year** | $30 | Consumer. Annual, poultry only |
| **Farmbrite** Essentials | **$29/month** | $348 | Business. Metered by active animals |
| **Farmbrite** Complete | **from $59/month** | $708 | " |
| **Farmbrite** Complete Premium | **~$109/month** | $1,308 | " |
| LookOver | Free for 1 machine, then paid | — | Consumer, scope-limited free tier |

*Researched August 2026. Farmbrite's and Flockstar's own pricing pages refuse
automated fetches, so these are converging figures from aggregators rather than
pages read directly. Flockstar's individual Backyarder / Keeper / Breeder tiers
could not be separated; $29.99 is the figure that surfaces.*

**The spread is the finding, and it is not a positioning difference — it is two
pricing cultures.** Farmbrite is $348–1,308 a year; Flockstar is $30. Twelve to
forty times apart. A number has to be chosen from inside one culture or the
other, and the masterplan already chose: it excludes double-entry accounting,
CSA order management, and field mapping — exactly the things that justify $29 a
month. W6 makes comprehension the headline. P11 forbids per-seat fees.

**A homesteader with twelve hens is not paying $350 a year.** Flockstar's
neighbourhood, then — and above Flockstar, because mixed stock, growing,
equipment, weather and withdrawal tracking is three or four apps against their
poultry alone.

### 4.3 — Why annual, with the arithmetic

Card processing at 2.9% + $0.30 makes monthly billing expensive at consumer
prices, and the difference is not marginal:

| | Fee per charge | Lost to processing |
|---|---|---|
| $2.99/month | $0.39 | **13%** |
| $4.99/month | $0.44 | **8.8%** |
| $39/year | $1.43 | **3.7%** |

Monthly costs three to four times more in fees and brings twelve times the
failed-card churn. **If billing runs through Play or App Store IAP, the
platform takes 15% on top** at the small-business rate, which is its own reason
to prefer a web checkout where policy allows.

So annual is the default and monthly exists for people who want it, priced at a
deliberate premium — $4.99/month against $39/year makes the annual plan 35%
cheaper, which is a large enough gap to steer without being punitive.
Flockstar's own framing is the same: *annual for the best value, or monthly for
flexibility.*

Seasonal cash flow points the same way. A farm's money arrives in lumps.

### 4.4 — The rest of the shape

- **Per farm, not per seat.** P11.
- **One paid tier, not four.** W6 makes comprehension the headline feature; a
  four-row pricing table is the same disease as a screen with too many
  sections. If a second tier ever appears it should be for a farm large enough
  to know it is large.
- **$39 rather than $49**, because the decision should not be agonised over at
  the homestead end, and because a price can be raised far more easily than it
  can be lowered.
- **The free tier is what makes the number safe.** Nobody pays until they want
  a second phone or a backup, so the price is never the thing that stops
  somebody trying it.

### 4.5 — The sequence

1. Ship the free tier. It costs nothing, so there is no urgency.
2. Take payment only when somebody wants the server. $39/year is the number to
   put in front of them.
3. Instrument per-org bytes anyway — for capacity, for the outlier who uploads
   video, and for knowing when photos should leave the database. **Not** to
   revisit the price; §4.1 is why.

The honest risk in this model is stated plainly: **it converts on an event, not
a deadline.** Farmbrite converts because a clock runs out. Steading converts
when somebody buys a second phone, hires help, or gets frightened about backup —
and a one-person homestead may never do any of those. Revenue is slower and
smaller than a trial model. It is chosen anyway, because the cost floor is near
zero and reach compounds.

---

## 4A. Where The Photo Bytes Live

**Mongo holds the record; S3 holds the bytes.** GridFS today, and the successor
is decided rather than open.

The record layer already works this way and always has — `photoShape` has said
since it was written that it carries *"metadata only, the Blob is uploaded
separately, which is why `uploadedAt` is optional"*. The photo record is
`subjectId`, `contentType`, `byteSize`, `capturedAt`, `uploadedAt?`, `caption?`
and **no location of any kind**. GridFS was never a decision about metadata; it
was the nearest bucket.

So the migration is a swap of four methods behind `blobsFor(orgId)` —
`put`, `get`, `head`, `remove` — and nothing above it moves.

### 4A.1 — The location is derived, never stored

**Do not add a URL or a key to the record.** It is `{orgId}/{photoId}`, and
both halves are already in hand at every call site. Storing one costs three
things:

- **Migration.** A URL bakes bucket, region and provider into every row, so
  changing any of them becomes a data migration rather than a config change.
- **Authorization.** A durable URL is a capability: anyone holding it reads
  that photo for ever with no token check, and the tenancy story quietly
  becomes "nobody shared the link". Presigned URLs minted per request keep the
  check where it belongs.
- **Tamper surface.** A stored key can be wrong; a derived one cannot. If it
  ever arrives from a payload, that is D2's problem reinvented.

Bucket policy blocks all public access. The client never holds a credential —
invariant 12 — so uploads and downloads both run on short-lived presigned URLs.

### 4A.2 — What survives the move, and what does not

**The `_id` backstop survives.** `photos._id` is unique collection-wide
regardless of `orgId`, so org B cannot create a record under org A's photo id —
the guarantee CI taught us on #55. That is a property of the Mongo record and
is unaffected by where bytes live.

**S3 has no equivalent.** Two orgs *can* hold the same photo id under different
key prefixes. So the record stays the real tenancy check and object storage is
defence in depth, never the only gate.

**The isolation tests become the conformance suite.** They call `blobsFor()`
directly, including `remove()`, so an S3 implementation is correct exactly when
it passes them unchanged — the same trick `packages/core/src/db/port.ts` plays
for the storage layer.

### 4A.3 — Why not yet

GridFS is built, isolation-tested and costs nothing to provision, and §4.1 shows
the volumes are small. The move earns itself on three things rather than the
storage line: **backups stop copying image bytes on every run**, replica sets
stop holding three copies of inert data on database-grade disk, and bytes stop
streaming through Fastify.

Switch when photo bytes become a serious fraction of the database's working set,
or when backup and restore time becomes an operational problem rather than a
line item.

### 4A.4 — S3, not R2, and the reason is not price

R2 is cheaper — roughly $0.015/GB against $0.023, and no egress charge against
about $0.09/GB. At the volumes in §4.1 that is a difference of **around ten
dollars a year at a thousand paying farms**, against some $39,000 of revenue.
Three hundredths of one percent.

**Familiarity is worth more than that.** The cost of a storage layer is not its
invoice, it is the evening spent debugging an access policy on a platform
nobody here has operated. S3 is the one we know, it did presigned URLs,
block-public-access and lifecycle rules first, and R2 is API-compatible *with
S3* rather than the other way round.

**Build against the AWS S3 SDK regardless.** R2 speaks the same API, so if
egress ever starts to matter the move is an endpoint and a credential — and
because §4A.1 derives the key rather than storing it, there are no rows to
rewrite either. Nothing here is a lock-in.

**What would change the answer:** egress, at a scale this has not reached. A
hundred thousand farms is roughly 4.5 TB of downloads a year — about $400 a
month on S3 and nothing on R2, at which point a migration is worth a week.
CloudFront in front of S3 is the other answer.

The thing to watch for is any feature that turns a photo into *repeated* reads:
web sharing, a public farm page, anything hotlinkable. Offline-first is the
protection — a device caches locally after the first fetch, so egress is about
one download per photo per device rather than one per view. A feature that
breaks that assumption is the one that makes this decision worth revisiting.

---

## 5. Open Question — D-number needed before A2.2 is built

**Does signup adopting a client-minted `orgId` sit inside D2's intent?**

Invariant 2 is that `orgId` is never read from a request payload; it comes from
the verified token. Adoption means the *signup* request carries a proposed
orgId.

The argument that it is fine: signup is the moment the binding is established
rather than a mutation being authorized, and every request afterwards derives
the org from the token exactly as now. The defences are a unique index on
`orgs._id` — so a double claim is a hard database failure rather than a silent
merge, the same guarantee that turned out to be protecting the photo route —
and a ULID that cannot be guessed.

The argument that it is not: it is a new door into the tenancy boundary, which
is the app's hardest invariant, and D2 exists precisely because "every query
must include orgId" is unenforceable by review.

**This needs an answer before A2.2 is built, not during.** Everything else in
this document is unaffected either way.

---

## 6. Also Open

- **Claim collision handling.** What a farm sees when adoption is refused. It
  should be near-impossible; it must still have a screen.
- **What a local-only farm is told about recovery**, and where. It must be
  honest without being a nag.
- **First flush at volume.** A month of offline mutations landing at once
  against a newly-claimed org. The batch cap is 100 and flush is sequential, so
  it should hold — but it has never been exercised at that size and wants a
  test before it meets a real farm.
