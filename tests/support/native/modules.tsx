import { createElement, forwardRef, type ReactNode } from 'react';

/**
 * The native modules a screen reaches, stubbed at the same seam as
 * `react-native.tsx`.
 *
 * Each of these is a real native dependency with no JS-only implementation, so
 * a screen test either stubs them or does not run. What matters is that none
 * of them carries logic worth testing — they draw, they buzz, or they hold a
 * token — and the things that DO carry logic (the store, the queue, the due
 * engine, the contracts) are the real ones throughout.
 */

type Props = Record<string, unknown> & { children?: ReactNode };

function host(name: string) {
  const Component = forwardRef<unknown, Props>(function Host(props, ref) {
    const { children, ...rest } = props;
    return createElement(name, { ...rest, ref }, children as ReactNode);
  });
  Component.displayName = name;
  return Component;
}

// ── expo-haptics ─────────────────────────────────────────────────────────────

/**
 * Recorded rather than discarded.
 *
 * Through a glove the buzz is often the only proof a tap registered, so
 * "did the destructive action warn before it fired" is a real assertion — see
 * the two-tap confirms.
 */
export const haptics: string[] = [];

export const ImpactFeedbackStyle = { Light: 'light', Medium: 'medium', Heavy: 'heavy' } as const;
export const NotificationFeedbackType = {
  Success: 'success',
  Warning: 'warning',
  Error: 'error',
} as const;

export async function impactAsync(style: string): Promise<void> {
  haptics.push(`impact:${style}`);
}
export async function notificationAsync(type: string): Promise<void> {
  haptics.push(`notify:${type}`);
}
export async function selectionAsync(): Promise<void> {
  haptics.push('selection');
}

// ── react-native-svg ─────────────────────────────────────────────────────────

export const Svg = host('Svg');
export const Path = host('Path');
export const Circle = host('Circle');
export const Ellipse = host('Ellipse');
export const Rect = host('Rect');
export const G = host('G');
export const Line = host('Line');
export const Polyline = host('Polyline');
export const Polygon = host('Polygon');
export const Defs = host('Defs');
export const ClipPath = host('ClipPath');
export const LinearGradient = host('LinearGradient');
export const Stop = host('Stop');
export default Svg;

// ── react-native-safe-area-context ───────────────────────────────────────────

export function useSafeAreaInsets(): { top: number; bottom: number; left: number; right: number } {
  return { top: 24, bottom: 16, left: 0, right: 0 };
}

export const SafeAreaProvider = host('SafeAreaProvider');

// ── expo-secure-store ────────────────────────────────────────────────────────

/**
 * An in-memory keychain.
 *
 * Not a no-op: `MembersScreen` reads the cached claims to decide which
 * controls to draw, and a stub that always returned null would hide the whole
 * owner-only half of that screen from the test.
 */
const secure = new Map<string, string>();

export async function getItemAsync(key: string): Promise<string | null> {
  return secure.get(key) ?? null;
}
export async function setItemAsync(key: string, value: string): Promise<void> {
  secure.set(key, value);
}
export async function deleteItemAsync(key: string): Promise<void> {
  secure.delete(key);
}
export async function isAvailableAsync(): Promise<boolean> {
  return true;
}

/** For a test that needs a signed-in session before rendering. */
export function seedSecureStore(entries: Record<string, string>): void {
  secure.clear();
  for (const [key, value] of Object.entries(entries)) secure.set(key, value);
}
