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
    await screen.press(`photos-open-${SUBJECT}`);
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
    await screen.press(`photos-open-${SUBJECT}`);
    await screen.press(`photo-${id}`);

    expect(screen.text()).toContain('never reached the farm server');
    expect(screen.text()).toContain('If that was this phone');
    screen.unmount();
  });

  /** The other real case: the server HAS it, so it genuinely is on its way. */
  it('promises the picture only when the server actually holds it', async () => {
    const id = await aPhoto({ uploadedAt: Date.now() });
    const screen = await mount(<Photos subjectId={SUBJECT} what="The hens" />);
    await screen.press(`photos-open-${SUBJECT}`);
    await screen.press(`photo-${id}`);

    expect(screen.text()).toContain('still coming');
    screen.unmount();
  });

  /**
   * The tile and the sentence under it must not disagree — and neither may the
   * closed row, which is where this correction was lost once already.
   *
   * `Photos` gained a collapsed row in parallel with this fix, and the new row
   * shipped carrying the old sentence. Two edits to one component, each right
   * on its own, merging without a textual conflict and putting `On the other
   * phone` back on the first thing anybody sees. Every surface that states
   * this fact is asserted here for that reason, closed row first.
   */
  it('labels every surface from the same fact as the sentence', async () => {
    const id = await aPhoto();
    const screen = await mount(<Photos subjectId={SUBJECT} what="The hens" />);

    expect(screen.text()).toContain('Not on this phone');
    expect(screen.text()).not.toContain('other phone');

    await screen.press(`photos-open-${SUBJECT}`);
    expect(screen.text()).toContain('Not on this phone');

    await screen.press(`photo-${id}`);
    expect(screen.text()).toContain('Not on this phone');
    screen.unmount();
  });

  /**
   * The closed row has one line for a set, so it makes the stronger claim only
   * when every photo in that set has earned it. One record with no
   * `uploadedAt` among three is one that may be gone for good, and a summary
   * has no room to say which — so it falls back to the thing true of all of
   * them rather than promising for the majority.
   */
  it('promises the closed row nothing the server is not holding', async () => {
    await aPhoto({ uploadedAt: Date.now() });
    const screen = await mount(<Photos subjectId={SUBJECT} what="The hens" />);
    expect(screen.text()).toContain('Still coming');
    screen.unmount();

    await aPhoto();
    const mixed = await mount(<Photos subjectId={SUBJECT} what="The hens" />);
    expect(mixed.text()).toContain('Not on this phone');
    mixed.unmount();
  });
});
