# Steading — Access and Billing

How somebody gets into the app, and where the money is. Researched August 2026.

The masterplan deferred billing at D7 — *"org invites, billing, and cross-org
admin deferred"* — which was right at the time. It is no longer, because the
question has started deciding other things: the weather licence, where photos
live, whether there is a server bill at all. This document settles the shape
and says what still has to be measured.

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

**Not yet, and that is the answer.** Three inputs, in order, and only the
second and third exist today.

### 4.1 — The cost floor, which has to be measured

What does one synced farm cost per month? Mongo storage, bandwidth, and photo
blobs — and photos dominate everything else by an order of magnitude. A 25 MB
ceiling per photo against a farm that photographs receipts, wounds and kills
is the only number here with real variance.

**This number does not exist yet and cannot be guessed.** It arrives once
there are real synced farms, by instrumenting bytes-per-org. Until then any
price is arithmetic on an invented cost.

The free tier is what makes this safe to defer: free users cost nothing, so
there is no bill accruing while the number is being found.

### 4.2 — The competitive anchors, which do exist

| | Price | Shape |
|---|---|---|
| Flockstar | **$29.99/year** | Consumer. Annual, one product. |
| Farmbrite | **~$29–109/month** | Business. Tiered, metered by animals. |
| LookOver | Free for 1 machine, then paid | Consumer, scope-limited free tier |

The spread is the finding. **Farmbrite is priced like business software and
Flockstar like a consumer app**, an order of magnitude apart, and Steading sits
between them in capability while its *buyer* is unambiguously Flockstar's
buyer. A homesteader with twelve hens is not paying $350 a year.

That puts the anchor band somewhere above Flockstar — we do considerably more —
and far below Farmbrite. It does not pick a number, and should not until §4.1
exists.

### 4.3 — The unit and the shape

- **Per farm, not per seat.** P11.
- **Annual, not monthly.** Farm cash flow is seasonal, and card processing eats
  small monthly amounts.
- **One paid tier, not four.** W6 makes comprehension the headline feature; a
  four-row pricing table is the same disease as a screen with too many
  sections. If a second tier ever appears it should be for a farm large enough
  to know it is large.

### 4.4 — The sequence

1. Ship the free tier. It costs nothing, so there is no urgency.
2. Instrument per-org storage and bandwidth on the first synced farms.
3. Price against §4.1 with §4.2 as the ceiling and floor.

The honest risk in this model is stated plainly: **it converts on an event, not
a deadline.** Farmbrite converts because a clock runs out. Steading converts
when somebody buys a second phone, hires help, or gets frightened about backup —
and a one-person homestead may never do any of those. Revenue is slower and
smaller than a trial model. It is chosen anyway, because the cost floor is near
zero and reach compounds.

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
