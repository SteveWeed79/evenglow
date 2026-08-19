# Getting a build into somebody's hands

How to put Steading on a tester's phone from a link, and what to tell them
before they install it.

---

## 1. The short version

```
pnpm --filter @steading/mobile exec eas login                     # once
pnpm --filter @steading/mobile exec eas build:configure           # once, if it asks
pnpm --filter @steading/mobile exec eas credentials               # once — back up the keystore (§8)

# then, for every build that leaves this machine:
#   bump expo.android.versionCode in app.json  (§5b)
pnpm --filter @steading/mobile exec eas build --profile preview --platform android
```

EAS builds it on Expo's machines and prints a URL. That URL is the link — mail
it, message it, whatever. Opening it on an Android phone downloads the APK, and
Android asks the tester to allow installing from that browser once. §7 is what
the person on the other end sees, which is two warnings that both look like a
refusal and are both routine.

No Play Console, no $25, no review, and no signing key to *create* — EAS makes
one on the first build. There is still exactly one to **keep**, and §8 is why
that is not a formality.

> **`eas-cli` is a devDependency of `apps/mobile`**, which is why these say
> `exec eas` rather than `pnpm dlx eas-cli`. It was neither for a long time, so
> every command written down here failed with *'eas' is not recognized* — the
> docs described a tool nothing installed.
>
> `dlx` would also have worked, and pinning is why it is not used: `dlx` fetches
> whatever is newest each time, so two machines can drive one project with two
> CLI versions and `eas.json`'s own `cli.version` floor goes unchecked. It never
> reaches a bundle — it is a build tool, not a dependency of the app.

### Which Expo account this belongs to

`app.json` sets `"owner": "swbuilds-team"`, and it is not decoration:

**`owner` decides which account holds the signing keystore.** Moving it later
means a different project and a different key, and a different key means every
installed copy needs an uninstall before it will take an update — which takes
the farm's records with it (§3, last row). It is close to a one-way door, which
is why it is written down rather than left to whoever happens to be logged in.

An organisation rather than the personal account that created it, because an
org can gain members and change hands without the project moving. A personal
account ties the keystore — and eventually the Play listing — to one login.

**Set it before the first build, not after.** With no `owner` and no
`extra.eas.projectId`, `eas build` creates a project under whoever is signed in
and writes the id into `app.json` mid-build. That works once and then leaves the
tree dirty, so the next `Build the app.bat` stops at `:update_code` — `git pull
--ff-only` refuses local changes — with nothing to connect it to the build that
caused it.

`eas init` is the deliberate version, run on its own and committed:

```
pnpm --filter @steading/mobile exec eas init
```

**And turn on 2FA for that account.** It holds the one piece of state in this
project that cannot be regenerated from anything (§8).

---

## 2. Which profile

`eas.json` has four. Three differ only by an environment variable; `development` differs by carrying the dev client.

| Profile | `EXPO_PUBLIC_API_URL` | What it is for |
|---|---|---|
| `development` | **unset** | A dev-client APK built in the cloud — for when the local Gradle toolchain is the problem |
| `preview` | **unset** | **A tester.** The whole app, no server, nothing to set up |
| `preview-farm` | `https://api.swbuild.dev` | The same, plus sync and accounts |
| `production` | `https://api.swbuild.dev` | An AAB for the Play Store |

> **Unset, not `""` — and do not put the empty string back.** Those two profiles
> carried `"EXPO_PUBLIC_API_URL": ""` to say *no server, deliberately*, and
> eas-cli rejects it outright:
>
> ```
> eas.json is not valid.
> - "build.preview.env.EXPO_PUBLIC_API_URL" is not allowed to be empty
> ```
>
> Absent means the same thing to the app and nothing else changes.
> `resolveApiConfig` maps `undefined` and `''` to the same `{ kind: 'missing' }`
> — see `boot/config.ts`, where a build with no origin opens, records, and says
> **Not set up** rather than refusing to start. `tests/unit/api-config.test.ts`
> pins both.

**Start with `preview`.** The free tier is the whole app on one device (D13), so
a build with no server is not a crippled demo — it is the product, and it needs
no infrastructure at all. The sync chip says **Not set up** in the colour
reserved for things waiting will not fix, and everything else works: tallies,
dues, treatments, weather, photos, export.

Move to `preview-farm` only once the API is deployed somewhere a phone can
reach. An APK pointed at `localhost` is an APK that cannot sync from anywhere
but the machine that built it. **`docs/DEPLOY-THE-SERVER.md` is how it gets
there** — a fresh Oracle box to a working `https://` address, and then the two
devices.

---

## 2b. Expo Go is not one of them, and that is deliberate

**A farm's records were emptied twice before this was understood**, so it is
worth stating plainly rather than leaving as a preference.

Expo Go is one shared app that every Expo project on a device borrows. The
records therefore lived in *its* sandbox — `host.exp.exponent` — rather than in
Steading's, and Expo Go reinstalls itself whenever the SDK version moves.
Bumping `expo` from 57.0.9 to 57.0.11 was enough. Android takes an app's data
on reinstall, so the database went with it, and neither loss was a bug in this
app.

A **development build** is Steading's own APK, `dev.swbuild.homefarm`, with its own
sandbox. It still connects to Metro, so a code change still reloads in a second
— what changes is that the records survive it. `Run on phone` and `Run on
emulator` both build one; `npx expo run:android` is the same thing by hand.

### When the app closes itself: `Catch a crash`

Double-click it, do the thing that goes wrong, come back and press a key. It
clears the log first so what comes back is about the thing that just happened,
reads three buffers, and says which of two situations it is — because they look
identical from the outside and want opposite fixes:

- **the app crashed** — `FATAL EXCEPTION`, `OutOfMemoryError`, and a stack;
- **Android killed it** — `am_kill`, `lowmemorykiller`, no stack at all,
  usually the camera wanting the memory the app was holding.

It exists because the alternative was asking somebody to type two `adb`
commands, and `adb` is not on the PATH — which is the whole reason every script
in that folder has to go and find it first. A diagnostic nobody can run is not
a diagnostic.

### A tablet also has to be able to reach the server

The API listens on `0.0.0.0`, so nothing about it needs changing for a device
on the same wifi. What stops one is Windows Firewall: it asks once, the first
time Node opens a port, and a prompt dismissed months ago on some other project
is a silent block today with no second prompt coming.

It surfaces as *"cannot reach the farm server"*, which reads as a fault in the
app and is a rule in the operating system. `Run on phone` says so at the moment
it sets the address, and prints the one-line `netsh` rule for the case where the
prompt never appears.

### Testing against the real server, not this computer

Everything above points a development build at the machine that built it. To
test the whole thing end to end — a device talking to the deployed API over the
internet, the way a tester's phone will:

```
Use the farm server.bat        then    Run on phone.bat
```

and `Use my own computer.bat` to go back. The address comes from `eas.json`'s
`preview-farm` profile, so it is written down in one place rather than two.

**This existed only as a full EAS build until it didn't.** `eas.json` has always
sent `preview-farm` and `production` at the deployed server, but every run
script rewrites the address to something local on each run — correct for the
flows they were written for, and it left no way to point a *development* build
anywhere else. So "does it work end to end" cost ten minutes and a cloud build,
with no Metro reload at the end of it.

The run scripts now check first: an address that is neither this machine nor
this network was a decision, so they leave it alone and say so. The test is by
destination rather than a flag file, so there is no marker to go stale —
`scripts/lib/api-origin.mjs`, and `tests/unit/api-origin.test.ts` pins the
boundary cases, including that `172.15` and `172.32` are public while
`172.16`–`172.31` are not.

**Two devices only share a farm if they were built against the same server.** A
tablet pointed at this computer and a phone pointed at `api.swbuild.dev` are two
separate farms whatever account you sign into — the origin is compiled in, and
`boot/config.ts` has no runtime setting on purpose.

### The QR code is not an Expo Go QR code

Worth its own line, because it is the trap that follows from the paragraph
above and it looks nothing like a refusal. Metro prints a big square QR, and
**only Steading's own development build can open it** — the code carries the
`steading://` scheme from `app.json`. Scanning it with Expo Go does nothing.
Scanning it with the phone's camera does nothing. Reported exactly that way,
from a tablet with Expo Go installed and a USB cable plugged in: *"when I scan
the qr code nothing happens."*

Nothing was broken. The device simply did not have the app the code is for, and
the window handed over a QR without ever checking. `Run on phone` now looks
first — if `dev.swbuild.homefarm` is not on the attached device it builds and
installs it, and only offers the code to a device that can read it.

The price is the first build: Gradle, five to fifteen minutes, and it needs
Android Studio's toolchain rather than just its emulator. Every run after is as
quick as Expo Go was. If the local toolchain turns out to be the problem,
`eas build --profile development` builds the same thing on Expo's machines and
gives you an APK to install.

---

## 3. Tell every tester this, before they install

> **Anything you log lives on your phone and nowhere else until you make an
> account. Uninstalling the app, or clearing its data, deletes it.**

That is not a caveat, it is how the app works, and it is what an account is
for — see `ACCESS-AND-BILLING.md` A2.3. It matters more in testing than in
production because testers install new builds often.

**Two ways a tester keeps their records across an update:**

1. **An account** — records reach the server and come back on the next install.
   Needs `preview-farm` and a deployed API.
2. **Export** — Settings → *Get your records out*. Spreadsheets, out through
   the share sheet, no server involved. Works on the `preview` build.

### What actually wipes a device

| Action | Records survive? |
|---|---|
| Installing a newer APK over the old one, same signing key | **Yes** |
| Uninstall, then install | No |
| "Clear data" / "Clear storage" in Android settings | No |
| Wiping or recreating an emulator image | No |
| Expo Go updating itself | **It did — which is why the app no longer runs there** |
| A build signed with a different key | No — Android forces an uninstall first |

The last one is the one that surprises people, and the dev build makes it
easier to hit rather than harder. EAS signs with a keystore it generates once;
`expo run:android` signs with the template's debug keystore. **Those are two
different keys**, so installing an `eas build --profile development` APK onto a
device that already has a locally-built one fails with
`INSTALL_FAILED_UPDATE_INCOMPATIBLE` — and the only way past it is an
uninstall, which takes the farm.

**Pick one route per device and stay on it.** Local for the machine you develop
on; EAS for anything you hand to somebody else.

Verified while writing this: the template's `debug.keystore` is byte-identical
across expo 57.0.8, 57.0.9 and 57.0.11, and `android/` is regenerated from it
by prebuild — so a patch bump genuinely does not wipe a locally-built dev
build, the way it could under Expo Go.

**There is a second, quieter version of this**, documented in
`auth/local-org.ts`: the farm's id lives in secure storage and the records live
in `steading-{orgId}.db`. Clearing app data takes both, so usually it is moot —
but if the id were lost while the file survived, the records would be on disk
with nothing knowing which file they are in. §4 is how you tell the two apart,
and **there is no recovery path in the app for that case yet**: the answer it
is designed around is an account (A2.3), which is the whole thing being sold.

---

## 4. Checking what is actually on a device

For a debuggable build, over adb:

```
adb shell run-as dev.swbuild.homefarm ls -la files/SQLite/       # expo-sqlite ≥ 14
adb shell run-as dev.swbuild.homefarm ls -la databases/          # older layout
```

- **One `steading-<ULID>.db`** — that is the farm, and it is the one open.
- **Two or more** — the app is opening a different farm than the one with the
  records in it. The bytes are safe; the id is what went missing.
- **None** — the app's data was cleared or it was reinstalled. Nothing to
  recover on the device.

Its size answers the other question: a busy year is roughly 900 KB, so a file
of a few KB is a farm that never had anything in it.

---

## 5. Knowing which build a tester is on

Every build stamps itself with the commit it came from, and the stamp travels
in three places: the issue title of any support ticket, **Settings → Sync** on
the device, and the bundle itself.

Nothing to remember on EAS — `scripts/stamp-build.mjs` is wired to
`eas-build-post-install`, so it runs on the builder where
`EAS_BUILD_GIT_COMMIT_HASH` is set. Locally it asks git, and a working tree
with uncommitted changes is marked `abc1234+` so a stamp is never a lie about
what was built.

**The commit is deliberately not part of `version`.** `version` is in the
fingerprint that decides whether two reports are the same defect, so folding a
commit into it would open a fresh issue thread for every build — during a
tester programme that is a new thread every few days for the same fault, which
is exactly the flood dedup exists to prevent. The commit answers *which build*
and splits nothing.

Bump `version` in `app.json` when you want a release to be a different release
— `0.2.0`, or `0.1.1` — and let the stamp handle telling two builds of the same
version apart.

---

## 5b. There are three version numbers and they answer different questions

Easy to conflate, and only one of them is Android's.

| | Where | Who reads it | When it changes |
|---|---|---|---|
| `version` | `app.json` → `expo.version` | People. Support fingerprints. | When a release is a different release |
| `versionCode` | `app.json` → `expo.android.versionCode` | **Android and Play.** Never shown. | **Every build you hand to anybody** |
| the commit stamp | generated, `EXPO_PUBLIC_BUILD` | You, in a ticket | Automatically, every build |

`versionCode` is an integer and the only thing Android uses to decide whether
one APK is newer than another. **It was absent until now**, which means Expo
defaulted it to `1` and every build ever made carried the same one.

### What that actually cost, which is less than it sounds

Sideloading a same-`versionCode` APK over an installed one **works** — same
signing key makes it a reinstall, and the records survive exactly as §3's table
says. So nothing was broken and nothing was lost. The bill comes due in three
places instead:

- **Play rejects a duplicate `versionCode` outright.** The first `production`
  upload would succeed and the second would be refused, at the worst possible
  moment to be discovering this.
- **Android blocks a downgrade.** Once a device has `versionCode` 4, a build at
  3 will not install over it — `INSTALL_FAILED_VERSION_DOWNGRADE`. Going back
  to an older build to reproduce something therefore costs an uninstall, and an
  uninstall takes the farm. Worth knowing *before* you need it.
- **Nothing on the device can tell two builds apart.** Settings → Apps shows
  `version`, which does not move between builds. `adb shell dumpsys package
  dev.swbuild.homefarm | findstr versionCode` is the only place the integer
  surfaces, and it was the same integer every time.

### The rule

**Bump `versionCode` by one for every build that leaves this machine.** It is
one line in `app.json`, it belongs in the same commit as whatever the build is
of, and git history is then the record of which integer was which.

**On EAS this needs nothing else** — the builder prebuilds from `app.json`
every time, so the new integer is in the APK. **Locally it does**: `expo
run:android` prebuilds only when `android/` is *absent*, so an existing native
project is compiled with yesterday's `versionCode` and the change is silently
ignored. That is the same trap as icons and permissions (see `CLAUDE.md`), and
it has the same answer — `pnpm mobile:prebuild` first. It matters less here
than for an icon, because a local build is for the machine you develop on and
§3 says to keep those on their own route anyway.

`version` moves on its own schedule — a release being a different release —
and often does not move at all between two tester builds. The commit stamp
answers *which build* either way, which is why it exists (§5) and why neither
of the other two has to carry that job.

> **`autoIncrement` is the option if bumping by hand becomes the thing that
> gets forgotten.** Setting `"autoIncrement": true` on a build profile has
> eas-cli do it, and with `appVersionSource: "local"` — which is what `eas.json`
> uses — the incremented value is written back into `app.json` for you to
> commit, so it stays visible in git rather than moving to a counter on Expo's
> servers. **Not enabled here and not verified on a real build**, because the
> first time it runs is the wrong time to find out it wrote somewhere else.
> Try it on a throwaway build before trusting it.

---

## 6. Free access for a tester

Sync is the paid thing (D13), so a tester on `preview-farm` would hit a 402
once a payment rail is configured. `FREE_SYNC_ORGS` in the API's environment is
the way round it — see `.env.example`. It takes farm ids, and a farm can read
its own from **Settings → Sync**, at the bottom.

It is deployment configuration rather than a route, deliberately: a grant that
can be requested is a grant that can be requested by anybody.

---

## 7. Sending a build to somebody

**`Build the app.bat` does all of this.** Double-click it: it pulls, offers to
move `versionCode` on by one, builds on EAS, works out the download url and asks
whether to publish it to the box. The rest of this section is what it is doing
and how to do it by hand when something in the middle fails.

Three machines are involved and which does what is the part worth holding onto:

| | does what |
|---|---|
| **this PC** | uploads the *source* to Expo. It compiles nothing. |
| **Expo** | compiles it, signs it with the keystore it holds |
| **the box** | serves it at `/app`, at one address, forever |

By hand:

```
pnpm --filter @steading/mobile exec eas build --profile preview-farm --platform android
```

Ten to twenty minutes on Expo's free tier, most of it queueing. It ends with a
build page URL and a QR code in the terminal.

**That URL is the distribution.** There is nothing else to set up — no Play
Console, no App Center, no file to host. The page has an *Install* button that
serves the APK.

### What the person on the other end does

1. Opens the link **on the Android phone itself** — not on a computer. The page
   detects Android and offers the APK.
2. Chrome warns that this file type can harm your device. That warning is
   unavoidable and correct in general; **Download anyway**.
3. Android asks to allow installing unknown apps from Chrome. This is a
   per-source permission and it is asked once.
4. Play Protect then says the app was not scanned or is from an unknown
   developer. **Install anyway** — it is not signed by a Play-registered
   developer, and it will say so every time until it is.

Steps 2 and 4 look like two different refusals and are both routine. Worth
saying in the message with the link, because a tester who reads either as *this
is dangerous* stops there and does not tell you they stopped.

### What the link is and is not

- **`distribution: "internal"`** on the profile means anybody with the URL can
  install it. It is unlisted, not access-controlled — the same shape as the
  secret gists in `SUPPORT-LOOP.md` S4, and acceptable for the same reason.
- **Build artefacts expire on the free tier** (30 days), and the url is new
  every build. It is a delivery mechanism, not an address — which is what the
  next section is for.
- **The origin is compiled in.** A `preview-farm` APK talks to
  `api.swbuild.dev` forever; there is no setting on the device (`boot/config.ts`,
  deliberately — a server address a stranger can talk somebody into changing is
  a phishing surface). Pointing at a different server means another build.

### Better: serve it from the box, at an address that never changes

The EAS link is fine for a one-off and poor for a tester you send builds to
repeatedly, because **it is a different url every build and it dies after
thirty days**. So "here is the app" becomes a message you send again each time,
and any link somebody kept stops working in a month.

The box already has Caddy and a certificate. One static route later,
`https://api.swbuild.dev/app` is a constant and the file behind it moves:

```
# on the PC, once the build is done
scp ~/Downloads/steading-0.1.0-2.apk ubuntu@api.swbuild.dev:

# on the box
sudo /opt/steading/scripts/deploy/publish-apk.sh ~/steading-0.1.0-2.apk
```

**Caddy serves it and Fastify never sees it.** A static file needs no route, no
auth and no database, so the API's surface does not grow by a byte to get a
download — `handle_path /app/*` is matched before the reverse proxy and nothing
under it reaches the service.

It lives in `/var/lib/steading/dist`, deliberately outside `/opt/steading`: the
deploy timer pulls into that tree every five minutes, and a build kept there
would be one `git clean` from gone.

`publish-apk.sh` keeps every build under its own name, moves the
`steading.apk` symlink the stable link serves, refreshes the install page, and
**refuses to overwrite a name that already exists** — which is the §5b
`versionCode` bump with teeth, because two different builds under one name make
the archive a lie.

The install page is the part a raw download cannot do: it explains Chrome's
warning and Play Protect's warning *before* somebody hits them, so you are not
writing that in a message every time. It is `scripts/deploy/install-page.html`,
in the repo so it is reviewed like everything else.

### What the box deliberately does not do

**Build the APK.** It would need the JDK and the Android SDK — roughly ten
gigabytes on a free-tier instance this repo already has a disk-resize section
for — and Gradle on that hardware is slow enough that nobody would use it
twice.

The disqualifying reason is §8, though. Building here means **the signing key
lives here**, on the internet-facing machine, and that is the one piece of
state that cannot be regenerated from anything. Expo's credential store holding
it is a better trade than an Oracle box holding it next to a public web server.

So EAS builds it and the box serves it.

**And there is no upload route.** The APK arrives by `scp` because a download
endpoint is a static file and an upload endpoint is a way to put a file on a
server, and those are not the same risk at all.

### Building it ourselves, when EAS will not

The free tier caps Android builds per month, and hitting that cap is not a
gentle failure: #153 is the promote that shipped the server, was refused a
build, and skipped the step that would have said so.

`.github/workflows/apk.yml` is the way round it — **Actions → APK → Run
workflow**, and leave the inputs alone. It runs `expo prebuild` and Gradle on a
GitHub runner, signs with our own keystore, checks the result, and attaches it
to a Release. No Expo account is involved at any point; `expo prebuild` is
local, so the queue and the quota are not in the path.

**Promoting the server builds the app too, and that is the normal route.**
`ci.yml`'s release job calls this workflow rather than running `eas build`, so
**Actions → CI → Run workflow** is the one button: it verifies, moves `release`,
and builds the APK at the promoted commit. Running the APK workflow by hand is
for a build outside a release — a signing fix to prove out, a rebuild of
something already shipped. `bump: none` still promotes the server and builds no
app, exactly as before.

The promote does **not** wait on Gradle. `release` is pushed before the app job
starts, so the box deploys the server on its next tick regardless; the quarter
of an hour only keeps the run marked in progress. What is new is that a failed
app build now shows as a red job instead of the silence #153 was.

**A runner and not the box, and §7's reasons above still stand.** The keystore
argument is the same wherever the machine is — except that a repository secret
is materialised for the length of one job, while a box holds what it holds all
the time, next to a public web server. There is also a practical blocker that
section predates: the box is aarch64 and Google ships the Android build-tools
as x86_64 binaries only, so `aapt2` and `zipalign` there would come from
emulation or a community rebuild.

**Five secrets, and the job refuses to start without them:**

| Secret | Where it comes from |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 steading.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | the §8 export |
| `ANDROID_KEY_ALIAS` | the §8 export |
| `ANDROID_KEY_PASSWORD` | the §8 export |
| `ANDROID_CERT_SHA256` | `keytool -list -v -keystore steading.jks -alias <alias> \| grep SHA256:` |

#### The `versionCode` is derived, not typed

It is one past the highest already released — read off the `v<version>+<code>`
tags — and never at or below **17**, which is what EAS reached before the
quota. `scripts/lib/apk.mjs` holds that rule and `tests/unit/apk.test.ts` holds
that file.

The input exists only to force a code *higher* than the derived one, and it is
rejected if it is not. This matters more than it sounds: the first draft made
it a required free-text box with the right answer written in the description,
and a description is not a guard. A typo there produces an APK that every
device refuses, where the only way past is an uninstall — and an uninstall
takes the farm's records with it (§3, last row).

#### Three checks, and each one catches something that succeeds silently

`scripts/apk-check.mjs` runs before anything is published, and fails closed —
anything it cannot positively confirm is a failure, including its own inputs
being missing.

- **The APK is the app.** `aapt2 dump badging` has to say `dev.swbuild.homefarm`
  with the version and code we intended. A build that read a stale `app.json`
  produces a perfectly ordinary APK with the wrong number in it.
- **The signature is ours.** The certificate's SHA-256 is compared against
  `ANDROID_CERT_SHA256`. A keystore exported from the wrong account, the wrong
  alias inside the right keystore, or a secret pasted with a line break all
  succeed at signing, and none of them look like errors.
- **It never falls back to a debug key.** `expo prebuild` points the release
  build type at the debug signingConfig, so a missing secret's natural outcome
  is a normal-looking APK that Android treats as a different app. The job stops
  before the checkout instead.

#### It does not put the APK on the box — the box comes and gets it

Nothing here opens an upload route, and that has not changed: *"a download
endpoint is a static file and an upload endpoint is a way to put a file on a
server, and those are not the same risk at all."* The box pulls, exactly as it
pulls the code.

**How it finds the right one.** `deploy.sh` resolves the commit it is serving to
a `v<version>+<code>` tag with git — locally, no network — and asks GitHub for
the APK attached to that release. `scripts/lib/release-apk.mjs` holds every
decision in that sentence and `tests/unit/release-apk.test.ts` holds that file.

**Why the commit and not "the newest release".** The EAS lookup this replaced
filtered on `--git-commit-hash`, and its own comment gave the reason: the box
already knows which commit it just deployed, so nothing has to be handed from
CI to the box and there is nothing to get out of step. Taking the newest
release would throw that away — `release` bumps the version, commits it and
promotes *that* commit, so the newest release is only coincidentally a given
box's. It is also why `ci.yml` passes the promoted sha to this workflow: the
tag has to land on the commit the box will be serving, not the one the button
was pressed against.

A commit with no tag publishes nothing, which is correct — a server-only
release leaves the shelf holding what it was already holding. A build still
running finds nothing too, and the next five-minute tick picks it up.

To publish a hand-built APK, the local-file form is unchanged:
`publish-apk.sh <path>`.

### A GitHub Release is for the archive, and now for the box as well

Attached to a tag, it answers "the build that was on her phone in August" after
the box has been rebuilt or the file pruned. It is still a poor *channel* to
send to a person — no install page, and on a public repository it puts the APK
in front of anybody, the same consideration that keeps `SUPPORT_ACCEPT_RECORDS`
off — so what a tester is sent is still `https://api.swbuild.dev/app`. The box
reading the Release is a machine fetching a known artefact by tag, which is a
different question from what a link in a message should point at.

Being public is what makes the box need no credential: `EXPO_TOKEN` is off it
entirely, and there is no token on that machine for anything to leak. If this
repository is ever made private, put a read-only `GITHUB_TOKEN` in
`/etc/steading/deploy.env` and the lookup honours it.

---

## 8. The keystore, which cannot be replaced

EAS generated a keystore the first time it built this app and holds it. **Every
APK is signed with it, and Android will only accept an update signed by the same
key** (§3's table, last row).

Lose it and there is no recovery. Not a hard recovery — none. A new key means a
new signature, which Android treats as a different app: every installed copy has
to be uninstalled first, and an uninstall takes the farm's records with it. On
Play it is worse, because the package name is claimed and cannot be reused.

Back it up now rather than before the first Play upload:

```
pnpm --filter @steading/mobile exec eas credentials
```

Android → the build profile → **Download credentials**. Keep the `.jks` and the
passwords it prints somewhere that is not this repository and not this machine
only. They are secrets in the ordinary sense — a password manager, or an
encrypted archive somewhere off the laptop.

This is the one piece of state in the whole project that lives outside the
repository and cannot be regenerated from it. The database can be restored from
a backup, the box can be rebuilt from `setup-box.sh`, the server's secrets can
be rotated. The signing key cannot be any of those things.
