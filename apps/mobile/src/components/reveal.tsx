import { createContext, useCallback, useContext, useRef } from 'react';

/**
 * Getting a field out from under the keyboard.
 *
 * ## Why this is not `KeyboardAvoidingView`
 *
 * On Android the keyboard used to be somebody else's problem: `adjustResize`
 * shrank the window, the `ScrollView` got shorter, and a focused field scrolled
 * itself into view. Edge-to-edge ended that. It is mandatory from Expo SDK 54
 * and the app now draws the full height of the screen with the keyboard over
 * the top of it — the window never resizes, so nothing downstream ever learns
 * the bottom third is gone.
 *
 * The symptom was reported from the first evening on a real handset: *"Log in
 * is hard as the keyboard completely covers the field."* It was invisible in
 * the bundler, and it would have stayed invisible, because a desktop browser
 * has no software keyboard to cover anything with.
 *
 * `KeyboardAvoidingView` is the obvious reach and it is the wrong one here. Its
 * Android behaviour is built on the window resizing, which is the thing that no
 * longer happens; and its `padding` mode pads the *outside* of a scroll view,
 * which shortens the scrollable area rather than adding somewhere to scroll to.
 *
 * So: the screen listens for the keyboard, reserves that much room at the foot
 * of its content, and scrolls the focused field up by however much of it is
 * covered. All of that is core React Native — no new dependency, which is the
 * bar `CLAUDE.md` sets.
 *
 * ## The arithmetic is separated from the wiring on purpose
 *
 * `scrollToClear` is a pure function of six numbers and is unit tested. What is
 * left in `Screen` is subscription and a `scrollTo` call, which is the part a
 * simulator cannot honestly check anyway.
 */

/** Anything that can say where it is on screen. A `TextInput` satisfies it. */
export interface Measurable {
  measureInWindow(
    callback: (x: number, y: number, width: number, height: number) => void,
  ): void;
}

/** Told when a field takes focus, and told `null` when it loses it. */
export type Reveal = (node: Measurable | null) => void;

const RevealContext = createContext<Reveal>(() => undefined);

export const RevealProvider = RevealContext.Provider;

/**
 * Where a scroll surface must be for a field to sit clear of the keyboard.
 *
 * Returns the new offset, or **null** when the field is already visible — the
 * distinction matters, because scrolling to where you already are still cancels
 * a drag in progress and still animates.
 *
 * Only ever scrolls **down** the content (a larger offset). A field above the
 * fold is not the keyboard's fault, and yanking the surface backwards to
 * "centre" a field somebody just tapped moves the thing under their thumb.
 */
export function scrollToClear({
  fieldTop,
  fieldHeight,
  windowHeight,
  keyboardHeight,
  margin,
  offset,
}: {
  /** Top of the field, relative to the window. */
  fieldTop: number;
  fieldHeight: number;
  windowHeight: number;
  /** How much of the bottom of the window the keyboard covers. */
  keyboardHeight: number;
  /** Breathing room to leave between the field and the keyboard. */
  margin: number;
  /** Where the scroll surface is now. */
  offset: number;
}): number | null {
  // No keyboard, nothing to get out from under.
  if (keyboardHeight <= 0) return null;

  const clear = windowHeight - keyboardHeight - margin;
  const hidden = fieldTop + fieldHeight - clear;

  // Already above the keyboard.
  if (hidden <= 0) return null;

  /**
   * Never past the top of the window.
   *
   * A field taller than the space left over — a multiline note with the
   * keyboard up — would otherwise be scrolled until its *bottom* cleared, which
   * pushes the line being typed off the top. Showing the start of it and
   * letting the rest run under the keyboard is the lesser of the two.
   */
  const most = Math.max(0, fieldTop - margin);

  return offset + Math.min(hidden, most);
}

/**
 * The props a field spreads to join in.
 *
 * A field does not need to know about any of the above — it says when it is
 * focused and where it is, and the surface it happens to be on does the rest.
 * On a surface with no provider the context default is a no-op, so a field
 * outside a `Screen` still renders rather than throwing.
 */
export function useRevealOnFocus<T extends Measurable>(): {
  ref: React.RefObject<T | null>;
  onFocus: () => void;
  onBlur: () => void;
} {
  const reveal = useContext(RevealContext);
  const ref = useRef<T | null>(null);

  return {
    ref,
    onFocus: useCallback(() => reveal(ref.current), [reveal]),
    onBlur: useCallback(() => reveal(null), [reveal]),
  };
}
