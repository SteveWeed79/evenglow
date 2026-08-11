import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { localStore } from '@steading/core/db/store';
import { freshStore } from '../support/store';

/**
 * A photograph taken by a process that did not survive to keep it.
 *
 * Reported from a tablet: *"Steading takes the pic then restarts and the pic is
 * lost."* Android destroys the activity behind the camera when it wants the
 * memory — or always, if "Don't keep activities" is left on in Developer
 * options — and the app that comes back is a new one.
 *
 * The id and the subject lived in a closure in `Photos.tsx`, which is the first
 * thing to go. This covers the durable half: the note written before the camera
 * opens, and the rules about clearing it. The picker half needs a real Android
 * activity to be destroyed, so it is device-verified rather than asserted here.
 */
describe('the note left before the camera opens', () => {
  beforeEach(async () => {
    await freshStore();
  });

  it('survives being written and read back', async () => {
    const pending = { id: newId(), subjectId: newId(), at: Date.now() };
    await localStore().setPendingPhoto(pending);

    expect(await localStore().getPendingPhoto()).toEqual(pending);
  });

  it('is nothing at all until a camera is opened', async () => {
    expect(await localStore().getPendingPhoto()).toBeNull();
  });

  /**
   * Cleared when the OS hands control back, cancel included. A note left after
   * a successful capture would be recovered on the next launch and write a
   * second record for one photograph.
   */
  it('can be cleared', async () => {
    await localStore().setPendingPhoto({ id: newId(), subjectId: newId(), at: Date.now() });
    await localStore().setPendingPhoto(null);

    expect(await localStore().getPendingPhoto()).toBeNull();
  });

  /**
   * Parsed on read like every other stored value (invariant 11). A note left by
   * an older build with a different shape is a real case rather than a
   * hypothetical, and a half-read one must not become a photo record with a
   * subject nobody can resolve.
   */
  it('refuses a shape it does not recognise', async () => {
    // What a previous version might have written: no subject to file it under.
    await localStore().setPendingPhoto({ id: newId(), at: Date.now() } as never);

    expect(await localStore().getPendingPhoto()).toBeNull();
  });
});
