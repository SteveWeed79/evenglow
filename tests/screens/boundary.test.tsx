import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Text } from 'react-native';
import { Boundary } from '../../apps/mobile/src/components/Boundary';
import { takeBreadcrumb } from '../../apps/mobile/src/support/breadcrumb';
import { files } from '../support/native/modules';
import { mount } from '../support/screen';

/**
 * What a farm gets instead of a white screen, and what the next launch knows.
 *
 * `[39]` and `[40]` are one problem seen from two sides. A thrown render
 * unmounts the whole app, so a defect in one row presents as the app dying —
 * and the support screen, the only way to tell anybody about it, is inside the
 * tree that just went. There is no console on a handset and no reload button.
 *
 * So: a boundary that draws something honest, and a crumb on disk that outlives
 * the process, because a crash report held in memory is not a crash report.
 */

/** A component that throws on demand, which is the only way to test a boundary. */
function Bomb({ live }: { live: boolean }): React.ReactElement {
  if (live) throw new Error('the gate list exploded');
  return <Text>the farm</Text>;
}

beforeEach(() => {
  files.clear();
});

describe('when a screen throws', () => {
  it('draws a fallback rather than taking the app with it', async () => {
    // React logs the caught error; that is expected here and it is noise.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const screen = await mount(
      <Boundary>
        <Bomb live />
      </Boundary>,
    );

    expect(screen.has('boundary')).toBe(true);
    expect(screen.text()).toContain('Something went wrong');
    screen.unmount();
    quiet.mockRestore();
  });

  /**
   * The first thing a farmer wonders, answered before anything else on the
   * screen. Every mutation is in SQLite before it is anywhere else, so this is
   * true as well as reassuring — which is the only reason to say it.
   */
  it('says the records are safe, because they are', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const screen = await mount(
      <Boundary>
        <Bomb live />
      </Boundary>,
    );

    expect(screen.text()).toContain('Nothing you logged has been lost');
    screen.unmount();
    quiet.mockRestore();
  });

  it('shows what happened and which build it happened on', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const screen = await mount(
      <Boundary>
        <Bomb live />
      </Boundary>,
    );

    expect(screen.text()).toContain('the gate list exploded');
    screen.unmount();
    quiet.mockRestore();
  });

  it('offers to try again', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const screen = await mount(
      <Boundary>
        <Bomb live />
      </Boundary>,
    );

    expect(screen.has('boundary-retry')).toBe(true);
    await screen.press('boundary-retry');

    // The child still throws, so it lands back here rather than pretending —
    // what matters is that pressing it is not itself a crash.
    expect(screen.has('boundary')).toBe(true);
    screen.unmount();
    quiet.mockRestore();
  });

  it('leaves the app alone when nothing throws', async () => {
    const screen = await mount(
      <Boundary>
        <Bomb live={false} />
      </Boundary>,
    );

    expect(screen.has('boundary')).toBe(false);
    expect(screen.text()).toContain('the farm');
    screen.unmount();
  });
});

describe('the crumb the next launch reads', () => {
  it('is written where a crash cannot take it with it', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const screen = await mount(
      <Boundary>
        <Bomb live />
      </Boundary>,
    );
    screen.unmount();
    quiet.mockRestore();

    const crumb = await takeBreadcrumb();

    expect(crumb?.message).toBe('the gate list exploded');
    expect(crumb?.where).toBe('drawing the app');
    expect(crumb?.version).toMatch(/\d+\.\d+\.\d+/);
  });

  /**
   * Reading clears it. A crumb that survived being read would ride on every
   * ticket a farm ever filed, and "the app crashed once in March" stops being
   * information the fourth time somebody sees it.
   */
  it('is taken rather than copied', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const screen = await mount(
      <Boundary>
        <Bomb live />
      </Boundary>,
    );
    screen.unmount();
    quiet.mockRestore();

    expect(await takeBreadcrumb()).not.toBeNull();
    expect(await takeBreadcrumb()).toBeNull();
  });

  it('is nothing at all on a launch that follows a clean run', async () => {
    expect(await takeBreadcrumb()).toBeNull();
  });

  /**
   * A crash loop writes one crumb, not a hundred, and the one it keeps is the
   * most recent — the hundredth is no more useful than the first, and the file
   * must not grow on the device that is already failing.
   */
  it('keeps one crumb however many crashes there are', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    for (const message of ['first', 'second', 'third']) {
      function Named(): React.ReactElement {
        throw new Error(message);
      }
      const screen = await mount(
        <Boundary>
          <Named />
        </Boundary>,
      );
      screen.unmount();
    }
    quiet.mockRestore();

    expect(await takeBreadcrumb()).toMatchObject({ message: 'third' });
    expect(await takeBreadcrumb()).toBeNull();
  });
});
