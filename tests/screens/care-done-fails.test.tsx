import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A Done press that cannot be written must say so.
 *
 * Its own file because `vi.mock` is hoisted and file-scoped, and this needs an
 * `enqueue` that refuses — which nothing else here wants.
 *
 * The press is fire-and-forget by design: R6 says a log is bounded by one
 * SQLite transaction and never by signal, so the button must not await the
 * network. But it was `void log(...)` with nothing after it, so a refused
 * mutation vanished and the row simply came back — **indistinguishable from
 * never having pressed the button at all**.
 *
 * That is the same shape as the report this came from. The farm pressed once,
 * nothing was written, and the row reappeared the next morning with no way to
 * tell whether the app had failed or the press had not counted. One of those
 * was true; the app should be able to say which.
 */

const { enqueue } = vi.hoisted(() => ({ enqueue: vi.fn() }));

vi.mock('@steading/core/sync/queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@steading/core/sync/queue')>();
  return { ...actual, enqueue };
});

/**
 * The unmocked module, reached through `importActual`.
 *
 * A plain `await import(...)` returns the MOCKED module here, so pointing the
 * mock at its own `enqueue` recurses until the stack gives out — which is how
 * this was first written.
 */
const real = await vi.importActual<typeof import('@steading/core/sync/queue')>(
  '@steading/core/sync/queue',
);

const { newId } = await import('@steading/contracts');
const { freshStore } = await import('../support/store');
const { mount } = await import('../support/screen');
const { TodayScreen } = await import('../../apps/mobile/src/screens/TodayScreen');

const GROUP = newId();
const LOOK_OVER = `due-done-${GROUP}:care:health-check`;

beforeEach(async () => {
  await freshStore();
  // Real for the setup, so the group exists and the row is drawn.
  enqueue.mockImplementation(real.enqueue);
  await real.enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: { name: 'Chickens', species: 'chicken', count: 6, purposes: ['eggs'] },
  });
});

describe('when the record cannot be written', () => {
  it('puts the reason on the wall rather than losing it', async () => {
    const today = await mount(<TodayScreen />);
    await today.press(LOOK_OVER);

    // Refuses only the confirming press.
    enqueue.mockRejectedValueOnce(new Error('the disk is full'));
    await today.press(LOOK_OVER);

    expect(today.text()).toContain('Could not read');
    expect(today.text()).toContain('looked over');
    today.unmount();
  });

  /** And the row is still there, which is correct — nothing was recorded. */
  it('leaves the job on the list', async () => {
    const today = await mount(<TodayScreen />);
    await today.press(LOOK_OVER);

    enqueue.mockRejectedValueOnce(new Error('the disk is full'));
    await today.press(LOOK_OVER);

    expect(today.has(LOOK_OVER)).toBe(true);
    today.unmount();
  });
});
