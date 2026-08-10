import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { enqueue } from '@steading/core/sync/queue';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { Photos } from '../../apps/mobile/src/components/Photos';

beforeEach(async () => {
  await freshStore();
});


/**
 * "There is not another phone."
 *
 * Reported from a one-handset farm looking at a photograph it had taken
 * itself. The tile said `On the other phone` and the sentence under it blamed
 * "the handset that took it" - both asserting a second device that farm has
 * never owned.
 *
 * Whether one exists is not something this app can know. What it knows is
 * whether the SERVER ever received the bytes, which is what `uploadedAt`
 * records, and that is a different fact entirely.
 */
describe('a picture whose bytes are not here', () => {
  const SUBJECT = newId();

  async function aPhoto(over: Record<string, unknown> = {}): Promise<string> {
    const id = newId();
    await enqueue({
      entity: 'photo',
      op: 'create',
      targetId: id,
      payload: {
        subjectId: SUBJECT,
        contentType: 'image/jpeg',
        byteSize: 240_000,
        capturedAt: Date.now(),
        ...over,
      },
    });
    return id;
  }

  it('never claims another phone when the server never had it', async () => {
    const id = await aPhoto();
    const screen = await mount(<Photos subjectId={SUBJECT} what="The hens" />);
    await screen.press(`photo-${id}`);

    const said = screen.text();
    expect(said).not.toContain('other phone');
    expect(said).not.toContain('another phone');
    screen.unmount();
  });

  /**
   * The loss is real and has to be sayable - but it is CONDITIONAL, because
   * which handset took it is the fact that is missing.
   */
  it('says the picture is gone if this was the phone that took it', async () => {
    const id = await aPhoto();
    const screen = await mount(<Photos subjectId={SUBJECT} what="The hens" />);
    await screen.press(`photo-${id}`);

    expect(screen.text()).toContain('never reached the farm server');
    expect(screen.text()).toContain('If that was this phone');
    screen.unmount();
  });

  /** The other real case: the server HAS it, so it genuinely is on its way. */
  it('promises the picture only when the server actually holds it', async () => {
    const id = await aPhoto({ uploadedAt: Date.now() });
    const screen = await mount(<Photos subjectId={SUBJECT} what="The hens" />);
    await screen.press(`photo-${id}`);

    expect(screen.text()).toContain('still coming');
    screen.unmount();
  });

  /** The tile and the sentence under it must not disagree. */
  it('labels the tile from the same fact as the sentence', async () => {
    await aPhoto();
    const screen = await mount(<Photos subjectId={SUBJECT} what="The hens" />);

    expect(screen.text()).toContain('Not on this phone');
    screen.unmount();
  });
});
