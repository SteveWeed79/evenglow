# Steading — The Landscape Plus-Up

**Status: design only. Nothing here is built.** It is a plan for using the room
a tablet in landscape actually has, written against what ships today.

Read `docs/UX-SPEC.md` first — R1–R10 are binding and this document proposes an
amendment to exactly one of them (R3), stated openly rather than worked around.

---

## 1. What ships today, measured

A tablet turns. `theme/rotation.ts` unlocked it and re-locked phones at 600dp,
which was the right call and only half the job: **the app that turns is still a
phone app, centred.**

Every screen renders through `components/Screen.tsx`, which caps both the status
row and the content at `LAYOUT.column` — 600dp — and centres them. On the two
sizes this actually runs on:

| Window | Content | Plaster | Wasted |
|---|---|---|---|
| 10" portrait, 800 × 1280 | 600 | 100 each side | 25% |
| 10" landscape, **1280 × 800** | 600 | **340 each side** | **53%** |

Over half the landscape window is texture. That is the complaint, and it is
correct.

Vertically it is worse than it looks. The tab bar is `TAP.primary + 24 +
insets.bottom` — 88dp before the inset — spread across the full 1280dp width so
that three words sit in 427dp cells, while the content they belong to occupies
the middle 600. In landscape the app spends its scarcest axis on its least
crowded one.

### The gap nobody has hit yet

`insets.left` and `insets.right` are read **nowhere** in the codebase. `Screen`
handles top and bottom; `Tabs` and `TabDividers` handle bottom. In portrait that
is complete. In landscape a display cutout and the gesture bar move to the left
or right edge, and nothing reserves for them. It has not been reported because
the full-bleed ground hides it and the content is 340dp from either edge — which
is to say **the wasted space is currently masking a real bug, and closing the
gap will expose it.** Fix it in the same pass.

---

## 2. Research: what the platform says

### Window size classes

Android classifies width and height separately
([Android developers](https://developer.android.com/develop/adaptive-apps/guides/use-window-size-classes)):

| Width | | Height | |
|---|---|---|---|
| Compact | < 600 | Compact | < 480 |
| Medium | 600–839 | Medium | 480–899 |
| Expanded | 840–1199 | Expanded | ≥ 900 |
| Large | 1200–1599 | | |
| Extra-large | ≥ 1600 | | |

Put the two devices this app runs on into that table and the whole problem is
visible in one line:

- **10" portrait, 800 × 1280** → medium width, expanded height.
- **10" landscape, 1280 × 800** → **large width, medium height.**

The app has exactly one breakpoint — 600 — and it is used twice, as
`LAYOUT.column` and as `ROTATES_AT`. Both of those numbers are about the
*compact/medium* boundary. **The app has no vocabulary at all for expanded or
large, which is precisely where the tablet in landscape lives.** It cannot take
advantage of the room because it has no way to say the room is there.

### Canonical layouts

Material names three shapes for wide windows
([Android developers](https://developer.android.com/develop/adaptive-apps/guides/canonical-layouts)):

- **List-detail** — a list beside the thing it opens. Compact and medium show
  one or the other; expanded shows both.
- **Supporting pane** — a primary area and a secondary one. 50/50 at medium,
  roughly 70/30 at expanded. At compact the supporting content goes below or
  into a sheet.
- **Feed** — an adaptive grid, columns derived from a minimum column width
  (~180dp in the reference).

Compact takes one pane; medium 1–2; large and extra-large may take more. The
AndroidX two-pane reference splits at **580dp total with a 280dp fixed list
pane**, which is worth noting as an existence proof that panes do not need to be
wide to be useful.

### Navigation at width

Material moves the bottom bar to a **navigation rail** at the left edge on
expanded windows. React Navigation 7 supports this natively —
`tabBarPosition: 'left'` with `tabBarVariant: 'material'` renders the bar as a
sidebar, and the material variant exists *only* for the left and right positions
([React Navigation](https://reactnavigation.org/docs/bottom-tab-navigator/)).

`@react-navigation/bottom-tabs` is already at `^7.18.14` in
`apps/mobile/package.json`. **This costs no new dependency**, which matters given
the style rule that a dependency must say what it replaces.

### Ergonomics, and why this is not just "make it wider"

A phone is held in one hand with a thumb arcing from a bottom corner. A tablet in
landscape is held in two, and the thumbs sit on the **left and right edges**,
each reaching roughly two-thirds across from its own side; the fingers are behind
the device, not on it. Primary controls belong at the outer edges and bottom
corners — the centre-bottom of a 1280dp window is one of the *worst* places on
the screen, not the best
([ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0003687017302818),
[Parachute](https://parachutedesign.ca/blog/thumb-zone-ux/)).

This lands directly on **R3**, whose test is *"thumb-reach audit on a 6.7"
phone"*. R3 is right about phones and does not transfer. See §7.

### The measure

600dp of 17dp body text is roughly 70–80 characters — the top of the readable
range. `tokens.ts` already argues this: *"a row that reads 'Chickens · EGGS · 6
HEAD · 4' at 430dp becomes the same words at 1280dp with a metre of plaster
between them."*

**So the answer is never a wider column. It is more columns.** `LAYOUT.column`
stays at 600 in everything below.

---

## 3. The vocabulary to add

One hook and one token block. Nothing renders differently until something reads
them, so this is the cheap, safe first commit.

```ts
// theme/tokens.ts
export const LAYOUT = {
  column: 600,          // unchanged — the measure, not the container
  spacer: SPACE.lg + 4, // 24 between panes
  aside: { min: 320, max: 480 },
  margin: SPACE.lg + 4, // 24 outside the pane assembly
} as const;

// theme/window.ts — pure, testable in Node, like tally.ts and rotation.ts
export type WidthClass = 'compact' | 'medium' | 'expanded' | 'large';
export type HeightClass = 'compact' | 'medium' | 'expanded';
```

**Window, not screen — and the distinction is load-bearing.** `useRotation`
reads `Dimensions.get('screen')` deliberately, because whether a *device* may
turn is a fact about the display and must not change when the app is put in
split-screen. Layout is the opposite: it must follow the window the app actually
occupies. A 1280dp tablet split down the middle gives each app 640dp — a medium
window on a large screen — and the layout has to be medium. Same for the
freeform desktop windowing Android now offers on tablets and connected displays,
where the window is any width the user drags it to.

So: `useWindowClass()` reads `useWindowDimensions()`, which re-renders on change.
That also handles foldables for free — the case `useRotation` already subscribes
for, where a 370dp device becomes an 800dp one mid-session.

### The two-pane threshold

Derived rather than picked, so it can be defended and tested:

```
600 (column) + 24 (spacer) + 320 (aside.min) + 2 × 24 (margins) = 992
```

Two panes when **usable width ≥ 992**, where usable is the window minus the rail
and minus `insets.left + insets.right`. What that yields:

| Window | Usable | Panes |
|---|---|---|
| 10" landscape, 1280 | 1200 (rail 80) | **two**, aside 480, margins 48 |
| 10" portrait, 800 | 800 | one |
| 8" landscape, 1024 × 600 | 944 | one |
| 1280 split 50/50, 640 | 640 | one |
| Phone, any | — | one, and phones do not turn |

The 8" landscape falling short is the right answer rather than a near miss: at
600dp tall it is a *compact-height* window, and two panes there would be cramped
on both axes.

---

## 4. The navigation rail

At expanded width and above (≥ 840), the bar becomes a rail:
`tabBarPosition: 'left'`, `tabBarVariant: 'material'`.

**What it buys.** 88dp of height back, on the axis a landscape tablet is short
of — it is a *medium-height* window. And it puts the three destinations under the
left thumb instead of stretched across a metre of bar.

**What it costs.** The bar is hand-drawn and both halves assume a horizontal
axis. `TabDividers` lays `count` flex slots in a row and draws a hairline on each
left edge; in a rail those become rows and the lines become horizontal, or the
dividers stand down entirely — a rail with three items does not need dividing.
`TabMark`'s `roomy = count <= 4` shrinks type when tabs get narrow, which is a
width argument that does not apply to a rail. Both are small, and both are places
where a change that "works" will look wrong in the hand.

**What it does not cost.** UX-SPEC §4 is about *how many* destinations, not which
edge they sit on. Three stays three. The rule is untouched.

**Verify the label orientation on the device.** Three uppercase mono words in a
narrow rail is exactly the shape that has already clipped twice in this codebase
— once in the icon slot, once at five characters — and `TabMark`'s comment is the
record of it.

---

## 5. The screens

### 5a. Today — supporting pane

The screen the complaint is really about, and the one with the most to gain.

```
┌──┬──────────────────────────────────────────────────────────┐
│  │  Sat 10 Aug                        [+] [3 waiting] [○] [⚙]│
│  ├──────────────────────────────────────────────────────────┤
│T │  ⚠ MET OFFICE — AMBER WIND                                │ ← full width
│O │  ⚠ Hens will want shelter by noon                         │   always
│D ├────────────────────────────────┬─────────────────────────┤
│A │  Sunnyside                     │  ALSO TODAY             │
│Y │                                │  ☐ Worm the goats       │
│  │  ┌──────────────────────────┐  │  ☐ Check the waterer    │
│F │  │      EGGS · SUNNYSIDE    │  │  ☐ Service the mower    │
│A │  │                          │  │    and 3 more           │
│R │  │           18             │  │                         │
│M │  │                          │  │  ── the weather ──      │
│  │  │  [+1] [+6] [+12]   [−]   │  │  12°C, rain by three    │
│H │  │  [    Log 18 eggs    ]   │  │                         │
│I │  └──────────────────────────┘  │  Records leave this     │
│S │                                │  device only when…      │
│T │  Goats · MILK · 8 head      2L │                         │
│  │  Bees · HONEY · 4 hives        │                         │
└──┴────────────────────────────────┴─────────────────────────┘
   rail          primary 600              aside 320–480
```

- **Primary (left):** the tallies. One open, full arch, unchanged.
- **Aside (right):** the quiet context — the dues list, the weather row, the
  exposure notice.
- **Across both, at the top:** anything that outranks the tally. An official
  weather alert and a withdrawal banner stay full-bleed. TodayScreen already
  argues this ordering carefully — *"a farm reading top to bottom must not meet
  'your hens are warm' first"* — and **a safety banner in a side column is a
  banner nobody reads.** Moving it into the aside would undo that argument
  quietly.

The payoff is not decorative. `VISIBLE_DUES` caps the list at 5 and one tally
opens at a time, both because *"three groups of routine look-overs filled the
screen and the egg tally started below the fold"*. Put the dues in their own
column and they stop competing for the tally's vertical space: the cap can lift
in landscape, and every collapsed tally row stays visible under the open one.

**One glow per screen still holds.** The temptation at large width is a 2-up grid
of open arches. Two open arches are two lamps, and UX-SPEC §3 gives the screen
one. The tallies stay one-at-a-time; only the collapsed rows and the dues get
room.

### 5a.1 Which side the tally goes — settled

**Rail, column, aside.** Tally in the 600dp column on the left, dues and weather
in the right-hand sidebar. The mirror was drawn and rejected.

The case for mirroring was real: the commit is the most-pressed control in the
app and a right thumb is already on the right edge. What killed it is that the
mirror does not move only the commit. **It moves the dues too**, so the right
hand ends up doing everything on the screen and the left hand is reduced to
holding the tablet. The chosen arrangement gives each hand a side and a job —
left thumb logs, right thumb ticks off.

The cost is named rather than denied: a right-hander reaches across for the
commit. It is a 560dp target, the widest thing on the screen and the most
forgiving thing on it to reach for.

**Two details the reach study earned, and both are cheap:**

- **The steps group inboard.** Four `TAP.min` targets with `TAP.gap` between
  them need 260dp, not the pane's full 560. Grouped toward the rail edge, all
  four clear a thumb's comfortable sweep **in the order they have always been
  in**. Reversing the order to chase the thumb was the tempting fix and the
  wrong one: the Tally is reused for every countable log so the muscle memory
  transfers, and an order that flips with the window is not muscle memory.
- **A due's tick moves to the trailing edge** in the aside. A checkbox on the
  leading edge of a right-hand pane is the one part of that pane a right thumb
  cannot comfortably reach.

**How much of the reach arithmetic to believe.** A comfortable thumb sweep from
a side grip is taken as ~50mm, which at 160dpi is ~315dp; the grip height is an
estimate. Call the arcs ±40dp. **The ranking is not in doubt** — which end of
the commit is reachable, and which stepper gets the good slot, hold under any
plausible thumb. Same standard `landscape-fold.test.ts` sets for the fold:
assert the sign and the order here, verify the millimetres on the device.

There are mockups of all of this, drawn to scale in the app's own faces and
palette, with plan views of both arrangements and the reach arcs over them.

### 5b. History — list-detail, and the pilot

History is already a list-detail screen wearing a phone's clothes: days collapse
to one line — *"12 eggs · 2 feeds · 1 loss"* — and expand **in place**, which the
file explains as *"no screen change, because the rows under a day are the same
kind of thing as the line that summarises them."* True on a phone. On a landscape
tablet it means a 340dp-wide list of days pushing itself down the screen while a
whole column sits empty.

Days on the left, the selected day's records on the right. It is the **cheapest
list-detail in the app** — the detail component already exists inline, there is
no route to restructure, and the selection state is already there. Do this one
first and learn from it.

### 5c. Stock, Iron, Growing, Inventory, Jobs, Treatments, Incubations, Members

The same shape: a list of things you open. This is the biggest structural win and
the biggest cost, because the detail lives in a pushed route
(`Stack.Screen name="Group"`) and React Navigation's stack does not do panes.

Two ways:

1. **Render the detail component directly in the aside.** Selection is local
   state; the pushed route stays exactly as it is for narrow windows. Cost: each
   detail screen currently takes `ScreenProps<'Group'>` and reads
   `route.params.groupId`, so each needs to accept the id as a prop with a thin
   route adapter around it. Mechanical, testable, no navigator surgery. **Back
   behaves correctly by construction** — there is nothing to pop, so system back
   leaves the screen as it always did.
2. Nest a navigator in the pane. More faithful — real back stack, deep links —
   and heavier, and it fights the single-stack simplicity `Root.tsx` argues for
   at length.

Recommend (1), staged after the History pilot proves the pane.

### 5d. The hubs and pickers — feed grid

Farm (7 rows), QuickAdd, MyFarm, Settings, PickVariety. A `Row` list in a 600dp
column with 600dp of nothing beside it, when the rows are equivalent items and
the canonical answer is a grid.

**This is the cheapest visible win in the whole document** — a wrapping container,
no navigation change, no state change. QuickAdd in particular is a verb grid
already; it just does not know it. Guardrail: a minimum column of ~300dp so a row
never gets narrower than its `detail` line.

### 5e. Numbers, Trend, Weather — let the charts out

The only screens where width is *literally more information*. A season's
production line at 1000dp shows more days than at 600. The forecast can show a
week instead of scrolling one.

These opt out of `LAYOUT.column` and take the full pane assembly, capped around
1000. **They are the one legitimate exception to the measure**, because a chart
is not prose and has no line length to ruin.

### 5f. Forms — one column, with context beside them

Add\*, Log\*, Weigh, Treatment, Harvest. **Do not two-column a form.** The eye
zigzags, focus order stops matching reading order, and validation becomes
ambiguous about which side failed. This is a well-worn mistake and there is no
reason to make it here.

Instead the supporting pane carries *context for the thing being logged*: the
group's withdrawal banner, the last three weights, the photo. Logging a weight
beside the last three weights is a genuinely better form than logging it alone —
that is the supporting-pane pattern doing what it is for, and it is more useful
than any amount of extra width on the fields.

---

## 6. The vertical half

"Larger space" in landscape is mostly horizontal, but not entirely — a landscape
tablet is *medium height*, which is the tighter of its two classes.

- The rail returns 88dp + `insets.bottom`.
- `ArchPanel` spends `SPACE.xl + SPACE.md` = 44dp of top padding, drawn for
  portrait. `landscape-fold.test.ts` already identifies this as one of the two
  levers that close the phone-landscape shortfall. Not needed for the tablet
  once panes exist, but it is the same 44dp and worth knowing where it is.
- With the keyboard up, an 800dp window is ~500dp of form. The reveal machinery
  in `Screen.tsx` and `reveal.tsx` is what makes that survivable and it becomes
  more important, not less, in landscape.

---

## 7. What must not move, and the one amendment

**Unchanged:**

- `LAYOUT.column` = 600. A measure, not a container. More columns, never a wider
  one.
- `ROTATES_AT` = 600, phones locked upright. Nothing here asks a phone to turn;
  the fold arithmetic still says no and the two-pane threshold is 992 anyway.
- One glow per screen (§3). One lamp, one doorway, however many panes.
- Arch = actionable. A supporting pane of read-only context wears `Panel`, never
  `ArchPanel`.
- UX-SPEC §4, four tabs. A rail is the same three destinations on a different
  edge.
- **Invariant 13.** Every pane layout degrades to today's exact single column
  below threshold. No screen loses anything by being narrow.

**The amendment — R3.** *"Primary actions live in the bottom third"*, tested by
*"thumb-reach audit on a 6.7" phone"*. That is a one-handed phone rule and it does
not transfer: on a landscape tablet held in two hands the reachable zone is the
bottom **outer corners**, and the centre-bottom is a dead spot.

Proposed wording, to be added rather than substituted:

> **R3 (amended).** Primary actions live in the reachable zone: the bottom third
> on a compact window, the bottom **outer corners** of the pane that owns them on
> an expanded one. Tested by a thumb-reach audit on a 6.7" phone *and* on a 10"
> tablet held in two hands.

Flagged rather than quietly broken, because R1–R10 are binding.

---

## 8. Tests

House style: token arithmetic in Node, not screenshots — the suite renders
against a stubbed react-native that does not lay out.

- **`tests/unit/pane-fit.test.ts`** — what `landscape-fold.test.ts` does for the
  fold, for panes. Assert the 992 threshold is the sum of its parts rather than a
  literal; assert 1280 landscape gives two and 800 portrait, 1024 landscape and a
  640 split each give one; assert the aside never falls below `aside.min` nor
  exceeds `aside.max`.
- **`tests/screens/reading-column.test.tsx`** — extend. The 600 cap still applies
  to the primary pane at *every* width, the ground is still uncapped, and the
  aside carries its own bounds.
- **The rail** — the tab set is byte-identical in both arrangements. No
  destination may appear or vanish with width. This is the invariant-13 guard for
  navigation.
- **Insets** — `insets.left`/`insets.right` are reserved. The stub reports
  `bottom: 16` today, which is what made the bottom-inset bug assertable; give it
  left and right and the same trick works.
- **Height** — the tally and its commit clear the fold at 800dp *and* at 600dp,
  with the rail's 88dp returned.
- **The step order never changes.** Assert the steps render in the order
  `STEPS[product][units]` gives them at every width. The grouping moves; the
  sequence is muscle memory and must not be a function of the window.

---

## 9. Order of work

**A — vocabulary and the free wins.** No navigation change, no pane machinery.

1. `theme/window.ts`, `useWindowClass`, the `LAYOUT` additions. Pure, tested.
2. `insets.left`/`insets.right` in `Screen`. A real bug, currently masked.
3. Grid the hubs: Farm, QuickAdd, MyFarm, Settings, and the three place lists.
4. Let Numbers, Trend and Weather exceed the column.

**B — the plus-up proper.**

5. `Screen` grows an optional `aside`; two panes at ≥ 992 usable.
6. History as the list-detail pilot.
7. Today: dues, weather row and exposure notice to the aside; alerts stay across
   the top. The farm's name moves above both panes — it titles the screen, not
   the tally pane.
8. The two reach details from §5a.1: group the steps inboard, move a due's tick
   to the trailing edge. Both are small and neither waits on anything.

**C — navigation and the rest.**

9. The rail at ≥ 840, with `TabDividers` and `TabMark` taught the other axis.
10. Stock, Iron, Growing to list-detail via the prop-not-param refactor.
11. Form context asides.

**D — write it down and prove it.**

12. The R3 amendment into UX-SPEC.
13. **On the tablet.** Every serious bug in this project so far has been one only
    a device could show, and a layout change is the most device-shaped work there
    is. The rail's labels, the reachable zone, the cutout insets and the pane
    split are four things the bundler cannot judge.

---

## 10. The one-line summary

The app has a single breakpoint at 600dp that means both "stop growing" and
"start turning", and a tablet in landscape is a *large*-width, *medium*-height
window that neither of those numbers describes. Give it a vocabulary for
expanded and large, keep the 600dp measure exactly where it is, and spend the
recovered 680dp on a second pane and a rail — not on a wider column.
