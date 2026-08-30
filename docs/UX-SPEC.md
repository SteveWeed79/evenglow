# Steading — UX Spec, Field-First Interface

The competitive finding that drives this document: the market leader loses on **comprehension**, not capability. Reviewers call Farmbrite powerful and hard to figure out. Every decision below spends capability to buy clarity.

**Design context, stated plainly:** one hand, gloves on, 6am, direct sun or near-dark, no signal, possibly holding a feed bucket. Not a desk.

---

## 1. Non-Negotiable Rules

| # | Rule | Test |
|---|---|---|
| R1 | **Five-second rule.** Any daily log is ≤3 taps from cold app launch. | Stopwatch, airplane mode, on device. |
| R2 | **Home is today, not a dashboard.** Charts live one level down. | Home shows chores + tally, no analytics above the fold. |
| R3 | **Primary actions live in the reachable zone** — the bottom third on a compact window, the bottom **outer corners** of the pane that owns them on an expanded one. Top of screen is for status only. | Thumb-reach audit on a 6.7" phone *and* on a 10" tablet held in two hands. |
| R4 | **Tap targets ≥56px, primary actions 64px, ≥12px spacing.** Gloves cut touch precision to roughly 12–25mm even with capacitive tips; the 44px accessibility floor is a floor, not a target. | Automated audit in CI. |
| R5 | **Numbers are entered with steppers, never a keyboard,** unless the value can exceed 99. | No numeric `<input>` on any daily log screen. |
| R6 | **Nothing waits on the network.** Every write is optimistic; the queue is visible and calm. | No spinner blocks a log action, ever. |
| R7 | **7:1 contrast on body text** (WCAG AAA), because the people reading it are mostly over forty. Two prose tiers share the floor — `ink` leads, `inkQuiet` follows. | Contrast check in CI. |
| R8 | **No hover-dependent affordance and no gesture-only action.** Every gesture has a visible button. | Manual review per screen. |
| R9 | **Basic / Full toggle per module.** Basic is default and hides every optional field. | New user completes a week of logs without opening Full. |
| R10 | **No modal blocks a log.** Warnings inform; only withdrawal violations confirm. | Review per screen. |

> **R7's reason changed; its number did not.** It used to read "because the
> screen is in the sun". Ambient light adds reflected luminance to foreground
> and background alike, so it *compresses* every ratio toward 1 — a 7:1 pair
> under harsh reflection lands near 1.3:1 and is unreadable whatever the
> palette says. Contrast is a weak lever against glare; screen luminance, an
> anti-reflective panel and the **bright-sun theme** are what handle that.
> Age-related loss of contrast sensitivity is the reason that actually holds,
> and unlike the sun it holds in a dark barn at 5am too — which is where the
> old reason broke down, since it was being applied to the lamplight theme.
>
> Reading R7 as *one colour for all prose* is what left the app with a single
> volume for every sentence it says. It is a floor, not a target: `ink` clears
> it by 1.8–2.7×, and `inkQuiet` is quieter while still AAA.
>
> **R3 gained a second half, and it is the phone half that was incomplete.**
> The rule used to read "the bottom third", tested by a thumb-reach audit on a
> 6.7" phone. That is right about a phone — one hand, a thumb arcing from a
> bottom corner — and it does not transfer. A tablet in landscape is held in
> **two** hands, with the thumbs on the left and right edges and the fingers
> behind the glass; the centre-bottom of a 1280dp window is one of the worst
> places on the screen rather than the best. So the rule now names the zone
> instead of a fraction of the screen, and the zone is a different shape at
> each size. Nothing about a phone changed.
>
> The arrangement this produced on Today is worth stating, because it is the
> reason the tally kept the left column: **each hand gets a side and a job.**
> Left thumb logs — the commit and all four steps sit in its sweep. Right thumb
> ticks off — the dues are in the pane under it. Mirroring the layout would
> have bought the commit a shorter reach for a right-hander and moved the dues
> across with it, leaving one hand carrying the whole screen. See
> `docs/LANDSCAPE-PLAN.md` §5a.1 for the reach study and its error bars.
>
> **R4 has one standing exception, and it is the header chrome.** Back, the
> quick-add, the gear, the lamp and the sync chip are declared at **28dp** with
> `hitSlop={12}`, so a finger registers over **52** — past the 44 accessibility
> floor, short of R4's 56. They stay there because that row stands above the
> content on every screen in the app, so 56 would take 28dp off the top of all
> of them, and the vertical budget down to a form's commit button already clears
> a 430dp landscape phone by under 30dp. The trade is a chevron that is easier
> to hit on one screen against a save button that stays reachable on all of
> them. It is a decision about header height, not an oversight: the audit
> (`tests/screens/tap-size.test.tsx`) names those five and **pins them at 28
> with their slop**, so one drifting either way fails CI. Every other control in
> the app is measured against the full 56.

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

  /* THE MOTIF: light, not shape. Every surface is the same rounded
     rectangle; what makes a card a card is the lamp across its head —
     see "the motif" below. The arch this replaced is recorded there.   */
  --radius: 0.75rem;
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

### The motif: the lamp on the card

Every surface is the same rounded rectangle, and what carries the burrow is **light**: a soft warmth along the top edge of every card, as though a lamp hung above the wall. It costs nothing, needs no illustration, and makes the app recognizable from across a room.

**It is a lamplight feature.** Over a near-white card the same warm wash darkens the surface *toward* the wall's own tone and subtracts the separation it was there to create — daylight measured 1.222:1 flat and 1.064 lit, bright sun 1.180 and 1.031, the last of which is a card top indistinguishable from its wall. So the two light themes carry no glow and take a darker ground instead — to 1.245 and 1.256, which is all the room they have. What runs out first in both is `lanternInk`, the readable brass, on a 4.5:1 floor of its own.

**This replaced the arch, which was the motif until it was seen at size.** `--arch` was an elliptical radius — 50% of the width across, a fixed 2rem down — so that a doorway got a wide shallow head on straight jambs rather than the semicircular dome a single circular radius gives. That much worked. What did not is that the head scaled with the surface: on a card 500dp wide the ellipse is 500 by 32, which reads as a warped top edge rather than a door. The motif was legible on a chip and a button and dissolved on everything larger, which is most of the app.

It was also **load-bearing — arch = something you can act on**, with flat rectangles read-only. That affordance now rests where it always actually lived: the chevron, the press state and the button role, which `<Touch>` renders and a flat panel does not. The arch was a second, silent copy of a signal already being given.

### Signature element — the Tally

The counter remains the heart of the app: oversized numeral, `+1 / +6 / +12` and `−` in the thumb zone, reused for every countable log so muscle memory transfers. It sits in a full-height card with a hairline brass rule, lit by the same soft radial warmth every card carries. The numeral is set in Fraunces with tabular figures, at a weight that makes eighteen eggs feel like an occasion.

**Restraint:** the Tally is the only bold element. Everything else is quiet and warm. No drop shadows, no mascot, no full-screen illustration.

**The glow used to be rationed to one per screen, and is not any more.** The line here read *"no gradients beyond the single lamp glow"*, on the reasoning that a lit surface reads as somewhere to go and four of them read as a gradient habit. That was overturned deliberately: on the tablet, cards were not separating from the wall at all — the surfaces are within 1.2:1 of each other and a dark theme has no room to push them apart — and the light does what the luminance step could not. What keeps the Tally the bold element is scale, not scarcity: it is the largest surface, so the same wash reads as more light on it than on anything else.

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
  border-radius: var(--radius);
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
  border-radius: var(--radius);
  font-family: var(--font-body);
}
.tally__commit { background: var(--lantern); color: #201913; width: 100%; }
```

The lamp glow sits on the top edge of the card, above its content — light falling from something hung over the wall. **On every card, after dark**: it was one glow per screen while it was a doorway's light rather than a room's, and it is off entirely in daylight and bright sun, where it made cards harder to pick out rather than easier.

**The light stops before the text starts, and that is a floor rather than a preference.** The first version washed *through* the card and put a `muted` label on 2.73:1 against a 4.5 minimum — a gradient defeats a palette check, because the colour underneath the text appears nowhere in the palette. `tests/unit/contrast.test.ts` composites it now. It also stays off `lantern` fills: the primary button is the one saturated thing on a screen and a wash over brass only mutes it.

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
2. ~~**Hand-drawn spot marks.**~~ **Dropped — see below.** The twelve empty containers that held their place have been removed; the copy is the invitation.
3. **Milestones.** The thousandth egg. A machine's first 500 hours. A hen's first lay. A small arched card appears at the *top of Today*, auto-dismisses, blocks nothing, and can be turned off in one setting. This is where the leaderboard from the competitive analysis lives too.
4. **The streak, as a growing thing.** Consecutive days of morning chores render as a small plant gaining a leaf per week rather than a number with a flame. Same information, better feeling, and it doesn't shame you when it breaks — it just goes back to a seedling.
5. **Pantry-label typography.** Section labels are set small-caps in `--font-data` with generous tracking, like handwritten labels on stored jars. Structural, not decorative — they mark where you are.
6. **Voice in the connective tissue.** See below.

### When to build it

The charm layer is the most enjoyable and least load-bearing work in this project, which makes it exactly what gets built instead of the sync engine. So it is split in two and gated:

- **Now (an afternoon, Phase 1):** tokens, the arch, type, voice. These are decisions, not features — cheap to make early and expensive to retrofit, since every component inherits them.
- **Not until Phase 2 exits:** milestones, streaks, spot illustrations, the leaderboard. **Gate: mutations survive a hard device restart and flush without loss or duplication.** A beautiful arched interface on a sync engine that silently eats egg counts is worse than no app.

**What's explicitly banned:** mascots, animal puns in controls, exclamation marks in system copy, confetti, bouncing, loading-screen jokes, anything that adds a tap, anything that delays a log by a single frame. Charm that costs time isn't charm.

### Why the spot marks were dropped

Twelve empty states carried an empty container waiting on illustration for as
long as they have existed. The containers are gone and the art is not coming.

**An empty state is the one surface that deletes itself.** A farmer reads
"Nothing here yet" on Stock once, adds their goats, and never sees it again —
so twelve illustrations, in light and dark variants, held to one hand, would
have been the largest art budget in the project spent on its shortest-lived
screens. The copy already does the work this list asked for: *"Add what you
keep under Stock, and the morning's tally lands here."* That **is** the
invitation.

It is also the same mistake `Icon.tsx` documents having already made once —
sixty-four marks cut to sixteen because "a mark beside a word that already says
the same thing is drawn twice on every screen it appears on." A drawing above a
sentence that already invites is that error at 112px.

**What survives from this idea:** the launcher icon, which is not charm. It is
the only image in the project seen daily and permanently, `app.json` still has
no `foregroundImage`, and an APK handed to anyone wears the default Expo icon.
Milestones and the streak (points 3 and 4) also still stand — an achievement is
a surface where a picture is the medium rather than a decoration on one.

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

It also sets the voice. A homefarm is unglamorous, well-kept, and built from what was to hand. Nothing in the interface should contradict that.

Reference it plainly: *Steading*, never *the Steading app*, never capitalized mid-sentence for emphasis. Domain target `homefarm.app` or `homefarm.farm`; verify the .com and run a USPTO search in class 9/42 before any public launch.

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
