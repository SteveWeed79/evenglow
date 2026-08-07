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

`eas.json` has three, and the difference is one environment variable.

| Profile | `EXPO_PUBLIC_API_URL` | What the tester gets |
|---|---|---|
| `preview` | empty | **The whole app, on their phone, with no server.** |
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
| A build signed with a different key | No — Android forces an uninstall first |

The last one is the one that surprises people. EAS uses a keystore it generates
once and reuses; a locally-built debug APK uses `~/.android/debug.keystore`.
Mixing the two means an uninstall, and an uninstall means an empty farm.

**There is a second, quieter version of this**, documented in
`auth/local-org.ts`: the farm's id lives in secure storage and the records live
in `steading-{orgId}.db`. Clearing app data takes both, so it is moot — but if
the id were ever lost while the file survived, the records would be on disk
with nothing knowing which file they are in. `pnpm farm:recover` (below) is how
you would look.

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

## 5. Free access for a tester

Sync is the paid thing (D13), so a tester on `preview-farm` would hit a 402
once a payment rail is configured. `FREE_SYNC_ORGS` in the API's environment is
the way round it — see `.env.example`. It takes farm ids, and a farm can read
its own from **Settings → Sync**, at the bottom.

It is deployment configuration rather than a route, deliberately: a grant that
can be requested is a grant that can be requested by anybody.
