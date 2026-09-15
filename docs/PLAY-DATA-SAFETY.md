# The Play Data Safety declaration

**`UNCONSIDERED.md` `[3]`.** The form Google Play makes every developer fill in,
answered here first so the answers can be reviewed like anything else in this
repository rather than typed into a web form once and forgotten.

**Why it is worth this much care:** a rejected listing is a delay, but an
*inaccurate* Data Safety declaration is an enforcement matter — a takedown or a
suspended account, after the farms are already on it. This is the one store
artefact where being wrong is worse than being late.

**Sourced, not remembered.** Every answer below names the file it came from, and
`docs/PRIVACY-FACTS.md` is the long version of the same evidence. Where an
answer needs a decision rather than a fact, it says so and does not guess.

> **Check the form before you transcribe this.** Play's data-type list and its
> exemptions have changed more than once, and this file was written against the
> form as understood in September 2026. Where this document and the Console
> disagree, the Console is right and this file is stale.

---

## The shape that decides most of the answers

**The app works completely with no account and no server.** First launch mints a
farm id on the device and opens a local SQLite database; every record lives
there. An account is optional and buys sync.

Play asks about data **collected** (sent off the device to us) and **shared**
(sent off the device to anybody else). Records on a handset are neither. So for
a farm with no account, almost every answer below is *no*, and the declaration
has to be written so that it stays true for both populations.

`android:allowBackup="false"` is set deliberately (`apps/mobile/app.json`), so
Android's own cloud backup never copies a farm's records to Google either.

---

## Data types

### Personal info — Name

| | |
|---|---|
| Collected | **Yes**, with an account only |
| Shared | No |
| Purposes | App functionality; Account management |
| Required | Optional — the app is fully usable without an account |
| Ephemeral | No |

A display name, so a farm can tell who logged what. Source:
`apps/api/src/db/identity.ts`.

**It outlives the membership.** A removed member's display name and previous
email stay with the farm, so the history of who recorded what remains readable.
The privacy policy says so (`packages/contracts/src/legal.ts`), and the
declaration should not imply otherwise.

### Personal info — Email address

| | |
|---|---|
| Collected | **Yes**, with an account only |
| Shared | No |
| Purposes | App functionality; Account management |
| Required | Optional |
| Ephemeral | No |

Sign-in, invitations, and password reset. Source: `apps/api/src/db/identity.ts`.

### Personal info — User IDs

| | |
|---|---|
| Collected | **Yes**, with an account only |
| Shared | No |
| Purposes | App functionality; Account management |
| Required | Optional |
| Ephemeral | No |

A farm id, an account id, a per-device identifier used to order a device's
queued changes, and a Google subject id when Google sign-in is used.

**The device identifier is not an advertising identifier and there is no
advertising identifier anywhere in this app.** It exists because the sync
ordering rule is per device (`clientSeq`), and it is minted by the app rather
than read from the handset.

### Photos and videos — Photos

| | |
|---|---|
| Collected | **Yes**, with an account only |
| Shared | No |
| Purposes | App functionality |
| Required | Optional |
| Ephemeral | No |

Photographs of receipts, kit and evidence, resized on the device to 1600px on
the long edge before they are stored. Without an account they never leave the
handset; with one, the bytes upload to the project's own server and nowhere
else. Source: `apps/api/src/db/blobs.ts`.

### App info and performance — Diagnostics

| | |
|---|---|
| Collected | **Yes**, only when somebody files a report |
| Shared | **Yes — GitHub** |
| Purposes | App functionality (diagnosing a fault the user reported) |
| Required | Optional |
| Ephemeral | No |

**This is the row most likely to be declared wrongly, so it gets the most
words.**

A support report carries structure and counts, never record content: app
version and build, OS version, local schema version, queue depth, rejected and
quarantined counts, last sync time, the last error message, engine error
signatures, a hashed farm id used only to recognise two reports as the same
farm — and **one free-text line the farmer chose to write**, which is the one
place a person can put anything at all.

A ticket becomes a **GitHub issue on this project's public repository**. That is
a transfer to a third party and it is world-readable, so it is declared as
shared. The app now says so on the screen before the line is typed
(`SUPPORT_REPORTS_ARE_PUBLIC`, `packages/contracts/src/support.ts`) — a warning
that exists because the screen previously described the contents as carrying no
names without ever naming the destination.

**The opt-in second half, which would send a farm's actual records, is refused
server-side while the repository is public** (`apps/api/src/support/github.ts`),
so no farm's records have ever gone to GitHub. Declare what happens, not what
the switch could do. **If that repository is ever made private, this row, the
warning constant and `SupportConfig.acceptRecords` change together.**

### Location — Approximate location

| | |
|---|---|
| Collected | **No** |
| Shared | **Yes — see the note below** |
| Purposes | App functionality (the weather forecast) |
| Required | Optional — a typed address works instead, and so does no weather at all |
| Ephemeral | — |

**Collected is genuinely "no", and this was checked rather than assumed.** A
search of `apps/api/src` finds no latitude or longitude anywhere: the project's
own server never receives a position. The coordinates live in the device's local
weather tables and are wiped on sign-out.

**Nothing in this app ever holds a precise position.** Coordinates are rounded
to two decimal places — roughly a kilometre — at the GPS path, at the geocoder
path, and again before every outbound call (`roundPosition`,
`packages/contracts/src/weather.ts`). `ACCESS_FINE_LOCATION` is explicitly
blocked in the manifest.

**Shared needs a decision, and this document will not make it.** Rounded
coordinates go from the device to **api.weather.gov** (US National Weather
Service), and a typed address goes to the **US Census Bureau geocoder**. Both
are transfers to third parties on their face. Play exempts a transfer made on a
specific user-initiated action where the user reasonably expects it — and asking
for a weather forecast is close to the centre of that exemption.

**The recommendation is to declare it as shared anyway.** The cost of
over-declaring is a line on the listing that is true; the cost of
under-declaring is the enforcement case. If somebody wants to claim the
exemption instead, that is a decision to take with advice, not one to infer from
this file.

This is also the one outbound call **a farm with no account makes**, which is
worth saying plainly in the listing rather than leaving somebody to discover it.

### Financial info — Purchase history

| | |
|---|---|
| Collected | **Not yet** |
| Shared | No |
| Purposes | App functionality (entitlement) |

Play billing verifies a purchase token and stores it against the farm
(`apps/api/src/billing/play.ts`). **No farm can buy anything yet**, so this row
is declared the day billing goes live and not before. A declaration describing
something that is not happening is the same defect as one that omits something
that is.

---

## The farm's records themselves — an open question

Every other row above is a data type Play names. **The farm's records are not.**
Livestock, treatments and withdrawal dates, eggs and milk and honey, feed,
losses, equipment and service history, plantings and harvests, breeding,
weights, tasks, inventory, notes — with an account, all of it is on the
project's server, and none of it fits "Personal info", "Financial info",
"Health" (that is the *user's* health) or "Messages".

**UNDECIDED.** Somebody has to look at the current form's type list and pick,
and the honest candidates are an "other" bucket under App activity, or a
declaration that the form does not model. Do not leave it out on the grounds
that nothing fits: the records are the substance of what this app holds, and a
declaration that omits them is the one a reviewer would notice.

---

## The four overall answers

**Is all of the data encrypted in transit? — Yes.** HTTPS everywhere and the app
cannot use cleartext (`apps/mobile/app.json`).

**Do you provide a way for users to request that their data is deleted? — Yes.**
Two ways, and one of them needs no app: in Settings, and at
`https://<server>/account/delete`, a page reachable by anybody. Every deletion
requires the account's password or a fresh Google token; a session alone is
refused. Deletion on the server is immediate and complete — no soft delete, no
grace period. Source: `apps/api/src/routes/account.ts`,
`apps/api/src/db/deletion.ts`, `docs/ACCOUNT-DELETION.md`.

**Two honest caveats that belong in the answer**, because both are already in
the privacy policy and a declaration that contradicts the policy is worse than
either alone:

- **A last owner's deletion takes the whole farm**, including every other
  member's account on it. Anybody else takes only themselves.
- **Support tickets already on GitHub are not reached by deletion.** They carry
  no records and a hashed farm id.

**Is data collection optional? — Yes, entirely.** The account is optional, the
location permission is optional, the support report is optional, and the records
half of a support report is off by default and refused server-side.

**Target audience — 13 and over.** The documents claim it; as of this writing
**there is no age gate in the app**, so the claim lives only in the policy.
Either build the gate or stop claiming it, but the Console declaration and the
app must not disagree.

---

## What this app does not do, and it was searched rather than remembered

- **No analytics, telemetry or crash-reporting SDK of any kind.** Not Sentry,
  Firebase, Crashlytics, Amplitude, Segment, Mixpanel, PostHog or Bugsnag. The
  search returned nine matches and every one was a false positive — "segment" in
  a path, "sEntry" inside `unitsEntry`.
- **No advertising, no ad identifier, no tracking.**
- **No data sold, and none shared for advertising.**
- **No third-party fonts, CDNs or web resources at runtime.**

**MongoDB Atlas is not a processor and must not appear anywhere.** The database
moved onto the box and that cluster was deleted. Naming a processor that holds
nothing is the error that survives review and fails an audit.

---

## Before this is submitted

1. **Re-read the form.** This file is a draft of answers, not a copy of the
   current questions.
2. **Settle the two open items above** — the farm records' data type, and
   whether the weather transfer is declared as sharing.
3. **Settle the age gate**, so the Console answer and the app agree.
4. **Re-check §3 and §4 of `docs/PRIVACY-FACTS.md`**, which go stale the moment
   the code moves — particularly if billing, email or backups become live, since
   all three are declared "not yet" here.
5. **Check it against the privacy policy** in `packages/contracts/src/legal.ts`.
   They are built from the same facts and must not drift; the policy is the one
   a farm reads and the declaration is the one Google enforces.
