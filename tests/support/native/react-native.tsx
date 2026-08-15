import { createElement, forwardRef, type ReactNode } from 'react';

/**
 * React Native, as far as a screen test needs it to exist.
 *
 * Aliased in for `tests/screens/**` only. This is a deliberate seam and it is
 * worth being precise about what it does and does not buy, because a harness
 * that oversells itself is worse than no harness:
 *
 * **It proves** every screen mounts without throwing, its hooks run in a legal
 * order, its effects subscribe and read the real SQLite store, its style
 * callbacks execute against the real theme tokens, and pressing its controls
 * enqueues the mutations the contracts actually accept.
 *
 * **It does not prove** layout, scrolling, gestures, native module behaviour,
 * or that anything looks right. Those need a handset, and the project has said
 * from the start that the bundler is not one.
 *
 * The alternative — transforming React Native's real Flow-typed source under
 * vitest — buys a component tree built from the same primitives and still
 * proves nothing about layout, because there is no layout engine either way.
 * It costs a jest preset and a babel pipeline for that.
 *
 * Types are NOT stubbed: `tsc` still resolves `react-native` to the real
 * package, so a screen using a prop that does not exist is a typecheck error
 * exactly as before. Only the runtime is swapped.
 */

type Props = Record<string, unknown> & { children?: ReactNode };

/**
 * A host element carrying its props through.
 *
 * `style` is resolved when it is a function so a `({ pressed }) => …` callback
 * actually executes — that is where a missing theme token would throw, and it
 * is one of the few real failures this layer can catch.
 */
function host(name: string) {
  const Component = forwardRef<unknown, Props>(function Host(props, ref) {
    const { style, children, ...rest } = props;
    const resolved = typeof style === 'function' ? (style as (s: unknown) => unknown)({ pressed: false }) : style;
    return createElement(name, { ...rest, style: resolved, ref }, children as ReactNode);
  });
  Component.displayName = name;
  return Component;
}

export const View = host('View');
export const Text = host('Text');
export const TextInput = host('TextInput');
export const Pressable = host('Pressable');
export const ScrollView = host('ScrollView');
export const Image = host('Image');
export const ActivityIndicator = host('ActivityIndicator');

export const StyleSheet = {
  create: <T extends Record<string, unknown>>(styles: T): T => styles,
  flatten: (style: unknown): unknown => (Array.isArray(style) ? Object.assign({}, ...style.flat()) : style),
  hairlineWidth: 1,
  absoluteFillObject: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
};

/**
 * A phone-shaped viewport, so the Tally's fraction-of-short-edge maths runs.
 *
 * It is also what makes every other screen test an assertion about the phone
 * case: a hub grid asked to lay out 350dp of content reports one column, so
 * the whole suite is standing guard over "below the threshold, this renders
 * exactly what shipped before". The tablet case has to be asked for — see
 * {@link seedWindow}.
 */
const PHONE = { width: 390, height: 844 };

let viewport = { ...PHONE };

export function useWindowDimensions(): { width: number; height: number } {
  return viewport;
}

/**
 * Puts the app in a different window, or back in the phone.
 *
 * Called with no arguments it restores the handset. Note this does NOT move
 * `Dimensions.get('screen')` below, and that is deliberate rather than an
 * oversight: the screen is the display and the window is what the app
 * occupies, they are genuinely different numbers under a split, and
 * `theme/rotation.ts` and `theme/window.ts` read one each.
 */
export function seedWindow(next: Partial<typeof PHONE> = {}): void {
  viewport = { ...PHONE, ...next };
}

export function useColorScheme(): 'light' | 'dark' {
  return 'light';
}

export const AppState = {
  currentState: 'active' as const,
  addEventListener: (): { remove: () => void } => ({ remove: () => undefined }),
};

/** The same phone-shaped viewport `useWindowDimensions` reports. */
export const Dimensions = {
  get: (): { width: number; height: number } => ({ width: 390, height: 844 }),
};

/**
 * A keyboard that never opens.
 *
 * `Screen` subscribes so it can make room for one — see `reveal.tsx`. Driving
 * this double to fire `keyboardDidShow` would let a test watch the subscription
 * run, and it would still prove nothing, because there is no layout engine here
 * to have covered anything and no scroll surface to move: the header above says
 * so, and it is worth not pretending otherwise.
 *
 * The arithmetic that decides how far to scroll is a pure function tested in
 * `tests/unit/reveal.test.ts`. The rest genuinely needs a handset.
 */
export const Keyboard = {
  addListener: (): { remove: () => void } => ({ remove: () => undefined }),
  dismiss: (): void => undefined,
};

/** Records what was shared, so the invite screen can be asserted on. */
export const shared: string[] = [];

export const Share = {
  share: async (content: { message?: string }): Promise<{ action: string }> => {
    if (content.message !== undefined) shared.push(content.message);
    return { action: 'sharedAction' };
  },
};

export const Platform = { OS: 'android' as const, select: <T,>(o: { android?: T; default?: T }) => o.android ?? o.default };

/**
 * Animation, resolved instantly.
 *
 * A test has no frames, so `timing().start()` jumps straight to the end value
 * and calls back. That is the honest double: every assertion in this suite is
 * about what a screen ends up saying, and none of them should have to wait
 * 200ms of wall clock to read it — or worse, assert against a half-faded
 * value that depends on when the scheduler happened to run.
 *
 * What it therefore does NOT prove: that anything eases, that the native
 * driver accepts the properties being animated, or that a transition looks
 * right. `useNativeDriver: true` silently accepts only `opacity` and
 * `transform`, and a screen that animated a `height` through here would pass
 * this suite and warn on a handset. Same standing caveat as the rest of this
 * file — the bundler is not a phone.
 */
class AnimatedValue {
  constructor(private value: number) {}
  setValue(next: number): void {
    this.value = next;
  }
  interpolate(config: { inputRange: number[]; outputRange: number[] }): AnimatedValue {
    const [from = 0, to = 0] = config.outputRange;
    return new AnimatedValue(this.value === 0 ? from : to);
  }
}

export const Animated = {
  Value: AnimatedValue,
  View: host('Animated.View'),
  Text: host('Animated.Text'),
  timing: (value: AnimatedValue, config: { toValue: number }) => ({
    start: (done?: () => void): void => {
      value.setValue(config.toValue);
      done?.();
    },
    stop: (): void => undefined,
  }),
};

/**
 * Reduced motion off, which is the majority case and the one worth exercising:
 * it is the branch that actually runs the animations.
 */
export const AccessibilityInfo = {
  isReduceMotionEnabled: async (): Promise<boolean> => false,
  addEventListener: (): { remove: () => void } => ({ remove: () => undefined }),
};
