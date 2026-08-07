import { beforeEach, describe, expect, it } from 'vitest';
import type { ReactTestInstance } from 'react-test-renderer';
import { AFFORDANCES, Touch, type Affordance } from '../../apps/mobile/src/components/Touch';
import { mount } from '../support/screen';
import { SCREENS, stockTheFarm } from '../support/screens';
import { freshStore } from '../support/store';

/**
 * What every pressable thing in the app promises, checked on every screen.
 *
 * ## Why this can exist and the arch rule could not
 *
 * The arch answered "you can act on this" by shape — one doorway meaning
 * press-this, go-there and this-is-the-point at once. A reviewer could say a
 * screen looked wrong; nobody could say it *was* wrong, so the rule survived
 * only as long as somebody was looking. Five signals, one per control, is the
 * same idea made checkable, and this is the check.
 *
 * ## It reads declarations, not drawings
 *
 * Every `<Touch>` names its affordance and this walks the tree for them by
 * component type. Nothing here looks for a chevron, a plus or a tick.
 *
 * **That is deliberate and it is the load-bearing decision in this file.** The
 * obvious implementation — find `<Icon name="forward">` and call that a
 * navigation signal — would have been simpler and would break the day the
 * icon set changes, which is the day this was written. A declaration outlives
 * whatever draws it: if every mark in the app were deleted tomorrow and
 * replaced with a glyph, a word or nothing at all, every assertion below still
 * holds and still means the same thing.
 *
 * What it therefore does *not* prove is that the signal was drawn. That gap is
 * closed at the other end — `Touch` is the only file allowed to import
 * `Pressable`, so a control cannot exist without declaring, and the components
 * that own each signal draw it in one place rather than forty.
 */

/** A farm with records, because an empty screen has almost no controls on it. */
beforeEach(async () => {
  await freshStore();
  await stockTheFarm();
});

function touchesOn(tree: ReactTestInstance): ReactTestInstance[] {
  return tree.findAllByType(Touch);
}

const declared = (node: ReactTestInstance): Affordance => node.props.affordance as Affordance;

/**
 * The two controls that are tappable and say nothing about it.
 *
 * **This list may only ever get shorter.** It is here rather than absent so a
 * third one cannot arrive quietly: an optional field would let the next
 * unsignalled control pass, and a suite that fails loudly on a known defect is
 * worth more than one that has forgotten about it.
 *
 * Both were predicted by the design pass and both are real:
 *
 * - **Today's closed tally rows** expand in place with no plus or minus. They
 *   carry `accessibilityState={{ expanded }}`, so a screen reader knows and
 *   eyes do not.
 */
const KNOWN_UNSIGNALLED = 1;

describe('every control says what pressing it does', () => {
  it.each(SCREENS)('%s', async (_name, render) => {
    const screen = await mount(render());

    for (const touch of touchesOn(screen.tree.root)) {
      expect(AFFORDANCES).toContain(declared(touch));
    }

    screen.unmount();
  });

  /**
   * The count across the whole app, in one number.
   *
   * Per-screen would be tidier to read and useless as a ratchet: a control
   * that moved from one screen to another would look like a fix and a
   * regression at the same time.
   */
  it('has no more unsignalled controls than it started with', async () => {
    const offenders: string[] = [];

    for (const [name, render] of SCREENS) {
      const screen = await mount(render());
      for (const touch of touchesOn(screen.tree.root)) {
        if (declared(touch) === 'unsignalled') {
          offenders.push(`${name}: ${String(touch.props.testID ?? 'unnamed')}`);
        }
      }
      screen.unmount();
    }

    // Deduplicated: a component rendered per group appears once per group, and
    // one defect repeated eight times is one defect.
    const distinct = [...new Set(offenders.map((o) => o.replace(/[0-9A-HJKMNP-TV-Z]{26}/g, '<id>')))];

    expect(distinct.length, distinct.join('\n')).toBeLessThanOrEqual(KNOWN_UNSIGNALLED);
  });
});

/**
 * Exactly one brass fill per screen — the design pass's own rule, and the one
 * that keeps "the thing this screen is for" meaningful.
 *
 * > If a screen wants two, it is two screens.
 */
describe('one thing per screen is the thing that screen is for', () => {
  /**
   * Two screens offer two, and the audit found both on its first run.
   *
   * Recorded rather than fixed, because which of a pair is *the* act is a
   * product decision and not a defect with one right answer. Both have one,
   * and neither is mine to make:
   *
   * - **Machine** — "Log the hours" is the thing somebody opens this screen to
   *   do; "Add a service schedule" is setup, done once a year. The second is
   *   almost certainly `border`.
   * - **Incubation** — a set that is neither candled nor hatched shows both
   *   forms at once, so it offers two brass buttons for acts a fortnight
   *   apart. Either the hatch form waits until the hatch is near, or its
   *   button is not the brass one.
   *
   * **This list may only ever get shorter**, and it is a list of names rather
   * than a count so that a third screen cannot hide inside a number.
   */
  const KNOWN_CROWDED = ['Machine', 'Incubation'];

  it('never puts two brass fills on one screen', async () => {
    const crowded: string[] = [];

    for (const [name, render] of SCREENS) {
      const screen = await mount(render());
      const brass = touchesOn(screen.tree.root).filter((t) => declared(t) === 'brass');
      if (brass.length > 1) crowded.push(name);
      screen.unmount();
    }

    expect(crowded.filter((name) => !KNOWN_CROWDED.includes(name))).toEqual([]);
  });

  /**
   * The other half of a ratchet, and the half people forget.
   *
   * Without it the allowlist above only ever grows stale: a screen fixed in
   * one pass stays exempted forever, and the next regression on it passes
   * silently under a name that was meant to be temporary.
   */
  it('has nothing stale on its allowlist', async () => {
    const crowded: string[] = [];

    for (const [name, render] of SCREENS) {
      const screen = await mount(render());
      if (touchesOn(screen.tree.root).filter((t) => declared(t) === 'brass').length > 1) {
        crowded.push(name);
      }
      screen.unmount();
    }

    for (const name of KNOWN_CROWDED) {
      expect(crowded, `${name} is fixed — take it off KNOWN_CROWDED`).toContain(name);
    }
  });
});

/**
 * The five are a real distinction or they are decoration.
 *
 * If the app only ever used two of them, the table would be describing an
 * intention rather than the interface — and the next control would be filed
 * under whichever of the two was closer.
 */
describe('the vocabulary is used', () => {
  it('uses every signal it defines somewhere', async () => {
    const seen = new Set<Affordance>();

    for (const [, render] of SCREENS) {
      const screen = await mount(render());
      for (const touch of touchesOn(screen.tree.root)) seen.add(declared(touch));
      screen.unmount();
    }

    for (const signal of AFFORDANCES) {
      if (signal === 'unsignalled') continue;
      expect([...seen], `nothing in the app uses "${signal}"`).toContain(signal);
    }
  });
});
