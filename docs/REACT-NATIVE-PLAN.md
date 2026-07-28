# Steading on React Native

**Decided.** Steading ships as a React Native app. This document is the plan,
and an honest inventory of what that costs.

The reason the cost is bearable: **the expensive part of this codebase has no
DOM in it.** The sync engine, the contracts, the SQLite store, the domain
reads — none of them know what a browser is. They were written against a port
precisely so this kind of move would be possible, and that investment now gets
spent.

---

## 1. Inventory

Measured, not estimated.

| | Lines | Fate |
|---|---:|---|
| `packages/contracts` + sync engine + SQLite store + reads + pure modules | **3,701** | **Ports unchanged** |
| Unit, offline, and sync test suites | **3,917** | **Port unchanged** — they run in Node, not a browser |
| `apps/api` (Fastify, Mongo, auth, appliers) | — | **Untouched.** The server does not know or care what the client is |
| Components (`*.tsx`) | 1,940 | Rewritten — HTML/CSS to RN primitives |
| `styles.css` | 826 | Becomes a token module plus `StyleSheet` |
| IndexedDB store, schema, and open | 682 | **Deleted**, not ported |
| Playwright e2e | 641 | Rewritten on Detox or Maestro |

So roughly **7,600 lines survive** and **2,800 are rewritten**. The survivors
are the ones that took the longest and carry the correctness guarantees.

---

## 2. What ports unchanged

**`packages/contracts`** — every entity schema, the mutation envelope,
`SPECIES_TRAITS`, the withdrawal arithmetic. Plain Zod and TypeScript. Zero
changes.

**The sync engine** — `queue.ts`, `flush.ts`, `pull.ts`, `engine.ts`,
`inbox.ts`. The outbox, `clientSeq` ordering, single-flight flushing, the
composite `(serverTs, ULID)` pull cursor, the backoff, the rejected inbox, the
pacing rule that stopped last night's hot loop. None of it touches a DOM API.

**The SQLite store** — `sqlite-store.ts`, `migrations.ts`, `schema.ts`,
`project.ts`, and the `LocalStore` port itself. This is the part that would have
hurt most, and it is already written, already passing the full suite, and
already running on a handset. Only the driver underneath it changes.

**The domain reads** — `groups.ts`, `iron.ts`, `withdrawals.ts`, `voice.ts`,
`naming.ts`, `theme.ts`, `api.ts`.

**The tests.** The unit, offline and sync suites run under Vitest in Node
against `node:sqlite`. They do not care that the app around them changed.
Keeping them green through the port is the primary safety line.

---

## 3. What is deleted, and why that is a gain

The IndexedDB store, its schema, and `db/open.ts` — 682 lines — are **not**
ported. React Native has no IndexedDB, so this is S7 arriving early, and it
simplifies three things that only ever existed to serve a browser:

- **`lock.ts`** — Web Locks, guarding against two open tabs syncing at once.
  There are no tabs. The whole cross-tab problem disappears, along with the
  `LOCK_HELD_MS` standoff added yesterday.
- **`storage.ts`'s eviction machinery** — quota estimates, persistence
  requests, the "may clear unsent work after a week" warning. An app-sandbox
  file is not evicted. The `setStorageBacking` seam added yesterday exists only
  to paper over this, and goes with it.
- **The dual-store ambiguity itself** — yesterday's worst bug was reads going
  to IndexedDB while writes went to SQLite. With one store that class of bug
  cannot be written.

The `LocalStore` port stays. It earned its place: it is why the SQLite store
could be built and proven before any device existed, and it will do the same
job again for whatever driver comes next.

---

## 4. What is genuinely new

**Navigation.** React Navigation. Today the four tabs are `useState` in
`AppShell`; that was a deliberate choice for a precached web shell and it stops
being the right one. Real navigation brings back-stack behaviour, screen
transitions, and gesture-driven back — three of the things that make an app
feel like an app.

**Secure token storage.** `expo-secure-store` or `react-native-keychain`,
backed by the Android Keystore and iOS Keychain. This is the piece that has
been outstanding since S3b: the auth endpoints exist and are tested, and nothing
on the client has ever held a token. Invariant 6 wants tokens in secure storage
and never in SQLite, and on RN that is finally a real facility rather than an
aspiration.

**A SQLite driver.** `expo-sqlite` or `op-sqlite`. Either satisfies `SqlDriver`
in about a hundred lines, and both support WAL. The Capacitor driver written
yesterday is the template, including the two lessons it cost: run row-returning
statements through the query path, and use the library's own transaction
methods rather than raw `BEGIN`.

**Build tooling.** See §5.

---

## 5. The one decision I need: Expo, or bare React Native

**Recommendation: Expo, and not narrowly.**

The deciding fact is that you are on Windows. **Building an iOS app requires
macOS and Xcode** — unless you use EAS Build, Expo's hosted build service,
which compiles on their machines and hands you an installable build. Without
it, iOS is not a build target you can reach at all from where you are sitting.

Expo also brings `expo-sqlite` (WAL-capable, actively maintained),
`expo-secure-store`, `expo-router` if we want file-based navigation, and
over-the-air updates for JS-only changes. It is no longer the constrained
sandbox it was years ago — the config-plugin system means native modules are
available, and the React Native team now recommends it as the default starting
point.

**Bare React Native** is the alternative: total control, no service dependency,
and you own every native config file. The cost is that you own every native
config file, on Windows, with no Mac for the iOS half.

**Open question 1:** Do you have or intend to buy a Mac? If yes, bare RN
becomes reasonable. If no, Expo is not a preference, it is the only route to
iOS.

---

## 6. What is NOT reopened

This move changes how the app is drawn. It does not reopen:

- **The contracts.** Same envelope, same entities, same schemas.
- **The sync semantics.** Client-minted ULIDs, `clientSeq` ordering, idempotent
  apply, per-mutation results, the rejected inbox.
- **Tenancy.** `scoped(orgId)`, role re-derivation on every mutation.
- **The invariants in CLAUDE.md**, other than the ones that name a browser.
- **The scope.** Animals, growing, and iron, as the masterplan now says.
- **The design direction.** The Burrow stands. See §8.

---

## 7. Staging

Each stage ends green, as the D8 migration did.

**R1 — the shell.** Expo app, React Navigation, four tabs, the design tokens as
a TypeScript module. Renders placeholders. Nothing else moves.

**R2 — storage.** `SqlDriver` over `expo-sqlite`, `openSqliteStore` on top of
it. The existing store suite runs against the new driver. This is the stage
that must not be rushed, and the suite already exists to police it.

**R3 — the engine.** `sync/` ported across, minus `lock.ts`. The offline suites
run unchanged. Delete the IndexedDB store here, once nothing imports it.

**R4 — screens.** Today, Stock, Iron, More. This is the bulk of the rewriting,
and the point at which the design pass happens rather than a straight
transliteration of the CSS.

**R5 — auth.** Secure token storage, the sign-in screen, refresh. Closes the
gap that has been open since S3b.

**R6 — the exit gate, again.** Airplane mode, 50 mutations, force-stop,
reopen, reconnect, zero loss, zero duplicates. It has to be re-earned, and it
is not re-earned from zero: the store is proven, the engine is proven, and only
the driver beneath them is new.

---

## 8. The design pass is a separate problem

Switching framework does not fix how it looks. The current build is flat because
it has **no icons anywhere**, no depth, almost no type hierarchy, a nearly
monochrome palette, and because the entire charm layer — the illustrations, the
milestones, the texture — is still gated behind Phase 2's exit gate. That is a
skeleton with no flesh on it, and it would be the same skeleton in any language.

What React Native does give, free and unfakeable in CSS: **real scroll physics,
real gesture handling, and correct keyboard behaviour.** Those are most of the
difference between a page and an app.

So the design work is additional, not incidental, and R4 is where it lands:

- Icons throughout, starting with the tab bar
- Elevation, which the spec currently forbids and should not
- A type scale with more than two steps in it
- The charm layer ungated — the gate has done its job

---

## 9. Answered

1. **Expo.** There is no Mac, so EAS Build is the only route to an iOS binary
   and this is not a preference.
2. **Monorepo stays.** `apps/mobile` alongside `apps/api`, sharing
   `packages/contracts`.
3. **The web app stays until R5.** It is the only client with a sign-in screen,
   which is also why the IndexedDB store is not deleted at R3 as originally
   planned — deleting it would break the one thing that can currently log in.

## 10. Status

- **R1 — the shell.** Done. Expo SDK 57, React Navigation, tokens as a
  TypeScript module, the icon set on `react-native-svg`. Metro resolves the
  monorepo under pnpm with no `node-linker=hoisted`.
- **R2 — storage.** Done. `SqlDriver` over `expo-sqlite`, `openSqliteStore`
  unchanged on top. The existing LocalStore suite runs against it as a third
  backing; 430 tests → 460.
- **R3 — the engine.** Done. Ported unchanged; `lock.ts` and the
  storage-persistence request fall away with the browser. New: AppState and
  network triggers, `boot/start.ts`, the sync chip.
- **R4 — screens.** Next. The design pass happens here, not a transliteration
  of the CSS. Scope is `docs/DOMAIN-SCOPE.md`.
- **R5 — auth.** Secure token storage, sign-in, refresh. The web app retires
  here and the IndexedDB store goes with it.
- **R6 — the exit gate.** On hardware. Not re-earned from zero: the store is
  proven, the engine is proven, only the driver beneath them is new.

## 11. Two things this migration changed about the design

**The arch does not survive as a token.** `--arch` is an elliptical border
radius — `50% 50% .5rem .5rem / 2rem 2rem .5rem .5rem` — and React Native has
only circular per-corner radii. There is no token that reproduces it, so
anything needing a real arch draws one in SVG. `Panel` is honestly a rectangle
rather than dishonestly a doorway until then.

**Growing takes a tab.** Crops are half of a small farm and had no home in the
bar; More was never a place you go. Today · Stock · Growing · Iron, with
settings pushed from the header.
