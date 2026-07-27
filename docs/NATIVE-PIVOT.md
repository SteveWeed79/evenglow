# Steading — Native Pivot Plan

**Settled:** Steading ships as a real app on the App Store and Play Store. The
pure-PWA target is retired.

**Open:** which route. Capacitor and React Native both produce store binaries
and differ enormously in cost. React Native was chosen first; the choice is
under active reconsideration and this document records the analysis rather
than pretending it is closed. See §5.

One win both routes share: app-owned storage is never evicted. Safari's ~7-day
eviction of non-persisted IndexedDB was the largest durability risk in the PWA,
and it disappears under either.

The cost difference comes down to one fact. The offline engine is built on
IndexedDB, a browser API. A native WebView has it, so **Capacitor keeps the
engine and its proof intact.** React Native does not have it, so the storage
layer — the most carefully built and most heavily tested part of this codebase
— is rebuilt on SQLite, and **Phase 2's exit gate must be re-earned from
scratch.** That gate is the reason anything downstream was allowed to exist; it
does not transfer by assertion.

---

## 1. What survives, and what does not

Sorted by what it costs, because that is the part that decides sequencing.

| Code | Fate |
|---|---|
| `lib/contracts/**` — Zod schemas, mutation envelope, entities, roles | **Survives unchanged.** Pure TypeScript. |
| `lib/withdrawal.ts` — W2 arithmetic | **Survives unchanged.** Pure, and already tested without a browser. |
| `lib/ulid.ts` | **Survives unchanged.** |
| `server/**` — scoped layer, applier, projections, auth, routes | **Survives unchanged.** The server stays a Next.js deployment; the app becomes a client of it. |
| `client/read/iron.ts` — `usagePerDay`, `daysUntilDue` | **Survives.** Pure functions; only the storage reads around them change. |
| `client/db/migrate.ts`, `client/db/project.ts` | **Survives.** Pure. |
| `client/sync/{queue,flush,pull,inbox,engine}.ts` | **Survives behind a port.** The logic is storage-shaped, not browser-shaped — see §2. |
| `client/db/open.ts` — the `idb` implementation | **Replaced** by a SQLite implementation. |
| Every component and all CSS | **Rewritten** as React Native views and `StyleSheet`. |
| `public/sw.js`, the web manifest | **Deleted.** A native app needs neither. |
| `client/sync/lock.ts` — Web Locks | **Deleted.** One process; the cross-tab problem does not exist. |
| `client/sync/storage.ts` — `persist()` and quota | **Mostly deleted.** App-owned storage is not evicted. Free-space checks stay for photos. |
| `tests/e2e/**` — Playwright | **Replaced** by a native harness (Maestro or Detox). |

The design tokens survive as *values* — the colours, type scale, tap sizes and
the arch radius are all still correct. Only their expression changes from CSS
custom properties to a TypeScript theme object.

---

## 2. The storage port — do this first

The sync engine is the crown jewel: sequence monotonicity, single-flight
flushing, poison-batch parking, corruption quarantine, the integrity check,
pull with pending-edit protection. Rewriting it on SQLite by hand would put
every one of those properties back at risk.

It does not have to be rewritten. Its dependency on the browser is narrow and
lives in one file. So:

1. Define a `LocalStore` port expressing what the engine needs as **atomic
   domain operations** — `enqueue`, `resolveBatch`, `applyPulled`,
   `retryRejected` — rather than as key-value gets and puts.
2. Keep the existing IndexedDB implementation and prove every test still
   passes against the port.
3. Write a SQLite implementation of the same port and run the same suite
   against it.

Atomicity belongs *inside* the implementation. `enqueue` mints a sequence
number, writes the outbox row, advances the counter and updates the projection
as one unit; expressing that as separate primitives would let a SQLite
implementation quietly lose the guarantee that a crash mid-write cannot
duplicate a `clientSeq`.

**Do not proceed to the UI rewrite until the SQLite implementation passes the
same suite the IndexedDB one does.** The engine is what makes this product
different from its competitors; a native shell around a lossy queue is worth
less than the PWA it replaced.

---

## 3. Order of work

1. **Storage port extraction.** Engine depends on `LocalStore`; IndexedDB
   implements it; all 236 tests stay green. Nothing user-visible changes.
2. **Workspace split.** `packages/core` (contracts, domain, sync engine),
   `apps/server` (Next.js), `apps/mobile` (Expo). pnpm workspaces.
3. **SQLite implementation** of `LocalStore` on `expo-sqlite`, running the
   existing engine suite.
4. **Phase 2 exit gate, re-earned.** Airplane mode → 50 mutations → hard app
   kill → reconnect → zero loss, zero duplicates, on a real device or
   simulator. Verified to fail, as the Playwright version was.
5. **Theme port.** Tokens from CSS custom properties to a typed theme.
6. **Screens**, in the order they earn their keep: Today and the Tally, then
   Stock, then Iron, then More.
7. **Auth.** The Next.js server keeps Auth.js; the app holds the JWT in
   `expo-secure-store` rather than a cookie.
8. **Store builds.** EAS Build for both platforms.

---

Steps 2 through 8 above describe the React Native route. Under Capacitor,
steps 3 and 4 disappear entirely and step 5 and 6 shrink to a build-config
change, because the existing screens and stylesheet ship unchanged.

---

## 4. What React Native costs, stated plainly

Weeks, not days.

The largest single risk is step 4. The exit gate is currently proven against
Chromium's IndexedDB; SQLite's durability under a hard process kill is
different, and re-earning that proof is not a formality. It means rewriting
the best-tested code in the repo in the one area where a silent bug loses a
farmer's morning.

Second, the visual identity is expressed in CSS that React Native has no
equivalent for: `color-mix(in oklab, …)`, `prefers-color-scheme`, the
bright-sun override, the lamp-glow radial gradient, and Fraunces' SOFT and
WONK axes. Bright-sun mode is a release gate, so that is re-derivation, not
porting.

---

## 5. Recommendation

**Capacitor**, for this project.

- The UI is forms, lists, steppers and one large number. There is no
  virtualised scrolling, no gesture work, and no animation. The cases where a
  WebView is visibly worse do not arise here.
- W1 — offline-first, not offline-tolerant — is the competitive wedge, and
  Capacitor preserves the engine that delivers it along with the tests and
  the gate that prove it.
- The design system, including both release-gated theme modes, ships as-is.
- Days rather than weeks.

React Native is the right answer when an app needs native feel in heavy
interactions, or deep OS integration such as widgets, a watch app, or
background services. If Steading grows that way later, the migration is the
same work as doing it now — deferred until it is known to be necessary rather
than assumed.

The storage port in `src/client/db/port.ts` is worth keeping under either
route: isolating the engine from its storage is sound regardless, and it is
what would make a SQLite implementation safe if that route is taken after all.
