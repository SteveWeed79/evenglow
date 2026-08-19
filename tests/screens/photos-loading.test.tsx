import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What a screen says BEFORE the store has answered.
 *
 * Its own file because `vi.mock` is hoisted and file-scoped, and this needs a
 * read that never resolves — which nothing else here wants.
 *
 * ## The defect, twice
 *
 * `useLive` returns `null` for a read in flight. A component that flattens
 * that into an empty list has promised something it does not know.
 *
 * My Farm did the opposite and waited forever on a read that had already
 * answered. The photo strip did this one: `(all ?? []).filter(...)`, so a
 * group with photos showed *"A receipt, a manual, or something you want to
 * remember…"* for the beat before SQLite came back — telling somebody their
 * photos were gone and then contradicting itself, every time they opened the
 * group. Reported from a handset as "nvm it just takes a bit".
 *
 * Neither was catchable: the normal harness settles every read before handing
 * the screen back, and a read against a test-sized store resolves inside the
 * first `act()` anyway. So the read is held open here deliberately.
 */

const held = { resolve: (() => undefined) as () => void };

vi.mock('@homefarm/core/read/photos', () => ({
  listPhotos: () =>
    new Promise((resolve) => {
      held.resolve = () => resolve([]);
    }),
}));

const { enqueue } = await import('@homefarm/core/sync/queue');
const { newId } = await import('@homefarm/contracts');
const { freshStore } = await import('../support/store');
const { mount, routeProps } = await import('../support/screen');
const { MachineScreen } = await import('../../apps/mobile/src/screens/MachineScreen');

const MACHINE = newId();

beforeEach(async () => {
  await freshStore();
  await enqueue({
    entity: 'equipment',
    op: 'create',
    targetId: MACHINE,
    payload: { name: 'The tractor', hasHourMeter: true },
  });
});

describe('the photo strip, mid-read', () => {
  it('does not claim there are none while it is still looking', async () => {
    const screen = await mount(<MachineScreen {...routeProps({ machineId: MACHINE })} />);

    // The read is still open, so the closed row must not answer the question.
    expect(screen.text()).not.toContain('A receipt, a manual');

    /**
     * The row is closed by default now, and the guarantee moved with it: it is
     * openable mid-read, and the buttons behind it are right either way — a
     * farmer can take a photo before the list of old ones has loaded.
     */
    expect(screen.has(`photos-open-${MACHINE}`)).toBe(true);
    await screen.press(`photos-open-${MACHINE}`);
    expect(screen.has('photo-camera')).toBe(true);

    // Still mid-read, so the open panel must not answer it either.
    expect(screen.text()).not.toContain('A receipt, a manual');

    held.resolve();
    await screen.settle();

    // And once the store has answered, it says so.
    expect(screen.text()).toContain('A receipt, a manual');
    screen.unmount();
  });
});
