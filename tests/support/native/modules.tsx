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

// ── expo-file-system / expo-sharing ──────────────────────────────────────────

/**
 * A filesystem and a share sheet, in memory.
 *
 * Not a no-op. The export screen writes a file and then shares its URI, and
 * the two things worth asserting are exactly those: that the CSV reaching the
 * file is the CSV the builder produced, and that something was actually
 * offered to the OS rather than the screen quietly succeeding.
 *
 * `expo-file-system` on SDK 57 is the object API — `new File(dir, name)`,
 * `create()`, `write()` — so this models that shape rather than the legacy
 * `writeAsStringAsync` one. A fake of the wrong API would pass tests against
 * code that cannot run.
 */
export const files = new Map<string, string>();

/** Every URI handed to the share sheet, in order. */
export const shared: string[] = [];

class FakeDirectory {
  constructor(readonly uri: string) {}
}

export const Paths = {
  cache: new FakeDirectory('file:///cache/'),
  document: new FakeDirectory('file:///documents/'),
};

export class File {
  readonly uri: string;

  constructor(...parts: (string | FakeDirectory | File)[]) {
    this.uri = parts
      .map((part) => (typeof part === 'string' ? part : part.uri))
      .join('')
      .replace(/\/+/g, '/')
      .replace(':/', '://');
  }

  create(): void {
    files.set(this.uri, '');
  }

  write(content: string): void {
    files.set(this.uri, content);
  }

  delete(): void {
    files.delete(this.uri);
  }

  get exists(): boolean {
    return files.has(this.uri);
  }
}

/**
 * `isAvailableAsync` is not redeclared here.
 *
 * Both modules alias to this file and expo-secure-store already exports one
 * with the same signature answering the same way. Two would be a compile
 * error, and the sharing check reads the secure-store one — which is correct
 * for a test double whose answer is "yes" either way.
 */
export async function shareAsync(uri: string): Promise<void> {
  if (!files.has(uri)) {
    // The real one rejects on a URI that is not there, and a test that shared
    // a file nobody wrote would otherwise pass.
    throw new Error(`Nothing to share at ${uri}`);
  }
  shared.push(uri);
}
