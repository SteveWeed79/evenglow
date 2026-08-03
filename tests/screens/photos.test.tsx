import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { listPhotos } from '@steading/core/read/photos';
import { enqueue } from '@steading/core/sync/queue';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { camera, files } from '../support/native/modules';
import { GroupScreen } from '../../apps/mobile/src/screens/GroupScreen';
import { MachineScreen } from '../../apps/mobile/src/screens/MachineScreen';

/**
 * Photos, and the two cases they were built for.
 *
 * **Receipts and manuals on kit**, because the history handed over with a
 * machine is what LookOver sells on and a receipt cannot be reconstructed
 * later. And **evidence** — a wound, a kill, a diseased leaf — the one a
 * keeper reaches for and the one that cannot be taken afterwards.
 *
 * Per-animal portraits were refused rather than forgotten: you tell six hens
 * apart with a leg ring. See `docs/ROADMAP.md`.
 */

const GROUP = newId();
const MACHINE = newId();

async function aFarm(): Promise<void> {
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: { name: 'The hens', species: 'chicken', count: 6, purposes: ['eggs'] },
  });
  await enqueue({
    entity: 'equipment',
    op: 'create',
    targetId: MACHINE,
    payload: { name: 'The tractor', hasHourMeter: true },
  });
}

beforeEach(async () => {
  await freshStore();
  files.clear();
  camera.granted = true;
  camera.resizes.length = 0;
  camera.next = {
    canceled: false,
    assets: [{ uri: 'file:///tmp/shot.jpg', width: 4000, height: 3000 }],
  };
});

describe('keeping a photo', () => {
  it('writes the bytes and a record that names the subject', async () => {
    await aFarm();
    const screen = await mount(<MachineScreen {...routeProps({ machineId: MACHINE })} />);

    await screen.press('photo-camera');
    screen.unmount();

    const [photo] = await listPhotos();
    expect(photo).toMatchObject({ subjectId: MACHINE, contentType: 'image/jpeg' });

    // The record's id is the filename, so nothing stores a path and nothing
    // can point at a file belonging to a different record.
    expect([...files.keys()].some((uri) => uri.endsWith(`${photo!.id}.jpg`))).toBe(true);
  });

  /**
   * A phone camera produces 4–8 MB a frame and a receipt is legible at 1600px.
   * Storing the original would be twenty times the bytes for no readable
   * difference — and photos are the one thing in this app that is not small.
   */
  it('shrinks a camera-sized image on the way in', async () => {
    await aFarm();
    const screen = await mount(<MachineScreen {...routeProps({ machineId: MACHINE })} />);

    await screen.press('photo-camera');
    screen.unmount();

    // Landscape, so the width is what gets pinned and the ratio is kept.
    expect(camera.resizes).toEqual([{ resize: { width: 1600 } }]);
  });

  it('pins the height instead when the photo is a portrait', async () => {
    await aFarm();
    camera.next = {
      canceled: false,
      assets: [{ uri: 'file:///tmp/tall.jpg', width: 3000, height: 4000 }],
    };

    const screen = await mount(<MachineScreen {...routeProps({ machineId: MACHINE })} />);
    await screen.press('photo-camera');
    screen.unmount();

    expect(camera.resizes).toEqual([{ resize: { height: 1600 } }]);
  });

  /** Already small enough is left alone rather than upscaled into a bigger file. */
  it('does not enlarge a photo that is already small', async () => {
    await aFarm();
    camera.next = {
      canceled: false,
      assets: [{ uri: 'file:///tmp/small.jpg', width: 800, height: 600 }],
    };

    const screen = await mount(<MachineScreen {...routeProps({ machineId: MACHINE })} />);
    await screen.press('photo-camera');
    screen.unmount();

    expect(camera.resizes).toEqual([]);
    expect(await listPhotos()).toHaveLength(1);
  });
});

describe('backing out', () => {
  /** A cancel is not a failure and must not put an error on the screen. */
  it('writes nothing when the picker is cancelled', async () => {
    await aFarm();
    camera.next = { canceled: true };

    const screen = await mount(<MachineScreen {...routeProps({ machineId: MACHINE })} />);
    await screen.press('photo-camera');

    expect(await listPhotos()).toEqual([]);
    expect(screen.text()).not.toContain('could not');
    screen.unmount();
  });

  /** Refusing the camera is an answer. The library is still there. */
  it('writes nothing and says nothing when the camera is refused', async () => {
    await aFarm();
    camera.granted = false;

    const screen = await mount(<MachineScreen {...routeProps({ machineId: MACHINE })} />);
    await screen.press('photo-camera');

    expect(await listPhotos()).toEqual([]);
    expect(screen.text()).not.toContain('could not');
    screen.unmount();
  });
});

describe('removing one', () => {
  /**
   * The record is archived like every other mutable entity (P13). The bytes
   * genuinely go — they are not the audit trail, they are the weight.
   */
  it('takes the bytes with it', async () => {
    await aFarm();
    const screen = await mount(<MachineScreen {...routeProps({ machineId: MACHINE })} />);
    await screen.press('photo-camera');

    const [photo] = await listPhotos();
    const uri = [...files.keys()].find((key) => key.endsWith(`${photo!.id}.jpg`));
    expect(uri).toBeDefined();

    await screen.pressLabel('Remove');
    await screen.pressLabel('Tap again');
    screen.unmount();

    expect(files.has(uri!)).toBe(false);
    expect(await listPhotos()).toEqual([]);
  });
});

describe('where photos are offered', () => {
  it('is on kit, for the receipt', async () => {
    await aFarm();
    const screen = await mount(<MachineScreen {...routeProps({ machineId: MACHINE })} />);
    expect(screen.has('photo-camera')).toBe(true);
    screen.unmount();
  });

  it('is on a group, for the evidence', async () => {
    await aFarm();
    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);
    expect(screen.has('photo-camera')).toBe(true);
    screen.unmount();
  });

  /**
   * A photo belongs to one subject. Without this the tractor's receipts would
   * appear on the hens, which is the failure a shared list makes silently.
   */
  it('keeps one subject’s photos off another', async () => {
    await aFarm();
    const machine = await mount(<MachineScreen {...routeProps({ machineId: MACHINE })} />);
    await machine.press('photo-camera');
    machine.unmount();

    const group = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);
    // The group has none of its own, so it still shows the invitation.
    expect(group.text()).toContain('A receipt, a manual');
    group.unmount();
  });
});
