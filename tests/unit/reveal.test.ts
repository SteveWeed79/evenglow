import { describe, expect, it } from 'vitest';
import { scrollToClear } from '../../apps/mobile/src/components/reveal';

/**
 * Getting a field out from under the keyboard.
 *
 * Reported from the first evening on a real handset: *"Log in is hard as the
 * keyboard completely covers the field."* Nothing in the bundler could have
 * shown it — a desktop browser has no software keyboard — and nothing in the
 * code was wrong, exactly. Android used to resize the window when the keyboard
 * opened and the scroll view sorted itself out. Edge-to-edge, mandatory from
 * Expo SDK 54, ended that: the app now draws the full height of the screen with
 * the keyboard over the top, and the window never resizes.
 *
 * The arithmetic is separated from the subscription for exactly this reason.
 * Whether `Keyboard.addListener` fires is a question only a handset answers;
 * whether the sums are right is a question that can be answered here, and every
 * off-by-one below is one that would otherwise be found by a person holding a
 * phone.
 *
 * A margin of 16 throughout, which is `SPACE.lg`.
 */

const MARGIN = 16;
/** A tall handset, in dp. */
const WINDOW = 800;
const KEYBOARD = 300;

/** Everything below this is under the keyboard. */
const CLEAR = WINDOW - KEYBOARD - MARGIN; // 484

const at = (over: Partial<Parameters<typeof scrollToClear>[0]>): number | null =>
  scrollToClear({
    fieldTop: 0,
    fieldHeight: 48,
    windowHeight: WINDOW,
    keyboardHeight: KEYBOARD,
    margin: MARGIN,
    offset: 0,
    ...over,
  });

describe('when nothing needs to move', () => {
  it('does not scroll with the keyboard down', () => {
    expect(at({ keyboardHeight: 0, fieldTop: 700 })).toBeNull();
  });

  /**
   * Null rather than the current offset, and the difference is not academic:
   * scrolling to where you already are still cancels a drag in progress and
   * still animates, so a field near the top would twitch every time somebody
   * tapped it.
   */
  it('does not scroll a field already above the keyboard', () => {
    expect(at({ fieldTop: 100 })).toBeNull();
  });

  it('does not scroll a field resting exactly on the margin', () => {
    expect(at({ fieldTop: CLEAR - 48, fieldHeight: 48 })).toBeNull();
  });
});

describe('when the keyboard is over the field', () => {
  it('scrolls by exactly what is covered', () => {
    // Bottom at 550, clear line at 484 — 66 of it is under the keyboard.
    expect(at({ fieldTop: 502, fieldHeight: 48 })).toBe(66);
  });

  it('scrolls from wherever the surface already is', () => {
    expect(at({ fieldTop: 502, fieldHeight: 48, offset: 240 })).toBe(306);
  });

  /** A field entirely below the fold, which is the reported login case. */
  it('lifts a field the keyboard has completely covered', () => {
    const moved = at({ fieldTop: 600, fieldHeight: 48 });

    expect(moved).not.toBeNull();
    expect(600 - (moved as number)).toBeLessThanOrEqual(CLEAR - 48);
  });

  /**
   * The one that is easy to get backwards. Scrolling until the *bottom* of a
   * tall field clears would push the line being typed off the top of the
   * screen — worse than the problem, and only on the multiline note fields
   * where somebody is most likely to be writing something long.
   */
  it('never lifts a field taller than the gap past the top of the window', () => {
    // Taller than the 468 left between the top of the window and the keyboard,
    // so there is no scroll position that shows all of it.
    const moved = at({ fieldTop: 300, fieldHeight: 600 });

    expect(moved).not.toBeNull();
    // Its top stays on screen, a margin down from the edge…
    expect(300 - (moved as number)).toBe(MARGIN);
    // …and its bottom is still under the keyboard, which is the trade being
    // made rather than a case that was missed.
    expect(300 - (moved as number) + 600).toBeGreaterThan(CLEAR);
  });

  /** Only ever downwards through the content — a field above the fold is not
      the keyboard's fault, and yanking the surface backwards moves whatever
      was under the thumb. */
  it('never returns an offset smaller than the current one', () => {
    for (const fieldTop of [0, 100, 300, 480, 500, 700, 900]) {
      const moved = at({ fieldTop, offset: 120 });
      if (moved !== null) expect(moved, `field at ${fieldTop}`).toBeGreaterThanOrEqual(120);
    }
  });
});
