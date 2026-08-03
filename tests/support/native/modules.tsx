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

  constructor(...parts: (string | FakeDirectory | File | Directory)[]) {
    const pieces = parts.map((part) => (typeof part === 'string' ? part : part.uri));

    /**
     * A single full URI is taken verbatim.
     *
     * The joining below collapses repeated slashes so `dir` + `name` does not
     * produce `//`, and that mangles `file:///tmp/x.jpg` into
     * `file://tmp/x.jpg` — a different key, so the file "vanishes". The real
     * `File` accepts a whole URI as its only argument and this has to as well.
     */
    if (pieces.length === 1 && pieces[0]!.includes('://')) {
      this.uri = pieces[0]!;
      return;
    }

    this.uri = pieces
      .join('/')
      .replace(/([^:])\/+/g, '$1/');
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

  get size(): number | null {
    const content = files.get(this.uri);
    return content === undefined ? null : content.length;
  }

  /** Real move semantics: the source stops existing. */
  async move(destination: File): Promise<void> {
    const content = files.get(this.uri);
    if (content === undefined) throw new Error(`Nothing at ${this.uri}`);
    files.set(destination.uri, content);
    files.delete(this.uri);
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

// ── expo-image-picker / expo-image-manipulator ───────────────────────────────

/**
 * A camera and a resizer, scripted.
 *
 * What the photo tests are about is not the picker — it is that a cancel
 * writes nothing, that a refused camera is not an error, and that removing a
 * photo takes the bytes with it. All three need the picker to be steerable
 * rather than real.
 *
 * `Directory` is here too because `photos/store.ts` creates one, and a fake
 * filesystem missing the directory half would fail on the first capture in a
 * way that says nothing about the code under test.
 */
export const camera = {
  /** What the next launch returns. Set by a test before it presses. */
  next: { canceled: false, assets: [{ uri: 'file:///tmp/shot.jpg', width: 4000, height: 3000 }] } as {
    canceled: boolean;
    assets?: { uri: string; width: number; height: number }[];
  },
  /** Whether the OS grants the camera. */
  granted: true,
  /** Every resize the manipulator was asked for, so a test can assert one. */
  resizes: [] as unknown[],
};

export async function requestCameraPermissionsAsync(): Promise<{ granted: boolean }> {
  return { granted: camera.granted };
}

export async function launchCameraAsync(): Promise<typeof camera.next> {
  return camera.next;
}

export async function launchImageLibraryAsync(): Promise<typeof camera.next> {
  return camera.next;
}

export const SaveFormat = { JPEG: 'jpeg' } as const;

export async function manipulateAsync(
  uri: string,
  actions: unknown[],
): Promise<{ uri: string }> {
  camera.resizes.push(...actions);
  // A distinct URI, so a test can tell the manipulator's output from its input
  // and the move below is a real move.
  const out = `${uri}.resized`;
  files.set(out, 'JPEG-BYTES');
  return { uri: out };
}

export class Directory {
  readonly uri: string;

  constructor(...parts: (string | { uri: string })[]) {
    this.uri = `${parts
      .map((part) => (typeof part === 'string' ? part : part.uri))
      .join('/')
      .replace(/\/+/g, '/')
      .replace(':/', '://')}/`;
  }

  get exists(): boolean {
    return true;
  }

  create(): void {
    // Directories are implicit in a Map keyed by path.
  }
}
