# Getting a build into somebody's hands

How to put Steading on a tester's phone from a link, and what to tell them
before they install it.

---

## 1. The short version

```
pnpm dlx eas-cli login                     # once
pnpm dlx eas-cli build:configure           # once, if it asks
pnpm --filter @steading/mobile exec eas build --profile preview --platform android
```

EAS builds it on Expo's machines and prints a URL. That URL is the link — mail
it, message it, whatever. Opening it on an Android phone downloads the APK, and
Android asks the tester to allow installing from that browser once.

No Play Console, no $25, no signing keys to manage, no review.

---

## 2. Which profile

`eas.json` has four. Three differ only by an environment variable; `development` differs by carrying the dev client.

| Profile | `EXPO_PUBLIC_API_URL` | What it is for |
|---|---|---|
| `development` | empty | A dev-client APK built in the cloud — for when the local Gradle toolchain is the problem |
| `preview` | empty | **A tester.** The whole app, no server, nothing to set up |
| `preview-farm` | your API origin | The same, plus sync and accounts |
| `production` | your API origin | An AAB for the Play Store |

**Start with `preview`.** The free tier is the whole app on one device (D13), so
a build with no server is not a crippled demo — it is the product, and it needs
no infrastructure at all. The sync chip says **Not set up** in the colour
reserved for things waiting will not fix, and everything else works: tallies,
dues, treatments, weather, photos, export.

Move to `preview-farm` only once the API is deployed somewhere a phone can
reach. An APK pointed at `localhost` is an APK that cannot sync from anywhere
but the machine that built it.

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

A **development build** is Steading's own APK, `com.steading.app`, with its own
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
first — if `com.steading.app` is not on the attached device it builds and
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
adb shell run-as com.steading.app ls -la files/SQLite/       # expo-sqlite ≥ 14
adb shell run-as com.steading.app ls -la databases/          # older layout
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

## 6. Free access for a tester

Sync is the paid thing (D13), so a tester on `preview-farm` would hit a 402
once a payment rail is configured. `FREE_SYNC_ORGS` in the API's environment is
the way round it — see `.env.example`. It takes farm ids, and a farm can read
its own from **Settings → Sync**, at the bottom.

It is deployment configuration rather than a route, deliberately: a grant that
can be requested is a grant that can be requested by anybody.
