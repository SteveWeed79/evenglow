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
export const RadialGradient = host('RadialGradient');
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

/**
 * What the next `File.pickFileAsync` returns. Set by a test before it presses.
 *
 * Steerable rather than real for the same reason the camera is: the three
 * states worth testing — a file chosen, the picker backed out of, and a file
 * that is not a backup — are not ones a system file picker can be asked to
 * produce on demand. The backed-out case is the one that matters most, because
 * it is not a failure and a stub that always chose would hide it.
 */
export const picker = {
  /** A URI in `files`, or null for a cancelled pick. */
  next: null as string | null,
};

export class File {
  readonly uri: string;

  /**
   * The system file picker, which SDK 57 puts on `File` rather than in a
   * separate document-picker package. Stubbed at the module boundary; the
   * parsing and the restore either side of it are the real ones.
   */
  static async pickFileAsync(): Promise<
    { canceled: true; result: null } | { canceled: false; result: File }
  > {
    if (picker.next === null) return { canceled: true, result: null };
    return { canceled: false, result: new File(picker.next) };
  }

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

    /**
     * Neither a colon nor a slash before the run, or the pattern matches the
     * first slash of `file:///` as the preceding character and collapses the
     * triple to a double. That was latent here — writer and reader mangled it
     * identically, so every path agreed with every other path — and became
     * real the moment `Directory.list()` had to match keys `File` had written.
     */
    this.uri = pieces
      .join('/')
      .replace(/([^:/])\/+/g, '$1/');
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

  async text(): Promise<string> {
    const content = files.get(this.uri);
    // The real one rejects on a file that is not there, and a test reading a
    // file nobody wrote would otherwise get an empty string and pass.
    if (content === undefined) throw new Error(`Nothing at ${this.uri}`);
    return content;
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

// ── expo-sqlite ──────────────────────────────────────────────────────────────

/**
 * The native module `db/open.ts` is the only file allowed to name.
 *
 * Stubbed here rather than left real because `open.ts` also holds
 * `knownFarmIds` — the read that decides whether a farm whose id was lost is
 * reopened or replaced by an empty one — and that answer was previously
 * reachable only from a handset. The store itself is still exercised for real
 * everywhere else, through `nodeSqlDriver`; this is the module boundary, not
 * the database.
 */
export async function openDatabaseAsync(name: string): Promise<unknown> {
  throw new Error(`No native SQLite in a test. Asked for ${name}.`);
}

export async function deleteDatabaseAsync(name: string): Promise<void> {
  files.delete(`file:///documents/SQLite/${name}`);
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

// ── expo-location ────────────────────────────────────────────────────────────

/**
 * The GPS, scripted.
 *
 * Steerable rather than real, because the three states worth testing are ones
 * a real device cannot be asked to produce on demand: permission granted,
 * permission refused, and granted-but-no-fix (indoors, which is where a farm
 * opens the app to check whether to go out).
 *
 * The refused case is the one that matters most. It is not an error — the typed
 * address search is the way back — and a fake that only ever granted would hide
 * the whole fallback path from the suite.
 */
export const gps = {
  granted: true,
  /** Set to false to model a granted permission that still cannot get a fix. */
  fixes: true,
  /** Deliberately more precise than anything is allowed to store. */
  at: { latitude: 44.47588, longitude: -73.21207 },
};

export const Accuracy = {
  Lowest: 1,
  Low: 2,
  Balanced: 3,
  High: 4,
  Highest: 5,
  BestForNavigation: 6,
} as const;

export async function requestForegroundPermissionsAsync(): Promise<{ granted: boolean }> {
  return { granted: gps.granted };
}

export async function getCurrentPositionAsync(): Promise<{
  coords: { latitude: number; longitude: number };
}> {
  if (!gps.fixes) throw new Error('Location request timed out');
  return { coords: { ...gps.at } };
}

export class Directory {
  readonly uri: string;

  constructor(...parts: (string | { uri: string })[]) {
    /**
     * The same hazard `File` documents, and this half had it.
     *
     * A directory's uri never matched the keys `File` writes under, so
     * `list()` came back empty for a directory with files in it — twice over.
     *
     * The old `.replace(/\/+/g, '/')` collapsed `file:///documents/` to
     * `file:/documents/` and `.replace(':/', '://')` put back only two of the
     * three slashes. Copying `File`'s `([^:])\/+` did not fix it either,
     * because a **slash is not a colon**: the pattern matched the first slash
     * of `///` as the preceding character and ate one anyway. The preceding
     * character has to be neither.
     */
    this.uri = `${parts
      .map((part) => (typeof part === 'string' ? part : part.uri))
      .join('/')
      .replace(/([^:/])\/+/g, '$1/')
      .replace(/\/$/, '')}/`;
  }

  get exists(): boolean {
    return true;
  }

  create(): void {
    // Directories are implicit in a Map keyed by path.
  }

  /**
   * Everything directly inside, as `{ name }`.
   *
   * Added for `knownFarmIds`, which reads the SQLite directory to find a farm
   * whose id secure storage has lost. That path decides whether a farm's
   * records come back or sit on disk with nothing pointing at them, so it had
   * to be reachable from a test rather than only from a handset.
   */
  list(): { name: string; uri: string }[] {
    const prefix = this.uri;
    return [...files.keys()]
      .filter((uri) => uri.startsWith(prefix) && !uri.slice(prefix.length).includes('/'))
      .map((uri) => ({ name: uri.slice(prefix.length), uri }));
  }
}

// ── expo-auth-session / expo-web-browser ─────────────────────────────────────

/**
 * The OAuth flow, stubbed at the module boundary.
 *
 * The real `useIdTokenAuthRequest` **throws during render** when no client id
 * is configured, which is every build of this app so far — and that is exactly
 * the defect this stub let the suite finally catch. It is here so
 * `AccountScreen` can be mounted at all; the guard that decides whether the
 * hook is called lives in `GoogleButton` and is real.
 */
export function maybeCompleteAuthSession(): void {
  // The real one closes the browser tab a redirect came back through.
}

export const googlePrompts: string[] = [];

export function useIdTokenAuthRequest(): [
  { url: string } | null,
  null,
  () => Promise<{ type: string; params: Record<string, string> }>,
] {
  return [
    { url: 'https://accounts.test/auth' },
    null,
    async () => {
      googlePrompts.push('prompt');
      // Backed out, which is the state a test gets unless it says otherwise —
      // and the one the screen must treat as a decision rather than a failure.
      return { type: 'dismiss', params: {} };
    },
  ];
}
