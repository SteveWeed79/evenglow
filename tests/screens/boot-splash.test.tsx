import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import { ThemeProvider } from '../../apps/mobile/src/theme/ThemeProvider';
import { writeLook } from '../../apps/mobile/src/theme/look';
import { THEMES } from '../../apps/mobile/src/theme/tokens';
import { freshStore } from '../support/store';
import { files, resetSplash, splash } from '../support/native/modules';
import { PRODUCT_NAME } from '@steading/contracts';

/**
 * When the splash comes down.
 *
 * The native splash hides at the **first React Native frame** unless somebody
 * holds it, and the first frame lands well before this app is worth looking
 * at: `Boot` is still opening the database and `useAppFonts` is still reading
 * four faces out of the APK. Held at module scope in `index.ts`, released
 * here.
 *
 * Both halves fail silently and in opposite directions. Without the hold, the
 * mark flickers past and a farm reports never seeing a splash — which is what
 * happened. Without the release, the splash stays up for the life of the
 * process and the app never appears at all.
 */

/** The boot sequence, so this file can decide whether the database opens. */
const start = vi.hoisted(() => ({ run: (): Promise<{ stop: () => void }> => Promise.resolve({ stop: () => {} }) }));

vi.mock('../../apps/mobile/src/boot/start', () => ({
  start: () => start.run(),
}));

// Neither of these is what is under test, and both would otherwise reach for a
// device. The faces are cosmetic by design — see `useAppFonts`.
vi.mock('../../apps/mobile/src/theme/fonts', () => ({
  useAppFonts: () => ({ ready: true }),
}));

const { Boot } = await import('../../apps/mobile/src/Boot');

interface Mounted {
  text: string;
  /** Whether a control is on screen at all. */
  has: (testID: string) => boolean;
  /** The resolved `backgroundColor` of a node, which is how a theme shows. */
  background: (testID: string) => unknown;
  unmount: () => void;
}

async function mountBoot(): Promise<Mounted> {
  let tree!: ReturnType<typeof create>;

  await act(async () => {
    tree = create(
      <ThemeProvider>
        <Boot render={() => <></>} />
      </ThemeProvider>,
    );
  });
  // Let the store promise settle and the effect that follows it run. Four
  // passes rather than two: the stored theme is read on its own promise now,
  // and the splash waits on it.
  await act(async () => {
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  });

  const read = (node: unknown): string =>
    typeof node === 'string' ? node
    : Array.isArray(node) ? node.map(read).join(' ')
    : typeof node === 'object' && node !== null && 'children' in node ?
      read((node as { children: unknown }).children)
    : '';

  const find = (testID: string): ReturnType<typeof tree.root.findAll>[number] | undefined =>
    tree.root.findAll((node) => node.props['testID'] === testID)[0];

  return {
    text: read(tree.toJSON()),
    has: (testID) => find(testID) !== undefined,
    background: (testID) => {
      const style = find(testID)?.props['style'];
      const layers = (Array.isArray(style) ? style : [style]).filter(
        (s: unknown): s is Record<string, unknown> => typeof s === 'object' && s !== null,
      );
      return layers.reduce<unknown>(
        (found, layer) => (layer['backgroundColor'] === undefined ? found : layer['backgroundColor']),
        undefined,
      );
    },
    unmount: () => tree.unmount(),
  };
}

beforeEach(async () => {
  await freshStore();
  resetSplash();
  // The stored look is a file beside the database rather than a row in it, so
  // `freshStore` does not touch it and a choice made in one test would be the
  // starting state of the next.
  files.clear();
  start.run = () => Promise.resolve({ stop: () => {} });
});

describe('the splash over a cold start', () => {
  it('comes down once the database is open', async () => {
    const screen = await mountBoot();

    expect(splash.hidden).toBeGreaterThan(0);
    screen.unmount();
  });

  /**
   * The branch that matters, and the one an app is most tempted to skip.
   *
   * `Boot` refuses to render an empty list when the store will not open,
   * because an empty list is indistinguishable from a farm with no animals.
   * A splash left up is the same failure wearing a nicer coat: the screen that
   * explains what went wrong is rendered, correct, and behind a logo.
   */
  it('comes down over the failure screen too, rather than hiding it', async () => {
    start.run = () => Promise.reject(new Error('database is locked'));

    const screen = await mountBoot();

    expect(screen.text).toContain(`${PRODUCT_NAME} could not start`);
    expect(splash.hidden).toBeGreaterThan(0);
    screen.unmount();
  });

  /**
   * The native splash used to be the loading state for the whole cold start,
   * and that is what made the theme wrong: Android picks it from the *phone's*
   * dark mode, so a farm that chose lamplight on a light-mode handset booted
   * into the daylight mark every time.
   *
   * It hands over instead. What must not change is that the screen is never
   * empty while the store opens — so this asserts the mark took the wait, not
   * that the native splash kept it.
   */
  it('hands the wait to its own mark rather than emptying the screen', async () => {
    // A boot that never settles: something has to be holding the screen.
    start.run = () => new Promise(() => {});

    const screen = await mountBoot();

    expect(screen.has('boot-mark')).toBe(true);
    screen.unmount();
  });
});

/**
 * The half the native splash cannot do.
 *
 * Asked for plainly — *"can we change the splash screen so that it matches the
 * theme the app is set to? I would love a lamplight version with the glowing
 * S"* — and the lamplight art already existed, wired to `expo-splash-screen`'s
 * `dark` key. That key follows the handset, because Android draws the splash
 * from resource qualifiers before a line of JavaScript runs. A farm on a
 * light-mode phone could not reach it.
 */
describe('the mark under the boot', () => {
  /**
   * **The ground, not the drawing.** Vitest resolves every PNG to one shared
   * stub, so `source` is the same object for all three themes here and an
   * assertion about which file was picked would pass whatever the code did.
   * Saying so rather than writing it: the image choice is one line, and it is
   * checked on a handset.
   *
   * The ground is the half this harness can see, and it is the half that was
   * wrong — a farm on a light-mode phone booted onto cream after choosing
   * lamplight.
   */
  it('wears the chosen theme, not the phone one', async () => {
    start.run = () => new Promise(() => {});

    // The stub reports a light-mode handset, so this is exactly the
    // disagreement the report was about: lamplight chosen, daylight phone.
    await writeLook('lamplight');
    const screen = await mountBoot();

    expect(screen.has('boot-mark')).toBe(true);
    expect(screen.background('boot')).toBe(THEMES.lamplight.ground);
    screen.unmount();
  });

  it('follows the phone when nothing has been chosen', async () => {
    start.run = () => new Promise(() => {});

    const screen = await mountBoot();

    // Nothing stored and a light-mode stub: following the device is still the
    // default, and the new gate must not have quietly become an override.
    expect(screen.background('boot')).toBe(THEMES.daylight.ground);
    screen.unmount();
  });

  /**
   * Bright sun is a legibility override rather than a time of day, and it has
   * no mark of its own — it borrows the pale one. Asserted so that "sun has no
   * art" stays a decision rather than becoming a missing file.
   */
  it('paints bright sun rather than falling back to the device', async () => {
    start.run = () => new Promise(() => {});

    await writeLook('sun');
    const screen = await mountBoot();

    expect(screen.has('boot-mark')).toBe(true);
    expect(screen.background('boot')).toBe(THEMES.sun.ground);
    screen.unmount();
  });
});
