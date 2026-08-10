import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, type ViewStyle } from 'react-native';

/**
 * Motion — the small amount of it this app is allowed.
 *
 * ## The rule that shapes all of this
 *
 * UX-SPEC §6 bans "anything that adds a tap, anything that delays a log by a
 * single frame. Charm that costs time isn't charm." So nothing here sits on
 * the write path. A commit fires the moment it is pressed and the mutation is
 * durable before any of this runs; what animates is the *report* that it
 * happened, which nothing waits on.
 *
 * The second constraint is R3/R4: a control must not move under a thumb that
 * is already travelling towards it. That is why the confirmations animate
 * opacity against a line whose height is already reserved, rather than growing
 * into the layout and pushing the primary button down — the visible difference
 * is small and the mis-tap it prevents is not.
 *
 * ## Why `Animated` and not a library
 *
 * CLAUDE.md: no new dependency without saying what it replaces and why the
 * platform primitive is insufficient. Reanimated would buy gesture-driven
 * interpolation and layout transitions this app has no use for. Opacity on the
 * native driver is a core primitive and does the whole job.
 */

/**
 * Two durations, and the number is the point.
 *
 * `quick` is a thing appearing; `settle` is content arriving where something
 * was opened. Both sit under the ~250ms where a transition stops reading as
 * motion and starts reading as waiting — which on the log path would be the
 * exact failure the whimsy budget is written to prevent.
 */
export const MOTION = { quick: 140, settle: 200 } as const;

/**
 * Whether the person using this has asked the OS for less movement.
 *
 * Honoured rather than assumed: vestibular sensitivity is real, the setting is
 * one somebody deliberately turned on, and an app that overrides it is telling
 * them their preference is decorative. Every animation here collapses to an
 * instant change when this is true — the information never depends on the
 * motion, which is what makes that safe.
 *
 * Subscribed rather than read once, because it can be toggled while the app is
 * open — Android exposes it in the same quick-settings panel as the torch.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (live) setReduced(on);
    });

    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);

  return reduced;
}

/**
 * Fade something in and out without touching the layout.
 *
 * Returns a value for `opacity` only. The caller keeps the element mounted and
 * its height reserved, so nothing reflows and the native driver can carry the
 * whole animation off the JS thread — which matters here because the frame
 * this runs on is the frame right after a SQLite write.
 */
export function useFade(visible: boolean): Animated.Value {
  const reduced = useReducedMotion();
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    const to = visible ? 1 : 0;

    if (reduced) {
      opacity.setValue(to);
      return;
    }

    const animation = Animated.timing(opacity, {
      toValue: to,
      duration: MOTION.quick,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [visible, reduced, opacity]);

  return opacity;
}

/**
 * Content appearing where something was tapped open.
 *
 * ## Why this animates the content and not the container
 *
 * The obvious build is `LayoutAnimation`, and it was the first one here. It is
 * the wrong tool for this app on three counts:
 *
 *  1. **It is global.** `configureNext` animates *every* layout change in the
 *     next commit, not the one it was called for. On Today that frame also
 *     carries the sync chip, the weather row and any due row that re-rendered
 *     — all of them dragged into a transition nobody asked for.
 *  2. **It is the one API here not guaranteed to exist.** Read at module scope
 *     it turned a missing animation into an import-time `TypeError` that took
 *     down every screen importing a form.
 *  3. **It is the wrong side of the New Architecture.** This app sets
 *     `newArchEnabled`, where `LayoutAnimation` is the legacy path.
 *
 * The alternative usually reached for is `react-native-reanimated`, and it is
 * genuinely the right library for layout transitions. It is still refused
 * here: CLAUDE.md wants a new dependency to justify itself against the
 * platform primitive, this is a **native** module needing a prebuild, and
 * nothing in CI compiles Android yet — so the first proof it links would be on
 * somebody's handset. That is a poor trade for an easing curve.
 *
 * So neither. The container's height still changes in one frame; what animates
 * is the content inside it, fading and settling the six pixels the container
 * grew. A reflow behind moving content reads as a reveal — the "pop" people
 * notice is the content arriving fully formed, not the box changing size. It
 * needs no measurement, no dependency, and rides the native driver.
 *
 * ## Opening animates and closing does not
 *
 * Deliberate. The caller unmounts this content when it closes, so there is
 * nothing left to animate out — and a close that is instant feels decisive
 * rather than reluctant. Nothing here carries information either way.
 */
export function useReveal(): Animated.WithAnimatedObject<ViewStyle> {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }

    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: MOTION.settle,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [reduced, progress]);

  // Downward, because that is the direction the container grew. Six pixels:
  // enough that the eye catches an arrival, too little to read as a slide.
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] });

  return { opacity: progress, transform: [{ translateY }] };
}
