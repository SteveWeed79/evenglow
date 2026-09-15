# Privacy and terms — the fact pack

**What this is.** Everything a drafter needs to write Evenglow's privacy policy,
terms of service and Play Data Safety declaration, taken from the code rather
than from anybody's memory. `UNCONSIDERED.md` `[1]`, `[2]`, `[3]` and `[7]`;
`APPROVED-WORK.md` §2 and §3.

**It is not a policy and must not be pasted into one.** It is the input. Every
claim below is a fact about this repository at the commit it was written on, and
each is marked so a drafter can tell them apart:

| Mark | Means |
|---|---|
| **VERIFIED** | Read out of the code while writing this, with the file named. |
| **DECIDED** | Settled in a document, and the code agrees. |
| **NOT YET TRUE** | Decided, and the configuration to make it true does not exist. **A policy must not state these as fact.** |
| **UNDECIDED** | Nobody has answered it. Several of these block the document. |

**Two standing warnings.**

*Jurisdiction is unanswered* (see §9). Everything here describes behaviour, not
compliance. Whether the result needs GDPR language, CCPA language, both or
neither is a decision nobody has made, and the honest instruction to a drafter
is *find out first*, never *assume*.

*The repository is public.* Nothing in this file is a disclosure, because
`PICK-UP-HERE.md` and `DEPLOY-THE-SERVER.md` already carry more operational
detail than this does. It is worth knowing the concentration exists.

---

## 1. The product, so the rest makes sense

Evenglow is an offline-first farm record book. **Android only** today.

The shape that decides almost every privacy answer: **the app works completely
with no account and no server.** First launch mints a farm id on the device and
opens a local SQLite database, and everything — livestock, treatments, eggs,
harvests, weather, photos — works from that moment with nothing leaving the
handset. An account is optional and buys three things: a second device, a farm
hand, and the records surviving the phone (`ACCESS-AND-BILLING.md` A2.1, A2.3).

So there are **two quite different populations**, and the policy has to address
both without implying the first is sending anything:

1. **No account.** Nothing ever leaves the device except the weather lookup
   (§3.1) and, if they choose to send one, a support report (§3.4).
2. **With an account.** Records sync to a server the project runs.

**Free farms never touch the server at all**, which is a real fact rather than a
marketing line: sync is the paid feature, and an unsubscribed farm's writing is
held rather than sent.

---

## 2. What is held on the device

**VERIFIED.** `apps/mobile/src/db/open.ts`, `packages/core/src/db/`.

One SQLite file per farm, named for the farm's id, inside the app's private
sandbox. `android:allowBackup="false"` is set in `app.json`, deliberately, so
Android's own cloud backup never copies a farm's records to Google.

Contents: every record the farm types — animals and groups, medicines and
withdrawal dates, eggs, milk, fibre, honey, feed, losses, predators, equipment
and service history, beds, plantings and harvests, breeding, incubation,
weights, shearing, tasks, inventory, notes — plus photographs taken in the app,
a cached weather forecast, and the outgoing sync queue.

**Credentials are not in SQLite.** Session tokens and the farm id live in
`expo-secure-store` (Android Keystore). That split is an invariant, not a
detail.

**Photographs** are resized on the device to 1600px on the long edge at quality
0.7 before being stored. The record and the image are separate: the record syncs
with everything else, the bytes upload separately.

---

## 3. What leaves the device, to whom, and why

### 3.1 Weather — `api.weather.gov`, and a geocoder

**VERIFIED.** `packages/core/src/weather/provider.ts`, `apps/mobile/src/weather/where.ts`.

- **Recipient:** the US National Weather Service, a US government service. No
  key, no account, no contract.
- **Sent:** the farm's coordinates, and a User-Agent naming the app and its
  public repository. Nothing else. No identifier, no account, no farm id.
- **Happens without an account**, which is the point worth being careful about:
  this is the one outbound call a farm with no account makes.
- **Coordinates are rounded to two decimal places — about a kilometre — before
  they are stored, and again before every call.** Enforced by `roundPosition`
  at both capture paths and at the provider. **Nothing in this app ever holds a
  precise position.** The reasoning, written in the schema: a farm's
  coordinates identify a family's home, and two decimals is ample for weather
  and useless for finding a door.
- **The typed-address alternative** sends the address to the **US Census Bureau
  geocoder** (`geocoding.geo.census.gov`) when somebody refuses the location
  permission and types where they are instead. The result is rounded on arrival.

### 3.2 The farm's records — the project's own server

**VERIFIED.** `apps/api/`, `packages/core/src/sync/`.

Only when signed in, and only when sync is entitled. Records travel as a queue
of mutations; photo bytes travel separately.

**Held on the server:** everything in §2 except the weather cache and the queue,
plus — for each account — an email address, a display name, an argon2 password
hash (absent for Google-only accounts), a Google subject id when connected, a
role, a creation date, and the app version and timestamp of the last sync.

**Also held:** a log of every mutation, which is the audit trail and the
replication feed; invitations and join codes; refresh token hashes; password
reset and email verification code hashes.

**IP addresses** reach the server and the reverse proxy in front of it. They are
used for rate limiting. The application itself runs with request logging **off**
(`logger: false`), but **Caddy keeps an access log** on the box — rolling, 10 MiB
× 5 files — which contains IP addresses and request paths. A drafter should
treat that as a real retention fact.

### 3.3 Google — sign-in and, later, Play billing

**VERIFIED.** `apps/api/src/auth/google.ts`, `apps/api/src/billing/play.ts`.

- **Sign-in** is optional. The app receives a Google ID token and the server
  verifies it, keeping the **subject id, email and name**. `email_verified` is
  required. It is inert on a server with no client ids configured.
- **Play billing** verifies a purchase token against Google's Android Publisher
  API and stores the token against the farm. **No farm can buy anything yet**,
  so nothing here is live.

### 3.4 Support reports — GitHub

**VERIFIED.** `packages/contracts/src/support.ts`, `SUPPORT-LOOP.md`.

Only when somebody deliberately files a report. Tickets become **GitHub issues**.

**What the bundle carries is structure and counts, never content:** app version
and build, platform and OS version, local schema version, queue depth,
rejected/quarantined/cleared counts, last sync time, the last error message,
whether the device is signed in, refused-mutation reasons, engine error
signatures, a **hashed** farm id used only to recognise two reports as the same
farm, a fingerprint, and **one free-text line the farmer chose to write**.

**The free-text line is the one place a person can put anything they like**, and
a drafter should say so plainly rather than describing the bundle as anonymous.

**A second, opt-in half would send the farm's actual records** as a secret gist.
It is **refused server-side unless the repository is private**, and the
repository is public, so **it is off and no farm's records have ever gone to
GitHub**. Say what it does today, not what the switch could do.

### 3.5 Email — Resend or Postmark

**VERIFIED.** `apps/api/src/mail/send.ts`. **NOT YET TRUE in production:**
`EMAIL_FROM` is unset, so **the server sends no mail at all today.**

When configured, one provider receives the recipient address, a subject, and a
plain-text body, for password resets, email confirmation and invitations. Codes
are typed by the person, never links.

---

## 4. Processors and recipients — `[7]`

**The list the policy and the Data Safety form are built from.**

| Party | Role | Holds | Status |
|---|---|---|---|
| Oracle Cloud | Infrastructure | The box: the API, the database, photo bytes | Live |
| The project itself | Controller | Everything in §3.2 | Live |
| National Weather Service (US gov) | Recipient | Coarse coordinates, no identifier | Live, and for accountless farms too |
| US Census Bureau geocoder | Recipient | A typed address, when used | Live |
| GitHub | Processor | Support tickets (§3.4) | Live |
| Google — Sign-In | Processor | Identity assertion | Live when configured |
| Google — Play Billing | Processor | Purchase token | Not live |
| Resend **or** Postmark | Processor | Outbound email | Not live |
| AWS S3 | Processor | Encrypted database backups | **Not live — no bucket exists** |

**MongoDB Atlas is NOT a processor and must not appear.** The database moved
onto the box and that cluster was deleted. Naming a processor that holds nothing
is the kind of error that survives review and fails an audit.

**No data-processing agreements are on file with any of these. UNDECIDED.**

---

## 5. What the app does not do

**VERIFIED by search across the whole repository and every `package.json`.**

- **No analytics, telemetry or crash-reporting SDK of any kind.** No Sentry, no
  Firebase, no Crashlytics, no Amplitude, no Segment, no Mixpanel, no PostHog.
  Nothing.
- **No advertising, no ad identifier, no tracking of any sort.**
- **No data is sold, shared for advertising, or disclosed to anyone** beyond §4.
- **No precise location is ever held** (§3.1), and the fine-location permission
  is explicitly *blocked* in the manifest.
- **No Android Auto Backup**, switched off deliberately so an accountless farm's
  records are never copied into Google's backup.
- **No third-party fonts, CDNs or web resources at runtime.**

---

## 6. Retention and deletion — `[4]` and `[5]`, answered

**DECIDED and built.** `docs/ACCOUNT-DELETION.md`, `apps/api/src/db/deletion.ts`.

**The rule:** the last owner of a farm takes the farm with them; anybody else
takes only themselves. A farm with another owner, or a farm hand leaving, loses
the person and keeps the records.

**Deletion is available three ways**, one of which needs no app:
`https://<server>/account/delete` is a web page reachable by anyone, which Play
requires. Every deletion needs the account's password or a fresh Google token; a
session alone is refused.

**On the server: immediate and complete.** No soft-delete, no grace period. The
records, the photo bytes, the mutation log, invitations, join codes, sessions
and the accounts all go.

**On the device: nothing is touched unless asked.** The handset keeps its
records, and there is a separate opt-in to clear them.

**In backups: NOT YET TRUE.** The decision is **30 days**, enforced by an S3
lifecycle rule. **The bucket does not exist and no backup has ever been taken**,
so today there is nothing to expire. A policy may state the 30-day rule **only
once the bucket and its lifecycle rule exist**; until then the sentence is
describing something that is not happening.

**A lapsed subscription is never a deletion.** Reading is deliberately ungated
on billing: a farm that stops paying keeps everything and can pull it back, and
simply cannot push new work up.

**It does not cancel a Play subscription**, and both deletion doors say so.

**Support tickets already on GitHub are not reached by deletion.** They carry no
records and a hashed farm id. Say so.

**A farm can export everything** at any time as CSV through the share sheet, and
take a full backup file — both without a server.

---

## 7. Permissions, for the store listing

**VERIFIED.** `apps/mobile/app.json`.

| Permission | Why | Notes |
|---|---|---|
| `ACCESS_COARSE_LOCATION` | The weather forecast | Optional; a typed address works instead |
| `ACCESS_FINE_LOCATION` | — | **Explicitly blocked** |
| Camera / photo library | Photographs of receipts, kit and evidence | Via `expo-image-picker`, only when used |

---

## 8. Security posture — state it honestly

**VERIFIED.** Passwords are argon2 hashed. Tokens are SHA-256 hashed at rest and
held in the Android Keystore on the device. Access tokens last 15 minutes and
refresh tokens 90 days with rotation and reuse detection. All traffic is HTTPS;
the app cannot use cleartext. Tenant isolation is a mechanism rather than a
convention — every query is scoped by construction, and a cross-tenant request
answers 404 rather than 403 so nothing discloses that a record exists. Backups,
when they exist, are encrypted to a public key so the box can write copies it
cannot read.

**Two honest gaps, which a policy should not paper over:** there is no off-site
backup at all yet, and nothing monitors the box's uptime.

---

## 9. What the drafter must be told before writing — **UNDECIDED**

These block the document. None of them can be inferred from the code.

1. **Who is the controller?** No business entity exists (`[14]`). Play needs a
   payee, and a policy needs a name and an address.
2. **Which jurisdictions?** US only, or UK/EU as well? The weather feature is
   United States only, so restricting distribution is a live option — and it
   decides whether GDPR, the EU trader declaration and a subject-access process
   are in scope at all (`[6]`, `[12]`).
3. **What contact address** receives privacy requests? There is no support email
   and no mail sender configured.
4. **What domain does mail come from?** `swbuild.dev` is the domain; the app is
   called Evenglow. A reset from a domain a farm has never heard of is
   indistinguishable from phishing.
5. **Children.** The app has no age gate and no age handling of any kind.
   Farming is a family activity and a teenager may well be the one logging eggs.
   Somebody must decide the intended audience before the Data Safety form is
   filled in.
6. **Medicine and withdrawal records** may be subject to a statutory retention
   period, which would conflict with immediate deletion (`[19]`). This one has a
   real chance of changing §6, so settle it before the policy is written.
7. **Bundled reference data** — the breed and variety library — has an unrecorded
   licensing provenance (`[15]`). It affects the terms, not the policy.
8. **Where will the policy be hosted?** Play needs a public URL, and the box
   currently serves only the API and the app shelf.

---

## 10. Tone, so the result matches the product

Every farmer-facing sentence in this app is plain and specific, and the policy
should read the same way. Two examples of the house style, both shipped:

> Everything you have logged is on this device. Nothing below can lose it.

> Evenglow keeps records; it does not give veterinary advice. Every withdrawal
> date here is worked out from what was typed in, so the medicine's label and
> your vet are what decide it.

The single most useful thing the policy can say, and it is true: **most of what
this app does happens on the phone, and a farm that never makes an account
sends nothing but a coarse weather lookup.**

---

## 11. Where to check any of this

| Claim | File |
|---|---|
| Local storage, one file per farm | `apps/mobile/src/db/open.ts` |
| Coordinate rounding | `packages/contracts/src/weather.ts`, `roundPosition` |
| Weather and geocoding calls | `packages/core/src/weather/provider.ts` |
| What the server stores per account | `apps/api/src/db/identity.ts` |
| Tenant isolation | `apps/api/src/db/scoped.ts` |
| Photo bytes | `apps/api/src/db/blobs.ts` |
| Support bundle contents | `packages/contracts/src/support.ts` |
| Deletion | `apps/api/src/db/deletion.ts`, `docs/ACCOUNT-DELETION.md` |
| Backup encryption and retention | `scripts/backup-mongo.sh` |
| Permissions and Auto Backup | `apps/mobile/app.json` |
| Access model and billing | `docs/ACCESS-AND-BILLING.md` |

**This file goes stale the moment the code moves.** Re-check §3, §4 and §5
against the source before any policy built on it is published.
