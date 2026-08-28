# Approved work

**The decided subset, as a checklist.** Everything here has been argued
somewhere else and agreed; this file is what to do, not why. The reasoning
lives in `UNCONSIDERED.md` (items `[n]`), `UNCONSIDERED-PHASES.md` (phases
A–P), `GAP-ASSESSMENT-REVIEW.md` (the outside assessment, checked) and
`SYNC-INTEGRITY-TODO.md` (the audit and its verification pass).

**Provenance is marked** so any line can be traced back and re-argued:

| Mark | Source |
|---|---|
| `[n]` | `UNCONSIDERED.md`, item number |
| **GA** | The August 2026 product gap assessment, verified against the code |
| **GA-c** | Same, adopted in changed form — the change is stated |
| **SI** | `SYNC-INTEGRITY-TODO.md`, carried rather than re-decided — §7 |

**What this file is not.** Not a roadmap and not an estimate. `ROADMAP.md`
still orders the product; the phases file still holds the dependency argument.
Nothing here is sized in hours, because shape is knowable and hours are not.

**Rejections are at the foot**, named with reasons, so the boundary of "agreed"
is unambiguous and nothing on the reject list gets quietly picked up later.

**There are three states, not two, and the third one used to be invisible.**
Approved is above, refused is at the foot, and the two together cover perhaps
forty of the two hundred and seven items in `UNCONSIDERED.md`. Everything else
is *undecided* — considered, written down, and not yet argued to a conclusion.
Silence in this file has never meant refusal, and the foot of it says so about
the reject list without saying it about the rest. **§8 names the undecided
clusters** so nobody has to infer their status from an absence.

**Checked against the code, 16 August.** Every unticked item below was re-read
against the source. Where the code contradicted the line, the correction sits
under the original wording and is marked *corrected 16 August*, so the claim
that was wrong stays visible rather than being edited away. Two ran the way
nobody expects — the clearing defect is live in shipped screens rather than
latent, and the reports item turned out to describe the opposite of the code.
Nothing already ticked was re-opened.

---

## 1. Fix now — verified defects

Each of these was confirmed by reading the code. Two are in files that comment
on the exact failure they then permit.

- [x] **The operations board was gated on a role farmers hand out.** **GA**
      Found while writing the script that would have granted the board to
      somebody — there was none, and building one surfaced why.
      `requireAdmin` checked `role === 'admin'`, and **`admin` is a farm role**:
      the manager an owner appoints on the Members screen.
      `assignableRoles('owner')` returns all three roles and
      `assignableRoles('admin')` returns `['admin', 'hand']`, so any owner could
      mint one and any admin could mint another, self-propagating. That account
      would have read **every farm on the server**, granted free sync to any of
      them, and minted unlimited subscription codes — cross-tenant escalation
      reachable from an ordinary farm screen, on the one surface `scoped()`
      deliberately does not protect. The suite's own header said *"the only
      thing between an owner and every other farm's numbers is the role
      check"*; it was, and the role was one farmers hand out.
      **Not remotely exploitable as deployed** — the board binds `127.0.0.1:3002`
      and nothing in the Caddyfile proxies it — which is the only thing that
      held it, and exposing the board is the whole point of having built it.
      **The fix is a separate fact, not a fourth role.** `operatorSince` on the
      user document, set by `pnpm ops:admin` and by nothing else: no payload
      schema, no `/members/:id/role`, not the access token. A farm's admin
      manages a farm; an operator runs the box; most operators are a plain
      `hand` on their own farm. Revoking it stops a board session in flight,
      because the board re-reads the row on every request — a property the
      previous PR added for a different reason, now doing a second job.
      **There was no way to grant it *in the codebase*** — `db:seed` creates an
      owner and nothing ever assigned `admin` — which is why the board had never
      been opened. `pnpm ops:admin` is the key, and `--list` answers "who else
      has this", because a grant nobody can audit is a grant nobody can revoke.
      **"No way to grant it at all" was the claim and it was wrong**, found by
      the audit of this commit rather than by writing it. `DEPLOY-THE-SERVER.md`
      documented a working grant the whole time — a raw `mongosh` `$set` of
      `role: 'admin'` — so the premise that nobody could already hold access was
      false, and that premise is what made this look like it needed no migration
      note. Two consequences, both now written into that page: a box whose
      operator followed it has an account that **silently stops working** at the
      board's sign-in, with a refusal indistinguishable from a wrong password;
      and the instruction **demotes the farm's only owner** to `admin`, leaving
      it with zero — unrepairable in-app, since `assignableRoles('admin')` is
      `['admin', 'hand']` and self-promotion is refused as `self`. The only
      reason that has probably not already happened is a third error in the same
      snippet: it hardcodes `getSiblingDB("homefarm")` while the box runs
      `homefarmdb`, so the write lands in a database nothing reads.

- [x] **Six defects from a read of the whole server.** **GA**
      A pass over all of `apps/api` after the mail and verification work.
      **The board's sweep panel could never say anything.** `startSweeper()`
      runs in the API process; the board is a separate systemd unit reading a
      module variable nothing in its process ever wrote, so it reported "no pass
      since boot" on every box for ever — the panel built because *"a silent
      journal and a broken timer look identical"* could not tell them apart
      either. `db/sweep-status.ts` is the durable row it reads now; the
      in-memory reading stays, because the two say different things.
      **The hourly sweep read the entire mutation log, per farm.** No index
      carried `outcome`, and `serverTs < an hour ago` matches nearly every row a
      farm has ever written — with normally zero pending rows, the pass walked
      and fetched the whole log to find nothing, at a cost that grows for as
      long as the farm keeps records. Measured against a 5,001-row collection:
      **5001 documents examined before, 1 after.** The index is partial on
      `outcome: 'pending'`, so it is empty almost all the time.
      **Two silent caps, both from a default argument nobody passed.**
      `findMany` limits to 200 and `sweepFarm` said nothing, so a farm with more
      stranded rows left the rest every hour; `sweepAllFarms` looped over
      `listOrgs()`, which caps at 200 newest-first — the loop written because
      *"a sweeper that silently covered one farm on a box holding two would be
      the quietest possible bug"* was that bug at two hundred. Paged on the
      `(serverTs, _id)` pair, because re-running the query loops for ever on an
      `unreadable` row; `listOrgIds` is unbounded; `capped` is reported.
      **`?since=` past the date range silently meant "from the beginning".**
      `new Date(1e30)` is an Invalid Date and BSON serialises one to **epoch 0**
      without complaining, so a bad cursor returned the farm's whole history
      while the caller believed it had asked for a point in the far future —
      on the one function whose docstring is *"Rejects a malformed cursor rather
      than defaulting it to everything"*.
      **`assertSafeUpdate` never looked at `$rename` destinations.** Every other
      operator names what it writes in its keys; `$rename` names it in the
      value, so `{ $rename: { name: 'orgId' } }` passed the tenancy guard. Not
      reachable today, which is the reason to close it rather than note it —
      that function exists so tenancy is a mechanism and not a rule to remember.
      **The board's two writing actions authorised from the token alone.**
      Invariant 8 inverted: an administrator demoted or removed kept free-sync
      grants and promotion-code minting for the fifteen minutes an access token
      lives. It re-reads the row now — not through `requireMutationClaims`,
      which also pins `orgId`, and the board is the one surface about no farm in
      particular.
      Every assertion was watched to fail against the code it replaced.
- [x] **The five the first pass reported and did not take.** **GA**
      **Nothing ever deleted a photo's bytes.** `Blobs.remove` was written with
      the store and had no call site, so archiving a photo set `archivedAt` and
      left the image in GridFS for good — a farm had no way to take a picture
      off the server at all. P13 still holds, because what P13 protects is the
      *record*: the row and the log survive, and the bytes are not a record but
      a picture of somebody's yard. **One-way, and named as one-way** — nothing
      un-archives today, and if that is ever built a restored photo comes back
      without its image. Removed **before** the `$set`, so a store that refuses
      leaves the record live, which is the truthful state.
      **`/billing/notifications` was unauthenticated, unthrottled and reachable
      from anywhere.** The state was never forgeable — the handler asks Google
      what a purchase is worth — so what was open was the cost: an outbound Play
      call and a write per request, unbounded. Now sixty a minute, an OIDC push
      token verified when `GOOGLE_PUBSUB_AUDIENCE` is set, and `packageName`
      compared against the configured one instead of parsed and ignored.
      **The limiter answers 429, and the first draft answered 200.** Writing
      the test inverted the argument: Pub/Sub retrying *is* the right response
      to being throttled, where a 200 says the notification landed and loses a
      real subscription change caught in a burst.
      **Uploaded bytes were never checked to be images.** Leading-byte checks
      for JPEG, PNG and WebP; a mismatch against the record's own type is
      refused rather than silently re-labelled, because the record is what every
      other device reads. `nosniff` on the way back out is the half that covers
      every record written before the check existed.
      **No security headers anywhere.** Hand-written rather than `helmet` — four
      static headers and a CSP, against a dependency whose own defaults would
      then have to be turned off one at a time. The board gets a real policy
      with a **per-response nonce**, so its inline script and style run and an
      injected one does not.
      **Eleven comments across seven files described a two-server world** that
      ended when the Next app was deleted, several of them justifying an
      extraction by a reason that no longer exists. Corrected to the reason that
      does: the seams are what made removing a whole server a deletion.
      **A seam was added to `billingRoutes`** because the notification route is
      deliberately silent — every outcome is a 200 — so "did a stranger make
      this server call the Play API" could not be observed at all. Four
      assertions passed against the ungated code before it existed.

- [x] **Seed `SiteSetupScreen` from the site record.** **GA**
      It opens on hardcoded May 15 / Oct 5 and writes them over the farm's real
      frost dates on save, stamped `source: 'entered'`. Silent, and every sow
      window, transplant date, autumn count-back, brooding date and cold-birth
      warning reads those numbers. *Fix before anything else on any list.*
- [x] **Hold produce indefinitely on an open treatment course.** **GA**
      `withdrawalClearsAt` counts from the first dose when there is no end date,
      which clears produce while the animal is still being dosed. Safe to do
      because `stillGoing` initialises `false` — only an explicitly-open course
      would hold.
- [x] **Ask for the real last-dose date when closing a course.** **GA-c**
      Not in the assessment. Closing stamps today, so a course finished Tuesday
      and closed Friday invents three days of withdrawal — the safe direction,
      still a wrong number in a record a regulator may read.
- [x] **Audit every edit screen for the merge-clearing class.** **GA**
      *Done for the half that can be done, and the audit found the pattern was
      wrong.* `EditGroupScreen` now always sends `purposes`, so removing the
      last one works. See the item below for the rest.
- [x] **Give the wire a way to say "clear this field".** *(found while fixing
      the item above; built 16 August)*
      **Done.** `contracts/clearing.ts` is the mechanism: `null` at the top
      level of an update payload means *remove this*, `updateSchemaOf` makes
      exactly the omittable fields accept it — never a required one, never one
      with a default — the applier splits the payload into `$set` and `$unset`,
      and `db/project.ts` deletes the key rather than storing a null, so no
      reader ever meets a value its schema forbids. A create still refuses null
      outright. The three screens that were losing clears now send them.
      **One consequence, named rather than discovered later:** the log carries
      the null, so a device still running the previous build projects it into
      its own record, where its create schema will not parse it and the reader
      drops that one row until it is upgraded. It is the ordering `mutation.ts`
      already sets out for a widened entity list — server first, then clients —
      and this is the cheapest week it will ever be, with one farm and no store
      release. It is also the first concrete case for the minimum client version
      in §6.

      *The diagnosis, kept as it was written, because the shape of the bug is
      the reason the contract change looks the way it does:*
      `TreatmentScreen`'s established fix — name every optional field, with
      `undefined` where it is now absent — **clears the device and never
      reaches the server.** `JSON.stringify` drops an `undefined` value, so the
      mutation arrives at `apply.ts` without the key and its `$set` leaves the
      old value standing: the device reads cleared, the server reads unchanged,
      and the next snapshot puts it back. An empty array or string survives the
      journey, which is why `purposes` was fixable and `breedId`, `bornAt` and
      `processAtWeeks` were not.
      **Needs a JSON `null` meaning "clear", mapped to `$unset` in the
      applier** — a contract change, deliberately not swept in with the defect
      fixes. Until then those fields keep the conditional spread, because
      consistently stale beats silently divergent.
      **Wider than filed, and it is not only latent** *(corrected 16 August)*.
      The three fields named above are the ones nobody has a screen for yet.
      The ones that ship today:
      - **`task.completedAt`.** The *Need to redo this* confirm on
        `JobsScreen` sends `{ completedAt: undefined }` — a button a farm
        presses whenever somebody ticks a chore they had not actually done.
        The tick clears on that handset and nowhere else: every other device
        on the farm goes on showing the job done, and a rehydration replays
        the log and marks it done again on the handset that undid it.
      - **`medication.reason`, `dose`, `withdrawalDays`, `treatmentEndsAt`.**
        `TreatmentScreen`'s own `cleared` object — the pattern this item is
        named after. A withdrawal revised down to nothing frees produce on the
        handset that revised it while the server and every other device go on
        holding it. The two answers disagree about a record a regulator may
        read, and the lenient one is the one in the hand of the person deciding
        whether to sell.
      **Two comments in `packages/contracts` assert the mechanism that does not
      happen**, and both will mislead whoever does this work: `namesOneSubject`
      and the note above `mergedUpdateProblem` each say a client clearing a
      field sends `undefined` and the driver stores it as null. No such value
      arrives — `JSON.stringify` dropped the key before it left the handset.
      Implementing `null` → `$unset` makes those two sentences true for the
      first time, and they should be corrected in the same commit rather than
      read as a description of today.
- [x] **Filter breeding records by group.** **GA**
      `names` is built from every animal on the farm, so the filter means "the
      dam exists here" rather than "the dam is in this group".
- [x] **Build the mail sender, and password recovery on top of it.** **GA** —
      *designed:* [`PASSWORD-RECOVERY.md`](PASSWORD-RECOVERY.md), *built 17
      August*
      `mail/send.ts` is the port, `db/password-resets.ts` the codes,
      `/auth/forgot` and `/auth/reset` the routes, and the recovery form sits
      behind a *Forgotten your password?* link on sign-in — two steps on one
      screen, because somebody doing this is already stuck and a second
      navigation is a place to get lost.
      **Three departures from the design, each written into it** rather than
      left as a difference somebody discovers: two providers behind the port
      instead of one (the cost analysis weighed scale, not floor, and at a
      handful of messages a month the monthly minimum is the whole bill);
      superseded rather than deleted rows; and no `html` part, because nothing
      needed one and an unsent branch is an untested path.
      **The supersede change was a real bug its own test found.** Deleting the
      previous row left exactly one row however many times somebody asked, so
      the per-account limit — the anti-harassment one §5 calls easy to forget —
      counted to one and never fired.
      **The timing assertion was wrong before it was right**, which is worth
      recording because §11 names it as the one people skip: the first version
      built a Fastify app per request, so construction swamped the argon2
      difference and it passed with the floor deleted. It now injects into one
      app and fails when the floor goes.
      **Still open and it is yours, not the code's:** `EMAIL_FROM` has no
      default, so mail is off until the sending identity is decided — see the
      next item.
      There is no password reset; `AccountScreen` says so in a comment, and
      recovery means a shell on the server. **The deliverable is a sender, not
      one flow** — it also finishes the invite feature, which binds a token to
      an email address and has never had anything to send it with, and it opens
      `[148]` and `SUPPORT-LOOP.md` §6. A code the person types, not a link, on
      phishing and cross-device grounds. Postmark behind a `sendEmail` port.
      **SPF, DKIM and DMARC are part of the work, not follow-up** — large
      providers reject unauthenticated mail outright now, so getting the DNS
      wrong is a farmer who never receives their code.
- [ ] **Decide what domain Steading's mail comes from.** *(raised by the design
      above)*
      The domain is `swbuild.dev` and the app is called Steading. A password
      reset from a domain the farm has never heard of is indistinguishable from
      phishing, and ignoring it is the correct user response. Cheaper to settle
      before the sending DNS exists than after.
- [x] **Verify email addresses at signup.** `PASSWORD-RECOVERY.md` §10, **GA**
      Password signup accepts whatever is typed; only the Google path carries
      `email_verified`. Harmless while an address does nothing — and once an
      address can receive a password reset, a typo at signup is a recovery
      route that reaches a stranger.
      **The gate is one line in `/auth/forgot`:** an address nobody has proved
      they can read is sent nothing. Silently, like every other refusal there,
      because answering differently would say which accounts are unconfirmed.
      **It is not what verification first looks like it buys**, and the
      difference is written into `contracts/verification.ts`: a stranger who
      receives a misdirected code can confirm the address and then reset
      through it, exactly as they could have reset directly. What changes is
      that the *default* is closed rather than open, and that the farm is told
      — which is the half that actually prevents the damage, since what stops
      a typo is somebody reading their own address back.
      **So correcting the address is part of the work, not a follow-up.**
      Without `/auth/email` a typo at signup is recovery permanently off with
      no in-app remedy, which makes the feature a trap rather than a guard. It
      moves an **unverified** address only — an unproved string asserts
      nothing, so swapping it discloses nothing — and asks for the account
      password even so, because a stolen session alone must not point an
      account at an inbox the thief controls. Moving a *verified* address needs
      the old one to confirm the move and is deliberately not built.
      **Google arrives confirmed, where the address is the same one.**
      `verifyGoogleIdToken` refuses a token without `email_verified`, so asking
      again would be theatre that leaves recovery off. That was written when
      linking was unconditional and it is narrower now: signup confirms because
      Google supplied the address, and the in-session link confirms only when
      `normalizeEmail(identity.email)` equals the account's — connecting a
      personal Google account under another address is ordinary and proves
      nothing about the farm's own. The unauthenticated link branch confirms
      nobody: it refuses an unproved account outright (H1).
      **Existing accounts are not backfilled.** Dating the flag from the row's
      creation would be it asserting something nobody demonstrated, which is
      the one thing it exists to stop. They confirm when they next open the app.
      **A real bug its own test found:** the change-of-address route relied on
      the unique index alone to refuse a taken address, and the suite's database
      has no indexes applied — so a second account onto the same address
      answered 200. A production box would have refused, which is the worst
      shape for a defect. The explicit check is back, the index stays as the
      race guard, and neither is load-bearing alone.
      **`passwordResets` had no index at all**, found on the way past. Both code
      tables are read three ways and every one leads with `userId` — including
      the per-account send limit, which runs on the timing-sensitive route whose
      whole design is that a real address and an unknown one are
      indistinguishable. Thirty days past expiry, so a run of rows stays
      readable as the record of somebody being locked out.
- [x] **Verify units on Harvest and reporting.** **GA**
      *Confirmed true and fixed.* `HarvestScreen` offered pounds to everybody
      and converted with `poundsToUg` whatever the farm had set. The entry
      units moved to `contracts/units.ts` so `WeighScreen` and this one read
      one table.
- [x] **Finish photo restore re-upload.** `ROADMAP.md` §12c, **GA** — *built 16
      August*
      Restored metadata retained its uploaded flag, so bytes the server does not
      have were never re-sent. `restore.ts` now drops `uploadedAt` from a photo
      payload as it restores it — photo-specific and named as such, since every
      other entity wants its payload back exactly as it was — so the transfer
      loop sees a photo whose bytes are not up yet and the device still holding
      the file offers them again. The restore panel says out loud that the
      pictures come back only from a phone that still has them.
      **Still open, and it is the interesting half:** the rehearsal nobody has
      run — build a file on a device that has synced photos, wipe the server,
      restore, and watch the bytes arrive. And `ACCESS-AND-BILLING.md` §4.1a-i
      is now wrong in the app's favour and wants the correction §12c asks for.

- [x] **`deploy.sh` deleted any Caddy site block added by hand.** **GA**
      *(found by the audit above; pre-existing, not introduced by it)*
      Every deploy re-renders `/etc/caddy/Caddyfile` from the repository's
      single-site template and `install`s it over the running file. So the
      `ops.example.com` block `DEPLOY-THE-SERVER.md` offers as the alternative to
      an SSH tunnel **cannot survive a deploy** — it is gone within five minutes
      of the next `homefarm-deploy.timer` tick, with `reloaded for ${DOMAIN}` as
      the only trace.
      **And the domain is read with `head -1`**, off the running file:
      `sed -n 's/^\([a-z0-9.-]*\) {$/\1/p' | head -1`. An operator who
      *prepended* the ops block rather than appending it gets the API's Caddyfile
      rendered for the ops hostname — every handset offline, reported as a
      successful reload.
      **The include, and a refusal rather than a guess.** The template now ends
      its preamble with `import /etc/caddy/conf.d/*.caddy`; both `setup-box.sh`
      and `deploy.sh` create that directory and neither ever writes into it, so
      a local block survives every tick. Absolute path deliberately — Caddy
      resolves a relative import against the file it appears in, and the deploy
      validates a rendered copy in `/tmp`, so a relative one would look in the
      wrong directory at exactly one of the two moments. `*.caddy` rather than
      `*` because Caddy's globbing includes dotfiles and would hand it an
      editor's swap file. An empty glob is not an error, which is what makes it
      safe to ship to every box at once.
      **The `head -1` half is not worked around, it is refused.** Two site
      blocks means the box predates `conf.d` and the deploy does not know which
      name is the API's — so it keeps a copy at
      `/etc/caddy/Caddyfile.local-blocks.bak`, says which blocks it found and
      what to do, and **leaves the Caddyfile alone**. A config that stops being
      updated is a real cost and it is the smaller one: bounded by one manual
      step, loud every five minutes until somebody takes it, and it cannot take
      a farm's server offline.
      **Tested by running the shipped shell**, not by restating it —
      `tests/unit/caddy-deploy.test.ts` lifts the decision block out of
      `deploy.sh` with `sed` and drives it against all three file shapes. Five
      of its ten assertions fail against the code they replaced, including both
      hazards: the appended block being deleted, and the prepended one causing
      the API's config to be rendered for the board's hostname.

## 2. Start on the same day — the only work with a calendar attached

None of this gets shorter by being started later, and two items are a waiting
period rather than a task.

- [ ] **Open the Play Console account and enrol the closed test.** `[10]`
      Production access is granted at the end of a fixed testing period.
- [ ] **Start Google OAuth consent verification.** `[158]`
      A second queue. Unverified apps are capped and show a warning screen.
- [ ] **Register both signing fingerprints for Google sign-in.** `[157]`
      Play re-signs, so the certificate an OAuth client is keyed to differs
      between the store route and the shelf. Passes every test available today
      and fails in production, for everybody, on the day the store opens.
- [ ] **Write the privacy policy.** `[1]` — also a prerequisite for both queues.
- [ ] **Write the terms of service and EULA.** `[2]`
- [ ] **Write the "not veterinary advice" line and place it.** `[16]`
      Settings, and beside the withdrawal banner. Two sentences.
- [x] **Clear the name — it did not clear, and the name is now Evenglow.**
      `[13]` — checked 19 August 2026. **Brechy LLC has a pre-launch page for an
      app called Steading**, same product and same "Scottish for farmstead"
      pitch (`brechy.com/apps/homefarm`). They have not launched; they are a
      company and this project is not one yet (`[14]`). **Decided: the app
      becomes Evenglow.** The rename itself is not done — see §3.
- [x] **Carry out the rename to Evenglow.** **GA**
      **The package is `dev.swbuild.homefarm`, not `com.evenglow.app`** — the
      publisher and the category rather than the brand. A package name is
      permanent from the first Play upload, so it is the one identifier that has
      to survive a change of name, and this project has already had a name taken
      out from under it by somebody who reached it independently. Evenglow is
      clear today; so was Steading. Overrules the first draft of `[13]`'s audit.
      **The brand is one constant**, `PRODUCT_NAME` in
      `contracts/src/product.ts`, so the next rename is a line rather than an
      audit. Twenty user-visible strings read it.
      **`[13]`'s audit missed six of them.** It counted `apps/mobile` and
      `apps/api` and never opened `packages/core` — where `restore.ts` refuses a
      foreign backup by name twice, `db/errors.ts` names the app in a version
      refusal, `support/tickets.ts` titles every ticket, and
      `weather/provider.ts` sends it as a User-Agent to an external API.
      **The package change reaches past `app.json`**: twenty-eight references
      across fifteen files, every one of them genuinely about package identity —
      the adb lines in `apk.yml`, `publish-apk.sh`, `deploy.sh`, `apk-check.mjs`
      and three Windows `.bat` helpers, `GOOGLE_PLAY_PACKAGE` in `env.ts` and
      `.env.example`, and five test fixtures.
      **Deliberately unmoved**, per that audit's four: the
      `homefarm-<version>-<code>.apk` stem, because `deploy.sh` decides the
      shelf is current by stripping it; the `slug`, bound to
      `extra.eas.projectId`; the `scheme`, which is in every OAuth redirect URI;
      the systemd units and `/opt`, `/etc`, `/var/lib` paths; and the 371 files
      carrying `@homefarm/*`. None is visible to a farm.
      **What it costs the two devices that have it:** a different package is a
      different app to Android, so the tablet and the tester's phone get a fresh
      install with an empty database rather than an upgrade. Nothing is lost
      that a backup and restore does not carry across, and it happens once.
- [ ] **Decide the business entity.** `[14]` — Play needs a payee.

## 3. Release mechanics

- [ ] **Add an AAB target** to `apk.yml`, alongside the APK the shelf needs. `[8]`
- [ ] **Decide Play App Signing versus the farm's own key**, and write down
      which install a farm gets. `[9]`
      Interacts with `PICK-UP-HERE.md` §3 — one route per device, because a
      mismatched signature forces an uninstall and an uninstall takes the farm.
- [ ] **Account deletion, in-app and as a web URL** reachable without the app. `[4]`
- [ ] **Decide what deletion means** on the server, in backups, and for a
      lapsed farm. `[5]`
- [ ] **Complete the Data Safety declaration.** `[3]`
- [ ] **Name the processors** — Oracle Cloud (the box), S3, GitHub, Google,
      weather.gov, the Census geocoder. `[7]`
      **Not Atlas.** The database moved onto the box and the cluster was
      deleted, so the managed-cluster row that used to lead this list names a
      processor holding nothing. The Data Safety form is built from this list.
- [ ] **Verify target API level and 16 KB page support.** `[11]`
- [ ] **Acknowledge a Play purchase inside three days.** `[181]` — *added 16
      August; entailed by §2's Play items rather than a new decision*
      Google auto-refunds and revokes a subscription nobody acknowledges within
      72 hours, and neither half of the acknowledgement exists: there is no
      billing library on the client to call `acknowledgePurchase`, and
      `billing/play.ts` verifies a token against `purchases.subscriptionsv2`
      and stops — `acknowledge` appears nowhere in this repository.
      **Not a gap in the running server.** `A2.8` is deliberate that no farm can
      buy anything yet; grants and promotion codes carry every one of them, and
      `playConfig === null` means the question is never asked. It goes live on
      the day the closed test in §2 sells its first subscription, which is why
      it belongs beside the purchase flow rather than after it — a refund that
      arrives 72 hours later looks like a farm that changed its mind.

## 4. Structural — the highest-leverage work

- [x] **Append-only `taskCompletion` and `serviceCompletion` events.** **GA**
      **Built 17 August.** Two append-only entities, and the schedules stay
      exactly as mutable as they were — `task` and `maintenance` are still
      edited, and only the past became immutable. `read/history.ts` had stated
      the fix in its own words against both entities (*"an append-only
      completion record — the shape `careLog` already is for animals"*), so
      this is that. Both notes stay where they are, rewritten: those builders
      are the legacy path for records written before events existed, and each is
      silent for a record that has any — or the last completion would be drawn
      twice on the day it happened.
      **Nothing reading the old field names had to change**, which is what kept
      it to one commit. `listTasks` and `listServices` fill `completedAt`,
      `lastDoneAtDate` and `lastDoneAtHours` from the newest event and fall back
      to the stored field for a record with none — so `taskDues`, `isSettled`
      and `serviceDue` did not lose a line between them, and a farm's existing
      records go on reading exactly as they did. An event wins **outright**
      rather than being compared with the field: un-completing is a delete, and
      a stale field that could win afterwards would make a job somebody un-ticked
      look done again.
      **One bug found in the writing, by a test asserting what a comment
      claimed.** `listServices` spread the stored fields and then overrode only
      the date, so a service recorded on a machine whose meter nobody read left
      this spring's date beside a reading from two services ago — and
      `serviceDue` counts the next interval from exactly that reading. An event
      replaces the pair outright now; an absent reading is the honest answer.
      **And it closed one of §1's two live clearing symptoms, as predicted.**
      *Need to redo this* deleted a completion instead of writing
      `{ completedAt: null }`. The null stays for a job finished by a build that
      predates this, which is the case the clearing contract was built for.
      Schedules stay mutable; completions become history. Today
      `task.completedAt`, `maintenance.lastDoneAtHours` and `lastDoneAtDate`
      each overwrite, so a machine serviced for six years can show one date —
      and `Evenglow-Masterplan.md` advertises a full service record for resale
      that therefore cannot be produced.
      **It also removes one of §1's two live clearing symptoms** *(noted 16
      August)*. An un-complete is `{ completedAt: undefined }` today, which is
      the field that never reaches the server; against an append-only
      completion it is a `delete` of the event, which does. That does not make
      the wire fix optional — the medication fields still need it — but it does
      mean these two items should be sequenced, not done twice.

      *The original note, kept:*
- [x] **One reusable detail-and-timeline screen.** **GA**
      Status, primary actions, upcoming work, full timeline, edit and archive.
      Used for animals, groups, beds, varieties, plantings, machines and
      inventory. *The best single idea from the assessment: several entities
      stop at creation and a static list, and this makes almost every other
      item on every list smaller.*
      **Its first commit is a read, not a screen** *(added 16 August; the read
      and the panel are built)*.
      **Done so far:** `HistoryEvent` carries `subjects` — plural, because a
      loss names the group it came out of *and* the animal, and a per-animal
      timeline that picked one would omit the animal's own death — and
      `listHistory(units, { subject })` filters on it. Subjects are what a
      record *names* and nothing inferred, so a group's timeline does not climb
      down to its animals' weights; that walk is a separate question and is
      asserted rather than left to be discovered.
      `components/Timeline.tsx` is the reusable half, and it shares
      `HistoryScreen`'s rows rather than copying them — that screen had already
      extracted them once, with the reason on it: a list whose rows delete
      things must behave identically in every container. It is on `Group`,
      `Machine` and `Planting` now.
      **`AnimalScreen` is built** — who she is, what she weighs, her matings,
      the way back to her group, and her own timeline. Animals were the sharpest
      case: a mating names a dam, so individuals exist in this app *because of*
      that animal, and hers was the record that could not be read back. It
      carries no edit and no archive on purpose, and says why: editing is the
      mutable-entity gap this file holds separately, and an animal leaving the
      farm is an **outcome** — sold, culled, died, moved — which is §4's own
      item. Hiding the row here would pre-empt a decision already written down
      and not yet made.
      A sack's history is on `AdjustStockScreen`, which is the screen somebody
      is already on when they wonder how the last two bags went. **Not a detail
      screen of its own**, because the farm-wide inventory model below is going
      to reshape what an item is, and a screen built against today's shape would
      be built twice.
      **Beds and varieties were a different shape, and both are built now**
      *(16 August)*. The finding stands: nothing append-only names a bed or a
      variety, because a `harvest` names its **planting**. So neither screen is
      a timeline with facts on top — each leads with what only `planting` can
      say, which is a mutable record of state and therefore absent from the
      history projection by design. A bed shows what is growing in it now and
      what grew there before, which is the question a bed is actually asked;
      a variety shows the numbers every planned date in the app is computed
      from — shown for the first time, since a keeper who disagrees with
      seventy-five days has to see seventy-five days.
      **The harvests still reach them, and the way they do is the decision.**
      `HistoryScope` now takes several subjects, so a bed asks for *itself and
      its plantings* by name. The rule that an event's `subjects` are what a
      record names stays exactly as strict; the hop is made on the screen that
      means it, where *"we took four kilos out of bed three in August"* is
      plainly true, rather than by a hierarchy walk every timeline in the app
      would inherit. That is also what keeps a group's timeline free of its
      animals' weights: nobody passes the animals.
      Both are reachable: the bed heading on Growing opened nothing before, and
      a planting now names the bed and the variety it belongs to.
      **Edit and archive are built for all three** *(16 August)*. It was the
      largest gap in the product — `DESIGN-BRIEF.md` §3 counts sixteen mutable
      entities against a UI that could change one — and the corrections it
      makes possible are not cosmetic: `possibleDams` reads an animal's sex, so
      a ram recorded female was offered for breeding for ever, and the frost
      warning reads `bed.covered`, so a tunnel recorded as open ground raised
      alarms all spring for plants in no danger. Clearing works on these screens
      because the wire learned the word for it in §1: a band that came off can
      be taken off rather than only replaced.
      **Two judgements worth keeping.** A bed with a crop still in it refuses
      to be put away and names what to finish first — archiving it would take
      the planting off every growing screen while it is still in the ground.
      A variety is a description rather than a place, so dropping one that has
      been planted is allowed and the plantings read on exactly as before.
      **And the animal one says what it cannot do:** putting her away records
      that she is gone and *not why*, in those words, because the app cannot
      tell a sale from a death and §4's outcome flow is what will ask. Nothing
      is deleted (P13), so that flow has a record to attach an answer to.
      **Machines, plantings and inventory items followed** *(17 August)*, and
      they were not three more field sets. `listMachines` did not carry
      `serial`, `year` or `note` at all — nothing could show them, so nothing
      read them — and the serial is the number on the insurance and the bill of
      sale, which is the whole reason P7 keeps hours and services in the first
      place. `listPlantings` was missing `quantity` and `note` the same way.
      Both reads now carry them.
      **Three more judgements.** A machine's meter toggle is the dangerous
      control on its screen: `serviceDue` refuses to build a row it cannot
      evaluate, so an hours interval on a meterless machine produces *nothing*
      rather than a row stuck on Today — which is right, and means switching the
      meter off silently stops every hour-based schedule ever asking again. The
      screen counts those schedules and names them before the toggle is
      believed. A planting with harvests against it **refuses** to be taken
      back out and points at *pull it*: a `harvest` names its planting, and beds
      and varieties reach their harvests *through* plantings, so archiving one
      would take four kilos of tomatoes out of the bed's story and the
      variety's while the harvest records sat there untouched and unreachable.
      A planting that fed somebody is not a row entered by mistake. An
      inventory item has **no** guard on stock still on the shelf, deliberately:
      a part the farm no longer stocks may well have three left in the drawer,
      and refusing until the count reached zero would teach people to type a
      zero they do not mean — which puts a use that never happened into the
      adjustment history, and that is worse than an archived item with a number
      on it.
      **A set of eggs came last** *(17 August)* and broke the pattern the other
      five had settled into. Everywhere else, archiving leaves what was logged
      against the record: a retired tractor keeps its hour readings, an archived
      item keeps its adjustments, because those are separate records that merely
      name it. **An incubation has no separate records** — set, candled,
      hatched, and the counts are all fields on itself, which is exactly why the
      hatch in What happened is built from the record — so archiving one really
      does take the hatch out of the farm's history. The screen says that in
      those words instead of implying the usual bargain. It is still *allowed*,
      where a planting with harvests is refused, and the difference is the
      point: there the harvests would survive unreachable, saying four kilos of
      tomatoes happened somewhere nobody can look; here nothing is stranded,
      because the row and the record are the same thing.
      **Two of its fields are the app's arithmetic rather than description.**
      `setAt` and `species` are what both dates count from and `SetEggsScreen`
      opens on chicken at today, so a duck set entered two days late hatches a
      week early in the app and nowhere else — and a due row that came and went
      is not one anybody can tell was wrong. `eggsSet` is the denominator of
      every rate the detail screen prints: twelve typed as twenty-one makes a
      good hatch read as 38%, which is the number a keeper diagnoses an
      incubator by. **And three counts could only ever be written once**, since
      the forms recording `fertile`, `hatched` and `earlyLosses` vanish the
      moment they are filled in. They are offered here and only once they
      exist — correcting what was recorded, never a second place to record it,
      because a `fertile` of nought from a stepper nobody touched is a claim
      that every egg was clear.
      **It also gave `flockId` its first caller.** *"The group the eggs came
      from, when they came from this farm"* has been in the schema since it was
      written and the add screen never asked, so the hatch reached What happened
      and no group's own story — however plainly the hens laid the eggs.
      **`SetEggsScreen` asks it now too** *(17 August)*, which is the moment
      somebody actually knows: the person standing at the incubator with a
      basket can say which birds these came from, and nobody goes back a
      fortnight later to. Nothing is preselected even on a farm with one flock,
      on that screen's own argument about `eggsSet` not opening on a dozen — a
      default is a claim the app chose and it would be recorded by anyone who
      pressed *Set them* without looking. Both screens filter the offer to
      groups of the bird being set, because duck eggs did not come from the
      goats and a wrong provenance is silent: nothing downstream can tell that a
      hatch landed on the wrong flock's timeline.
      **The upcoming-work half closed it** *(17 August)*, and it turned out to
      be a reading of the engine rather than an addition to it. `useDues`
      composes twelve builders into a farm-wide list and exactly one screen had
      ever rendered a row from it — so the app knew a tractor's yearly service
      was due in November and would not say so on the tractor's own screen,
      which is the question somebody opens that screen to ask. `Coming` is
      `Timeline`'s twin: same panel shape, same subject scope, same hop made by
      the screen that means it, and it sits on all six.
      **It shows what Today deliberately hides**, and that is the point rather
      than an oversight being corrected. `todayList` drops `later` rows because
      a morning's list reaching into November is one nobody finishes; that is a
      judgement about Today, not about the row, so `duesFor` keeps them —
      undated meter rows included, since *"at 250 hours"* is a permanent
      resident on Today and the honest schedule on the machine's own screen.
      Nothing is capped or bundled either: both exist because Today mixes every
      group, machine and bed, and a group's seven husbandry rows **are** its
      routine when read on the group.
      **`Due.subject` meant two things and now says so.** `birthDue` already
      carried the confession — *"`subject` is what opens the row, not merely
      what the row is about"* — because an animal id in a `groupId` slot
      rendered "That group — Missing" on a live row. Three builders point
      somewhere other than what they describe: a birth at the dam's group, a
      withdrawal at the medication the arithmetic came from, a chore at itself.
      Filtering on `subject` alone gave Bramble's screen nothing to say while
      "Bramble due" sat on Today. `Due.about` is the second answer — ids only,
      the same shape and the same reasoning as `HistoryEvent.subjects` — and
      `subject` goes on doing all the opening.
      **And the routing map left `TodayScreen`.** `due-routing.test.tsx` exists
      because that map once read `subject.entity` first and sent every flock row
      to a hub; a second copy of it on a screen with no test walking every kind
      is where that class of fault comes back. One `dueDestination`, named
      rather than performed, so a panel can ask *would this go where I already
      am* — a service row on its own machine's screen is drawn as text, because
      a chevron that reloads the screen you are standing on reads as a door.
      **Incubation and Jobs came last and wanted opposite things** *(17
      August)*. A set of eggs is a detail screen and took the panel: its two
      steps are dated, and the screen stated those dates in plain muted prose
      with no notion of late, so a set four days past its hatch read exactly
      like one due next week. The form's own sentences **stay** — they are not
      the same statement, because `incubationDues` produces nothing at all for a
      species the library has no length for while the panel falls back to
      twenty-one days, so for a bird the app cannot model the form is the only
      thing said.
      **It found a hole while it was there.** `read/history.ts` was blind to
      incubations entirely, so a hatch — one of the few events on a poultry year
      anybody remembers the date of — appeared nowhere but that one screen. It
      lands in What happened now and on the source group's timeline, since the
      hens laid the eggs. Only the hatch: candling is a step in the middle, and
      the *set's own* timeline is deliberately absent because nothing else in
      the projection can ever name an incubation, so the panel's only possible
      content would restate the two panels above it.
      **Jobs is the task list itself**, so a panel of the same rows above the
      same rows is Today with a different heading. What it lacked was the
      engine's sense of time, which it had been reimplementing worse: the detail
      line printed "3 September" whether that was next month or three weeks
      gone, and a weekly chore done yesterday sorted by the Monday it started
      from rather than by next Thursday. It reads through `taskDues` and
      `urgencyOf` now, in Today's own words, and an overdue row goes rowan.
      **And a job can finally say what it is for.** `taskShape.subjectId` has
      existed since the schema was written, `useDues` reads it, `Due.about`
      carries it — and nothing in the app could set it, so the path that puts
      *order the wormer* on the does' own screen beside their worming schedule
      was reachable only from a test. A builder with no caller, which is the
      lesson `useDues` already records about itself.

      *The original note, kept:*
      `read/history.ts` is farm-wide and has no notion of a subject:
      `listHistory` takes none, and `HistoryEvent` carries the record's own id
      and its entity but not what the record is *about*. So nothing today can
      answer "what has happened to this animal", and the screens that want it
      filter by hand — `WeighScreen` sorts and slices the weight list itself to
      put the last three weighings beside the form. A subject key on
      `HistoryEvent` and a filter on the read is what makes one screen reusable
      instead of seven screens each re-implementing that pane. Three of the
      seven have a detail route today — `Group`, `Machine` and `Planting`, with
      `Incubation` beside them off-list. Animals, beds, varieties and inventory
      items go from a list straight to an edit form.
- [ ] **A common event field set** — backdated date and time, who, where, note,
      photo — added to the entities that already exist. **GA-c**
      This is the universal-event proposal adopted in the one form that does not
      touch the sync contract; see the rejection at the foot for why not as an
      entity.
- [ ] **Named locations and dated movement history.** **GA**, `[91]`, `[94]`, `[114]`
      Pastures, paddocks, pens, coops, beds, storage. Answers "where are they
      now", gives movement records something to point at, and needs no map.
- [ ] **One adaptable animal-outcome flow** — death, cull, sale, transfer,
      processing, predator loss. **GA**, `[98]`
- [ ] **Individual-animal lifecycle** — location history, weights, health,
      breeding links, outcome, full linked timeline. **GA**
- [ ] **One farm-wide inventory model** — feed, seed, medicine, fertiliser,
      fuel, parts, packaging — with movements linked to the event that consumed
      or produced them. **GA**, `[116]`
      **The shelf is mostly built; the link is the item** *(corrected 16
      August)*. `inventory` and `stockAdjustment` are both in the contract and
      both have screens — five kinds (`feed`, `bedding`, `medicine`, `part`,
      `other`) against the seven above, and six reasons a quantity moved. Seed,
      fertiliser, fuel and packaging have nowhere to go, and **the one movement
      the app already makes for itself records no reason at all**: logging feed
      writes a `feedLog` and then an `inventory` update that lowers `quantity`,
      with no `stockAdjustment` beside it. `stockAdjustment` exists because
      every non-consumption reason *looked* like consumption; the inverse now
      holds, and a sack's history reads as purchases and losses with the
      feeding invisible between them. Whether that pair should also become one
      transaction is a separate call — `enqueueAll` is the tool, and
      `FeedScreen` argues out loud for the opposite, that the feed is the fact
      and the shelf is bookkeeping derived from it.
- [ ] **Meat processing record.** **GA**, `[98]`
      Closes the grow-out clock, which counts down to a day nothing records.
      Freezer and package tracking optional and off by default.
- [ ] **Progressive disclosure** — minimum fields first, secondary under
      *More details*. **GA-c**
      The assessment frames this as replacing Basic/Full modes; no such setting
      exists in the code, so this is *building* the comprehension rubric the
      masterplan calls the competitive differentiator, not restructuring it.
      Worth naming: a thing that does not exist cannot regress.

## 5. Domain and safety records

- [ ] **Medicine-book fields** — batch or lot, expiry, supplier, prescribing
      vet, quantity administered, who administered. **GA**, `[18]`
- [ ] **A sanity check on entered withdrawal periods.** `[17]`
      A vetted table, a confirm-against-the-label step, or a warning on
      implausibly short windows.
- [ ] **A provenance line on each heat, cold and THI threshold.** `[21]`
      **The reasons are written; the sources are not, and neither reaches a
      farm** *(clarified 16 August)*. `contracts/warnings.ts` argues every
      number it uses — why 33–36 °F rather than freezing, why poultry pant at
      29 °C, why an alpaca gets a heat index and a cow gets THI, and it prints
      the THI formula. What none of them carries is where the figure came from,
      and none of the reasoning is visible outside the source file: the farmer
      sees *"Dangerous heat today for the goats"* with no way to ask why. So
      this is two things — a citation per threshold, and a decision about
      whether any of it is shown.
- [ ] **Crop input and pesticide records** with the statutory field list —
      product, registration number, rate, area, date, operator, re-entry
      interval. **GA**, `[107]`
      *Two reviewers reached this independently.*
- [x] **Reports carrying human-readable names beside stable identifiers.** **GA**
      — *built 16 August: every sheet now ends with `Subject id` and `Record
      id`, appended in one place rather than written into twelve headers.*
      **Adopted the wrong way round, and the missing half is the cheaper one**
      *(corrected 16 August)*. Every sheet `export/csv.ts` writes already
      resolves a ULID to a name — `named(groupName, v.flockId)`, printing
      `(archived)` when the subject is gone — and not one of them prints an
      identifier. So the line as agreed describes the opposite of the code. What
      an accountant cannot use is not a column of ULIDs; it is two groups both
      called *Big coop* with nothing to tell them apart, and a season's rows
      that cannot be joined back to anything. One column per sheet, beside the
      name that is already there.
- [ ] **Opt-in local notifications.** **GA**
      Treatment doses, withdrawal clearance, birth and hatch, succession sowing,
      harvest windows, service due, recurring chores. **This corrects
      `DOMAIN-SCOPE.md` §8.2 twice over** — local scheduled notifications are an
      OS API that fires with the radio off, *and* the "server dependency" that
      parked them was never a real constraint, because there is a server. Today
      stays usable without them. Ship inventory reorder alerts last, if at all —
      an alert nobody can act on from a barn trains people to dismiss the ones
      they can.
- [ ] **Targeted CSV import, bounded to an empty farm.** **GA-c**
      Current animals, equipment, varieties, plantings, inventory. The refusal
      in `COMPETITIVE-ANALYSIS.md` §2.1 rests on three hazards that are all
      about historical events merging into a *populated* farm; none survives
      contact with an empty one, on the same empty-versus-populated boundary
      `ROADMAP.md` §12 already used for backup restore. **The bound is the
      approval** — not "current versus historical" but "no records of that
      entity type yet".
- [ ] **Decide the sales event, out loud, either way.** `[119]`, **GA**
      Costs with no revenue means the app can say what a farm spent and never
      whether it made anything. One append-only sold event completes every ratio
      already computed and stays far short of a ledger.
- [ ] **Optional individual production for identified breeders.** **GA-c**
      `eggLog.birdId` already exists for this. Never the default, never offered
      on the ordinary flock screen — the refusal of per-bird tallies stands for
      five hens sharing a roost and does not apply to a trap nest.

## 6. Platform and operations

- [ ] **Define the day, store the zone, stop calendar arithmetic in
      milliseconds.** `[29]`–`[34]`
      There is no timezone handling in this codebase at all. `[34]` is the
      urgent half: a record written today without its zone can never have one
      added.
- [x] **An operational control centre on the box.** *(raised in §8 on 17
      August, decided the same day, **built the same day**)*
      One page, its own process, live reads, behind a Caddy site block with a
      password on the existing `admin` role. **Business and operations, not farm
      records** — the point is subscribers, tokens, versions and health, and
      nobody needs a panel telling them how many eggs a farm collected.

      **Built as specified**, with the pieces where the spec put them:
      `apps/api/src/ops.ts` is the entry (`pnpm ops`), `ops/server.ts` the
      routes, `ops/page.ts` the page, `ops/actions.ts` the two writes, and
      `db/board.ts` the reads — in `db/` because that is the only place lint
      permits a collection handle, which keeps every deliberate cross-tenant
      read in one directory.

      **Three decisions taken while building, none of them in the spec:**
      - **The token lives in a variable, not a cookie.** An ambient credential
        the browser attaches by itself is a CSRF surface needing its own
        defence; with none there is nothing to forge a request with, and no
        `@fastify/cookie` dependency to add. The cost is that a refresh signs
        you out, which for a board somebody opens to answer a question is the
        right way round.
      - **Loopback by default.** The API binds `0.0.0.0` because it must be
        reachable; this binds `127.0.0.1` unless `OPS_HOST` says otherwise, so a
        box whose Caddy config does not mention the board has no way in from
        outside — no firewall rule to remember, and none to forget.
      - **A 403 rather than a 404 for a signed-in non-admin**, which inverts
        this service's usual rule. Everywhere else an unauthorised read is a 404
        because distinguishing them discloses that a record exists; the board is
        a fixed page with nothing to disclose, so telling an owner their role is
        not enough beats pretending the page is missing. Sign-*in* keeps the
        single indistinguishable refusal, because that one does enumerate
        accounts.

      **Verified in a browser, not only by tests.** Playwright drove sign-in as
      a farmer (refused), as the admin (board drawn), both buttons (a code
      minted, a farm granted and revoked, a bad id refused), with no console
      errors. A farm was deliberately named `<img src=x onerror=alert(1)>`: it
      renders as those characters, `img[onerror]` count zero, no dialog. Every
      value reaches the DOM through `textContent`, so the correct display and
      the correct security come from the same line.

      **The panels, and what already backs each one.** Everything but the third
      is answerable from the database today:
      - **Paid, comped and free.** `orgs.subscription` is absent on every farm
        that never subscribed, `syncGranted` is the comped ones, and the
        `FREE_SYNC_ORGS` env list still wins over both — so the readout has to
        show all three or it will disagree with what a farm experiences.
      - **Tokens claimed.** `promoCodes.redeemedBy[]` carries `orgId`, `userId`
        and `at`, so minted-versus-spent is exact rather than estimated;
        invites and join codes have the same shape. This is the closest thing
        the server has to a funnel.
      - **Versions in the field.** ~~*Nothing backs this yet.*~~ **Backed as of
        17 August.** `users.lastSeen` carries `{ at, client }`, written on both
        `/sync` and `/snapshot` — the pull route too, because a reinstall
        restoring a farm reports its build for a while before it writes
        anything. `listFarmSummaries` tallies accounts per build.
        **Per account, not per device**, and the panel must not claim otherwise:
        the token names an account and nothing identifies a handset outside a
        mutation envelope, so `/snapshot` has no device to name. Somebody with
        two phones on different builds shows as whichever synced last.
        The header is **parsed, not stored** — `parseVersion` bounds it to three
        integers, so a caller-controlled string never reaches the page and a
        histogram cannot be sprayed across invented values.
      - **Server health.** `ping()`, process uptime, mongod reachable, disk and
        photo bytes from `db:usage`, and the sweeper's last report — which
        currently goes to `console.log` and nowhere a person looks.
      - **Sync trouble.** `pending` rows and their age, the per-farm outcome mix
        (`rejected` and `conflict` counts), and feed lag per device. A farm
        quietly generating refusals is a bug nobody will report, because the
        only person who sees the inbox entry is the one who caused it.

      **Buttons, not just readouts** — that was the point of asking for it. The
      `.mts` scripts are the action list: `farm:ls`, `farm:show`, `db:usage`,
      `db:verify` are read-only and safe; `promo:new` and `farm:grant` are
      writes whose worst case is a spurious code or a comped farm, both
      reversible by hand.
      **`db:password` stays on the shell**, and that is the one line worth
      holding. It sets anybody's password, which makes a button for it an
      account-takeover primitive — and it is the same risk on localhost as on a
      public hostname, so it is not an argument about where the panel lives.
      *This replaces "read-only first"*, which was the wrong rule: the useful
      version of it is **no credential-changing actions**, and everything else
      can be a button.

      **The buttons call the functions, never a shell.** `createPromoCode` and
      the rest are exported from `apps/api/src/db/`; shelling out to `pnpm …`
      would be a command-injection surface that also depends on a checkout being
      present. ~~`list-farms.mts` queries inline rather than through a shared
      function, so that one query wants extracting first~~ — **done 17 August.**
      `db/farms.ts` owns the cross-tenant read and `list-farms.mts` is
      presentation, so the board and the command cannot answer differently.
      **Extracting it found the listing was already wrong.** It read
      `syncGranted` and the subscription and stopped, so a farm comped through
      `FREE_SYNC_ORGS` — testers and whoever runs the box, which is to say the
      farms most likely to be looked up — printed `unsubscribed` while syncing
      perfectly. `farmSyncState` now mirrors `syncAccess`'s own branch order and
      names all four ways through (`comped`, `granted`, `open`, `paid`); a test
      walks every combination and fails if the two ever disagree about whether a
      farm may sync.

      **Auth: a password, on the `admin` role, with three conditions.** From a
      manager and never typed, because the whole thing rests on entropy; its own
      `@fastify/rate-limit` registration, since the existing limiters are
      per-route `scope.register` calls and a new route inherits nothing; and
      `TRUSTED_PROXY_HOPS=1` verified on the box, because `DEPLOY-THE-SERVER.md`
      records that with it wrong `request.ip` is `127.0.0.1` for every request
      and **every limiter in the service shares one bucket** — which would make
      the rate limiting decorative and reduce this to a password alone.
      A network filter in front is cheap and optional: Caddy's `remote_ip`
      matcher costs one line and breaks when the ISP rotates you, a tailnet
      survives that and is one more daemon. mTLS is the strongest and the most
      annoying to install on a phone.

      *The stance this replaces, kept because it was wrong in a specific way:*
      *"A public admin login is a second auth system guarding the one thing on
      this box that can read every farm, and should not be the first version of
      anything."* **Both halves overstated it.** It is not a second auth system:
      `ROLES` already has `owner | admin | hand` and `@fastify/rate-limit` is
      already scoped onto auth, billing, members and support, so an admin page
      reuses what exists. And the cross-tenant point is real but worth nothing
      at one farm — a compromised admin session reaching every farm is a
      property that matters at twenty, not at one. It was a future constraint
      presented as a present one.

- [ ] **A minimum client version the server can require**, and an in-app update
      check against the shelf. `[23]`, `[24]`
      **The first half is built** *(16 August)*: the client states its version
      in `x-homefarm-client`, `MINIMUM_CLIENT_VERSION` sets a floor that is
      empty and inert on every server today, and a batch from below it gets a
      426 and the `appTooOld` refusal — **held exactly as an unsubscribed farm
      is held**, queued and uncounted, because the mutations are valid and only
      the APK is old. A floor the server cannot parse is ignored rather than
      enforced: a typo in a config file must not be this server breaking a
      working app.
      **The second half is not**: nothing tells a farm an update exists. That
      wants a version the shelf can be asked for and a screen to say it on,
      which is its own piece of work — and until it exists the refusal above is
      the only thing that will ever mention it.

      **Scoped 17 August, and it is two builds rather than one.** *Not urgent —
      the box is the only channel until the Play listing exists, and the box
      path stays correct forever for self-hosted farms, which have no store to
      ask.*

      **Phase 1 — ask the box. No new dependency, and it works today.**
      The shelf already renders a version stamp
      (`scripts/deploy/render-install-page.sh`), and every release now has a
      tag and an APK behind it. Serve that stamp as JSON, compare it to
      `APP_VERSION`, and put a banner with the `/app/` link on the sync screen.

      **Phase 2 — ask Play, once there is a listing.** `AppUpdateManager`'s
      `IMMEDIATE` flow: Play downloads, installs and restarts, so the
      self-update policy does not apply. It needs a native module — there is no
      first-party Expo one — which is a dependency to justify under Style when
      it is actually reached.

      **Four things settled while scoping it, so they are not re-derived:**
      - **Play does not force updates.** There is no Console switch for it.
        Every "you must update" screen is the app choosing to block, with Play
        supplying the install. This is code either way.
      - **The app must know which channel installed it**, or it will offer the
        wrong thing: a Play build may not show an APK link at all — Google
        Play's Device and Network Abuse policy forbids a Play-distributed app
        updating itself by any other route. Cheapest honest answer is a
        build-time stamp beside `EXPO_PUBLIC_BUILD`, set from the EAS profile,
        since `TESTING-BUILD.md` already defines `production` as the AAB for
        Play and everything else as APKs we serve. `getInstallSourceInfo()`
        would be the runtime answer and needs a native module we do not have.
      - **The box cannot answer for a Play device.** It knows what was
        published; Play decides what each device may have — staged rollouts,
        review, an unsupported API level. A nag nobody can act on is worse than
        silence, so on Play the question goes to Play.
      - **`MINIMUM_CLIENT_VERSION` becomes dangerous the day Play is the
        channel.** Today distribution is ours and raising the floor is safe.
        Raise it during a staged rollout and a farm is refused sync with **no
        action available** — the app says update, Play says you are current.
        Rule: only raise the floor for builds old enough that everybody has
        long since been offered the new one.

      **And it must not lock the app.** The standard pattern blocks the whole
      UI; that is wrong here and breaks D14. Sync is held — already the right
      shape, nothing dropped and no attempts counted — while local logging
      carries on untouched. What is missing is a banner that can be acted on,
      not a wall.
- [x] **Guard against a database from the future.** `[151]` — *built 16 August*
      `migrate()` silently no-opped when `user_version` exceeded
      `SCHEMA_VERSION`, reporting the higher number as a success and handing
      back a store shaped to a schema this build has never seen. It now throws
      `DatabaseFromTheFutureError`, which `Boot` already renders in words. The
      message names the fix rather than the fault and is tested for what it must
      never say: clearing app data is the one action that would turn a temporary
      refusal — a downgrade, which `[156]` calls the only route back from a bad
      release — into the loss the guard exists to prevent.
- [x] **An error boundary and a crash breadcrumb.** `[39]`, `[40]` — *built 16
      August*
      `components/Boundary.tsx` sits above the providers in `App.tsx`, so it
      catches the store and the theme as well as the screens, and draws a
      fallback that answers the only question a farm has at that moment —
      nothing logged has been lost — with a retry and the build it happened on.
      It is the one class component in the app, because React has no hook form
      of `componentDidCatch`; `CLAUDE.md` now names that exception rather than
      leaving the rule quietly broken.
      **The crumb is what closes `[40]`.** A crash report held in memory is not
      a crash report, so the fallback writes one small file — not SQLite, which
      may be what failed — and the next launch that works picks it up into the
      trouble history, where a support bundle carries it. Reading clears it, so
      one crash rides on one ticket.
- [x] **Free-space check before photo capture; `integrity_check` on open.**
      `[36]`, `[37]` — *built 16 August*
      A full phone was met in the worst possible order: open the camera, let
      somebody frame a wound they are worried about, take it, then fail while
      writing. `capture` now refuses before the picker opens, with a floor
      well above one photo — the resize writes a temporary beside the original
      — and a device that will not say how much room it has counts as having
      room, because refusing a photograph on a guess is worse than the bug.
      The file check is `quick_check` rather than `integrity_check`: the full
      one is O(database) on every cold start, and the cheap half catches what
      actually happens, which is a torn page from a battery pull. **It reports
      and does not refuse** — a damaged file still holds most of a farm's
      records, and the one thing somebody needs then is to get them out, so an
      app that will not start is an app that cannot hand anything over. It
      repairs nothing either: every automatic repair here is destructive in
      some case, and a device that has just reported damage is the last place
      to run one unattended.
- [ ] **Run the restore drill, and decide the RPO it implies.** `[50]`
- [ ] **Second custody location for the `age` key and the keystore.** `[51]`, `[52]`
- [ ] **Stop the nightly `mongodump` copying every photo every night.** `[159]`
      GridFS shares the database, so each dump is a full copy of every image
      ever uploaded, and §4.1a prices that storage against records.
- [ ] **Watch the box** — an uptime check and an alert that does not travel over
      the box. `[49]`
- [ ] **Handle font scaling.** `[68]`
      The rail has clipped its labels twice already, at the default scale.
- [ ] **Design for a wet glove.** `[167]`
      Capacitive touch does not register through wet or muddy gloves, and rain
      on the screen registers taps nobody made. This is the precondition under
      every field-usability rule in `UX-SPEC.md` §1, and the real argument for
      voice entry `[76]`.
- [x] **Correct the two documents the code has outgrown.** `[203]`, `[205]` —
      *added and done 16 August*
      Both were found by checking this file against the source, which is the
      failure mode `[203]` predicted: nothing checks the documents against each
      other.
      - **`CLAUDE.md`'s Mutation Envelope section lists 14 entities and there
        are 26**, and its append-only set names six of the eleven in
        `APPEND_ONLY_ENTITIES`. Everything growing, `breeding`, `incubation`,
        `weight`, `shearing`, `feedPlan`, `careLog`, `stockAdjustment` and
        `note` are absent from the file every agent and every new reader is told
        to start from. *Highest leverage per line in this document*: a wrong
        invariant list in the instruction file is wrong in every task that
        reads it. **Fixed by not repeating the list at all** — the section now
        points at `ENTITIES` and states the rule for widening it, so the one
        that can go stale is the one nobody has to maintain twice.
      - **`DESIGN-BRIEF.md` says "where this disagrees with `ROADMAP.md`, this
        is newer"** and is dated 9 August. Three of its stated gaps have since
        closed — there is a launcher icon, there is a splash, and `apk.yml`
        compiles Android in CI — so on those points it is now the older
        document asserting priority over the newer one. It wants the staleness
        line `PICK-UP-HERE.md` carries. **It has one now**, naming the three
        gaps that have since closed so the diagnosis can still be read without
        the expired claim being acted on.

## 7. Carried from the sync integrity list — **SI**

**Pointers, not decisions.** These were argued and agreed in
`SYNC-INTEGRITY-TODO.md` and are unticked there. They are repeated here because
that file was not in this one's source table until 16 August, so the repository's
highest-severity open work was invisible from the checklist that is supposed to
say what to do. **The file remains the authority; do not re-argue them here.**

- [x] **A sweeper for `pending` mutation rows.** P0-2's last open box. The
      outcome field, the accepted-only feed and the repair have shipped; what
      is missing is the hourly pass over rows whose client never came back,
      running the same stored-envelope re-projection. Until it exists a row
      logged at the moment a device dies stays `pending` for ever, and
      `pending` is withheld from the feed — so that record reaches no other
      device on the farm.
      **Built 17 August** — `apps/api/src/sync/sweep.ts`, with the runner wired
      into the entry point rather than into `buildServer`, so importing the
      module in a test binds no port and starts no timer. It reuses `apply.ts`'s
      own re-projection rather than copying it; identity comes from the log and
      the role from `users` as it stands, which is what invariant 8 asks for; and
      an author who has left the farm is stamped `rejected` rather than swept for
      ever.
      **It did not close the box on its own, and a second device is what showed
      that.** The sweeper decided stranded rows correctly from the first commit,
      but the feed walked its watermark past a `pending` row — so a repaired
      record still reached no other phone, which is the harm the box is about.
      See N-4. Both halves are needed and both are now in.
- [ ] **Mint a fresh ULID in `retryRejected`.** P0-1(b). Reusing the id of a
      refused mutation means the corrected payload meets the duplicate branch
      and is answered as already-done.
      **Deferred there, and the deferral is the point** *(noted 16 August, after
      this line was first written without it)*. The source file says wait until
      the correction editor is actually being built, and sizes why: the outbox
      primary key *is* the mutation id, so this needs a new terminal status and
      a migration, plus an audit of every status predicate — `readOutboxBySeq`
      would otherwise resend a superseded row for ever, and `checkIntegrity`
      derives expected depth from enqueued-minus-cleared, so a supersede that
      skips the counter is later reported to a farm as data loss. Doing it early
      buys nothing and risks exactly what it is meant to protect.
- [ ] **Restate P0-3 as a property of visible order**, rather than replacing the
      cursor. The verification pass re-ranked it and refused the original
      prescription; the restatement is what it left open.
- [ ] **The two-device harness**, and the six assertions listed under it. Every
      symptom P0-2 describes is invisible to a suite that runs one device, and
      the fix shipped without a test that could have caught the bug.
      **The harness is built and five of the six assertions with it** *(17
      August)* — `tests/support/devices.ts`, `tests/offline/two-devices.test.ts`,
      `tests/sync/two-devices.test.ts`, `tests/sync/photo-round-trip.test.ts`
      and `tests/sync/crash-recovery.test.ts`. The sixth is late-insertion
      behind an advanced cursor, which is P0-3 and stays deferred while its
      restatement is undecided — a test written now would encode a rule nobody
      has settled.
      **It paid for itself on the fifth.** The crash assertion, unblocked when
      the sweeper shipped, found N-4: the feed advanced the watermark past a
      `pending` row, so every device that pulled before the sweep missed that
      record permanently. The sweeper had been repairing records that reached
      nobody. Nothing but a second device could express it — the sweeper's own
      suite reads the feed from `since: 0`, which is a phone that has never
      pulled.
      **Every one of them was watched to fail**, which the first version of this
      note said was impossible here. It was not: a mongod in a container needs no
      egress to MongoDB, and `tests/support/mongo.ts` now says so in the message
      it prints when it cannot find one. The earlier claim that these suites were
      CI-only was what let a broken assertion reach CI in the first place.

## 8. Undecided, and not refused

**Named so an absence stops reading as a judgement.** None of this is agreed and
none of it is rejected; it is the part of `UNCONSIDERED.md` that has not been
argued to a conclusion. Listed as clusters rather than items because the
decisions are cluster-shaped — one argument settles each group.

- **Entry quality** — `[174]`–`[180]`. Plausibility of a typed figure, the
  double-log at 6:02 and 6:04, undo on the screen that just wrote, duplicate
  entities, unnormalised free text. **`GAP-ASSESSMENT-REVIEW.md` §3 names this
  as one of the six things the assessment is blind to, and then nothing carries
  it** — §5's withdrawal sanity check is the only entry-quality line in this
  file, and it covers one field on one screen. Nothing in the app checks a
  figure anywhere: the schemas bound it (an egg count stops at 10,000) and
  `WeighScreen` shows the last three weighings beside the form on a wide window,
  which is context rather than a check.
- **Data protection beyond the two policies** — `[6]` subject access, `[12]` the
  EU trader declaration, `[15]` the bundled reference data's licensing, `[19]` a
  retention floor for medicine records. §2 and §3 carry the launch-blocking
  paperwork; these four are the same kind of work and were not argued.
- **Security posture** — `[53]`–`[67]`. Secret rotation, dependency
  vulnerabilities, per-org quota, app lock, a lost device, `SECURITY.md` and a
  disclosure address. Two of them are narrower than they read and worth saying
  so: `[64]` is about the S3 successor rather than today — GridFS is covered by
  `tests/isolation/photo-bytes.test.ts`, in both directions — and `[65]` is
  specifically `/sync`, which is the one route with no `@fastify/rate-limit`
  scope on it; auth, billing and members all have one.
- **Accessibility and language** — `[69]`–`[75]`. Screen-reader flow, colour as
  the only carrier of meaning, locale formatting, English-only. §6 carries font
  scaling `[68]` alone, because the rail has already clipped its labels twice.
- **The domain phases** — `[91]`–`[135]`, which are phases K, L and M in
  `UNCONSIDERED-PHASES.md`. §4 and §5 take the parts the gap assessment reached
  independently; grazing, forage, water, soil, quarantine, biosecurity, labour
  and the rest are untouched by either sweep's conclusions.
- **Device and platform reach** — `[77]`–`[90]`. Barcode, EID, Bluetooth
  scales, printing, calendar export, foldables, Chromebooks. `[76]`, voice, is
  argued in §6's wet-glove item and is still undecided as work.
- **A control centre on the box** — *raised here 17 August and decided the same
  day, so it has moved to §6.* Left as a pointer rather than deleted, because
  this list is what somebody reads to find out whether a thing was considered.
---

## Rejected, and why

Named here so the boundary is unambiguous and nothing below gets picked up
later by accident.

- **The universal farm-event structure, as an entity.** The append-only/mutable
  split is what makes sync conflict-free: an immutable record cannot be
  disagreed about, so applying it is insert-if-absent and replay is a no-op. One
  event type spanning both classes must be mutable, which puts conflict
  resolution back into the daily logging path — the one property the whole
  architecture exists to protect. **Adopted as a field set instead**, §4.
- **The assessment's delivery order**, which places account and Play
  requirements at step 10 of 10. Those are the only items whose cost is calendar
  rather than effort. Its steps 1 and 2 are correctly placed and are §1 here.
- **Per-bird egg logging as a default workflow.** Five hens share a roost, so a
  per-bird tally is a guess recorded as a fact. The narrow breeder case is
  approved in §5 and is a different thing.
- **Satellite imagery, GPS field boundaries, e-commerce and CSA orders,
  double-entry accounting, payroll, vehicle telematics, dairy processing
  workflows, and a dedicated equipment-PDF subsystem.** The assessment reached
  every one of these independently and agrees. A generic file attachment covers
  manuals.
- **Inventory reorder and expiry alerts as an early item.** Not refused —
  deferred to last of the notification set, because an alert nobody can act on
  from a barn is how a farm learns to dismiss the ones that matter.
