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

W1 is "offline-first, not offline-tolerant". But `homefarm-{orgId}.db` is one
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

First launch mints an org ULID on device, opens `homefarm-{that}.db`, and the
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

An earlier draft said the price could not be set until per-farm cost was
measured. That was wrong twice over, and both errors are worth keeping because
they are the kind a cost-plus instinct produces:

1. **The cost floor does not bind.** A farm costs under a dime a year to serve
   against $39 of revenue. The price is set by what a smallholder will pay.
2. **Costs here are fixed, not marginal.** Reasoning per-farm at all was the
   mistake. What matters is a flat hosting bill and how many farms clear it —
   **break-even, at three or four**, on a box that is already rented.

### 4.1 — What one farm costs, and what the whole thing costs

The measurement this section used to demand had already been half done, in the
roadmap:

> A busy year — eggs and feed logged twice daily, a weekly care note, monthly
> losses and weighings, 1,540 records — is **884 KB on disk**.
>
> A photo compressed for the purpose is **200–400 KB**.

So a synced farm accumulates roughly **1 MB of records and ~30 MB of photos a
year** at a hundred photos. On S3 that is about **half a cent a year** for a
farm in its first year, and — because storage accrues rather than resets —
somewhere near **four cents a year for a farm a decade old**. Requests and
egress round to nothing beside it: one upload per photo, and roughly one
download per photo per additional device, because each device caches locally
after the first fetch.

**The marginal cost of a paying farm is under a dime a year.** Against $39 of
revenue, that is a quarter of one percent, and it stays there at any scale
this reaches. The 25 MB ceiling is a ceiling rather than a typical, and the
app already shrinks photos for the purpose.

### 4.1a — The costs are fixed, not marginal, and that is the whole shape

Everything that actually costs money is a flat bill that does not care how
many farms there are:

| | Annual |
|---|---|
| API host and MongoDB — Oracle Always Free ARM | **$0** |
| Apple Developer | $99 |
| Domain, Play Store (one-off $25), S3 | ~$25 |

**Roughly $125 a year.** The masterplan's *"same box as your other services, or
a managed host?"* has an answer: **the box, and it is already rented.**

An Oracle Cloud Always Free Ampere A1 allocation is **2 ARM cores and 12 GB of
RAM** as of August 2026, with 200 GB of block storage and 10 TB a month of
egress — still far more machine than this workload will notice, and on a
pay-as-you-go account it is not subject to the idle reclamation that affects
trial accounts. Fastify and MongoDB both run there, and it is what D10
describes: one long-running process with a stable connection pool.

**It was 4 cores and 24 GB when this was written, and Oracle halved it.** Noted
with a date rather than quietly corrected, because it is the one number here
somebody else controls — and because nothing downstream moved: the bill is still
$0, break-even is still three or four farms, and the workload was never within
an order of magnitude of either figure. What a change like this *would* threaten
is a plan that had started treating the headroom as a resource. This one has not.

**ARM is not a blocker, and this was checked rather than assumed.** The only
native dependency in `apps/api` is `@node-rs/argon2`, and
`@node-rs/argon2-linux-arm64-gnu` is already in the lockfile as an optional
dependency, so the right binary installs and nothing compiles. Everything else
— Fastify, the Mongo driver, `jose`, `zod`, `ulid` — is pure JavaScript.
MongoDB ships official ARM64 builds; **run Ubuntu on the instance** rather than
Oracle Linux, which is the better-supported path for them.

The alternatives, kept because the answer could change:

| | ~Monthly | Note |
|---|---|---|
| **Oracle Always Free ARM** | **$0** | Current answer. API and MongoDB on one box |
| MongoDB Atlas Flex | $8 | What it really buys is backups — see below |
| Vercel Pro | $0 marginal | Already paid for another project. Serverless — see the payload note |
| Lightsail / EC2 `t4g.micro` | $5–7 | Same shape as the Oracle box, for money |
| ECS Fargate | $25+ | **Avoid at this scale** — the ALB alone is ~$16–18 whether used or not |
| Lambda + API Gateway | ~$1 | Cheap, but inherits serverless friction with no edge over Vercel |

**Serverless has one hard constraint worth writing down.** Vercel Functions cap
a request or response body at **4.5 MB**, and it is infrastructure-level rather
than configurable. `photoShape` permits `byteSize` up to 25 MB, so the contract
allows a payload the platform will refuse with a 413 — and it would reach a
farm as an unexplained rejected mutation.

Nothing normal comes near it: photos are resized to 1600px at quality 0.7
before they leave the phone, which is 200–400 KB, under a tenth of the limit.
It bites only when something escapes the resize path. **Two fixes, and both are
worth having** — lower the contract ceiling to match reality so an oversized
photo is refused at the boundary with a sentence, and move to presigned S3
(§4A) so the bytes never touch the API at all.

**Co-locating the API on AWS would buy one real thing**: S3 through an attached
IAM role rather than an access key in environment variables, since a credential
that does not exist cannot leak. On the Oracle box that is not available, so an
S3 key lives in the server's environment. Not an invariant-12 matter — nothing
here ships in the bundle — but it is a credential to rotate and keep out of
logs, and it is the one thing the free box costs.

### 4.1a-i — The trade is backups, not compute

Twenty-four gigabytes of RAM is absurd overkill for this. What Atlas's $96 a
year would actually buy is **automated backups, point-in-time restore, and
somebody else's patching** — and self-hosting means owning all three.

> **Decided and executed.** The database runs on the box — `mongod` bound to
> loopback, standalone — and the free managed cluster it started on has been
> deleted. So the three things above are owned rather than bought, and the first
> of them is not yet in place: no bucket, no key, no backup taken. The condition
> below is therefore live and unmet, not aspirational. `DEPLOY-THE-SERVER.md`
> §"Moving the database onto the box" is the record.

**Self-host, and treat a backup as a condition of the first real farm.**
`scripts/backup-mongo.sh` is that job: dump, encrypt, upload, and a restore
beside it. Rotation is an S3 lifecycle rule on the prefix rather than logic in
the script, because a bucket setting cannot silently stop working.

**It encrypts to a public key, so the private half never exists on the
server.** The box can write backups it cannot read, and a compromise of the
machine is therefore not a compromise of its history. S3's own encryption is
worth enabling too, but it guards against AWS-side access — not against the two
failures that actually happen, a leaked access key and a bad bucket policy.

**Nothing is redacted, deliberately.** A dump with `users` stripped restores a
farm nobody can log into; that is a partial export wearing a backup's name.
What the dump holds is emails, farm names and coordinates — real PII, but no
usable credentials, since passwords are argon2 hashes and refresh tokens are
stored as a sha256 of the token. Sensitivity is handled by encryption, which is
reversible exactly when it needs to be.

**The backup is also the migration path.** `mongodump` out, `mongorestore` into
whatever comes next — another box, a managed cluster — change `MONGODB_URI`,
restart. `apps/api/src/db/client.ts` takes the
connection entirely from the environment and is the only module permitted to
import `MongoClient`. A tested restore is a rehearsed migration, so there is no
separate plan to keep current.

Two things soften the single-box risk, and both are the architecture working:

- **Downtime is nearly free.** If the box goes, farms keep logging — mutations
  queue and flush later. The only thing that actually breaks is signing in on a
  new device, which is the one flow that needs the server (A2.5).
- **The server is not the only copy.** Every device holds a complete SQLite
  copy of its farm. A total server loss is *in principle* recoverable by
  devices re-syncing — except no mechanism exists for it, because `/snapshot`
  runs server-to-client only. A latent property rather than a safety net, but
  the cheapest disaster insurance this design could ever grow.

### 4.1b — Break-even, which is the number worth holding

At $39 a year, fixed costs of about $125 are covered by **three or four paying
farms.** Under a dozen even if the host later has to be paid for.

That is the number to plan against, and it is deliberately not a market
forecast. For scale: `COMPETITIVE-ANALYSIS.md` records Farmbrite — the
category leader, established and marketed — at **~5,000+ customers**. Any
figure in the hundreds would already be a real business here, and a thousand
would be a fifth of the leader's size. Conversion on this model runs on an
*event* rather than a deadline, so a paying farm implies a good many free ones
behind it.

**None of which has to work for the project to survive**, and that is the
point of the free tier rather than a consolation. Free farms never touch the
server, so they never move the line above. The break-even is small enough to
be reached by one well-received forum thread, and everything past it is real.

### 4.1c — So what is the instrumentation for?

Not pricing. Per-org bytes are still worth measuring, for three things:
capacity planning, spotting the one farm that starts uploading video, and
knowing when photo bytes should leave the database for object storage (§4A).
The price is set by what a smallholder will pay — see §4.2 — and the two
numbers are three orders of magnitude apart.

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

**Asked again once MongoDB moved onto the box, and the answer did not change —
but one of the three reasons above started a clock.**

The new question is whether a self-hosted server with ~170 GB spare should put
photos on its own filesystem rather than in GridFS. Disk is no longer the
constraint that motivated any of this, and three things still say no:

- **Backups stop being one command.** Photos on disk means a `mongodump` is no
  longer a complete backup, so there are two jobs that can drift — and a restore
  that hands a farm records referencing photos that are not there is worse than
  either failure alone. `scripts/backup-mongo.sh` is currently the whole story.
- **Half-written state becomes possible.** A record and its bytes are one system
  today. Split them and every failed write can leave an orphan (bytes with no
  record) or a dangling reference (record with no bytes).
- **A filesystem path is a tenancy boundary that has to be re-earned.**
  `blobsFor(orgId)` is already the seam and §4A.2's isolation tests are already
  its conformance suite. A path built from `{orgId}/{photoId}` introduces
  traversal as a risk class GridFS does not have at all.

**The local filesystem was never the successor anyway — S3 is** (§4A.4), and it
is the better answer than the box's own disk for the reason §4.1a-i gives about
databases: an off-site copy somebody else keeps running is most of what the money
buys.

**The clock: the nightly dump now copies every photo ever taken, every night.**
O(total) rather than O(new), and it is the first of the three reasons above
coming due. `pnpm db:usage` already counts photo bytes separately from records,
which makes it the instrument for exactly this — when photo bytes dominate the
dump, the trigger has fired and §4A is the plan.

### 4A.4 — S3, not R2, and the reason is not price

R2 is cheaper — roughly $0.015/GB against $0.023, and no egress charge against
about $0.09/GB. At the per-farm volumes in §4.1 that is a saving of **a
fraction of a cent per farm per year**, on a marginal cost already under a
dime. It stays smaller than the domain renewal until the farms number in the
tens of thousands.

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

## 5. Answered — D15

**Does signup adopting a client-minted `orgId` sit inside D2's intent?**
**Yes, and it is now D15 in the masterplan.**

Invariant 2 is that `orgId` is never read from a request payload; it comes from
the verified token. Adoption means the *signup* request carries a proposed
orgId — and the invariant is not reached, because it governs **authorizing an
operation against an existing tenant**. That is the failure it exists to
prevent: a payload-supplied org letting a caller act inside somebody else's
farm. Signup creates the tenant. At the moment the route runs there is nothing
to reach into, and every request afterwards derives the org from the token
exactly as before.

**What settled it was that the defence is structural rather than remembered.**
The argument for adoption was originally written around a unique index on
`orgs._id`, which is weaker than it needed to be: an index is a thing somebody
can forget to create on a new deployment. In fact `insertOrg` puts the ULID in
the document `_id`, and `_id` uniqueness in MongoDB is not an index at all — it
is the collection, it cannot be dropped, and it exists before anyone runs
`pnpm db:indexes`. A second claim on the same id is a hard duplicate-key
failure on any database this app could ever be pointed at. **Two farms cannot
silently merge into one**, which was the whole worry.

A ULID also carries 80 bits of randomness, so the id of a farm somebody has
never seen cannot be guessed.

The counter-argument — a new door into the app's hardest invariant — is
answered by bounding the door rather than by trusting review. Exactly one route
reads an org from a payload, it is rate limited with sign-in, it refuses an id
that is not a ULID, and `tests/isolation/claim.test.ts` asserts that a caller
who *knows* another farm's id is refused.

**One case was found while building it and is worth recording.** Creating a
farm is two inserts — the org, then its owner — with no transaction to wrap
them in, because the test harness runs a standalone mongod and requiring a
replica set to make an account would be a worse trade. A crash between them
leaves an org with no members. Such an org is **unclaimed by definition**: no
user means no token can carry its id, so nothing can ever have been written
inside it. The route therefore finishes a claim it finds in that state, because
the alternative is telling a farm its own id is taken and stranding every
record on the handset behind an id it can never claim.

---

## 6. Also Open

- ~~**Claim collision handling.**~~ **Answered.** The server refuses with *"That
  farm has already been claimed. Sign in to it instead."* and the account
  screen shows the server's sentence verbatim. It stays near-impossible — an
  80-bit id — and it now has words rather than a stack trace.
- ~~**What a local-only farm is told about recovery**, and where.~~
  **Answered twice, and the second answer corrects the first.** The Settings
  row reads *"Keep these records safe"* rather than "Your account", and the
  panel behind it leads with the water trough.

  That was called "not a nag: it is a row on a screen nobody opens during
  chores" — which is true, and is also the whole problem with it. It said the
  same sentence on day one about four records as in year two about two
  thousand, so by the time it meant anything it was furniture. See A2.7.
- **First flush at volume.** A month of offline mutations landing at once
  against a newly-claimed org. The batch cap is 100 and flush is sequential, so
  it should hold — but it has never been exercised at that size and wants a
  test before it meets a real farm. **More pressing now than when it was
  written**: before A2.1 a device could only accumulate a queue after signing
  in, and now the ordinary first-claim case is a farm handing over everything
  it has ever logged.
- **A hand's own farm, when they join one.** Joining leaves the org the handset
  minted unreachable, and the screen says so before the code is typed. The
  honest fix is a membership model where a user can belong to more than one
  farm, which is a schema change rather than a screen, and inventing one to
  make a warning go away would be the wrong place to decide it.
- ~~**Losing the local org id.**~~ **Answered.** Android clears secure storage
  when app data is cleared, and an unclaimed farm's id went with it — the
  records still in the database file and nothing knowing which file. It adopts
  now when there is exactly one database on disk, because exactly one means
  exactly one farm; two means the app would be guessing which farm somebody
  meant, so it mints and leaves both alone. See `db/open.ts`.

---

## A2.6 — Promotion codes

**A code somebody was handed, typed into the app, worth a subscription.**

The first version of this was `FREE_SYNC_ORGS`, a list of farm ids in the
server's environment, and it was built to answer a real objection: an
authenticated route whose whole job is to switch off a paywall is the worst
thing in a service to get wrong.

**A code is not a request, and that is the distinction the first design
missed.** Nobody asks for anything — they present a secret they could only have
been given. That is the same shape as the join code (A2.5), and it is why this
is safe where *"please grant me sync"* would not be.

### It writes a subscription; it does not bypass the gate

This is the whole design and everything else follows from it. Redeeming sets
`org.subscription` with `source: 'promo'`, and nothing downstream changes:
`entitlementOf` still decides, an expiry still overrides a stored state,
`/billing` reports a promotion exactly as honestly as it reports a purchase,
and `routes/sync.ts` never learns that promotions exist.

A bypass would have been fewer lines and a second code path through the one
decision in this app that money depends on.

### Sized against the invite token, not the join code

`membership.ts` argues carefully that six characters are enough for a join
code, and every reason it gives is a reason this cannot be six: that code lives
ten minutes while somebody holds a phone out, it is single use, and there is
one per farm. A promotion code is handed over and then sits in a message for a
month — the shape `invites.ts` says flatly that no rate limit can make safe if
it is guessable.

So: **twelve Crockford characters, 60 bits**, `randomInt` per character,
formatted `4F7K-M2Q9-XT3B` so it can be read down a phone line, and normalised
on the way in so `O` for `0` is understood rather than refused.

| Property | Why |
|---|---|
| Redemption is authenticated | A grant lands on *a farm*, and a farm comes from a verified token — so an attacker needs an account before spending one guess |
| `maxRedemptions`, default 1 | Claimed by one conditional update, so two phones at once cannot both win |
| The code can expire | Separately from the grant it produces |
| The grant can expire | `days`, counted from **redemption** — a code written in March and used in June is worth the same year either way |
| `disabledAt` | The honest answer to "that got posted somewhere" is to turn it off, not to hope |
| Stored hashed | A database dump must not hand over working codes |
| Minted only by `pnpm promo:new` | There is no path from the wire to a new code |
| One sentence for every refusal | "Spent" would tell a guesser they found a real code, which is most of the work |

### Redeeming twice is not an error

A farm that presses the button again on bad signal gets the grant it already
had, and the code's remaining uses are untouched. Every other write path in
this app is idempotent because the mutation queue insists on it; a redeem route
that punished a retry would be the one place a dropped response cost somebody a
subscription.

### Making one

```
pnpm promo:new                        one code, forever, single use
pnpm promo:new --days 365             a year from whenever it is redeemed
pnpm promo:new --uses 5 --note beta   five farms, and a word to remember why
```

Printed once. It is stored hashed and cannot be shown again.

**`FREE_SYNC_ORGS` stays** as the break-glass that needs no database — for the
farm that cannot redeem because the thing that is broken is the server.

---

## A2.7 — The third moment, and the copy that answers it

A2.3 says an account is asked for at three moments and no others, and names the
third as *"enough data to hurt losing"*. It also says that one is *"the honest
one and must not be buried"*.

**It was buried, in a row on a settings screen.** Not through neglect — the row
was written for exactly this — but because the sentence it carried could not
tell the two ends of the farm's life apart. *"Everything is on this phone
only"* is true on the afternoon somebody installs the app, and true two years
later about a season nobody can reconstruct. A line that says the same thing
either way is furniture by the time it matters.

### The condition, stated

`packages/core/src/backup/exposure.ts`. Three clauses, all from reads a screen
can afford every morning:

1. **Nothing has ever reached a server** — `lastSyncAt === null`.
2. **Enough records that losing them would hurt** — `EXPOSED_AT`, currently 200.
3. **No copy taken recently** — `BACKUP_GOOD_FOR`, ninety days.

**The first clause is not "has no account", and the difference is the point.**
A farm whose card lapsed still has a copy on the server and can pull it back —
`GET /snapshot` is deliberately ungated on billing — so it is not exposed and
must not be told it is. A farm *with* an account that has never once flushed,
because it is on the free tier, is exposed, and "has no account" would have
missed it entirely.

The second is a count rather than a span of days, which is the weaker measure
and is chosen anyway: a span needs a scan of every record on a screen that
renders every morning, and `countRecords()` is one query. Two hundred sits
above a setup burst — every group, every animal, every machine and bed comes to
a few dozen — and below a season.

**Records, not mutations, and that was got wrong first.** The cheapest read
available is `counts()`, which the sync chip already makes — but it counts
outbox rows, and on a never-synced farm a group created and then edited three
times is four of those and one record. A band reading *"1,540 records"* about
roughly 1,200 of them would be the app overstating the exact thing it is asking
somebody to act on, so the port grew a `countRecords()` instead.

### Why there is nothing to dismiss

`WeatherWarnings` already argued this out for a different strip, and three of
its four reasons transfer unchanged: a stored *"I saw this"* is the completion
flag the due engine refuses, it drifts from what it describes, and the reflex it
trains gets spent on the row that mattered.

The fourth reason is what makes this different rather than exempt. A weather
warning has nothing you can do about it, so dismissal is the only thing on
offer. This has two things, and doing either ends it honestly: sync, or take a
copy. A copy goes stale, so the notice comes back — ninety days is long enough
not to be a nag and short enough that *"your last copy is from February"* is not
something somebody discovers in September.

### What the copy is, and what it is not

**Records, not photographs.** The bytes are far larger than everything else put
together and a backup that quietly grew to 300 MB is one that fails to send
with no explanation. The file names its own exclusions rather than leaving a
screen to remember them.

**A file is a copy of a moment; an account is a copy that keeps itself.** The
backup screen says so, under the button rather than in front of it — somebody
who came for the file should get the file, and should not leave without knowing
what it does not do.

**It is not a reversal of the CSV-import refusal.** That refusal names three
reasons and a restore has none of them: it goes into a farm with nothing to
merge against, every row already carries the ULID it was minted with (D1), and
there is nothing to preview because the file is this app's own output. A
spreadsheet somebody edited has none of those properties.

### The one thing that cannot be built

**The app cannot find a backup file by itself on a fresh install.** Uninstalling
deletes an app's directories and releases every Storage Access Framework grant
it had persisted, so there is no folder a new install may read without being
handed it — and the handing over is the picker.

The two ways round it are both worse. A broad media permission is asking for
every document on the phone in order to look at one. And **Android Auto
Backup**, which really is the platform doing this automatically, is off in
`app.json` on purpose: it would put the records of a farm with no account into
Google's backup without anybody agreeing to it, and *"everything is on this
phone only"* — which is what this document says and what the app repeats —
would quietly stop being true.

---

## A2.8 — The day the paywall switches on

**Right now this server charges nobody, and that is not an oversight.**
`syncAccess` asks three questions before it asks what a farm has paid, and the
first one ends it:

```ts
if (env.playConfig === null) return { syncing: true, refusal: null };
```

`playConfig` is null unless **both** `GOOGLE_PLAY_SERVICE_ACCOUNT` and
`GOOGLE_PLAY_PACKAGE` are set, which needs a Play Console service account. On a
box without them the answer is not "unpaid", it is *"there is no such thing as
paid here"* — nobody could have bought anything, so refusing work over a
subscription state nobody could possibly hold would lock every farm out of a
self-hosted server permanently.

Confirm which state a box is in with `grep -c GOOGLE_PLAY /etc/homefarm/api.env`.

### Except when the box is on the open internet

That default is right for a server with one farm on it and wrong for one whose
install page is public. Reported from exactly that box: *"our site for download
is online all the time — if someone finds it they get a free account?"* They
did. The page has to be public for a tester to reach it, and the hostname is in
**Certificate Transparency logs** from the moment Caddy is issued a certificate,
so *if* somebody finds it is a matter of when rather than whether.

So it asks by default. The two comps below and a redeemed promotion code are
the ways through, on a server that has never heard of Play.

**The first version of this was a `SYNC_REQUIRES_GRANT` flag that defaulted
off**, which made the gate possible rather than actual — and a hole stays open
when closing it is a step somebody has to remember. `SYNC_OPEN_TO_ALL` is the
inversion: the safe state is what you get by doing nothing, and running an open
server is the deliberate act.

`pnpm db:seed` grants the farm it creates, so a fresh box syncs its own farm out
of the box and nobody else's — without that, the first thing a self-hoster does
after standing a box up is discover their own farm cannot reach it, which is the
sort of surprise that gets fixed by opening the door for everybody.

**Where the gate sits is the argument.** The app stays free to install and a
farm may keep its whole records on its own handset for nothing — that is D14 and
it is not a trial. What needs granting is a copy on *somebody else's* server,
which is the part that costs money to keep. D13 already says sync is the only
thing sold; this makes that true before Play exists rather than after.

A farm without a grant is told *"Kept on this phone. Everything works; nothing
is sent anywhere."* — true, naming no store it could not reach, and sitting
directly above the field where a code goes.

Guarding the download page instead was considered and is weaker: it costs a
tester a password, and it does nothing at all about somebody who already has the
APK. The account is what consumes the disk, so the account is where the gate
belongs.

### The cliff

Adding those two variables does not switch billing on gradually. It moves the
first question from *yes* to *keep asking*, for **every farm at once** —
including the one running the server. A farm that was syncing five minutes ago
starts getting `unsubscribed` on every batch, and the only thing it did was
exist while somebody edited a file it has never heard of.

This is the ordinary shape of a flag that gates a whole population, and the
mitigation is ordering rather than cleverness.

### The order that avoids it

**The same order applies to a box that has been running open.** Closing the gate
is the same cliff Play configuration causes, arriving earlier — and any farm
already syncing without a grant stops the moment the new default lands.

1. **Comp everyone who must not be interrupted** — the farm running the box,
   every tester, anyone mid-season. All three mechanisms below are read *before*
   the subscription is, so they work in either state.
2. **Then** deploy the closed default, or add `GOOGLE_PLAY_SERVICE_ACCOUNT` and
   `GOOGLE_PLAY_PACKAGE` later. Restart.
3. **Then** verify from a handset that had been syncing that it still is —
   before anybody reports that it is not. The account screen and the sync chip
   both read `syncAccess`, so they agree or they are both wrong.

Doing 2 before 1 is recoverable — nothing is lost, the queue holds and flushes
when the grant lands — but the farm spends that window being told its records
are staying on the phone, which is the one sentence this app cannot afford to
say carelessly.

### Which comp to reach for

| | Where it lives | Right when |
| --- | --- | --- |
| `FREE_SYNC_ORGS` | the server's environment | the break-glass. Needs no database, so it works when the database is the thing that is broken. Costs a restart. |
| `pnpm farm:grant` | the `orgs` document | the ordinary comp. Same decision, no restart, and it survives somebody rewriting the env file. |
| A promotion code (A2.6) | handed to a person | when the farm should do the redeeming — a tester you will never have shell access on behalf of. |

The first two are things done *to* a farm and need its org id. The third is a
thing a farm does for itself, which is why it is the only one of the three that
belongs in somebody else's hands.
