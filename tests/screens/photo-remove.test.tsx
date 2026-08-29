import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Removing a photo when the write fails (H14).
 *
 * ## What it used to do
 *
 * `remove` deleted the file first and then fired the mutation with no `await`
 * and no `catch`:
 *
 *     forgetBytes(photo.id);
 *     void log({ entity: 'photo', op: 'delete', … });
 *
 * On a full disk — which is *the* reason somebody is deleting photos — the
 * JPEG was already gone by the time `enqueue` threw, the rejection went
 * unhandled, and the panel closed as though it had worked.
 *
 * For a photo that had not been uploaded yet those bytes were the only copy:
 * `BACKUP_EXCLUDES` keeps images out of the backup file. The record stayed
 * live with `uploadedAt` absent, and that pair matches neither branch in
 * `sync/photos.ts` — `uploadedAt === undefined` skips the download, and with
 * no local bytes there is nothing to upload — so it could never get bytes
 * again, on this device or any other.
 *
 * ## Why its own file
 *
 * `vi.mock` is hoisted and file-scoped, and this needs an `enqueue` that can
 * be made to fail — which every other photo test wants to work. Same reason
 * `photos-loading.test.tsx` sits apart with its never-resolving read.
 *
 * The assertion is by consequence rather than by call order: a spy on the
 * order of two calls would pass just as happily with the old code if the
 * error were swallowed somewhere else. What is asserted is the thing that
 * matters — after a failed removal the photograph is still on the phone.
 */

/** Set just before the removal, so the fixtures can still be built. */
const refuse = { next: false };

vi.mock('@homefarm/core/sync/queue', async (importOriginal) => {
  const real = await importOriginal<typeof import('@homefarm/core/sync/queue')>();
  return {
    ...real,
    enqueue: async (input: unknown) => {
      // The shape a full phone produces: the SQLite write refuses, so neither
      // the outbox row nor the projection is written.
      if (refuse.next) throw new Error('There is no room left on this phone.');
      return real.enqueue(input as never);
    },
  };
});

const { newId } = await import('@homefarm/contracts');
const { listPhotos } = await import('@homefarm/core/read/photos');
const { enqueue } = await import('@homefarm/core/sync/queue');
const { freshStore } = await import('../support/store');
const { mount, routeProps } = await import('../support/screen');
const { camera, files } = await import('../support/native/modules');
const { MachineScreen } = await import('../../apps/mobile/src/screens/MachineScreen');

const MACHINE = newId();

async function aMachine(): Promise<void> {
  await enqueue({
    entity: 'equipment',
    op: 'create',
    targetId: MACHINE,
    payload: { name: 'The tractor', hasHourMeter: true },
  });
}

/** The panel, open, with one photograph in it. */
async function withOnePhoto() {
  await aMachine();
  const screen = await mount(<MachineScreen {...routeProps({ machineId: MACHINE })} />);
  await screen.press(`photos-open-${MACHINE}`);
  await screen.press('photo-camera');

  const [photo] = await listPhotos();
  const uri = [...files.keys()].find((key) => key.endsWith(`${photo!.id}.jpg`));
  expect(uri).toBeDefined();

  return { screen, photo: photo!, uri: uri! };
}

beforeEach(async () => {
  refuse.next = false;
  await freshStore();
  files.clear();
  camera.granted = true;
  camera.resizes.length = 0;
  camera.next = {
    canceled: false,
    assets: [{ uri: 'file:///tmp/shot.jpg', width: 4000, height: 3000 }],
  };
});

describe('a removal the phone cannot write', () => {
  it('leaves the photograph on the phone', async () => {
    const { screen, photo, uri } = await withOnePhoto();

    await screen.press(`photo-${photo.id}`);
    refuse.next = true;
    await screen.pressLabel('Remove');
    await screen.pressLabel('Tap again');

    // The whole finding: the bytes were the only copy, and they are still here.
    expect(files.has(uri)).toBe(true);
    // And the record was not archived either — the write is one transaction,
    // so it recorded the removal or it changed nothing.
    expect(await listPhotos()).toHaveLength(1);

    screen.unmount();
  });

  it('says so, instead of closing as though it had worked', async () => {
    const { screen, photo } = await withOnePhoto();

    await screen.press(`photo-${photo.id}`);
    refuse.next = true;
    await screen.pressLabel('Remove');
    await screen.pressLabel('Tap again');

    expect(screen.text()).toContain('no room left on this phone');
    // Still open, because the photograph is still there to try again on.
    expect(screen.has(`photo-open-${photo.id}`)).toBe(true);

    screen.unmount();
  });

  /**
   * And a second attempt, once there is room, still works — the failure left
   * nothing half-done behind it.
   */
  it('removes cleanly once the write can land', async () => {
    const { screen, photo, uri } = await withOnePhoto();

    await screen.press(`photo-${photo.id}`);
    refuse.next = true;
    await screen.pressLabel('Remove');
    await screen.pressLabel('Tap again');

    // One tap, not two: `Confirm` stays armed after a confirm that threw, so
    // somebody who has just made room carries on from where they were rather
    // than arming a destructive control a second time.
    refuse.next = false;
    await screen.pressLabel('Tap again');

    expect(files.has(uri)).toBe(false);
    expect(await listPhotos()).toEqual([]);
    expect(screen.has(`photo-open-${photo.id}`)).toBe(false);

    screen.unmount();
  });
});
