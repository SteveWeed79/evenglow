# Steading — The Landscape Plus-Up

**Status: phases A–C built; phase D is this document and a device.** Written
first as a design, then kept as the record of what the building changed about
it. Where the two differ, §11 says so — a plan that was quietly edited to match
its outcome is worth nothing to whoever reads it next.

**It has been seen on a tablet once, and that look paid for itself.** One
screenshot, 16 August, found two defects no test could reach and corrected the
device dimension the whole plan was drawn against — §11a. What has *not* been
seen is the state after those fixes. See §12 for what a second look still owes.

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

**A — vocabulary and the free wins.** No navigation change, no pane machinery. ✅

1. `theme/window.ts`, `useWindowClass`, the `LAYOUT` additions. Pure, tested.
2. `insets.left`/`insets.right` in `Screen`. A real bug, currently masked.
3. Grid the hubs: Farm, QuickAdd, MyFarm, Settings, and the three place lists.
4. Let Numbers, Trend and Weather exceed the column.

**B — the plus-up proper.** ✅

5. `Screen` grows an optional `aside`; two panes at ≥ 992 usable.
6. History as the list-detail pilot.
7. Today: dues, weather row and exposure notice to the aside; alerts stay across
   the top. The farm's name moves above both panes — it titles the screen, not
   the tally pane.
8. The two reach details from §5a.1: group the steps inboard, move a due's tick
   to the trailing edge. Both are small and neither waits on anything.

**C — navigation and the rest.** ✅ (Growing excepted — see §11)

9. The rail at ≥ 840, with `TabDividers` and `TabMark` taught the other axis.
10. Stock, Iron, Growing to list-detail via the prop-not-param refactor.
11. Form context asides.

**D — write it down and prove it.** Written; not yet proved.

12. The R3 amendment into UX-SPEC.
13. **On the tablet.** Every serious bug in this project so far has been one only
    a device could show, and a layout change is the most device-shaped work there
    is. The rail's labels, the reachable zone, the cutout insets and the pane
    split are four things the bundler cannot judge.

---

## 10. Where each piece landed

| Plan | Code |
|---|---|
| §3 vocabulary | `apps/mobile/src/theme/window.ts`, `hooks/useWindow.ts`, `LAYOUT` in `theme/tokens.ts` |
| §1 cutout insets | `components/Screen.tsx` — on the children, never the ground |
| §5d hub grids | `components/Grid.tsx`; Farm, QuickAdd, Settings, Stock, Iron, Growing |
| §5e charts | `wide` on Numbers, Trend, Weather |
| §5a supporting pane | `above` and `aside` on `Screen`; Today |
| §5b list-detail | History; then Stock via `GroupBody`, Iron via `MachineBody` |
| §5f form context | Weigh — the last three weighings beside the scale |
| §4 rail | `navigation/Tabs.tsx`, `hasRail` in `theme/window.ts` |
| §7 R3 | `docs/UX-SPEC.md`, amended |

Tests: `tests/unit/panes.test.ts` (the arithmetic), `tests/unit/tabs.test.ts`
(the rail's budget), `tests/screens/reading-column.test.tsx` (both caps and the
insets), `tests/screens/grid.test.tsx`, `tests/screens/panes.test.tsx`,
`tests/screens/list-detail.test.tsx`.

Two seams were added to the harness so the wide path is reachable at all:
`seedWindow` in `tests/support/native/react-native.tsx` and `seedInsets` in
`tests/support/native/modules.tsx`. Both default to a portrait handset, which
is what makes every *other* screen test a standing assertion that the narrow
path still renders what it always did.

---

## 11. What the building changed

Five things. Each was a plan that met a component and lost.

**The 8" tablet is decided by the rail.** §3's table said 944 and one pane,
computed with the rail's width already deducted; the code separates a window's
*class* from what is left for *content*, and `tests/unit/panes.test.ts` caught
the plan having it backwards. 1024 clears 992 on its own, so an 8" landscape
tablet is a two-pane window until the rail exists and a one-pane window
afterwards. That is why `windowClass` takes the chrome as an argument rather
than assuming it, and why the shortfall is 64dp rather than 32.

**The rail is 96dp, not 80.** Material's 80 is sized for a 24dp glyph with a
short word under it. This bar has no icons — the word is the whole tab — and
`tab-marks.ts` allows eight characters, which is about 70dp of Plex Mono with
its tracking and does not fit inside 80 less padding. `TabMark` records this
bar clipping its labels twice already, both times because a word went in a box
measured for something else.

**The weather does not go in the aside.** §5a put the forecast row there.
`aside` restacks *under* the column at one pane, so anything moved into it
moves below the tallies on every handset — and the row is deliberately above
them. A layout change for a tablet may not reorder a phone. It spans both panes
instead, which also keeps the three weather strips in the order their own
comments argue for rather than splitting them across two columns.

**Neither "reach detail" existed.** §5a.1 asked for the tally steps to be
grouped inboard and a due's tick moved to the trailing edge. Reading the
components: `styles.steps` is already a centred row of `TAP.min` targets — a
260dp group, not a row spanning the pane — and `DueRow` already renders its
Done control as the trailing child. Both mockups had been drawn from this
document rather than from the code. The trap the study was right about is real
and still open, so it is kept as a test instead: the step order may not be a
function of the window.

**MyFarm is a form and Growing has no detail.** §5d listed MyFarm as a hub from
its filename; it is Fields, Toggles and Pickers, so it keeps one column by
§5f's own rule. And Growing's list is *beds* while its pushed detail is a
*planting*, so "the selected bed's detail" is the plantings the bed card
already shows. Making it list-detail means listing plantings instead of beds,
which is a redesign of the screen rather than a layout for it.

---

## 11a. What the tablet said, the first time it was looked at

A screenshot, 16 August. Three things, and the third is not a bug.

**The rail was 360dp, not 96.** `BottomTabBar` applies
`getDefaultSidebarWidth()` as a **`minWidth`** whenever the labels are
horizontal, and that default is Material's navigation *drawer* width. A
`minWidth` beats the `width` in `tabBarStyle`, so `LAYOUT.rail` was never
reached and nothing said so. `tabBarLabelPosition: 'below-icon'` drops the
minimum to zero. This bar has no icons, so "below the icon" only means
"stacked" — which is what a rail wants anyway.

**Nothing reserved the bottom inset.** `Screen` read `back ? insets.bottom : 0`
because a tab screen has the bar beneath it and the bar reserves its own. The
moment the bar moved to the leading edge, nothing stood at the bottom of a tab
screen at all, and "Also today" ran under the system navigation. The rule the
old code was reaching for is the one now written: the inset belongs to whichever
thing actually meets the bottom of the screen.

### **The tablet is 960 × 600dp, and this plan was drawn for 1280 × 800.**

This is the finding, and it is not fixable by moving a number.

The screenshot is 1920 × 1200 physical at density 2.0. Everything checks: the
360dp drawer default is 720px and the sidebar measured ~718px; the content
column came out under the 600dp cap rather than over it.

So the real device is **expanded** width, not large. After a correct 96dp rail
it has **864dp** for content, and the two-pane threshold is 992. **Two panes
will never appear on this tablet**, and lowering the threshold does not help:

```
600 column + 24 spacer + 200 aside + 48 margins = 872 > 864
```

Even a 200dp aside does not fit, and 200 is already below anything worth
calling a pane. The arithmetic in §3 is right; the hardware is narrower than
the plan assumed. `aside` restacks below the column, which is exactly what the
screenshot shows and exactly what invariant 13 asks for.

**What the tablet does get**, once the two fixes above ship: a 96dp rail
instead of a 360dp drawer, two-column hubs (864dp of content is two 400dp
cells), and the charts at full width. That is still most of the 53% back.

**What it does not get is the pane work** — Today's aside, History and
Stock/Iron list-detail. That code is correct, tested, and dormant on this
hardware. It waits for a wider window: a 1280dp tablet, a desktop-mode display,
or a decision to shrink the measure, which §7 says not to make.

---

## 12. What a device still has to answer

### What the first look already answered

One screenshot, 16 August, and it settled three of the five questions this
section used to list — two of them by failing.

- **`tabBarVariant: 'material'` was the wrong combination**, exactly as this
  section suspected. `BottomTabBar` applies `getDefaultSidebarWidth` as
  `minWidth` when labels are horizontal, that default is the 360dp *drawer*
  width, and `minWidth` beats `width` — so `LAYOUT.rail` was never in play.
  Answered, and fixed with `tabBarLabelPosition: 'below-icon'`.
- **The bottom inset was not reserved at all.** Not on this list, because
  nobody thought to put it here: `Screen` read `back ? insets.bottom : 0` and
  that reasoning expired the moment the bar left the bottom edge. Content ran
  under the system navigation. Answered by looking, and by nothing else.
- **The two-pane fold is moot on this hardware.** §11a: 960 × 600dp, 864dp
  after the rail, against a 992dp threshold. There is no 480dp of dues to
  judge beside the column because there is no aside. Deferred, not answered —
  the question returns on a wider display.

The measurement underneath all three is the one that mattered most: the drawer
rendering at 718px is what gave density 2.0, and therefore 960 × 600dp instead
of the 1280 × 800 this plan was drawn for.

### What a second look still owes

- **The rail's labels, at 96dp this time.** The first look could not answer
  this — the rail was 360dp wide, so nothing was under pressure. Three
  uppercase mono words stacked under no icon in 96dp is arithmetic saying yes,
  and this bar has clipped twice on arithmetic that said yes.
- **`tabBarLabelPosition: 'below-icon'` with no icon.** The fix swapped one
  undrawn-for combination for another. It drops the `minWidth` floor, which is
  the part that was verified by reading the source; how it *looks* with a label
  and no icon above it is not.
- **The bottom of Today, now that the inset is reserved.** The fix is
  conditional on `!hasRail(width)`, so a phone and a tablet take different
  branches and only one of them has been seen broken.
- **The cutout insets.** `insets.left`/`insets.right` are reserved and still no
  device in the suite reports a non-zero one. Unchanged by the first look.
- **Which pane the tally wants.** §5a.1 settles it on an argument, not a
  measurement, and the reach arcs are ±40dp. Dormant with the pane work.

---

## 13. The one-line summary

The app had a single breakpoint at 600dp that meant both "stop growing" and
"start turning", and a tablet in landscape is a *large*-width, *medium*-height
window that neither of those numbers described. It has a vocabulary for
expanded and large now, the 600dp measure has not moved a dp, and the
recovered width went into a second pane and a rail rather than into a wider
column.
