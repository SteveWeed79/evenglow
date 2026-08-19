# What has not been considered

**August 2026.** A sweep of every document in `docs/`, the contracts, both apps
and the workflows, looking for the opposite of what those documents do well:
not what is unfinished, but what has never been written down at all.

This is not a roadmap and it is deliberately not ordered by priority. It is a
list of blind spots, and a blind spot ranked is a blind spot somebody has
already started arguing about instead of reading.

**How to read it.** Every item is something no document in this repository
raises — not a known TODO, not a deferred decision, not something in
`ROADMAP.md` §"deliberately not on this list". Where a thing is *half*
considered, the item says which half. Where an item is a decision rather than
work, it says so: several of these want one paragraph of prose and no code, and
those are the cheapest items on the list.

**What this list is not.** It is not a claim that any of it should be built.
`Evenglow-Masterplan.md` §"Explicitly Out of Scope" and `ROADMAP.md`'s refusals
are decisions, and several items below will rightly be refused the same way.
The point is that a refusal is a decision and silence is not — right now most
of what follows is silence.

**Two caveats on accuracy.** Statutory items name the rules as they are broadly
understood and every one of them needs checking against the jurisdiction the
first farms are actually in; treat them as "find out", never as legal advice.
And where an item asserts something is absent, it means absent from `main` on
16 August 2026 and absent from `docs/` — not that nobody has ever thought it.

§19 is the other half of the honesty: the things checked and found already
covered, listed so they are not raised again as gaps.

**§20 onwards is a second sweep**, run after the first was written and using
different lenses — the code rather than the documents, version skew, the seams
between subsystems, the physical conditions of a yard, and what happens to the
farms if the person running this stops. Items 151–207. It also records the two
draft findings that did not survive checking, because a gap analysis that only
reports its hits is not one.

---

## 1. Law, licence, and the store — the ones that can stop a release

D13 puts this app on Google Play. Everything in this section is a Play or legal
condition of that, and none of it appears in `ACCESS-AND-BILLING.md`, which
otherwise plans the billing down to the refusal copy.

1. **There is no privacy policy.** Play requires a policy URL for any app that
   handles personal or sensitive data, and this one handles location, an email
   address, a Google identity and a farm's records. Nothing in the repository is
   one, and nothing links to one. **This is a launch blocker and it is prose.**

2. **There are no terms of service, and no EULA.** What the farm is owed, what
   it is not, what happens to its data if the service stops, and what liability
   is disclaimed. See §2 for why the disclaiming half matters more here than in
   most apps.

3. **The Play Data Safety declaration has never been drafted.** It is a form
   about collection, sharing, retention and deletion, filled in per data type,
   and it must match what the app actually does. Two things here are easy to
   declare wrongly: the support bundle's opt-in half sends a farm's records to
   **GitHub**, and the weather path sends coarse coordinates to **a US
   government service**. Both are third-party sharing, both are undeclared, and
   an inaccurate declaration is an enforcement matter rather than a rejection.

4. **There is no account-deletion path, in the app or on the web.** Play requires
   both for any app with account creation: in-app deletion, plus a web URL
   reachable without installing the app. `deleteOrgIfEmpty` exists as a
   housekeeping call at logout; a user-initiated "delete my account and my
   farm's data" does not, and neither does the URL. **Launch blocker.**

5. **Nothing decides what happens to a deleted or lapsed farm's data on the
   server.** How long records are kept after deletion, whether backups are
   purged with them (they are not — an encrypted `mongodump` in S3 will hold a
   deleted farm until the retention window rolls), and what a lapsed
   subscription's data costs to keep forever. "Reading is never gated" is
   settled and right; "kept for how long, at whose expense" is not asked.

6. **A subject access request has no answer.** Export hands a farm its records;
   it does not tell a *person* what the system holds about them — their email,
   their role history, their name against every log line, the support tickets
   they raised. Under UK/EU rules this is a thirty-day obligation with a
   defined shape.

7. **The lawful basis and the processor chain are undocumented.** Oracle Cloud
   (the box the records sit on), AWS S3 (backups, once configured), GitHub
   (support bundles and gists), Google (sign-in and Play billing),
   api.weather.gov and the US Census geocoder. Each is a processor or a
   recipient; none is named in a document a farm could read, and there are no
   data-processing agreements on file.

   **This list used to begin "MongoDB Atlas (US)", and that is no longer where
   the records are** — the database was moved onto the box and the cluster
   deleted. The correction matters more here than anywhere else in this file:
   the processor list is what the privacy policy and the Data Safety
   declaration are built from, and an inaccurate declaration is an enforcement
   matter rather than a rejection. Naming a data processor that holds nothing
   is exactly the kind of wrong that survives review and fails an audit.

8. **Play requires an App Bundle for new apps, and the pipeline builds an
   APK.** `apk.yml` produces and signs `homefarm-<version>-<code>.apk`, which
   is exactly right for the shelf at `/app` and cannot be uploaded to Play as a
   new app. The AAB path is a second Gradle task and a second artefact, and it
   has not been built or tested once.

9. **Play App Signing changes the signature, and the shelf depends on the
   signature.** Uploading to Play means Play holds the app signing key and
   re-signs; the certificate a Play install carries is then *not* the one
   `ANDROID_CERT_SHA256` pins. `PICK-UP-HERE.md` §3's rule — one route per
   device, because a mismatched signature forces an uninstall and an uninstall
   takes the farm — becomes a rule about Play versus the shelf, and nobody has
   worked out which install a farm should have or how one migrates to the other.

10. **The Play Console account itself is unstarted and has a waiting period.**
    A personal developer account created recently must run a closed test with a
    minimum number of testers for a minimum continuous period before production
    access is granted, plus identity verification whose address may be
    published. That is weeks of calendar time, not a task, and no document
    counts it. Verify the current numbers — they have changed twice.

11. **Target API level and the 16 KB page-size requirement are unchecked.**
    Play enforces a target level within a year of the latest Android release,
    and native code must support 16 KB memory pages for recent target levels.
    Expo 57 and RN 0.86 are new enough that this is probably fine — but "probably
    fine" about a rejection reason is exactly the shape of the four APK runs in
    `PICK-UP-HERE.md`.

12. **The EU trader declaration, and whether the EU is a distribution target at
    all.** Play requires trader status for consumer distribution in the EU, with
    a published address. Since the weather half is United States only, the honest
    answer may be to restrict distribution — but that is a decision nobody has
    made, and it interacts with §8's zone systems and §12's metric-first farms.

13. **Nobody has cleared the name.** "Steading" as an app name on Play, as a
    trademark, and against the several farm products already using the word.
    Cheapest to find out before the icon, the splash, the domain and the
    typography all carry it.

    **Checked 19 August 2026, and the answer is the bad one.**
    `brechy.com/apps/homefarm` is a pre-launch page for an app called
    **Steading**, by **Brechy LLC**, described as *"the only app that manages
    your entire homestead — livestock, gardens, orchards, and all the tasks that
    keep it running"* — and it argues the name the same way this project does:
    *"Steading (n.): Scottish for farmstead. Now, an app for yours."* Same word,
    same product, same reasoning, arrived at independently.

    **What is known:** they have not launched (the page collects a waitlist),
    they are a formed company, and no trademark filing for them was found —
    though the trademark databases were unreachable from the environment this
    was researched in, so that last point proves nothing. **What is not known:**
    which side used the name publicly first.

    **The decision has a hard deadline and an asymmetric cost.** A Play package
    name is permanent from the first upload; a display name is about eleven
    lines (`app.json` plus ten strings in `apps/mobile/src`) and changeable at
    any release. The 371 files carrying `@homefarm/*`, the `homefarm-{orgId}.db`
    filename and the `homefarm://` scheme are internal and never need to move.
    So this is cheap until the first AAB goes up and expensive-to-impossible
    afterwards — which puts it *before* `[10]`'s first upload rather than
    alongside it.

    Nothing else found is a conflict: `THE STEADING CODEX` (99877285, Web
    Production Labs LLC, pending) covers homehomefarm books and retail, not
    software; the word is a dictionary term with farms, a wine and a brewing
    channel already on it. **The conflict is this one product, and it is total.**

    ### The new name is **Evenglow**

    Decided 19 August 2026, after about a hundred candidates. Clear on Google
    Play, checked in the store itself. No exact trademark found; `EVENGLO`
    (Fort Howard Paper, 1930, paper goods) is the nearest and is another century
    and another class away.

    **What the standard actually is**, because it drifted during the search and
    the drift was wrong: a name does not have to be unused. Dove is soap and
    chocolate. The test is whether it is taken **in software**, taken **in
    farming**, or taken **in both at once** — and only the third forces a
    rename. Steading fails the third. Nothing else considered did, which means
    several candidates were retired here for search noise rather than conflict.

    **Known and accepted about Evenglow.** *Even* reads to most Americans as
    *level* rather than *evening*, which is why "even glow" is a skincare phrase
    (Pureance, skinbetter both sell one). It is also phonetically close to
    `EVENFLO`, the baby-products brand, and to Everglow — several companies and a
    K-pop group. None of that blocks anything; it means the store listing does
    the explaining, which is a communication cost taken with open eyes.

    ### What the rename touches — audited 19 August, not yet carried out

    **Config, and the only irreversible part:** `app.json`. `name` becomes
    `Evenglow`; **`slug` and `scheme` deliberately do not move** — the slug is
    bound to `extra.eas.projectId` and the scheme is in every OAuth redirect
    URI, and neither is visible to a farm.

    **The package is `dev.swbuild.homefarm`, not `com.evenglow.app`** — the
    publisher and the category rather than the brand. A package name is
    permanent from the first Play upload, so it is the one identifier that has
    to survive a change of name, and **this project has already had a name
    taken out from under it by somebody who reached it independently.** Evenglow
    is clear today; so was Steading, until somebody looked. Putting the brand
    inside the permanent thing would mean the next collision costs the install
    base rather than a display name. Decided 19 August 2026, overruling the
    `com.evenglow.app` in the first draft of this audit.

    **It reaches further than `app.json`** — twenty-eight references across
    fifteen files, all of them genuinely about package identity: the adb lines
    in `apk.yml`, `publish-apk.sh`, `deploy.sh`, `apk-check.mjs` and the three
    Windows `.bat` helpers, `GOOGLE_PLAY_PACKAGE` in `env.ts` and
    `.env.example`, and five test fixtures.

    **They are one constant now**, `PRODUCT_NAME` in
    `contracts/src/product.ts`, because finding all of them took an audit and
    the next rename should not. **This audit itself missed six of them** — it
    counted `apps/mobile` and `apps/api` and never looked in `packages/core`,
    where `restore.ts` says *"That file is not a Steading backup"* twice,
    `db/errors.ts` names the app in a version refusal, `support/tickets.ts`
    titles every support ticket, and `weather/provider.ts` puts it in the
    User-Agent sent to an external API. Twenty in total, not fifteen.

    **User-visible strings, and the app is the smaller half.** Three in
    `apps/mobile/src` — `Boot.tsx`'s accessibility label and its *"Steading could
    not start"*, and `ExportScreen`'s share-sheet title. **About fifteen on the
    server**, which nobody had counted: the six copies of *"That email already
    has a Steading account"* across `auth.ts` and `members.ts`, `EMAIL_TAKEN` in
    `contracts/verification.ts`, *"No Steading account uses that Google address
    yet"*, the mail subjects *"Your Steading reset code"* and *"Confirm your
    Steading email"* with their bodies, three on the ops page, and the support
    gist description. **The farm reads the server's words more often than the
    app's**, so a rename that stops at `apps/mobile` leaves the old name in every
    email the product sends.

    **Four things are load-bearing and must not be renamed casually:**

    1. **The APK filename.** `apk-plan.mjs` builds `homefarm-<version>-<code>.apk`
       and `deploy.sh` decides whether the shelf is current by comparing against
       exactly that stem — it strips a literal `homefarm-` prefix and looks for
       `/var/lib/homefarm/dist/homefarm-<version>-<code>.apk`. Renaming the
       artefact makes every box re-fetch ninety megabytes, which is the trap
       `DEPLOY-THE-SERVER.md` already recorded once. Either leave the artefact
       name alone or change both sides in one commit and accept one re-download.
    2. **The systemd units and paths** — `homefarm-api`, `homefarm-deploy.timer`,
       `homefarm-backup*`, `/etc/homefarm`, `/opt/homefarm`, `/var/lib/homefarm`.
       Invisible to any farm, and renaming them is a box migration rather than an
       edit. Leave them.
    3. **The EAS slug.** `extra.eas.projectId` is bound to the slug; changing one
       without the other breaks `eas build`. The runner path (`apk.yml`) does not
       care, but the EAS fallback does.
    4. **`check-assets.mjs`** prints the expected `app.json` block with
       `assets/icon/homefarm*.png` in it, so renaming the asset files means
       updating that checker's guidance in the same commit.

    **Deliberately staying `homefarm`:** the 371 files carrying `@homefarm/*`
    workspace names, the `homefarm-{orgId}.db` filename, and the internal
    database name. No user, reviewer or store listing ever sees them, and
    churning them buys nothing but risk.

14. **There is no business entity, and billing needs one.** Play payouts, tax
    identity, VAT/sales tax on a $39/year subscription, and the invoice a farm
    may want for its own books. Play handles collection and remittance in most
    markets; it does not handle being a payee.

15. **The bundled reference data has an open licensing question that
    `BREED-AND-PURPOSE.md` §5 names and leaves open.** Listed here because it is
    the one legal item that *is* documented — and it is documented as unanswered,
    which means it is still in the path of a release.

## 2. What the app tells a farm to do, and who is answerable for it

This is the section with the least written about it and the most exposure. The
product computes windows that decide whether food enters the human chain.

16. **There is no "not veterinary advice" disclaimer anywhere.** The app
    computes an egg and meat withdrawal window, warns about heat stress at
    specific temperatures, schedules worming, and counts down to a processing
    date. Every one of those is a health decision presented as arithmetic. The
    disclaimer is two sentences and its absence is the largest unpriced risk in
    the repository.

17. **Withdrawal periods are entered, and nothing checks them.** The engine is
    correct about the arithmetic and knows nothing about the drug. A keeper who
    types 7 days for a product with a 28-day egg withdrawal gets a confident
    green screen. Options exist — a small vetted table for common products, a
    "confirm against the label" step, a warning on suspiciously short windows —
    and none has been considered.

18. **The medication record is missing the fields a statutory medicine book
    needs.** Batch or lot number, expiry, supplier, prescribing vet, quantity
    administered, identity of the animals treated, and who administered it.
    Most jurisdictions require these and require retention for years. Right now
    the app is close enough to a medicine book that a farm will use it as one,
    and short enough that it will not stand up as one — which is worse than not
    offering it.

19. **Nothing states a retention floor for medicine and treatment records.**
    `ROADMAP.md` correctly refuses the yearly-purge idea partly on these
    grounds; the positive half — "these are kept for at least N years and the
    app will not help you delete them" — is not written.

20. **A2.10's correction mechanism can take back a treatment.** That is right for
    a mistyped egg count and it is a different question for a medicine record
    with a live withdrawal on it. Nothing distinguishes them.

21. **The heat, cold and THI thresholds are asserted with no cited source.**
    They are good numbers and the reasoning in `ROADMAP.md` §4 is sound. They
    are also the numbers a farm will act on at 35 °C, and a one-line provenance
    field per threshold costs nothing and settles it.

22. **Nothing covers what the app does if it is wrong.** No mechanism to
    correct bad bundled data on devices already in the field — the library is
    copied into a farm's own records at pick time, deliberately (§5 of
    `DOMAIN-SCOPE.md`), which means a wrong grow-out figure is now in every
    farm that picked that breed and no later version can reach it.

## 3. The update path — there is not one

23. **Sideloaded installs have no updater at all.** A farm installs from
    `https://api.swbuild.dev/app` and Android will never tell it there is a
    newer build. No `expo-updates`, no in-app version check against the shelf,
    no notice. Every farm not on Play is frozen at whatever it installed until
    somebody remembers to visit a URL.

24. **The server cannot require a minimum client version.** P1-1 in
    `SYNC-INTEGRITY-TODO.md` handles an old client meeting an unknown *entity*;
    nothing handles an old client that must be upgraded — no `426`, no
    `minClientBuild` in a response, no way to say "this build cannot sync until
    it updates". Given envelope versioning accepts N−1 only, this is the
    mechanism that stops a three-release-old handset from silently failing.

25. **Nothing tells a farm an update exists, let alone why it matters.** A
    security fix and a new icon look identical from a barn.

26. **There is no rollback.** A bad release reaches the shelf and the only route
    back is building the previous tag again and having every farm reinstall —
    which, per §1 item 9, may not install over what is there.

27. **`allowBackup: false` is set, and its consequence is unstated.** A device
    restored from a Google backup comes back with no farm. That is the correct
    setting for invariant 6 and a defensible one; the farm needs to be told, and
    the local backup file (§12 of the roadmap) is the answer that should be
    named beside it.

28. **Nothing checks that the shelf's APK is what was built.** No published
    hash, no signature instructions for the person sideloading it, and the
    install requires enabling "install unknown apps" — a permission a farm turns
    on once and forgets, having been trained to by this product.

## 4. Time — clocks, zones, and the day boundary

There is **no timezone handling anywhere in this codebase**. Not a wrong
implementation: none. This is the largest purely technical gap on the list.

29. **A "day" is never defined.** Egg tallies, feed logs, harvests and history
    all group by day; `Date.now()` is UTC and `setHours(0,0,0,0)` is the
    device's current zone. A 6am log in the US Mountain zone is the previous day
    in UTC. Whether a day boundary is the device's, the farm's, or the server's
    has never been decided, and the answer changes every number the app shows.

30. **Daylight saving breaks fixed-millisecond arithmetic.** `DAY_MS` is
    86,400,000 in `withdrawal.ts`, `frost.ts` and `due/tasks.ts`. Across a DST
    transition a seven-day window lands an hour early or late, which is
    harmless for a frost date and is not harmless for the hour at which a
    withdrawal is declared clear.

31. **The device clock is trusted locally, and it is the only clock.** D6
    correctly refuses to trust `clientTs` on the server. On the device, the due
    engine, the withdrawal countdown and every "today" is derived from a clock
    the farm can set. A handset with a wrong date shows a cleared withdrawal
    that is not cleared, offline, with nothing to contradict it. A sanity check
    against `serverTs` at flush is cheap and is not there.

32. **A farm that moves zones, or straddles one, has no story.** So does a
    keeper who travels — the tablet in the barn and the phone in another state
    disagree about what "today" is, and both write to the same tally.

33. **Frost dates are month-day pairs with no year rule at the wrap.** A first
    frost in December and a last frost in March describe one winter across two
    years; the arithmetic has to pick a year and nothing documents which.

34. **Nothing records the zone a record was written in.** With it, any of the
    above can be reconstructed later; without it, a decision made now cannot be
    revised — the information is gone.

35. **Daylight itself is unmodelled.** Sunrise, sunset and day length drive when
    chores happen, when layers slow down, and whether supplementary light is
    worth running. The forecast is fetched from a service that could supply it.

## 5. Failure modes on the device that nobody has modelled

36. **A full disk is not handled.** Photos at 200–400 KB, a growing SQLite file,
    and no free-space check before capture. `FileSystem` can report free bytes;
    nothing asks. The failure lands as a SQLite write error inside a
    transaction that also enqueues a mutation — which is invariant 5's territory
    and has never been exercised against a genuinely full device.

37. **SQLite corruption has no path back.** No `PRAGMA integrity_check` on open,
    no recovery, no user-visible "your database is damaged". On a free-tier
    single-device farm, that file is the farm. The local backup exists (§12);
    nothing prompts anybody to take one, and nothing detects the moment it is
    needed.

38. **There is no journal or checkpoint policy.** WAL versus delete, checkpoint
    size, and whether a `VACUUM` ever runs after two years of archived rows.
    Defaults may be fine; nobody has said so.

39. **There is no error boundary in the React tree.** One thrown render in one
    screen takes the whole app to a red box or a blank screen, in a barn, with
    no way to report it — the support screen is behind the same tree.

40. **Nothing catches a crash the user did not survive to report.** The support
    loop is entirely user-initiated. An app that crashes on launch, or during
    the first flush, produces no bundle and no ticket, and that is precisely the
    crash worth having. A crash log written to SQLite on the next successful
    launch would close it without taking a third-party SDK, which invariant 12
    and the privacy posture would both object to.

41. **Native crashes and ANRs are invisible.** Play Console reports them for
    Play installs and reports nothing for the shelf.

42. **OEM battery managers kill backgrounded apps.** Sync triggers on resume, so
    the design mostly dodges this — but a flush interrupted by the OS mid-batch
    is the restart case, and the restart tests kill the process at a chosen
    moment rather than an arbitrary one.

43. **Process death mid-form loses typed work.** Android reclaims a backgrounded
    app freely; a half-filled treatment or planting form has no saved state.
    Everything logged is a transaction, and everything *being typed* is not.

44. **Photo capture has no failure story.** Camera permission refused after
    being granted, storage refused, the picker returning a file the manipulator
    cannot read, or the app killed between capture and the SQLite row. The
    cache directory is documented; the interrupted case is not.

45. **EXIF is not explicitly stripped.** `expo-image-manipulator` re-encodes,
    which drops it in practice — but a photo of a barn carrying GPS coordinates
    is exactly the data §4 rounds to a kilometre on purpose, and "in practice"
    is not a test.

46. **Cellular data is never considered.** Photo upload over a metered
    connection with no wifi-only setting, on a farm with a data cap. A 92 MB APK
    download from the shelf has the same problem.

47. **Nothing measures cold launch.** The 2s target in the rubric has never been
    observed on a low-end device, and the app now opens a database, a theme, a
    font set, an SVG icon set and a due engine before it draws.

## 6. The server, treated as something that has to stay up

48. **There is one box, one database, and no failover.** Documented as a cost
    decision and correct at this scale. What is not written: what a farm sees
    when the box is down (they keep logging, which is the whole point — but the
    sync chip's copy for a multi-day outage has not been designed), and how long
    an outage can last before a queue at the 100-per-batch cap becomes a
    problem.

49. **Nothing watches the box.** No uptime check, no alert, no page. `/health`
    exists and nobody is subscribed to it. The first notice of an outage is a
    farm's, and their route to reporting it travels over the thing that is down
    (S7 anticipates exactly this for the app; not for the server).

50. **The restore has never been run.** Named as a condition of the first farm
    in `ACCESS-AND-BILLING.md` §4.1a-i and still true. Listed here for the part
    that is *not* in that note: nobody has decided the RPO or RTO. Nightly means
    up to 24 hours of records lost, which for a twice-daily tally is a day's
    work and for a medicine record may be more than that.

51. **The `age` private key is a single point of total loss.** Backups
    encrypted to a keypair whose private half lives in one password manager. If
    it is lost, the backups are noise. No documented second copy, no recovery
    drill.

52. **The keystore is the same shape of risk and one degree worse.** It is now
    backed up (16 August), and losing it means never being able to update any
    installed copy of the app again, by any route. Worth an explicit second
    location and a note saying why.

53. **Secret rotation has no procedure.** `AUTH_SECRET` rotation invalidates
    every session at once, which for an offline-first app means every device
    silently stops flushing until somebody signs in again — in a barn, without
    the password. A rotation needs a dual-secret verification window and there
    is no code for one.

54. **DNS is a single vendor with no monitoring.** The GoDaddy zone, the
    `swbuild.dev` renewal, and a certificate that auto-renews only as long as
    both are right. An expired domain takes sync, the shelf and the support
    route together.

55. **There is no dependency vulnerability process.** No Dependabot, no audit
    step in CI, no SBOM, and no license inventory beyond the bundled fonts —
    which are handled properly, and are the only thing that is.

56. **Nothing enforces a per-org storage quota.** Documented as uninstrumented
    for pricing; the operational half is that one farm uploading video fills
    **the box's disk** for everybody, and the failure reaches every other farm
    as rejected mutations. *(Written against a 512 MB managed tier, which is
    gone. The shape is identical and the headroom is tens of gigabytes rather
    than half of one, so this moved from near-term to eventual — not from real
    to imaginary. A disk with no quota still fills.)*

57. **Mongo connection limits are unconsidered.** Nothing documents the pool
    size or what a burst of devices flushing after an outage does to it. *(The
    free managed tier's 500-connection cap was the original worry; a local
    `mongod` sets its own ceiling and the API is a single process, so the
    question is now about the pool, not the tier.)*

58. **No load test, ever.** Not a criticism at three farms. It becomes one the
    first time a snapshot of a ten-year farm meets a slow connection, and the
    number nobody has is how long that response takes to build.

59. **Log retention and content are undecided.** What Fastify logs, for how
    long, whether a payload ever reaches a log line, and who can read them. A
    log with a farm's records in it is a copy of the database with none of the
    protections.

## 7. Security questions not yet asked

60. **There is no app lock.** A tablet in a farmhouse kitchen is a shared
    device. No PIN, no biometric, no lock on the settings that could delete a
    farm. `expo-local-authentication` exists and is not a dependency.

61. **A lost or stolen device cannot be cut off.** Refresh tokens rotate and can
    be revoked server-side on logout; there is no "sign out my other devices"
    and no device list. The tokens are in `expo-secure-store`, which is the
    right place — and on a rooted device, that is a weaker claim than it sounds.

62. **Rooted and emulated devices are not considered.** No detection, and
    probably correctly none — but the decision belongs in a document beside D4
    rather than nowhere.

63. **The join code's brute-force surface is unanalysed.** Six characters, ten
    minutes, single use is a good shape; the missing half is a per-org attempt
    limit and what an attacker gets by grinding codes across every org at once.

64. **Photo access control has never been isolation-tested against the derived
    key.** `blobsFor(orgId)` is the seam and §4A.1 says the S3 key is derived
    from `{orgId}/{photoId}` — meaning a bug in the derivation is a cross-tenant
    read. The tests exist for GridFS; the successor's conformance run does not.

65. **Nothing rate-limits sync per org.** Rate limiting fails open for
    authenticated sync by design (A9), which is right. A compromised or
    malfunctioning client hammering `/sync` is the case that design does not
    cover, and the batch cap bounds a request rather than a rate.

66. **The support gist has no lifecycle.** Named in `SUPPORT-LOOP.md` §6 as
    outstanding. Adding here what that note does not: a secret gist is
    unlisted, not private, and a URL in a closed issue outlives the fix.

67. **There is no security contact, no disclosure policy, and no `SECURITY.md`.**
    A researcher who finds something in a public repository has nowhere to send
    it but a public issue.

## 8. Accessibility and reach

The field-usability rules in `UX-SPEC.md` are strong — contrast, tap targets,
gloves, sun. They are about a specific person in a specific condition, and they
are not the same as accessibility.

68. **Font scaling is never handled.** `allowFontScaling` is never set and the
    type scale is fixed in tokens. A farm running Android's largest font size
    gets clipped labels — the rail has already clipped its words twice on
    arithmetic that said they would fit, at the default scale.

69. **Screen-reader flow has never been walked.** Labels exist on most
    components, which is the easy half. Reading order, focus after navigation,
    the Tally's announcement as a number changes, and whether the withdrawal
    banner interrupts are the half that decides whether it works.

70. **Colour alone carries meaning in places.** Due states and the sync chip
    lean on amber and green. Deuteranopia is 8% of men, and this is a product
    for a demographic that skews that way.

71. **One-handed reach is designed for and never tested.** R3 puts primary
    actions in the bottom third; nothing has verified the reach on a 6.7"
    handset held in a glove.

72. **The app is English-only, in one dialect, with no plan.** Not just strings:
    the species vocabulary, the collective nouns, the breed library, the variety
    library, the zone systems and the weather provider are all Anglophone and
    mostly US. The doors for zones are open by design (`{ system, value }`);
    nothing else is.

73. **Numbers and dates are formatted by hand rather than by locale.** A metric
    farm gets the units switch, which is the hard half. The decimal separator,
    the thousands separator and the date order are the half that makes an app
    feel foreign to everybody outside one country.

74. **RTL is untested and probably broken.** Consequential only if §12's
    international question is answered yes; cheap to keep possible and expensive
    to retrofit.

75. **Literacy and numeracy are unaddressed.** The comprehension rubric —
    "an untrained person logs a full day with no instruction" — is the right
    goal and it is stated for a reader. Icons carry no text alternative in some
    places, and the voice, which is deliberately warm and wordy, is the opposite
    of what a low-literacy user needs.

## 9. Input, in a barn, with gloves on

The whole UX spec is built around this problem, and three of its best answers
have never been raised.

76. **Voice input is not considered anywhere.** "Twelve eggs from the big coop"
    at 6am, one-handed, in the dark, with a torch in the other hand, is the
    single best fit for speech that this product has, and Android's recogniser
    is free and on-device for short phrases. `packages/core/src/voice.ts` is
    about prose voice, which is how thoroughly this has not been thought about.

77. **Barcode and QR scanning is unconsidered.** A medicine bottle's barcode
    into a treatment record, a QR sticker on a machine that opens its screen, a
    join code as a QR rather than six typed characters, a seed packet's barcode
    into a variety.

78. **Electronic ID for livestock is unconsidered.** EID tags are mandatory for
    sheep in much of the world and common on cattle. Stick readers pair over
    Bluetooth and speak a documented protocol; an animal record that cannot
    accept the tag number a farm is already legally required to carry is doing
    the typing twice.

79. **NFC is unconsidered.** A tag on a coop door or a machine that opens the
    right screen removes the entire navigation problem for the most repeated
    task on the farm.

80. **Bluetooth peripherals generally.** Livestock scales and weigh crates —
    which write directly into the `weight` entity that already exists — milk
    meters, and incubator or coop temperature probes.

81. **Widgets, tiles and lock-screen entry.** A home-screen tally widget is the
    shortest possible path to the app's core action, and Android's quick
    settings tile is the second. Both were raised for the retired Capacitor
    client (`NATIVE-PIVOT.md`) and neither survived into the React Native plan.

82. **Wear OS is unconsidered.** Probably rightly, and it is the one platform
    where a gloved hand and a running tally genuinely fit.

83. **Hardware keys and external keyboards.** A tablet in a farm office with a
    keyboard case is a real setup, and nothing handles tab order, enter to
    submit, or escape to close.

84. **Printing is unconsidered.** A medicine board for the wall, bed labels,
    a service history for the machine's folder, a tally sheet for the days the
    phone is not in the barn. Paper is not a failure of the app; it is where the
    app's output has to live sometimes.

85. **Calendar export is unconsidered.** Due rows as an ICS feed put the farm's
    year in the calendar the family already shares, and it is a read-only,
    server-free, one-way export that breaks nothing.

## 10. Form factors and hardware

86. **Foldables and multi-window are unconsidered.** `LANDSCAPE-PLAN.md` handles
    width classes well and stops at the window; a fold, a hinge, or a
    split-screen resize mid-form is a different event.

87. **Desktop modes are unconsidered.** Samsung DeX and Android's freeform
    windowing put this app on a monitor with a mouse.

88. **`supportsTablet: false` is set for iOS.** Fine while iOS is deferred; it
    contradicts a landscape layout built for tablets, and it will be missed when
    iOS happens.

89. **Screen orientation is `default`.** So the phone rotates too, and every
    phone falls on the narrow side of every branch — meaning a rotated phone
    gets the compact layout in a landscape window, which nothing has looked at.

90. **Chromebooks run Android apps** and are common in rural schools and
    offices. Untested, and the input assumptions above are all wrong there.

## 11. The animal domain

91. **Grazing and pasture management is absent.** Beds exist for growing;
    paddocks do not exist at all. Rotational grazing, rest days, stocking
    density, and which field a group is in this week are the central daily
    decisions on a ruminant holding, and the app cannot record where an animal
    is.

92. **Hay, silage and stored forage are not modelled.** Bales cut, bales fed,
    bales left, and the winter arithmetic every ruminant farm does in October.
    `feedLog` and `feedPlan` cover bought feed; forage is a stock that is
    produced, stored and consumed on the same farm.

93. **Water is entirely absent.** Troughs, tanks, rainwater harvesting,
    irrigation, and a freeze warning that already fires for it without anything
    to attach to. Water is the one input a farm cannot skip for a day.

94. **Animal movement records are absent.** Where an animal came from, where it
    went, and when — statutory in most of the world (holding numbers, movement
    documents, standstill periods) and useful everywhere. The schema has an
    `acquiredAt` and no counterpart.

95. **Statutory identifiers have nowhere to live.** A holding or premises number
    for the farm, and an official tag or passport number for the animal, as
    distinct from the farm's own name for it.

96. **Fallen stock disposal is not recorded.** Mortality records the death; the
    legally required part is what happened to the body and who collected it.

97. **Quarantine of incoming stock is unmodelled.** "Integration timelines" are
    named in the masterplan feature list; a quarantine period with an end date
    is a due row that does not exist.

98. **Processing day has no record.** Grow-out counts down to it and stops.
    Live weight, dressed weight, yield, the batch that went, and what came back
    — which is the number that makes the whole meat-purpose feature worth
    keeping, and the one place `mortality`'s cull weights nearly reach.

99. **Feed conversion is not derived** even though both halves are recorded.

100. **Beekeeping is one field deep.** `productionLog` carries honey; a hive,
     an inspection, a queen, a varroa treatment and a winter weight are the
     actual record a beekeeper keeps.

101. **Working and companion animals fall between the cracks.** A livestock
     guardian dog gets wormed, gets vaccinated, and is not stock. `companion`
     and `guarding` are purposes on a *flock*.

102. **Biosecurity is unaddressed.** Visitor logs, housing orders during avian
     influenza, and notifiable disease reporting are the compliance surface
     that arrives suddenly and applies to exactly this size of farm.

103. **Nothing tracks where an egg or a carcass went** — which is the
     traceability half of the medicine record, and the reason the withdrawal
     feature exists at all.

## 12. The growing domain

104. **Irrigation is absent.** Scheduling, what was applied, and the rainfall
     that means it was not needed. The forecast knows rain is coming and no
     watering decision consumes it.

105. **Soil is absent.** Tests, pH, amendments, fertiliser applications and a
     fertility plan. Rotation is modelled by family, which is the pest and
     disease half; the nutrient half is the other reason rotations exist.

106. **Compost and manure are absent.** A closed-loop smallholding's main
     fertility input, produced by the animal half of this same app.

107. **Spray and pesticide records are absent, and they are statutory.**
     Product, registration number, rate, area, date, operator, weather at
     application, and re-entry interval. `DOMAIN-SCOPE.md` says the withdrawal
     machinery covers harvest intervals — which is the *harvest* half. The
     record-keeping half is a legal obligation with a defined field list.

108. **Seed is not modelled.** Seed inventory, viability by age, saved seed,
     and what was ordered for next season. A variety is a thing you can plant;
     seed is the thing you actually have.

109. **Germination and propagation are skipped.** Trays sown, germination rate,
     potting on, and hardening off — the six weeks between "sown" and
     "transplanted" where losses actually happen.

110. **Perennial and orchard work is absent.** Pruning, grafting, chill hours,
     thinning, and a fruit tree's decade-long record. A `planting` that never
     ends is modelled; the annual work on it is not.

111. **Protected growing has one boolean.** `bed.covered` drives the frost
     warning well. A polytunnel's own record — venting, heating, a minimum
     temperature — is a different thing.

112. **Foraging, mushrooms, sap and other enterprises** do not fit the four
     entities and have no home. `ENTERPRISES` is `stock | growing | iron` — the
     three halves of the app, not a list of what a farm produces — so there is
     not even a slot to widen.

113. **Weeds, pests and disease observations have no home** other than a free
     note. A photo and a date against a bed is how a grower learns their own
     ground, and it is the growing half of the threat log the animals already
     have.

## 13. Iron, and the buildings the animals live in

114. **Buildings and infrastructure have no register.** Coops, barns, fences,
     gates, water lines and the generator. `equipment` assumes a machine with
     an hour meter; a fence has neither and still needs a maintenance interval
     and a repair history. This is the largest single omission in the iron half.

115. **Fuel is not logged.** Diesel, petrol and propane bought and burned. Cost
     per hour of machine time is the number a farm actually wants and both
     inputs nearly exist.

116. **Tool and small-equipment inventory is unmodelled.** `inventory` is parts
     and consumables; what was lent to a neighbour is the classic loss.

117. **Warranties and registrations are not tracked.** A purchase date, a
     warranty expiry and a serial are three fields and one due row.

118. **Storage readiness is named in `DOMAIN-SCOPE.md` §3.2 and unbuilt.**
     Listed here only because it is the one item in this section that is
     already written down.

## 14. The farm as a business

119. **Nothing records what left the farm.** Cost tracking is deliberately
     bounded to cost-per-egg, and that boundary is a decision. The consequence
     is not stated anywhere: with costs and no sales, the app can tell a farm
     what it spent and never whether it made anything. A single append-only
     "sold" event — count, price, date — stays far short of accounting and
     completes every ratio the app already computes. Worth deciding out loud.

120. **Labour is not recorded.** Hours worked, by whom, and against what. The
     data is nearly there — every log carries its author.

121. **The Schedule F export is named and its categories are unmapped.** An
     export that an accountant has never looked at is a claim, not a feature.

122. **Insurance and valuation have no record.** Herd value, machinery value,
     policy numbers and renewal dates. The photo evidence a claim needs is
     already in the app.

123. **Grants, subsidies and certification schemes are unconsidered.** Organic
     certification in particular is a record-keeping obligation this app is
     three fields away from satisfying, and it is the one thing that would make
     a certified farm switch to it from a shoebox.

124. **Multiple farms, holdings or enterprises under one owner** — refused for
     users deliberately and never asked for sites. Whether one org can hold two
     `site` records with different frost dates is not documented, and a farm
     with a home plot and a rented field is common.

## 15. People, and what happens to a farm over time

125. **There is no owner transfer.** An owner cannot hand the farm to somebody
     else. If the owner dies, leaves, or sells the holding, the records are
     inside an account nobody else can reach — and the last owner cannot be
     demoted by design, which is right and makes this worse.

126. **There is no guest or time-limited role.** A vet, a contractor, a
     neighbour feeding the animals for a fortnight, or a buyer looking at a
     machine's history. Owner/Admin/Hand covers people who stay.

127. **The audit trail is not visible to the farm.** Every record carries its
     author server-side. No screen shows who changed what, which is what a farm
     wants the moment two people disagree about a count.

128. **Offboarding is a disable, and the person's own copy is not addressed.**
     A removed hand's device still holds a full SQLite copy of the farm until
     somebody signs them out of it, and nothing revokes at the device level.

129. **Nothing handles a farm that stops.** Records after the last animal is
     sold: a read-only archive, an export reminder, or silence. Silence is the
     current answer and it is not deliberate.

## 16. Data at scale, and over years

130. **Every list in the app is a `ScrollView`, and there is no `FlatList`
     anywhere.** `Screen` scrolls, and screens render their rows into it. That
     means every row of a ten-year history is mounted at once, on a low-end
     handset, with no virtualisation and no test that would notice. It is the
     right choice for a tally and the wrong one for History, and nothing marks
     where the line is.

131. **A snapshot for a ten-year farm has never been built or timed.** The
     cursor is there; the size of the first page for a farm with photos is not.

132. **The rollup question is open in the masterplan and unanswered.** Named
     here because everything in this section depends on the answer.

133. **Charts over multi-year ranges are unconsidered.** The graphs are built
     for week, month, quarter, year. A five-year lay curve is the question a
     farm keeps records for.

134. **Search does not exist.** Not across notes, not across records, not across
     machines. At year one nobody misses it; at year three the app holds
     thousands of rows and only offers browsing.

135. **Bulk operations are unconsidered.** Archiving a season, moving a group,
     correcting a week of logs entered against the wrong flock. The correction
     mechanism is per-record by design; a wrong flock selected on Monday and
     noticed on Friday is ten corrections.

## 17. What the tests do not reach

136. **No end-to-end test runs on a device or emulator.** 134 test files and
     none of them drives the app. `ROADMAP.md` rule 3 says device-only defects
     are a gap in the suite rather than bad luck, and the suite has not changed
     shape since.

137. **No screenshot or visual regression test.** The two rail defects were
     found by a human looking at one screenshot.

138. **No layout engine in the suite** — stated in `PICK-UP-HERE.md`, repeated
     here because it means every width branch above 600dp is untested by
     anything but a tablet somebody has to hold.

139. **No property-based or fuzz testing of the sync engine.** Idempotency,
     ordering and restart are tested with chosen sequences. The engine's
     correctness claims are universal and the evidence is a handful of examples.

140. **No clock-skew or DST test.** Follows from §4 having no implementation to
     test.

141. **No concurrent multi-device test.** Two devices flushing overlapping
     mutations for one org is the case P0-3's ordering work exists for.

142. **No performance budget or bundle-size gate in CI.**

143. **CI never builds or boots the container** — B-1, known, listed for
     completeness.

144. **No test asserts the accessibility tree**, so item 69 cannot regress
     visibly.

## 18. Knowing whether any of this works

145. **There is no analytics, and no decision not to have it.** The privacy
     posture implies the refusal and nothing states it. The cost is real:
     nobody knows which screens are used, where people abandon, or whether the
     comprehension rubric — the stated competitive differentiator — is being
     met by anybody but its author.

146. **There is no beta channel and no test farm but this one.** Play's closed
     track is a launch requirement (item 10) and would also be the first outside
     users this app has ever had.

147. **There is no in-app help, no FAQ, and no manual.** The support screen
     raises a ticket. A farm's first question is usually answerable and
     currently reaches a human or nobody.

148. **There is no way to tell a farm anything.** No message channel, no
     release notes in the app, no notice when a defect they hit is fixed —
     named as outstanding in `SUPPORT-LOOP.md` §6 and worth repeating because
     it is also the update problem (§3) and the outage problem (§6) wearing a
     third hat.

149. **There is no onboarding beyond first run, and no sample farm.** An empty
     app is the hardest one to evaluate, and a demo farm somebody can poke at
     and then discard is how most people decide whether to type in their own.

150. **Nobody has decided what success is.** Not revenue — the number of farms
     still logging in month six. Without it, every item on this list is
     prioritised by argument.

## 19. Checked, and already considered — do not re-raise these

Listed so this document is a gap analysis rather than a review of the docs.
Each of these looked like an omission and is not:

- **CSV import** — refused with reasons, `COMPETITIVE-ANALYSIS.md` §2.1.
- **PDF manuals, per-bird egg logging, a weather tab, incubation humidity,
  Google Drive backup, yearly email-and-purge** — all refused with reasons in
  `ROADMAP.md`.
- **Push notifications** — open question, `DOMAIN-SCOPE.md` §8.2.
- **iOS** — deferred with a route (EAS Build), masterplan §5.
- **Backups** — designed, scripted, scheduled, blocked on a bucket and an
  `age` key; restore untested and named as such.
- **Photo storage growth** — measured and documented in `PICK-UP-HERE.md`. The
  free-tier ceiling it was measured against no longer exists; the box's disk is
  the number now.
- **Reduce-motion** — implemented in `theme/motion.ts`.
- **Dark mode** — implemented, and the splash has both.
- **Multi-org membership** — refused structurally, with the reason.
- **Units, currency and integer storage** — settled, and better than most
  products manage.
- **Envelope versioning across a stale APK** — A8, and P1-1 for the entity half.
- **Rejected mutations, conflicts, and correction** — A5, A6, A10.
- **Cross-tenant isolation** — the mechanism, the lint rule and the suite.
- **The support loop's shape** — S1–S7, including its own open items.
- **Location privacy** — rounded to ~1 km on the way in, with a typed fallback.
- **Font licensing** — the Licences screen exists because of it.

---

---

# Second sweep

**The first pass swept the documents for absence.** This one swept the *code*,
and applied lenses the first pass did not have: what happens going backwards,
what happens where two well-built things meet, what happens in the physical
conditions the product is for, and what happens to the farms if the person
running this stops.

Two draft findings did not survive checking and are recorded here rather than
quietly dropped, because a gap analysis that only reports hits is not one:

- **The backup restore does guard its versions.** `backupRefusal` refuses a
  file whose format or mutation-schema version is newer, with a sentence saying
  why. It is better than the draft assumed — see item 152 for what it exposes
  instead.
- **`fly.toml` is not drift.** It is a documented alternative host with a header
  explaining its relationship to §4.1a's Oracle box, and `DEPLOY-THE-SERVER.md`,
  `OPERATOR.md` and `DESIGN-BRIEF.md` all name it.

## 21. Version skew — going backwards, and files from the future

151. **`migrate()` silently no-ops on a database from the future.** A
     `user_version` above `SCHEMA_VERSION` falls through every `continue` and
     the function returns as though it had worked. The app then runs against a
     schema it does not know: unfamiliar columns are harmless, and a `NOT NULL`
     column added by a later migration is an insert that fails at 6am. The
     migration runner is otherwise careful — each step in a transaction with
     its own version bump, for exactly the right reason — and this is the one
     direction it does not look in.

152. **The backup restore refuses a newer file and tells the farm to update the
     app, which is the one thing this product cannot do.** `backupRefusal` is
     correct and its two messages both end *"Update the app and try again."*
     There is no updater `[23]`, no store listing yet, and on the shelf route
     no notification that a newer build exists. The guard is right; the remedy
     it names does not exist, and that pairing is worse than either alone —
     it is a farm holding its own records in a file the app has told them is
     readable by a version they cannot get.

153. **`MUTATION_SCHEMA_VERSION` has never been bumped, so the envelope ladder
     has never run.** `migrate.ts` says so in a comment: *"Empty today."* A8's
     whole claim — a device offline three weeks across two releases syncs
     cleanly — rests on a mechanism with zero exercised steps, and the first
     bump is both the first test and a production event.

154. **No migration test starts from a real database file.** Migrations are
     tested as statements. Nobody has a v1 file written by a shipped build and
     walked forward to v7, which is the only test that catches a migration that
     is wrong about what the previous one actually produced on a device.

155. **The reverse skew has no rule.** N−1 is specified for a client meeting a
     newer server. A *newer client* meeting an older server — trivially
     reachable, since the box deploys on its own timer and an APK build takes
     thirteen minutes longer than the server half — is unspecified.

156. **A bad build has no route back at all.** Android refuses a `versionCode`
     downgrade, uninstalling takes the farm, `allowBackup` is off, and the
     database has no downgrade path. Item `[26]` names the release-side
     rollback; this is the device-side half, and it is the reason `[26]` is
     harder than it looks.

## 22. Seams — where two well-built things meet

157. **Google sign-in and Play App Signing will collide, in production, for
     everybody at once.** An Android OAuth client is keyed to the signing
     certificate's fingerprint. Play re-signs the app, so the fingerprint that
     must be registered is Play's, not the farm's key — and sign-in works from
     the shelf and fails from the store, or the reverse, depending on which
     fingerprint is registered. Both routes are meant to exist `[9]`, which
     means both fingerprints must be registered and nobody has established
     that. This is the sharpest item in either sweep.

158. **The Google OAuth consent screen needs verification, and unverified apps
     are capped.** Verification wants a privacy policy `[1]`, a verified domain
     and a review. Until then the app shows an unverified-app warning and is
     limited to a small number of users. It is a second queue with a calendar,
     alongside `[10]`, and nothing counts it.

159. **The nightly `mongodump` copies every photo, every night.** Photo bytes
     live in GridFS in the same database `blobsFor(orgId)` uses, so a full dump
     is a full copy of every image the farm has ever uploaded — encrypted,
     pushed to S3, and repeated tomorrow. The backup grows without bound, the
     window grows with it, and §4.1a prices the storage against *records*.
     Excluding the bucket, dumping it separately, or moving to incremental was
     never considered, and the S3-successor plan `[4A]` changes the shape of
     this rather than removing it.

160. **The forecast is United States only and the price is worldwide.** Play
     sells into whatever countries are enabled. A farm in Ireland pays $39 for
     an app whose forecast, official alerts and hardiness zones do not work
     where they live. Restricting distribution, or saying it on the listing, is
     a decision; charging for it silently is not.

161. **`forgetDatabase` is one of four things on that device.** Handing the
     tablet on also has to take the cached photo files, the queued support
     tickets in their own SQLite table, the secure-store tokens and any local
     backup file sitting in Downloads. C5 covers the database and the photo
     cache; the other two arrived later and nothing revisited the list.

162. **The local backup file is the whole farm in readable JSON, and it leaves
     through the share sheet.** Downloads, Drive, a chat app — wherever the
     farm sent it, unencrypted, indefinitely. That is the right default for
     recoverability and it has no warning and no optional passphrase, and it
     sits oddly beside a design that rounds coordinates to a kilometre on the
     way in.

163. **An export is not a complete copy, and does not say so.** Photo bytes are
     not in it. §12c covers the restore side of that gap; the export side means
     a farm that exports everything before wiping a device has not, in fact,
     got everything.

164. **The support bundle is content-free and the gist beside it is not.** S1 is
     scrupulous — structure and counts, a hashed org key, `.strict()` so nothing
     rides along. The opt-in half is then the farm's actual records, in a gist,
     with no expiry `[66]`. The join between the two is where the care in S1
     stops applying, and nothing says so.

165. **The shelf is served by the API.** `/app` hands out a 92 MB APK from the
     same Fastify process that serves sync, on a box whose egress is the free
     tier's. One scraper, or one farm on a bad connection retrying, competes
     with every farm's morning flush. Nothing rate-limits the download, caches
     it at an edge, or separates the two jobs.

166. **The join code and the invite solve the same problem with different
     security models**, and which one a farm should use is a UX decision
     nobody has written: `PICK-UP-HERE.md` §5 says "redeem it on the second
     device rather than signing in, if the aim is a second person" — which is
     the whole guidance that exists, and it is in a document that goes stale by
     design.

## 23. The physical world the product is for

The field-usability rules are the best-argued part of `UX-SPEC.md` and they are
about *seeing* and *reaching*. None of this section is about either.

167. **Capacitive touch does not work through wet or muddy gloves.** The entire
     rubric — 56px targets, gloved operation, five seconds to a logged egg
     count — assumes the tap registers. A wet glove does not register at all,
     and a wet *screen* registers taps nobody made. This is the physical
     precondition of every interaction rule in the spec and it is not mentioned
     once. It is also the strongest argument for voice `[76]`, which is the
     other thing not mentioned.

168. **Cold shuts phones down.** A lithium battery at −5 °C reports 40% and
     dies. The morning chores this app is designed around are the coldest hour
     of the day, and the app's answer to a dead phone mid-log is the same as its
     answer to anything else — the queue survives — which is true and is not the
     same as having thought about it.

169. **Rain, dust, and a dropped handset** are the ordinary condition of the
     yard. A rugged case changes the grip, which changes the reach assumptions
     in `[71]`, and a farm's device is likelier than most to be replaced
     mid-season — which is the continuity path `[27]` and `[162]` both touch.

170. **Maximum brightness in direct sun is the fastest way to empty the battery
     in item 168.** The contrast rules solve the seeing half and create the
     power half.

171. **There is no night mode, only a dark theme.** Lamplight is a beautiful
     dark palette and it is still a bright white-point screen in a dark barn at
     5am, which wrecks night vision and wakes the birds. A red-shifted mode is a
     genuine field feature and is a different thing from `userInterfaceStyle`.

172. **Machinery is loud and ears are protected.** Any audio feedback is
     useless in the one place iron is worked on. Haptics already carry
     confirmation, which means the app is accidentally right here — worth
     writing down as a rule so it stays right.

173. **One hand is holding something.** Not the phone — a bucket, a bird, a
     torch, a gate. The spec's one-handed reach requirement is about which
     thumb; the harder version is that the interaction may need to complete
     with no hands free at all, which again is voice.

## 24. Data quality at the point of entry

The app is excellent at *taking back* a wrong number (A10, and it is one of the
best-argued rules in the project). It does nothing to *prevent* one.

174. **No figure is checked for plausibility, anywhere.** Forty eggs from six
     hens, a 900 kg goat, a service interval of twelve hours, a harvest of two
     tonnes from a raised bed — all accepted in silence. A soft "that looks
     unusual, is it right?" is not a validation rule and does not block; the
     app's own thesis is that mistypes are a weekly event, and the entire
     response to that is downstream.

175. **The wrong-subject error has no defence and leaves no trace.** Logging
     against the group above the one intended, on a list of similar names, in
     the dark, is the likeliest mistake this app can absorb — and afterwards it
     is indistinguishable from a correct record. A confirmation that names the
     subject in the exhale — *"Twelve, in the big coop"* — costs nothing and is
     the one moment a person can catch it.

176. **The double-log is not detected.** The same tally entered twice at 6:02
     and 6:03, because the first did not look like it saved, is two records and
     a permanently wrong day.

177. **Nothing prevents duplicate entities.** Two groups called "Big coop", two
     machines with one serial number, two varieties of the same cultivar.

178. **Free text is not normalised.** "Big Coop" and "big coop " are two things
     forever, and the app's own search `[134]` — when it exists — will treat
     them as such.

179. **There is no undo on the screen that just wrote.** Correction is per
     record from the record's own screen, which is the right permanent
     mechanism and a slower gesture than the moment deserves.

180. **A farm hand's mistakes and an owner's are indistinguishable.** The author
     is recorded server-side and no screen shows it `[127]`, so the person best
     placed to spot a wrong entry cannot see whose it was.

## 25. Money, deeper than the price

`ACCESS-AND-BILLING.md` decides the number, the tier, the gate and the refusal
copy, and maps Play's states to three of its own with a good argument. What
follows is the mechanics underneath that map.

181. **Play auto-refunds a purchase that is not acknowledged within three
     days.** It is a server obligation, it is the single most common way a new
     Play Billing integration loses money silently, and the word
     "acknowledge" appears nowhere in this repository. The purchase flow is
     documented as unbuilt, which covers the *existence* of the work and not
     this deadline inside it.

182. **Restoring a purchase on reinstall is unspecified.** A farm that wipes a
     device and comes back must not have to buy again, and the entitlement is
     keyed to an org while the purchase is keyed to a Google account.

183. **Those two keys can diverge.** One farm with two Google accounts, or a
     farm sold with its org intact, breaks the join between purchase and
     entitlement in opposite directions.

184. **A price change needs consent, notice and a flow.** Play requires all
     three for existing subscribers, and the annual term `[4.3]` means the
     first one lands a year after launch, when nobody is thinking about it.

185. **Auto-renewal disclosure is regulated.** US state statutes and the EU
     withdrawal right both prescribe what the purchase screen says and how
     cancellation is reached. The copy is written with unusual care already;
     it has not been written against these.

186. **There is no refund position of our own** for the farm that pays and then
     cannot sync because the box was down for three days.

187. **Regional pricing is undecided.** $39 is a US number and Play's local
     defaults will produce figures that are absurd in some markets — which
     interacts with `[160]`, since the markets where the price is strangest are
     the ones where the weather half does not work.

188. **The entitlement direction of truth is unstated.** When Play says entitled
     and the server disagrees — a lost real-time notification, an unverified
     token — nothing says which side wins or how it reconciles. Given the sync
     gate is the only paid thing, the wrong answer locks a paying farm out.

189. **One tier is a decision that needs restating as the farm grows.** It is
     the right call and it is currently a fact about the code rather than a
     commitment, and `[119]`'s sales question is the first thing that will
     press on it.

## 26. The service as a promise

This product's entire pitch is that a record survives. Every item here is about
the farm's records outliving the person who wrote the app.

190. **The bus factor is one and it is undocumented.** Not a criticism of the
     work — a description of a risk that this specific product makes worse than
     most, because a farm is asked to trust it with a decade of records.

191. **There is no sunset commitment.** What a farm gets if this stops: a final
     build that works offline forever, an export window, and a promise the app
     keeps functioning without the server. The architecture already delivers
     every part of that — D9 and the offline engine mean the app is genuinely
     useful with the server switched off — and nobody has said so anywhere a
     farm can read.

192. **`OPERATOR.md` is commands, not custody.** A second person could run the
     day-to-day; they could not take over the keystore, the `age` key, the
     Oracle Cloud account that the box and its only copy of the records live
     in, the DNS registrar, the Play account or the Google Cloud project,
     because nothing lists them as things that have owners.

193. **Nothing covers a fortnight of illness during lambing.** The support loop
     assumes somebody reads the issues.

194. **The support load has no model.** One person, GitHub issues, and farms
     whose mornings break at the same hour. The dedup work `[S3]` is the only
     part of this that has been sized.

195. **Nothing says what happens to a farm's server data if the service ends.**
     It is the same question as `[5]` from the other direction and it is the one
     a farm would actually ask.

## 27. Found while reading the code

196. **`trend.ts` starts its week on Monday** — `(getDay() + 6) % 7`, which is
     ISO and correct — in an app that defaults to imperial, forecasts from the
     US National Weather Service and ships USDA hardiness zones. A US farm's
     weekly chart will disagree with every other calendar they own. It is one
     line and a setting, and it is the kind of thing that is free now and a
     data-comparison question later.

197. **The scroll belongs to `Screen`, which makes `[130]` a component change
     rather than a screen change.** Worth knowing before that work is scoped:
     every screen inherits the decision, so the fix is one place and the
     regression surface is everywhere.

198. **`SqlStalledError` is a named, well-argued diagnosis with nowhere to go.**
     It exists because a handset deadlock produces no message, no log line and
     no crash report — and it is not in the support bundle's error signatures,
     so the farm sees a failure and the author still gets nothing.

199. **A restore counts its refusals and cannot retry them.** `runRestore`
     reports how many records were refused and the first reason, deliberately
     continuing past each one. There is no second pass, so those records are
     lost from a file the farm still has.

200. **The backup filename is dated to the day**, so two backups taken on one
     day collide in most file pickers — which is exactly what a farm does on
     the day it is nervous enough to take two.

201. **`deviceId` is regenerated when unreadable**, with a comment saying it
     only groups sequences. That is probably right and it is the sort of
     "probably" that ordering invariants are made of: a fresh id restarts
     `clientSeq` at zero, and nothing has confirmed that a device which loses
     its id mid-life cannot produce two live sequences the server orders
     against each other.

## 28. The documents themselves

Eleven and a half thousand lines across twenty files, and they are the best
thing about this project. These are the gaps in them *as a set*.

202. **There is no index.** `CLAUDE.md` gives a reading order to a machine.
     A person arriving at `docs/` gets twenty filenames.

203. **Nothing checks the documents against each other, and drift has already
     produced one contradiction** — `ROADMAP.md:477` said backups were done
     while `PICK-UP-HERE.md` said they were not, caught by hand. A short test
     that greps for a handful of load-bearing claims is cheap.

204. **Decisions are numbered in seven different sequences** — D, P, A, B, C, R,
     S, W, N — across as many documents, with no map from a number to the file
     that owns it.

205. **Only `PICK-UP-HERE.md` declares its own staleness.** The others carry no
     date, no freshness expectation, and no marker for the sections that were
     true when written.

206. **There is no `CONTRIBUTING.md` and no path for a second developer**, which
     is item `[192]`'s other half and the cheaper half.

207. **There is no glossary.** Steading, flock-as-a-wire-name, tally, iron,
     plaster, worn, burrow, the arch, the exhale. A newcomer — or an
     accountant, or a vet, or the second developer — meets all of them
     undefined.

---

## What to do with this

**A running order exists: [`UNCONSIDERED-PHASES.md`](UNCONSIDERED-PHASES.md).**
It sequences all 150 items below into phases A–O, states the four dependencies
that are real and marks the rest as judgement. This list stays unordered on
purpose — it is the evidence, and the argument about priority belongs in one
file rather than in the margins of this one.

Four things are worth pulling out, and none of them is a feature:

1. **Items 1–4 and 8–10 are a launch blocker with a calendar attached.** A
   privacy policy, terms, a data-safety declaration, an account-deletion route,
   an AAB, and a Play account that must serve a waiting period before it can
   ship anything. None of it is hard and all of it is weeks.
2. **Item 16 costs two sentences** and is the largest unpriced risk here.
3. **§4 is one piece of engineering** — define the day, store the zone, stop
   doing calendar arithmetic in milliseconds — and every number the app shows
   depends on it.
4. **Item 157 is a trap with a delay on it.** Google sign-in is keyed to the
   signing certificate, Play re-signs, and both install routes are meant to
   exist. It works in every test you can run today and fails in production, for
   everybody, on the day the store route opens. It costs one registered
   fingerprint to avoid and a support inbox to discover.

Everything else is product, and product is what the roadmap is for.
