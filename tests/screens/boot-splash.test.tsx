import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import { ThemeProvider } from '../../apps/mobile/src/theme/ThemeProvider';
import { freshStore } from '../support/store';
import { resetSplash, splash } from '../support/native/modules';

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

async function mountBoot(): Promise<{ text: string; unmount: () => void }> {
  let tree!: ReturnType<typeof create>;

  await act(async () => {
    tree = create(
      <ThemeProvider>
        <Boot render={() => <></>} />
      </ThemeProvider>,
    );
  });
  // Let the store promise settle and the effect that follows it run.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  const read = (node: unknown): string =>
    typeof node === 'string' ? node
    : Array.isArray(node) ? node.map(read).join(' ')
    : typeof node === 'object' && node !== null && 'children' in node ?
      read((node as { children: unknown }).children)
    : '';

  return { text: read(tree.toJSON()), unmount: () => tree.unmount() };
}

beforeEach(async () => {
  await freshStore();
  resetSplash();
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

    expect(screen.text).toContain('Steading could not start');
    expect(splash.hidden).toBeGreaterThan(0);
    screen.unmount();
  });

  it('stays up while the store is still opening', async () => {
    // A boot that never settles: the splash is the loading state, so nothing
    // should replace it.
    start.run = () => new Promise(() => {});

    const screen = await mountBoot();

    expect(splash.hidden).toBe(0);
    screen.unmount();
  });
});
