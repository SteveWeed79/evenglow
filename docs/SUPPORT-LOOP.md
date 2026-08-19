# Steading — The Support Loop

How a defect gets from a farm's handset to a fix, and back.

Decided and built August 2026. The design below was written while the decisions
were being made rather than reconstructed afterwards; §5 says where each part
of it now lives.

**Companion docs:** `Evenglow-Masterplan.md` (the invariants) · `UX-SPEC.md`
(the voice) · `ACCESS-AND-BILLING.md` (who the farm is) · `ROADMAP.md`.

---

## 1. The Problem

**A farm that hits a defect has no way to tell anybody, and the person who
could fix it has no way to see what happened.**

Every other channel a small product uses is unavailable or wrong here:

- **There is no email sender in this system** (see `MembersScreen`), so "email
  support" means building mail infrastructure to carry a bug report.
- **A screenshot is nearly useless.** The interesting state is the sync queue,
  the migration ladder, the rejected inbox and the engine's own errors — none
  of which a photograph of a screen contains.
- **The farm is in a barn.** Whatever the channel is, it has to survive having
  no signal at the moment the problem happens, which is frequently the same
  moment.
- **The person reading the ticket is a model.** That is not a limitation to
  work around; it is the design constraint that makes everything else simple.

---

## 2. The Shape

### S1 — The bundle is machine-first. Human readability is not a goal.

A ticket body is structured data with a stable key order and a schema version,
not prose. Nobody is skim-reading these; they are being parsed, diffed against
a previous occurrence, and used to locate a line of code.

That inverts the usual bug-report advice and it is the right inversion here.
"Steps to reproduce" written by a person standing in a coop with cold hands is
a worse artefact than the queue depth, the last four engine errors, the schema
version and the rejected-mutation reasons — all of which the device already
knows and none of which anybody has to type.

**One human line survives**: the issue title, and whatever the farm chose to
say. Everything else is for the machine.

### S2 — Two bundles, and the second one is opt-in by name

> *"Do you want to send your farm data along with the ticket to help develop
> the correction?"*

**The lean bundle always.** Structure and counts, never content: app version,
platform, schema version, migration position, queue depth, mutation counts by
entity, rejected reasons, engine error signatures, storage backing, a hashed
org id for correlating repeat reports. No email, no farm name, no coordinates,
no record contents. This is enough to diagnose most defects, because most
defects are about *shape* rather than about what a hen laid on Tuesday.

**The farm's records only if asked for, and only if answered yes.** Some
defects cannot be found without the data — a due row computed wrong, a cost
figure that disagrees with the log, a migration that mangled a field. For
those, the farm can choose to send what it has, and the prompt says plainly
what it is for.

Default is no. The question is asked at the moment a ticket is raised, not
buried in a settings toggle, and the answer applies to that ticket only.

### S3 — The issue body is the bundle

Tickets arrive as GitHub issues on the repository. The body is the lean bundle
inline, in a fenced block, machine-first. The title is one line a person can
scan in a list.

**Why issues rather than a support inbox:** the fix happens in the same place.
An issue can be read, reproduced, branched from, fixed, linked to a PR and
closed by the commit — with no transcription step between the report and the
work. A support inbox would mean copying every ticket into an issue by hand,
and the copy is where detail is lost.

### S4 — The farm's data rides as a secret gist, linked from the issue

When the farm says yes, the records go to a **secret gist** and the issue links
it. Two reasons, and the second is the load-bearing one:

1. A GitHub issue body is capped at 65 KB. A farm's records are not.
2. **The issue stays readable.** A ticket whose body is four megabytes of JSON
   is a ticket nobody opens, and the lean bundle is what gets read first
   anyway.

A secret gist is unlisted and unindexed rather than access-controlled, so it is
a URL that must not be published — which is acceptable for a farm that opted in
and unacceptable as a default, which is exactly why S2 makes it opt-in.

### S5 — The repository goes private before Play

**Until it does, the opt-in half must be refused server-side.** A public
repository means every issue body is world-readable, and a farm cannot
meaningfully consent to that on a prompt in a barn.

The gate lives on the server rather than in the app, because the app cannot
know a repository's visibility and a build that shipped before the change would
be wrong forever. One environment variable, and the route declines the data
half with a reason the app can show.

### S6 — A ticket is queued locally and survives everything

Tickets are held on the device until they can be sent — the same promise the
mutation queue makes, for the same reason: the farm is in a barn and the
problem happened *now*.

**Not in the mutation outbox.** A ticket is not a farm record: it does not sync
between a farm's devices, it does not belong to the org's history, and it must
not be replayed onto the server as an entity. It gets its own local table, the
way the weather cache does — never in the outbox, never on the wire as a
mutation.

### S7 — The channel must not depend on the thing most likely to be broken

**This is the failure mode that makes support loops useless**, and it is
circular: if what is broken is sync, then a ticket that travels over the sync
transport cannot leave either. The device with the most to report is the one
that can report least.

So there are two ways out, and the second exists precisely for that case:

1. **The API**, `POST /support` — the ordinary path, queued and retried.
2. **The share sheet** — the same bundle, out through the OS, into whatever the
   farm has: a message, a mail client, a note. It needs no server, no account
   and no signal beyond whatever the app they share into uses.

The second is not a fallback that fires automatically. It is a button that says
what it is, because a farm whose sync has been failing for a week needs to be
able to *choose* the other door rather than wait for a retry that will not
succeed.

---

## 3. Dedup, which is what makes this survivable

**One device in a crash loop must produce one issue, not four hundred.**

Every bundle carries a **fingerprint**: a hash over the parts of the failure
that identify it rather than describe this instance — the error signature, the
route or screen, the schema version, the app version. Not the timestamp, not
the org, not the queue depth.

On arrival the server looks for an open issue with that fingerprint:

- **Found** → add a comment with the new bundle and bump a count in the title
  or a label. The issue accumulates evidence rather than multiplying.
- **Not found** → open a new issue, labelled with the fingerprint.

A fingerprint that is too specific produces the flood this is meant to prevent;
one too loose merges unrelated defects into a single unreadable thread. When in
doubt it should be too specific — a duplicate issue is an annoyance, and a
merged pair of unrelated bugs is a wrong fix.

**Rate limiting is per device and per fingerprint**, not global: one farm
having a bad morning must not silence another farm's first report.

### The listing lags, and that broke this twice

Both times the loop was used in anger it produced duplicate issues, and the
second cause is not the first.

**#95 and #96** — two held reports arriving a second apart, both searching,
both finding nothing because neither had created its issue yet, both creating
one. Check-then-act across a network round trip. Fixed by serialising filings
per fingerprint.

**#113 to #116** — five held reports, drained *sequentially*, still four
issues. The single-flight was working perfectly. `GET /issues?labels=` is a
**listing**, and GitHub's listings are eventually consistent: a just-created
issue is absent from them for roughly five to twenty seconds. The fifth report,
twenty seconds after the fourth, found its issue and commented — which is what
identified the window.

Ordering our own calls cannot fix this, because the staleness begins *after*
the create returns — the exact moment we know the issue number and the listing
does not. So the server remembers what it opened, keyed by repository and
fingerprint, and prefers that over asking. The number is then **checked rather
than trusted**, by reading the single issue (strongly consistent, unlike the
listing): §3 wants an *open* issue, so a defect that was closed and reported
again opens a fresh one.

The memory is in-process and deliberately so — the tracker is the durable
record, and a restart falls back to a listing that has long since caught up.

> **The suite passed through both.** The fake tracker indexed an issue the
> instant it was created, so it was more consistent than the real service and
> tested a race that could not happen. A fake that is kinder than production is
> not a test. `tests/unit/support-filing.test.ts` lags by default now, and the
> caught-up case is the one that has to be asked for.

---

## 4. What is deliberately not in this

- **No crash reporter SDK.** Sentry and its kind are excellent and would mean a
  third party holding a farm's stack traces, a second consent conversation, and
  a dependency on somebody else's free tier. The app already has
  `reportTrouble` and `reportEngineError`; what was missing was a way off the
  device, not a way to catch.
- **No automatic sending without consent.** Even the lean bundle is sent
  because somebody pressed a button. An app that phones home about its own
  failures without being asked is an app that will eventually phone home about
  something else.
- **No screenshots.** They are the least informative artefact per byte in this
  system, and they are the one most likely to contain a farm's data by
  accident.
- **No "steps to reproduce" field.** See S1. The farm can say whatever it likes
  in one free-text line; asking for a methodology from somebody holding a
  bucket produces an empty box or an apology.

---

## 5. Where it lives

| Piece | File | Rule |
|---|---|---|
| The bundle, the fingerprint, the ticket shape | `packages/contracts/src/support.ts` | S1, S2, §3 |
| Assembling one on the device | `apps/mobile/src/support/collect.ts` | S1, S2 |
| The local queue (table, port, store) | `packages/core/src/db/` — migration **v5**, `tickets` | S6 |
| Sending, holding, retrying, and the share text | `packages/core/src/support/tickets.ts` | S6, S7 |
| The screen and the consent question | `apps/mobile/src/screens/SupportScreen.tsx` | S2, S7 |
| The route | `apps/api/src/routes/support.ts` | S5 |
| Filing on GitHub | `apps/api/src/support/github.ts` | S3, S4, §3 |
| Configuration | `apps/api/src/env.ts`, `.env.example` | S5 |

Four things worth knowing that are not obvious from the design:

- **A `Due.done.label` is the one route by which a farm's own words could reach
  a lean bundle.** `TodayScreen` reports a failed log as ``reportTrouble(
  `recording ${done.label.toLowerCase()}`, error)``, and `where` goes into the
  bundle and into the issue title. Every label in the app today is a constant,
  so nothing leaks — but nothing enforced it, and a builder that one day wrote
  ``label: `Fed ${group.name}` `` would put a farm's herd name on a public
  issue tracker silently. `tests/unit/support.test.ts` now checks both builders
  that produce a `done`, with sentinel names.

- **The fingerprint contains the schema version**, so migration v5 itself
  changes the fingerprint of every defect a migrating device reports. That is
  correct — a fault at one schema version is plausibly a different fault at the
  next — but it does mean this migration splits any issue thread that was open
  across it.
- **`hash64` is FNV-1a rather than anything from `crypto`.** Hermes has no such
  global; there is a lint rule about it because that exact assumption once
  shipped.
- **`markTicketSent` nulls the records column.** A farm's whole database sitting
  on the handset a second time, indefinitely, after it has already reached
  where it was going, is a copy nobody asked to keep.

### Not built, deliberately

- **No client purchase of anything, and no account required.** The route is
  unauthenticated; see the header of `routes/support.ts`.
- **Retries are not on a timer and not driven by the sync loop.** A ticket
  about a broken sync must not be retried by the machinery it is about. The
  support screen opening is the retry trigger, because somebody walking to it
  is the honest signal that the situation may have changed.

---

## 6. Open

- **Where the secret-gist URL lives** so it is not lost if the issue is
  transferred to another repository.
- **Retention.** A gist of a farm's records should not outlive the fix, and
  nothing currently deletes one.
- **Whether a fix can be reported back to the device that raised the ticket.**
  Closing the loop properly means the farm learns their report mattered, and
  there is no channel to tell them — the same gap §1 opens with.
- **Rate limiting is per address, not per fingerprint.** §3 asks for per device
  and per fingerprint; the route has the blunt version, and the device-side
  queue is what currently keeps an honest farm well under it.
- **Nothing has been on a handset yet.** The share sheet in particular is a
  native intent, and §6 of the roadmap exists because every serious bug in this
  project so far has been one only a device could show.
