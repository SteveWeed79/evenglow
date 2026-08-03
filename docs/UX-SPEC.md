# Steading — UX Spec, Field-First Interface

The competitive finding that drives this document: the market leader loses on **comprehension**, not capability. Reviewers call Farmbrite powerful and hard to figure out. Every decision below spends capability to buy clarity.

**Design context, stated plainly:** one hand, gloves on, 6am, direct sun or near-dark, no signal, possibly holding a feed bucket. Not a desk.

---

## 1. Non-Negotiable Rules

| # | Rule | Test |
|---|---|---|
| R1 | **Five-second rule.** Any daily log is ≤3 taps from cold app launch. | Stopwatch, airplane mode, on device. |
| R2 | **Home is today, not a dashboard.** Charts live one level down. | Home shows chores + tally, no analytics above the fold. |
| R3 | **Primary actions live in the bottom third.** Top of screen is for status only. | Thumb-reach audit on a 6.7" phone. |
| R4 | **Tap targets ≥56px, primary actions 64px, ≥12px spacing.** Gloves cut touch precision to roughly 12–25mm even with capacitive tips; the 44px accessibility floor is a floor, not a target. | Automated audit in CI. |
| R5 | **Numbers are entered with steppers, never a keyboard,** unless the value can exceed 99. | No numeric `<input>` on any daily log screen. |
| R6 | **Nothing waits on the network.** Every write is optimistic; the queue is visible and calm. | No spinner blocks a log action, ever. |
| R7 | **7:1 contrast on body text**, exceeding WCAG AA, because the screen is in the sun. | Contrast check in CI. |
| R8 | **No hover-dependent affordance and no gesture-only action.** Every gesture has a visible button. | Manual review per screen. |
| R9 | **Basic / Full toggle per module.** Basic is default and hides every optional field. | New user completes a week of logs without opening Full. |
| R10 | **No modal blocks a log.** Warnings inform; only withdrawal violations confirm. | Review per screen. |

---

## 2. Visual Direction — The Burrow

**Concept: a lamplit burrow, not a dashboard.** The reference world is the cozy earth-sheltered home — round-topped doors, arched windows set in thick plaster walls, brass hardware, turf roofs, oil lamps, hand-lettered pantry labels, produce from the garden. Warm, worn-in, made by hand. The opposite of enterprise software, and the opposite of the safety-yellow equipment aesthetic this spec originally carried.

Two deliberate swerves away from the obvious:

1. **Not cream.** The cozy default is a pale cream page with a high-contrast serif and a terracotta accent — currently the most-copied look in software, and it reads as a template. This ground is **limewashed plaster shifted gold-green**, with brass and garden accents instead of clay. Warm, but not the warm everyone else is using.
2. **Not cute.** Whimsy comes from craft — the arch, the lamplight, the hand-set type, the voice — never from mascots, rounded blobs, or exclamation marks.

### Tokens

```css
:root {
  /* Daylight (default) — limewashed plaster. Sun is the harsher
     constraint and daylight is simply the majority of use.            */
  --ground:  #EDE6D2;   /* plaster, gold-green — not cream              */
  --raised:  #F5F0E1;   /* card surfaces                               */
  --ink:     #241C14;   /* deep loam brown                             */
  --muted:   #6E6152;   /* secondary text, dividers                    */

  /* Accents — brass, garden, orchard. Shared across both modes.        */
  --lantern: #E9B23C;   /* primary action. Brass + lamplight            */
  --leaf:    #6B8F52;   /* complete, synced, healthy                    */
  --rowan:   #C4442C;   /* overdue, withdrawal active, conflict         */
  --damson:  #8A6484;   /* queued / offline. Plum — calm, never alarming*/

  /* Type — Fraunces carries the warmth, Alegreya Sans carries the load */
  --font-display: 'Fraunces', Georgia, serif;        /* wonk 1, soft 30 */
  --font-body:    'Alegreya Sans', system-ui, sans-serif;
  --font-data:    'IBM Plex Mono', ui-monospace, monospace;

  --step-tally:  clamp(4rem, 22vw, 7rem);
  --step-title:  1.5rem;
  --step-body:   1.0625rem;   /* 17px floor — never smaller outdoors    */
  --step-label:  0.8125rem;   /* small caps, tracked, --font-data       */

  /* Touch — unchanged. Coziness never costs a millimetre.              */
  --tap-min:     56px;
  --tap-primary: 64px;
  --tap-gap:     12px;

  /* THE MOTIF: the round door. Top arched, bottom seated on the floor.
     Elliptical: 50% of the width across, a fixed 2rem down. A doorway is a
     wide shallow head sitting on straight jambs, and one circular radius
     cannot be both — see "the motif" below.                              */
  --arch: 50% 50% 0.5rem 0.5rem / 2rem 2rem 0.5rem 0.5rem;
  --border: 2px solid color-mix(in oklab, var(--ink) 22%, transparent);
}

/* Lamplight — the burrow at dawn. System-driven, plus a manual toggle
   in the header for pre-sunrise chores.                              */
@media (prefers-color-scheme: dark) {
  :root {
    --ground: #201913;   /* deep loam, warm not grey                   */
    --raised: #2C2319;   /* one step toward the fire                   */
    --ink:    #F0E7D5;   /* candle-warm off-white                      */
    --muted:  #9C8E7A;
  }
}

/* Bright-sun override — one tap from the header. Warmth yields to
   legibility, never the reverse. */
[data-contrast='sun'] {
  --ground: #FFFDF6; --raised: #FFFFFF; --ink: #14100A; --muted: #4A4238;
  --lantern: #A66F00; --border: 2px solid var(--ink);
}

[data-numeric] { font-variant-numeric: tabular-nums; }
```

### The motif: the round door

`--arch` is the one shape the whole app is built from. Every card, the Tally frame, primary buttons, sheets, and the empty-state panels are arched at the top and squared at the base — a doorway seated on a floor. It appears everywhere, costs nothing, needs no illustration, and makes the app recognizable from across a room.

It is also load-bearing: **arch = something you can act on.** Flat rectangles are read-only. That's a real affordance, not decoration — so a card that only tells you something wears no door. Use `.panel` for those.

**Why the radius is elliptical.** This token was `999px 999px 8px 8px` until it was looked at on a screen. When corner radii would overlap, CSS scales all four by a single factor, so on any element wider than it is tall the top corners meet in the middle: a semicircular dome with no jambs at all. Every chip, button and card rendered as a tombstone, and the curve ate its own padding badly enough that card text sat outside the border. A radius small enough to fix that flattened the Tally into a rounded rectangle. Two radii — wide across, shallow down — give a head and jambs at any size, which is what a door is.

### Signature element — the Tally, in its doorway

The counter remains the heart of the app: oversized numeral, `+1 / +6 / +12` and `−` in the thumb zone, reused for every countable log so muscle memory transfers. It now sits inside a full-height arch with a hairline brass rule, lit by a soft radial warmth behind the numeral — a lamp above a doorway. The numeral is set in Fraunces with tabular figures, at a weight that makes eighteen eggs feel like an occasion.

**Restraint:** the Tally is the only bold element. Everything else is quiet, flat, and warm. No gradients beyond the single lamp glow, no drop shadows, no mascot, no full-screen illustration.

---

## 3. Core Components

### Tally

```tsx
'use client';
import { useState, useCallback } from 'react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

type TallyProps = {
  label: string;
  unit: string;
  steps?: readonly number[];
  initial?: number;
  onCommit: (value: number) => void;   // enqueues offline; never awaits network
};

export function Tally({
  label, unit, steps = [1, 6, 12], initial = 0, onCommit,
}: TallyProps): JSX.Element {
  const [count, setCount] = useState(initial);
  const bump = useCallback((by: number) => {
    setCount((c) => Math.max(0, c + by));
    void Haptics.impact({ style: ImpactStyle.Light });   // confirmation through gloves
  }, []);

  return (
    <section className="tally" aria-labelledby="tally-label">
      <p id="tally-label" className="tally__label">{label}</p>

      <output className="tally__count" data-numeric aria-live="polite">
        {count}
      </output>
      <p className="tally__unit">{unit}</p>

      <div className="tally__steps">
        {steps.map((s) => (
          <button key={s} type="button" className="tally__step" onClick={() => bump(s)}>
            +{s}
          </button>
        ))}
        <button
          type="button"
          className="tally__step tally__step--down"
          onClick={() => bump(-1)}
          aria-label="Subtract one"
          disabled={count === 0}
        >
          −
        </button>
      </div>

      <button type="button" className="tally__commit" onClick={() => onCommit(count)}>
        Log {count} {unit}
      </button>
    </section>
  );
}
```

```css
.tally {
  border-radius: var(--arch);
  border: var(--border);
  background:
    radial-gradient(120% 80% at 50% 12%,
      color-mix(in oklab, var(--lantern) 14%, transparent), transparent 70%),
    var(--raised);
  padding: 2.5rem 1rem 1rem;
  text-align: center;
}
.tally__count {
  display: block;
  font-family: var(--font-display);
  font-variation-settings: 'SOFT' 30, 'WONK' 1, 'wght' 700;
  font-size: var(--step-tally);
  line-height: 0.9;
  color: var(--ink);
}
.tally__step, .tally__commit {
  min-height: var(--tap-primary);
  border-radius: var(--arch);
  font-family: var(--font-body);
}
.tally__commit { background: var(--lantern); color: #201913; width: 100%; }
```

The lamp glow sits behind the numeral, above the arch's spring line — light coming in through a round door. **One glow per screen**, over whichever doorway that screen is about. A screen with no Tally spends it elsewhere: sign-in, which has no counter, lights its own doorway.

Haptic feedback matters more than it sounds: through a glove it's often the only confirmation the tap registered. This is a concrete argument for the native shell — the web `navigator.vibrate` API is unsupported in iOS Safari, so on a PWA this feature would simply not exist on half the phones in the world. The Capacitor plugin works everywhere.

### SyncChip

Persistent, top-right, never blocks anything. Calm blue for queued work — a farm hand seeing red all morning learns to ignore red.

```tsx
type SyncState =
  | { kind: 'synced'; at: Date }
  | { kind: 'queued'; count: number }
  | { kind: 'syncing'; count: number }
  | { kind: 'rejected'; count: number };

const COPY: Record<SyncState['kind'], (s: never) => string> = {
  synced:   () => 'Saved',
  queued:   (s: { count: number }) => `${s.count} waiting`,
  syncing:  (s: { count: number }) => `Sending ${s.count}`,
  rejected: (s: { count: number }) => `${s.count} need a look`,
};
```

Tapping the chip opens the diagnostics sheet: queue depth, last successful sync, last error, device ID, storage used, and a **Copy diagnostics** button. This is what makes a stuck queue debuggable from a barn.

### WithdrawalBanner

The one place a warning outranks speed. If an active medication withdrawal covers today, the egg log shows a persistent `--alert` band naming the medication and the clear date, and committing requires one confirm tap. Not a modal — a band that stays put.

---

## 4. Navigation

At most four bottom tabs — every additional tab is a decision made at 6am.
Three, as it turns out.

```
┌────────────────────────────────────┐
│  Tue 26 Jul        [3 waiting]  ○  │  status, the sync chip, the lamp
├────────────────────────────────────┤
│                                    │
│   MORNING                    2/5   │  today's chores, tap to complete
│   ─────────────────────────────    │
│   ☐ Feed layers                    │
│   ☐ Check waterer                  │
│   ☑ Collect eggs            18     │
│                                    │
│   ┌──────────────────────────┐     │
│   │   EGGS TODAY             │     │  the Tally, always reachable
│   │        18                │     │
│   │   [+1] [+6] [+12]  [−]   │     │
│   │   [   Log 18 eggs    ]   │     │  thumb zone
│   └──────────────────────────┘     │
├────────────────────────────────────┤
│  Today  │  Stock  │  Iron  │  More │  64px tabs
└────────────────────────────────────┘
```

- **Today** — chores, the Tally, anything overdue. The morning.
- **Farm** — a hub, one press to Animals, Crops and beds, Machines and kit, and
  to what this farm runs at all.
- **History** — the record, by day. Titled *What happened* on the screen; the
  bar has room for one short word.

### The three, and the amendment that was not needed

Stock, Growing and Iron were three of the four tabs, so the bar was full before
the record had anywhere to live. That framed a choice — amend this section to
allow a fifth, or leave What happened somewhere nobody would find it.

**It was a false choice.** Those three are the same kind of thing: places you
go to set something up or look something over. Today is the morning, History is
the record, the Farm is the farm. Three answers to three different questions,
which is what a tab bar is for.

The hub costs one press to reach a flock. It buys:

- a bar that stays at three however many enterprises a farm adds, so no future
  feature has to fight for the bottom of the screen;
- **a bar that does not change shape under somebody's thumb.** It used to be
  built per farm, so switching Growing on moved every other tab along — and
  muscle memory is most of what a tab bar is for. What a farm runs still
  decides what it sees; it now hides a row rather than a tab.

**Four remains the wall.** If a feature needs a fifth tab, it needs a rethink —
and this section is the worked example of what that rethink looks like.

---

## 5. Onboarding

Setup burden is the top cause of abandoned record keeping, so the first run collects almost nothing and pre-fills the rest.

1. **What do you keep?** Species chips (chickens, ducks, quail, turkeys, geese, other). Multi-select.
2. **How many?** One Tally screen. Individual bird profiles are optional and can wait.
3. **Any equipment?** Make/model picker → service intervals pre-populated from the preset library, Deere-style. Skippable.
4. Done. Land on Today with three suggested chores already there.

Total: three screens, no typing beyond a farm name. Everything else is discovered later through Full mode.

---

## 6. The Whimsy Budget

Charm is spent where the app is *waiting* — never where it's working. The split is absolute:

| Layer | Register | Why |
|---|---|---|
| Controls, labels, field names | Plain and literal | You're reading it with cold hands |
| Errors and warnings | Plain and literal | Charm here is an insult |
| Numbers and data | Plain and literal | Mono, tabular, no flourish |
| Empty states, confirmations, milestones, seasons, illustrations | Warm | Nothing depends on them |

**Where the warmth actually lives — six places, and no others:**

1. **Lamplight.** A genuinely warm dark mode, not a grey one — system-driven with a header toggle for pre-sunrise chores. Daylight remains the default, because sun is the harsher constraint and it's the majority of use.
2. **Hand-drawn spot marks.** Inline SVG line drawings, one per empty state — a nesting box, a hung lantern, a grease gun on a bench. Single-weight strokes in `--muted`, under 2KB each, never full-bleed, never animated.
3. **Milestones.** The thousandth egg. A machine's first 500 hours. A hen's first lay. A small arched card appears at the *top of Today*, auto-dismisses, blocks nothing, and can be turned off in one setting. This is where the leaderboard from the competitive analysis lives too.
4. **The streak, as a growing thing.** Consecutive days of morning chores render as a small plant gaining a leaf per week rather than a number with a flame. Same information, better feeling, and it doesn't shame you when it breaks — it just goes back to a seedling.
5. **Pantry-label typography.** Section labels are set small-caps in `--font-data` with generous tracking, like handwritten labels on stored jars. Structural, not decorative — they mark where you are.
6. **Voice in the connective tissue.** See below.

### When to build it

The charm layer is the most enjoyable and least load-bearing work in this project, which makes it exactly what gets built instead of the sync engine. So it is split in two and gated:

- **Now (an afternoon, Phase 1):** tokens, the arch, type, voice. These are decisions, not features — cheap to make early and expensive to retrofit, since every component inherits them.
- **Not until Phase 2 exits:** milestones, streaks, spot illustrations, the leaderboard. **Gate: mutations survive a hard device restart and flush without loss or duplication.** A beautiful arched interface on a sync engine that silently eats egg counts is worse than no app.

**What's explicitly banned:** mascots, animal puns in controls, exclamation marks in system copy, confetti, bouncing, loading-screen jokes, anything that adds a tap, anything that delays a log by a single frame. Charm that costs time isn't charm.

### Voice

Warm and plainspoken — a well-kept notebook, not a greeting card. Specific always beats clever.

- **Controls say what they do.** *Log 18 eggs*, not *Submit*, and not *Gather the harvest*. The button's verb reappears in the confirmation.
- **Confirmations may exhale.** After logging: *Eighteen in the basket.* That's the whole allowance — one short, plain sentence.
- **Names people recognize.** *3 waiting*, not *pending mutations in queue*.
- **Errors stay plain and never apologize.** *That hour reading is below the last one recorded (412 h). Check the meter and try again.*
- **Empty screens invite.** *No equipment yet. Add your tractor and its service schedule comes with it.*
- **Sentence case everywhere.** Uppercase only for `--font-data` section labels.

### The name

**Steading** — the farmhouse and its working buildings taken together: barn, byre, stable, granary, yard. A Scottish word for the whole of a small farm rather than any one part of it, which is exactly the product's scope. Stock and iron and chores under one roofline.

It also sets the voice. A steading is unglamorous, well-kept, and built from what was to hand. Nothing in the interface should contradict that.

Reference it plainly: *Steading*, never *the Steading app*, never capitalized mid-sentence for emphasis. Domain target `steading.app` or `steading.farm`; verify the .com and run a USPTO search in class 9/42 before any public launch.

---

## 7. Release Gates

- [ ] Cold start → egg logged in ≤5s, airplane mode, gloved, timed on a real device
- [ ] Someone who has never seen the app logs a full day's chores with no instruction
- [ ] Every interactive element ≥56px with ≥12px spacing (automated)
- [ ] Body text ≥7:1 contrast, light and dark (automated)
- [ ] Readable at arm's length in direct sunlight at max brightness (manual, outdoors)
- [ ] Every action reachable one-handed on a 6.7" screen
- [ ] Full keyboard navigation with visible focus; `prefers-reduced-motion` respected
- [ ] Zero blocking spinners on any log path
- [ ] Diagnostics sheet reachable in two taps from anywhere
- [ ] Every gate above verified on a real Android device, not the dev server
- [ ] Cold launch under 2s on a low-end device
- [ ] Haptic confirmation fires on every Tally increment and commit
- [ ] Bright-sun mode reachable in one tap from the header and holds ≥7:1 on all text
- [ ] Every decorative element can be disabled without breaking a layout
- [ ] No milestone, streak, or celebration adds a tap or delays a log
- [ ] Total illustration payload under 20KB across the whole app
