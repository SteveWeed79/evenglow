# Pick up here

**Last worked: 16 August 2026.** The server is live. The app still has not been
pointed at it, and that still needs the tablet — but the *route* to a tablet
changed today, and §0 is the record of that.

This file is a point-in-time note, not a spec. It goes stale by design.
`DEPLOY-THE-SERVER.md` is the durable version for the server; for the app,
`TESTING-BUILD.md` §7 is.

---

## 0. Where 16 August left things

Three threads. Two are finished and unverified; one is half done and knows it.

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
> kept rather than edited away. **§12 is the honest ledger: none of it has been
> looked at on a tablet.** The suite has no layout engine and every phone falls
> on the narrow side of every branch. The rail's labels are the first thing to
> look at; that bar has clipped its words twice before on arithmetic that said
> they would fit.

`UX-SPEC.md` R3 was amended, not bent: primary actions live in the bottom third
on a compact window and the bottom **outer corners** on an expanded one,
because a tablet in landscape is held in two hands and the centre-bottom is a
dead spot. Nothing about a phone changed.

### The APK now builds on a GitHub runner — merged, first run in flight

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

**First run: [31922188936](https://github.com/SteveWeed79/steading/actions/runs/31922188936)**,
dispatched from `main` at `9daed0c`. At the time of writing it was on the Gradle
step with every earlier step green — including the secrets check, the
versionCode derivation and the prebuild. **Its outcome is not recorded here;
look at the run.**

Two things about that first run:

- It should produce **`steading-0.1.13-18.apk`** and a release tagged
  `v0.1.13+18`. 18 because `EAS_LAST_CODE` is 17 — the code EAS consumed on the
  submission that the quota then refused.
- **The real test is the install, not the green tick.** Put it on the tablet
  *over* the existing app without uninstalling. If it goes on and the records
  survive, the signature matched and the whole chain is proven. If Android
  refuses with a signature error, **stop** — the keystore is not the one EAS has
  been signing with, and nothing should ship until that is understood.

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
absent or points at a local machine. `pnpm stamp` runs before the prebuild.

> **So the APK from run 1 is not usable against the live server.** Rebuild
> after the fix lands. The run is still worth watching for the signature check,
> which is the part it can prove.

> **PR #154's description is stale.** It describes the first draft, where
> `versionCode` was a required free-text input. The second commit replaced that
> with derivation. `TESTING-BUILD.md` §7 and the code are correct; the PR body
> is not.

### The box still pulls from EAS — this is the open work

`deploy.sh` finds the APK by asking EAS (`eas build:list`). **So a
runner-built APK never reaches the shelf.** The box will go on serving the last
EAS build, with no error — the same silent half-done shape as #153 itself.

This is #153's remaining half, and there is a decision in it. The EAS lookup
filters on `--git-commit-hash "$NOW_FULL"` — *the build made from the commit
this box is serving*. Its own comment argues that is better than a build id
because it needs no channel between CI and the box. **Swapping in "newest
GitHub Release" throws that away**, and breaks specifically: `release` bumps the
version, commits it and promotes *that* commit, while the APK workflow is
dispatched separately at whatever `main` is. Two commits, no link.

The coherent fix is two parts:

1. **`ci.yml`'s release job calls `apk.yml`** instead of `eas build`.
   `workflow_call` is already on `apk.yml` for exactly this. The APK is then
   built at the promoted commit and the commit link is restored.
2. **`deploy.sh` looks up the release whose tag points at `$NOW_FULL`** and
   takes its APK asset URL. Same three guarantees, same `.last-artifact`
   marker, same "the box pulls, nothing pushes" shape — and `EXPO_TOKEN` comes
   off the box entirely.

The decision logic belongs in a tested `.mjs`, not in shell, for the reason
`scripts/lib/apk.mjs` gives.

**The cost, which is a real choice and not an oversight:** today you can promote
the server without building an app (`bump: none`). Under (1) the two become one
action, so a server-only fix waits on a Gradle build. The release job's own
comments argue *"am I shipping a new app?" is one question, not two* — but it is
worth deciding deliberately.

**Until this lands, both build routes should stay.** The APK workflow costs no
quota and the EAS one still feeds the box.

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
| Atlas reachable **from the service process**, not just the box | `POST /auth/login` with a junk email returned *"That email or password is not right."* — that route reads `users`, so a clean 401 proves the connection |
| The server data path against the real cluster | `pnpm db:verify` — 55/55, including cross-tenant isolation, idempotent replay, role refusals and archive-not-delete |
| Indexes on the real database | `pnpm db:indexes` reported *Indexes applied to "steadingdb"* |

## The facts this box actually runs on

| | |
|---|---|
| Host | Oracle Ampere A1, `aarch64`, 2 OCPU / 12 GB, Ubuntu 24.04 |
| Public IP | `147.224.207.159` |
| Hostname | `api.swbuild.dev` |
| DNS | **GoDaddy** holds the zone (`ns71`/`ns72.domaincontrol.com`). Vercel is only the registrar's tenant on the apex — a record added on Vercel's side would be ignored |
| VCN | `vcn-20260115-1714`, Default Security List, ingress on 22 / 80 / 443 |
| Atlas | cluster `steadingdb`, **database `steadingdb`**, M0 free, AWS us-east-1 |
| Checkout | `/opt/steading`, tracking `main` |
| Config | `/etc/steading/api.env`, mode 0600 — `AUTH_SECRET`, `MONGODB_URI`, `MONGODB_DB=steadingdb`, `TRUSTED_PROXY_HOPS=1`, `PORT=3001` |

**`MONGODB_DB=steadingdb` is load-bearing.** `env.ts` defaults it to `steading`,
and this cluster's database is not called that. Without the line the service
starts, connects, serves an empty database and reports nothing wrong.

**There is a systemd drop-in on this box that must not be lost yet:**
`/etc/systemd/system/steading-api.service.d/netlink.conf`. It adds `AF_NETLINK`
to `RestrictAddressFamilies`, without which the service binds its port and then
exits 1. The real fix is in PR #100; the drop-in can go once that merges and
`deploy.sh` has run.

---

## Next, and it needs the tablet

### 1. Build the tester APK — any machine with the checkout

```
pnpm --filter @steading/mobile exec eas login
pnpm --filter @steading/mobile exec eas build --profile preview-farm --platform android
```

`preview-farm`, **not** `preview`. The profile carries
`EXPO_PUBLIC_API_URL=https://api.swbuild.dev`, which is compiled into the APK;
`preview` leaves it empty and the sync chip reads *Not set up*. EAS prints a URL
and that URL is the install link.

### 2. Read the tablet's queue depth before touching anything

Settings → Sync. **Write the number down.** That is what should drain in step 3,
and it is the only way to tell a working first flush from a stalled one.

This is the *"first flush at volume"* case `ACCESS-AND-BILLING.md` §6 names.
`tests/offline/first-flush.test.ts` now covers it and passes, but that is a test
and this is a real farm's history. If it stalls, nothing is lost — the queue
accumulates rather than dropping.

### 3. The tablet first, still on its USB dev build

Sign up on the tablet **before any EAS APK goes near it**. Signing up claims the
org the device already minted (D15) and flushes its queue, so the records reach
Atlas without anything being retyped.

> **Installing the EAS APK over a locally-built one forces an uninstall** —
> different signing keys, `INSTALL_FAILED_UPDATE_INCOMPATIBLE` — and an
> uninstall takes the farm. Pick one route per device and stay on it: local for
> the machine you develop on, EAS for anything handed to somebody else.

### 4. Then the phone

Install the EAS APK, sign in with the same account. The records arrive by
snapshot. **That is the continuity test** and the whole point of the exercise.

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
      released on stop/start, and losing it silently breaks the DNS record, the
      Atlas allowlist and the certificate at once. A plain reboot keeps it.
- [ ] **Dedupe `MONGODB_DB` in `api.env`.** It was written twice, both
      `steadingdb`, so the value is right and systemd takes the last one — but a
      later edit to the first line would be silently overridden.
      `sudo grep -c '^MONGODB_DB=' /etc/steading/api.env` should print `1`.
- [ ] **`rm -f /tmp/dbs.cjs`** — a throwaway script used to list databases.
- [ ] **Confirm the reboot survives.** `uptime -p` after a `sudo reboot`, then
      `/health` from elsewhere. The unit is enabled and the iptables rules were
      persisted, but neither has been observed surviving a restart.

Known and deliberately deferred:

- **No backups *yet*, and now only for want of a bucket.** Atlas M0 shows
  `Backups: Inactive`, so the farm's 3.8 MB exists in one place.
  `ACCESS-AND-BILLING.md` §4.1a-i calls a tested restore a condition of the
  first real farm rather than a nicety.

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
- **Photos share the 512 MB M0 cap, and nothing warns in time.** Photo bytes
  live in GridFS in this same database (`blobsFor(orgId)`, bucket `photoBytes`),
  so they count against the tier's total. At the 200–400 KB the app resizes to,
  that is roughly **1,300–2,500 photos** before the cluster is full; `photoShape`
  permits 25 MB per photo, so ~20 would do it if anything ever escapes the
  resize path. When M0 fills, writes fail — and a farm sees rejected mutations,
  not "the server is full".

  `db:usage` watches for photo bytes past **10 GB**, which is twenty times this
  cluster's entire capacity, so that signal cannot fire first. Its reasoning is
  about `mongodump` size and is right for a self-hosted mongod; it is the wrong
  constraint for M0. Either add a capacity-aware warning, or treat Atlas Flex
  ($8/month, priced in §4.1a) or the S3 move (§4A) as due earlier than the
  documented signal implies.
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
`pnpm farm:show <id>` both read `MONGODB_URI`, so they can run from any machine
with the checkout and a route to Atlas — not only from the box.
