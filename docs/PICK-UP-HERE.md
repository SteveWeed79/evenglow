# Pick up here

**Last worked: 16 August 2026.** The server is live, and the app now builds,
signs, archives and *reaches the shelf* on its own — one button, no manual step
in the middle. What is left needs a tablet in somebody's hands, which no amount
of CI can stand in for. §0 is the record of how the route got here.

This file is a point-in-time note, not a spec. It goes stale by design.
`DEPLOY-THE-SERVER.md` is the durable version for the server; for the app,
`TESTING-BUILD.md` §7 is.

---

## 0. Where 16 August left things

Three threads. **Two of them are finished and proven on real hardware:** the
box no longer pulls from EAS, and the whole promote-to-shelf chain ran
unattended — `v0.1.15+19` is on the box and served at `/app`. The landscape
layout is the one still waiting on the thing it always was: a tablet.

### The landscape layout — merged, never seen on a device

`docs/LANDSCAPE-PLAN.md` is the design and the record. Phases A–C are built and
merged (**#151**), phase D is the document itself.

The complaint was that a 10" tablet in landscape rendered a 600dp column with
340dp of plaster either side — 53% of the window was texture. The app had one
breakpoint, 600, used for two different jobs, and no way to say "expanded" or
"large" at all.

What is now in `main`: `theme/window.ts` (the vocabulary, pure and tested),
`insets.left`/`insets.right` finally reserved, `LAYOUT.wide` and `<Grid>` for
the hubs and charts, `above`/`aside` panes on `Screen`, list-detail on History,
Stock and Iron, a context pane on Weigh, and the tab bar becoming a navigation
rail at expanded width.

> **§11 of the plan is the list of five places the plan lost to the code** —
> kept rather than edited away. **§12 is the ledger of what a device has and
> has not answered.** It has been looked at once: one screenshot found two
> defects no test could reach and corrected the device dimension the plan was
> drawn against (§11a). The suite has no layout engine and every phone falls on
> the narrow side of every branch, so that look is still the only evidence
> there is — and it was of the *broken* state. The rail's labels are the first
> thing to check next, at 96dp this time; that bar has clipped its words twice
> before on arithmetic that said they would fit.

`UX-SPEC.md` R3 was amended, not bent: primary actions live in the bottom third
on a compact window and the bottom **outer corners** on an expanded one,
because a tablet in landscape is held in two hands and the centre-bottom is a
dead spot. Nothing about a phone changed.

### The APK now builds on a GitHub runner — and, after four runs, works

**Issue #153** is what set this off. A promote hit EAS's monthly free-tier
Android build cap: the server shipped, the app build was refused, and the step
that would have said so is the one that skips on failure. The run summary for a
half-done release was blank.

**#154** is the escape. `.github/workflows/apk.yml` runs `expo prebuild` and
Gradle on a GitHub runner and signs with our own keystore. **No Expo account is
in the path**, so no quota can refuse it.

| | |
|---|---|
| Workflow | `.github/workflows/apk.yml` — Actions → APK → Run workflow |
| Decisions | `scripts/lib/apk.mjs`, held by `tests/unit/apk.test.ts` (22 cases) |
| CLIs | `scripts/apk-plan.mjs` (names it, stamps `app.json`), `scripts/apk-check.mjs` (the gate) |
| Docs | `TESTING-BUILD.md` §7, *"Building it ourselves, when EAS will not"* |

**The five signing secrets are set** (16 Aug). They came out of
`eas credentials` → Download credentials, which also served as the §8 keystore
backup that had never been taken.

**First run:
[31922188936](https://github.com/SteveWeed79/steading/actions/runs/31922188936)
— failed, and the outcome is now recorded rather than left to be looked up.**

Dispatched from `main` at `9daed0c`. It got through the secrets check, the
versionCode derivation, the prebuild, twelve minutes of Gradle and the signing,
and then **failed its own signature check** — step 13 of 14, with `publish`
skipped. So the expensive half of the pipeline is proven: a runner really does
build and sign this app, and the quota was never in the path.

The cause is the fingerprint-label defect fixed in `83c5df3` (merged in #155,
so it is in `main`): `keytool` prints `SHA256: A1:B2:…`, **`SHA256` contains
four hex characters**, and stripping non-hex without removing the label first
prepended `A256` and produced 68 characters that matched nothing. That was
written up as *"a likely cause rather than a confirmed one — the failure text is
buried under Gradle's cache-saving output"*, and the run's step list is
consistent with it: signing succeeded, the check that reads the secret is what
refused.

**That reading was wrong, and the second promote said so.** It is recorded
below rather than left as a theory that quietly stopped being true.

Two more things about that run:

- It never produced an artefact, so there is no `steading-0.1.13-18.apk`
  anywhere and no `v0.1.13+18` tag. The next run derives 18 again — 18 because
  `EAS_LAST_CODE` is 17, the code EAS consumed on the submission the quota
  refused.
- It also predates the `EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_BUILD` fix below, so
  even a green run 1 would not have been usable against the live server.
- **The real test is still the install, not the green tick.** Put it on the
  tablet *over* the existing app without uninstalling. If it goes on and the
  records survive, the signature matched and the whole chain is proven.

#### The second promote, which got further and named the real cause

Run
[31925150611](https://github.com/SteveWeed79/steading/actions/runs/31925150611),
the first promote through `ci.yml` → `apk.yml`. `verify`, `container` and
`release` all green — the version moved to **0.1.14** and `release` was pushed,
so the server half shipped. `app / build` then failed at the same step and with
**a different message**:

```
- No SHA-256 certificate digest in the apksigner output — is the APK signed?
```

**No comparison happened at all**, so the key-mismatch stop was never reached
and the label theory above was never even exercised. What failed was reading
the output: `certificateFrom` was pinned to the literal
`Signer #1 certificate SHA-256 digest:`, and newer build-tools qualify that
line with the SDK range it covers. The workflow takes the **newest**
build-tools on the runner by design, so a fixed string was always going to
drift out from under it.

**The APK was signed correctly.** `apksigner verify` exits non-zero when an APK
does not verify, the Sign step runs under `set -euo pipefail`, and that step
passed — so the artefact verified and only the parsing failed. Everything else
the check looks at was right too: it reported no other problem, meaning
package, `0.1.14` and versionCode 18 all matched, which is the whole stamp and
prebuild chain proven.

Fixed by matching the signer line however it is qualified, and — the part that
matters more — **by printing what was actually read**. The old message was two
completely different repairs wearing one sentence, and the only way to tell
them apart was another thirteen-minute build.

#### And that fix was still a guess. Here is the format, from a real runner

APK run 2 failed the same way, and this time the log said why. **The prefix is
per signing scheme**, not a signer number and not an SDK range:

```
V3.0 Signer: certificate DN: CN=, OU=, O=, L=, ST=, C=US
V3.0 Signer: certificate SHA-256 digest: e5cc9f91ba8d6f5ce0afa2482ca765d10efebfd7d2f5fbc111d93247428863cc
V3.0 Signer: certificate SHA-1 digest: a25ba0bf06d52ed6e109d361ffc1ccb43c5ef4fb
V3.0 Signer: certificate MD5 digest: e57ad165764850942329018d31af2152
```

Three formats guessed at across three builds, twenty-six minutes of Gradle
spent learning that **the prefix is the part that moves**. So it is no longer
matched at all: `certificate SHA-256 digest:` is the only thing every version
of every format has agreed on, and that is what the parser looks for now. The
real output is a test fixture, copied verbatim, because every previous version
of this parser was written against a guess.

Two things that run settled, both worth keeping:

- **The APK is signed with our keystore, not a debug key.** A debug key's DN is
  `CN=Android Debug, O=Android, C=US`; blank fields with `C=US` is what EAS
  generates. So `ANDROID_KEYSTORE_BASE64` is real and is being used, and the
  Gradle-then-resign path works end to end.
- **The APK's certificate SHA-256 is
  `E5:CC:9F:91:BA:8D:6F:5C:E0:AF:A2:48:2C:A7:65:D1:0E:FE:BF:D7:D2:F5:FB:C1:11:D9:32:47:42:88:63:CC`.**
  That is now a known quantity and does not need another build to obtain. If
  `ANDROID_CERT_SHA256` does not equal it, the secret is what is wrong — not
  the keystore — and it can be corrected before the next run rather than after
  it.

#### Run 3 was green. The build half is done

[31927760927](https://github.com/SteveWeed79/steading/actions/runs/31927760927),
at `f149da8`. Build, sign, verify, publish — all of it — and
**[`v0.1.14+18`](https://github.com/SteveWeed79/steading/releases/tag/v0.1.14%2B18)
carries `steading-0.1.14-18.apk`**, published 05:10 on 16 August.

The key was right the whole time. `ANDROID_CERT_SHA256` matches the APK's
certificate exactly, 64 characters, no formatting problem — so the comparison
that four runs never reached passes on the first attempt it got. **Every one of
those failures was the parser, not the keystore and not the secrets.** Worth
saying plainly because the wrong diagnosis was offered more than once, and the
evidence against it was in the run all along: the preflight step that exits on
a missing secret (`The signing key has to be here`) reports success in every
run, and the string `Signing secrets are not set` appears nowhere in any log.

So this is now proven, on a real runner, with no Expo account and no quota
anywhere in the path:

| | |
|---|---|
| Gradle builds and signs | ~13 minutes |
| The APK is what it claims | package, `0.1.14`, versionCode 18 |
| Signed by the farm's key | certificate matches the secret |
| Archived | a Release, tagged at the commit it was built from |

**What has still never run is the box half.** `deploy.sh` resolving its commit
to a tag and fetching the release has not been exercised once, and it cannot be
by a standalone build: this release is tagged at `main`'s tip, which is not the
commit `release` points at, so no box will look for it. That is deliberate, and
it means the next promote is the first real test of the second half.

#### A defect found while writing this section, and fixed

Run 1 was already in flight when it turned up. **A runner build reads no
`eas.json` profile**, so the two build-time values `preview-farm` carried were
both missing:

- **`EXPO_PUBLIC_API_URL`** — inlined by Metro into `boot/config.ts`. Without
  it the app boots and says *"This copy of the app was built without the address
  of your farm server"*.
- **`EXPO_PUBLIC_BUILD`** — written by `pnpm stamp` into
  `apps/mobile/.env.local`, which `eas-build-post-install` used to do. Without
  it a support bundle cannot say which build a report came from.

It is the worst shape in the whole pipeline: builds, signs, passes every check,
installs cleanly, and is useless. Every guard held and none of them was looking
at this.

`apk-plan.mjs` now lifts the address via `farmOrigin` — the same profile the EAS
build would have read, so it is not written down twice — and refuses if it is
absent or points at a local machine. The stamp runs before the prebuild.

> **So the APK from run 1 is not usable against the live server.** Rebuild
> after the fix lands. The run is still worth watching for the signature check,
> which is the part it can prove.

#### And the fix for that had a defect of its own, also fixed

The step added above ran **`pnpm stamp`**, and there is no `stamp` script in the
root manifest — it is in `apps/mobile/package.json`. From the repository root
that exits 254 with `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`, which is a hard
failure of the step, so **the next APK run would have died at step 10 of 14**
before Gradle. It is now `pnpm --filter @steading/mobile stamp`.

Nothing caught it because nothing could: run 1 predates the step, and there has
been no run since. It is the third time in this one pipeline that a change was
written, merged and first exercised on the run that mattered — which is the
argument `apk.yml`'s own header makes for keeping judgement out of YAML, landing
on the part of the file that is not judgement and cannot be moved.

#### The tablet is 960dp, and the pane work is dormant on it

First screenshot of the rail, 16 August. Two bugs fixed — the rail rendering at
Material's 360dp *drawer* default because `minWidth` beat our `width`, and the
bottom inset going unreserved once the bar was no longer at the bottom.

**The finding underneath them matters more.** The tablet is 960 × 600dp, and
`LANDSCAPE-PLAN.md` was drawn for 1280 × 800. After a correct rail that leaves
864dp, against a 992dp two-pane threshold — so **Today's aside, and the
list-detail on History, Stock and Iron, will not appear on this hardware.** Not
a bug: 600 + 24 + 200 + 48 is already 872, so even a token aside does not fit
beside the measure. The plan's §11a has the arithmetic.

The rail, the two-column hubs and the wider charts all do land. The pane code
is correct, tested, and waiting for a wider window.

> **PR #154's description is stale.** It describes the first draft, where
> `versionCode` was a required free-text input. The second commit replaced that
> with derivation. `TESTING-BUILD.md` §7 and the code are correct; the PR body
> is not.

### The box pulls the Release now — and has done it, on the real box

**This was the open work and it is done** — both parts as they were set out
here, plus the tested `.mjs` the note asked for, **and it has now run on the
box.** `v0.1.15+19` was resolved from the deployed commit, fetched and
published without anybody touching the shelf. §1 has the whole run.

| | |
|---|---|
| Decisions | `scripts/lib/release-apk.mjs`, held by `tests/unit/release-apk.test.ts` |
| CLI | `scripts/release-apk.mjs` — `git tag --points-at HEAD \| … --remote <origin>` |
| Wiring | `ci.yml`'s `app` job calls `apk.yml`; `deploy.sh`'s app block |
| Docs | `TESTING-BUILD.md` §7, `DEPLOY-THE-SERVER.md` §7 |

**The commit stayed the key, which was the constraint.** The EAS lookup filtered
on `--git-commit-hash` and argued that beat a build id because it needs no
channel between CI and the box; "newest GitHub Release" would have thrown that
away. So git on the box resolves HEAD to a `v<version>+<code>` tag — locally, no
network, nothing handed over — and GitHub is asked only what is attached to that
tag. `ci.yml` passes the **promoted sha** to `apk.yml` (a new `ref` input),
because the version-bump commit is the one `release` points at and it does not
exist when the run starts. Without that the tag would land a commit early and
the box would never find it.

**The feared cost did not materialise, and that is worth writing down rather
than leaving as a decision somebody still owes.** The note here said the two
would become one action, so a server-only fix would wait on a Gradle build. It
does not: the app job runs *after* `release` is pushed, so the server is already
shipping while Gradle runs, and `bump: none` still skips the app entirely —
the property is preserved exactly. The quarter of an hour only keeps the run
marked in progress. One thing genuinely did change: **a failed app build is now
a red job** rather than the silence #153 was, which is the point.

`EXPO_TOKEN` is off the box. There is no credential on that machine for
anything to leak, because a public repository's releases are readable by
anybody; `GITHUB_TOKEN` in `deploy.env` is honoured if the repo is ever made
private.

**Both build routes still work.** Nothing removed `eas build` as a thing a
person can run by hand, and the EAS quota resets on 1 September. What changed is
which one CI uses and which one the box reads.

### Other state worth knowing

- **EAS's Android quota resets 1 September 2026.** `versionCode` 17 was burned
  by the refused submission.
- **`eas.json` still says `appVersionSource: remote`**, so `app.json`'s
  `versionCode: 3` is stale and ignored by EAS. Deliberately left alone —
  flipping it would change the EAS path too. If EAS is dropped entirely, the
  repo should own that counter.
- **`main` is at v0.1.13**, promoted 15 Aug. The `release` branch moved with it,
  so the **server** is current; the **app** on any device is not.

---

## Done, and verified rather than assumed

`https://api.swbuild.dev/health` answers `{"ok":true}` over TLS from outside the
box. That single response covers DNS, both firewalls, Caddy's certificate, and
Fastify behind it.

| Checked | How |
|---|---|
| The whole request path | `curl https://api.swbuild.dev/health` from a machine that is not the box |
| The database reachable **from the service process**, not just the box | `POST /auth/login` with a junk email returned *"That email or password is not right."* — that route reads `users`, so a clean 401 proves the connection |
| The server data path against the real database | `pnpm db:verify` — 55/55, including cross-tenant isolation, idempotent replay, role refusals and archive-not-delete |
| Indexes on the real database | `pnpm db:indexes` reported *Indexes applied to "steadingdb"* |

> **The last three were run while the data was still on Atlas.** The database
> has since moved onto the box (below), and none of them has been re-run against
> the local `mongod`. They are cheap and they are the checks that would notice a
> half-finished move: `db:verify` and `db:indexes` both take a `MONGODB_URI` and
> do not care which one.

## The facts this box actually runs on

| | |
|---|---|
| Host | Oracle Ampere A1, `aarch64`, 2 OCPU / 12 GB, Ubuntu 24.04 |
| Public IP | `147.224.207.159` |
| Hostname | `api.swbuild.dev` |
| DNS | **GoDaddy** holds the zone (`ns71`/`ns72.domaincontrol.com`). Vercel is only the registrar's tenant on the apex — a record added on Vercel's side would be ignored |
| VCN | `vcn-20260115-1714`, Default Security List, ingress on 22 / 80 / 443 |
| Database | **`mongod` on this box**, bound to `127.0.0.1`, standalone, **database `steadingdb`**. Atlas is gone |
| Checkout | `/opt/steading`, tracking `main` |
| Config | `/etc/steading/api.env`, mode 0600 — `AUTH_SECRET`, `MONGODB_URI`, `MONGODB_DB=steadingdb`, `TRUSTED_PROXY_HOPS=1`, `PORT=3001` |

**The database is on the box, and Atlas has been deleted.** That was
`DEPLOY-THE-SERVER.md`'s *"Moving the database onto the box"* — `setup-mongo.sh`
then `migrate-to-local-mongo.sh` — and the cluster it came from no longer exists.
Three things follow, and each of them changes an answer this file used to give:

- **The 512 MB ceiling is gone.** Photos in GridFS now run against the box's
  disk, not a free tier's allowance. `df -h /` is the number that matters.
- **`db:usage`'s 10 GB photo signal is now the right one**, not a threshold
  twenty times the capacity it was watching. Its reasoning was always about
  `mongodump` size on a self-hosted `mongod`, which is what this is.
- **Nobody else holds a copy.** A managed tier at least ran on somebody else's
  disks; this is one `mongod`, on one volume, on one instance. See the backups
  item below, which is the same item it always was and now the only one.

**`MONGODB_DB=steadingdb` is load-bearing.** `env.ts` defaults it to `steading`,
and this box's database is not called that. Without the line the service starts,
connects, serves an empty database and reports nothing wrong.

**There is a systemd drop-in on this box that must not be lost yet:**
`/etc/systemd/system/steading-api.service.d/netlink.conf`. It adds `AF_NETLINK`
to `RestrictAddressFamilies`, without which the service binds its port and then
exits 1. The real fix is in PR #100; the drop-in can go once that merges and
`deploy.sh` has run.

---

## Next, and it needs the tablet

### 1. Promote — done, and the whole chain is proven

**This step is finished.** `v0.1.15+19` was promoted on 16 August and reached
the shelf with nothing manual in the middle. What ran, in order, and all of it
unattended:

| | |
|---|---|
| **Actions → CI → Run workflow**, `bump: patch` | verify, container |
| `release` job | version 0.1.14 → 0.1.15, `release` moved to `6bc6b2d` |
| `app` job (`apk.yml`) | prebuild, 13 min of Gradle, sign, verify |
| Release published | `v0.1.15+19`, **tagged at `6bc6b2d`** |
| The box, on its own timer | deployed `6bc6b2d` before anybody logged in |
| `deploy.sh` | `v0.1.15+19 -> steading-0.1.15-19.apk`, 92 MB fetched, published |

`https://api.swbuild.dev/app` now serves `steading-0.1.15-19.apk`. **That
address is the install link** — a constant, unlike an EAS artefact url, which
is new every build and dies after thirty days.

**The tag landing on `6bc6b2d` is the part that had to be right**, and it is
why `ci.yml` hands the promoted sha to `apk.yml` rather than letting it default.
The version-bump commit does not exist when the run starts; without that input
the tag lands a commit early and the box looks for it forever.

**The failure path was observed too, by accident and usefully.** A `deploy.sh`
run seven minutes before the build finished printed
`no app release tag on this commit — the shelf keeps what it has` and
`nothing to publish for this commit`, then left the existing APK alone. That is
the designed behaviour for "the build is still running", and it has now been
seen on the real box rather than only in tests.

> **One cosmetic wart, found on the page and fixed.** It read
> `Version 0.1.15-19` where the wording is meant to be
> `Version 0.1.15 · build 19`. The box has no `aapt2` and is not getting one, so
> `publish-apk.sh` could not read the numbers out of the APK and printed the
> label `deploy.sh` had passed — a filename stem dressed as a version.
>
> The label is `<version>-<code>`, so both numbers were there and simply never
> taken apart. They are now, which makes the name, the *Publishing* line and the
> stamp all come from one place, and gives a box with no Android SDK the same
> output as a machine with one. **The filename is deliberately unchanged** —
> `deploy.sh`'s "already serving" check compares against
> `steading-<version>-<code>.apk`, and renaming it would have made every box
> re-download ninety megabytes on the next tick.
>
> `deploy.sh`'s own recovery stamp — the one that reads the symlink when
> `.version` is missing — got the same split, because two writers of one line on
> one shelf disagreeing would look like the box had changed its mind about what
> it was serving. Labels that are not `<version>-<code>` (`nightly`,
> `0.1.15-rc1`) are still left whole, and the timestamp fallback still produces
> no stamp at all rather than a number that means nothing.

To build **without** promoting — a signing fix to prove out — **Actions → APK →
Run workflow** still works and leaves the shelf alone, deliberately: it is not
built at a commit any box is serving. `v0.1.14+18` is such a build and sits in
the archive unfetched, which is the proof that rule holds.

The EAS route also still works by hand (`eas build --profile preview-farm`,
**not** `preview` — the profile carries `EXPO_PUBLIC_API_URL` and `preview`
leaves it empty, so the sync chip reads *Not set up*). Its quota resets on
1 September.

### 2. Read the tablet's queue depth before touching anything

Settings → Sync. **Write the number down.** That is what should drain in step 3,
and it is the only way to tell a working first flush from a stalled one.

This is the *"first flush at volume"* case `ACCESS-AND-BILLING.md` §6 names.
`tests/offline/first-flush.test.ts` now covers it and passes, but that is a test
and this is a real farm's history. If it stalls, nothing is lost — the queue
accumulates rather than dropping.

### 3. The tablet first, still on its USB dev build

Sign up on the tablet **before any released APK goes near it**. Signing up
claims the org the device already minted (D15) and flushes its queue, so the
records reach the server without anything being retyped.

> **Installing a released APK over a locally-built one forces an uninstall** —
> different signing keys, `INSTALL_FAILED_UPDATE_INCOMPATIBLE` — and an
> uninstall takes the farm. Pick one route per device and stay on it: local for
> the machine you develop on, the shipped build for anything handed to somebody
> else.
>
> A runner-built APK and an EAS one are **not** two routes in that sense: the
> whole point of `ANDROID_CERT_SHA256` is that they carry the same signature, so
> one installs over the other as an ordinary update. That is precisely the claim
> run 1 was meant to prove and has not yet — see §0.

### 4. Then the phone

Install from `https://api.swbuild.dev/app`, sign in with the same account. The
records arrive by snapshot. **That is the continuity test** and the whole point
of the exercise.

### 5. A second person, optionally

Farm → Members → mint a join code. Six characters, ten minutes, one use. Redeem
it on the second device rather than signing in, if the aim is a second person
rather than a second device.

**Billing will not stop any of this.** `access.ts` returns
`{ syncing: true, refusal: null }` whenever `playConfig === null`, which is this
server. No farm is refused sync and `pnpm farm:grant` does nothing observable
until Play is configured.

---

## Loose ends, honestly labelled

Told to do, never confirmed done — worth checking rather than assuming:

- [ ] **Reserve the public IP.** Instance → Attached VNICs → the VNIC → IP
      administration → Ephemeral → **Reserved**. An ephemeral address is
      released on stop/start, and losing it silently breaks the DNS record and
      the certificate at once. A plain reboot keeps it. *(It used to break the
      Atlas allowlist too. With the database on the box and reached over
      loopback, that failure mode has gone with it.)*
- [ ] **Dedupe `MONGODB_DB` in `api.env`.** It was written twice, both
      `steadingdb`, so the value is right and systemd takes the last one — but a
      later edit to the first line would be silently overridden.
      `sudo grep -c '^MONGODB_DB=' /etc/steading/api.env` should print `1`.
- [ ] **`rm -f /tmp/dbs.cjs`** — a throwaway script used to list databases.
- [ ] **Confirm the reboot survives.** `uptime -p` after a `sudo reboot`, then
      `/health` from elsewhere. The unit is enabled and the iptables rules were
      persisted, but neither has been observed surviving a restart.

Known and deliberately deferred:

- **No backups *yet*, and now only for want of a bucket — and now the only
  copy is here.** The farm's 3.8 MB is on this box's disk and nowhere else:
  Atlas held an off-site copy until the migration, and that cluster has been
  deleted. `ACCESS-AND-BILLING.md` §4.1a-i calls a tested restore a condition of
  the first real farm rather than a nicety, and the move onto the box is what
  makes that literal — there is no longer a second disk anywhere that has ever
  seen these records.

  `scripts/backup-mongo.sh` is written and **now scheduled** —
  `steading-backup.timer` nightly, `steading-backup-check.timer` failing a unit
  when the last one is over thirty-six hours old. What remains is genuinely
  configuration: an S3 bucket and an `age` keypair, public half on the box in
  `/etc/steading/backup.env`, private half in a password manager. Until those
  exist the timer runs and the script stops on the variable it needs, which is
  a state that reports itself.

  **`ROADMAP.md:477` used to say this was done.** Two documents disagreeing
  about whether a farm has backups is worse than either answer, and the roadmap
  was the one that was wrong — a script with no timer is not a backup. Both now
  say the same thing.
- ~~**Photos share the 512 MB M0 cap, and nothing warns in time.**~~
  **Withdrawn — it was true of Atlas and the database is no longer there.**
  Photo bytes still live in GridFS beside the records (`blobsFor(orgId)`, bucket
  `photoBytes`), but they now run against the box's disk: roughly 37 GB spare on
  a default 46.6 GB boot volume, which at 30 MB per farm-year is over a thousand
  farm-years. The old arithmetic — 1,300–2,500 photos to fill a free tier — does
  not apply to this deployment.

  **And `db:usage`'s 10 GB photo threshold is the correct signal here**, not a
  number twenty times the capacity it was watching. Its reasoning is about
  `mongodump` size on a self-hosted `mongod`, which is exactly what this now is.
  Nothing needs adding; the note that said otherwise was reasoning from a tier
  that has been deleted.

  **What survives the correction:** `photoShape` still permits 25 MB per photo
  against an app that resizes to 200–400 KB, so the ceiling is still four
  hundred times the typical, and a payload that escapes the resize path is still
  worth refusing at the boundary rather than storing. That was never an M0
  argument. `ACCESS-AND-BILLING.md` §4.1a-i's serverless 4.5 MB note is the
  other half of it.
- **Twenty-five VCNs in this tenancy**, nearly all duplicates on `10.0.0.0/16`,
  several created seconds apart in January. Only `vcn-20260115-1714` is live.
  They consume the tenancy's VCN limit, which is the kind of thing that makes a
  *future* instance fail to launch for no visible reason. Delete carefully —
  removing the wrong one takes this box's networking.
- **A leftover `UDP 5520` "Hytale Ingress" rule** on the live security list.
  Nothing listens on it, so it is a hole to nowhere rather than an exposure.
  Worth removing with the VCN cleanup.
- **After PR #100 merges:** run `sudo /opt/steading/scripts/deploy/deploy.sh`,
  then delete the netlink drop-in, then **re-run `pnpm db:indexes`** — that is
  what creates the unique partial index on `orgs.playPurchaseToken`, and it
  wants to exist *before* Play billing is configured, not after.

---

## When something is wrong

`DEPLOY-THE-SERVER.md`'s symptom table is the first stop. The three failures
this deployment actually hit, in case they recur:

| What you see | It is |
|---|---|
| Service binds then exits 1, five restarts, `uv_interface_addresses` errno 97 | The missing `AF_NETLINK`. The drop-in above, or PR #100 |
| Green `/health`, zero farms | `MONGODB_DB` — the database is `steadingdb`, not `steading` |
| Two accounts on one email, or nothing ever expires | `pnpm db:indexes` was never run against the real database |

Operational commands are in `OPERATOR.md`. `pnpm farm:ls` and
`pnpm farm:show <id>` both read `MONGODB_URI` — **and since the database moved
onto the box and bound itself to `127.0.0.1`, that means they run *on the box*.**
They used to work from any machine with the checkout and a route to Atlas; there
is no longer a route to reach from anywhere else. An SSH tunnel is the way to
run them from a laptop, and `OPERATOR.md` §"Where these run" has it.
