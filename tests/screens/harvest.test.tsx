import { beforeEach, describe, expect, it } from 'vitest';
import { MORTALITY_CAUSES, isTaken, newId } from '@homefarm/contracts';
import { lastHarvestByGroup, lossesByGroup, processedByGroup } from '@homefarm/core/read/groups';
import { enqueue } from '@homefarm/core/sync/queue';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { LossScreen } from '../../apps/mobile/src/screens/LossScreen';
import { ProcessingScreen } from '../../apps/mobile/src/screens/ProcessingScreen';

/**
 * A harvest is not a loss, and the app filed it as one.
 *
 * Reported from the farm in a sentence: *"an animal taken for meat isn't culled
 * it's harvested."* Both acts wrote `cause: 'cull'`, because that was the only
 * cause the schema had, so nothing downstream could tell them apart.
 *
 * The visible damage was on a group's own screen. `lossesByGroup` counted every
 * mortality row whatever its cause, so a finished batch of broilers — the whole
 * purpose of having raised them — was reported as *"7 lost since you started
 * recording"*. The app told a farm its best day was a bad one.
 *
 * ## What has to stay true
 *
 * A cull is **still a loss**, and that is not an oversight. It is an animal
 * that did not work out and the farm got nothing for it, which is what a loss
 * is. Only the harvest moves.
 *
 * And every `cull` a farm has already written must go on discharging the
 * processing row, because that is what the app told it to write. Nothing is
 * migrated: the two questions are asked by different predicates, and only the
 * "were these taken by the farm" one accepts both.
 */

const GROUP = newId();

async function theRoasters(count = 7): Promise<void> {
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: {
      name: 'Roasters',
      species: 'chicken',
      count,
      purposes: ['meat'],
      bornAt: Date.now() - 70 * 86_400_000,
      processAtWeeks: 8,
    },
  });
}

async function mortality(cause: string, count: number): Promise<void> {
  await enqueue({
    entity: 'mortality',
    op: 'create',
    targetId: newId(),
    payload: { occurredAt: Date.now(), flockId: GROUP, count, cause },
  });
}

beforeEach(async () => {
  await freshStore();
  await theRoasters();
});

describe('what counts as a loss', () => {
  it('does not count a harvest, which is the yield rather than a loss', async () => {
    await mortality('harvest', 7);
    expect((await lossesByGroup()).get(GROUP)).toBeUndefined();
  });

  it('still counts a cull, because the animal did not work out', async () => {
    await mortality('cull', 1);
    expect((await lossesByGroup()).get(GROUP)).toBe(1);
  });

  it('counts what actually went wrong, beside a harvest that did not', async () => {
    await mortality('harvest', 5);
    await mortality('predator', 2);

    // Two, not seven. The fox is the loss; the freezer is not.
    expect((await lossesByGroup()).get(GROUP)).toBe(2);
  });
});

describe('what discharges the processing row', () => {
  it('takes a harvest', async () => {
    await mortality('harvest', 7);
    expect((await lastHarvestByGroup()).get(GROUP)).toBeGreaterThan(0);
  });

  /**
   * The compatibility that makes this additive rather than a migration. Every
   * harvest a farm recorded before the split is stored as a cull, and a row
   * that used to clear must not start asking again.
   */
  it('still takes a cull, which is what the app wrote before there was a harvest', async () => {
    await mortality('cull', 7);
    expect((await lastHarvestByGroup()).get(GROUP)).toBeGreaterThan(0);
  });

  it('takes neither a fox nor an illness', async () => {
    await mortality('predator', 3);
    await mortality('illness', 1);
    expect((await lastHarvestByGroup()).get(GROUP)).toBeUndefined();
  });

  /** The yield sums across both spellings, for the same reason. */
  it('sums the yield over harvests and legacy culls alike', async () => {
    await mortality('harvest', 4);
    await mortality('cull', 3);
    expect((await processedByGroup()).get(GROUP)?.count).toBe(7);
  });
});

describe('the screens keep the two acts apart', () => {
  /**
   * A harvest must not be reachable from a screen headed "Record a loss". It
   * has its own, which also collects the dressed weight this one has no field
   * for — and offering it here would file a farm's best day under the record
   * nobody wants to make.
   */
  it('does not offer a harvest as a cause of loss', async () => {
    const screen = await mount(<LossScreen {...routeProps({ groupId: GROUP })} />);

    expect(screen.labels()).toContain('Culled');
    expect(screen.labels()).not.toContain('Taken for meat');
    screen.unmount();
  });

  it('writes a harvest from the screen that means it', async () => {
    const screen = await mount(<ProcessingScreen {...routeProps({ groupId: GROUP })} />);
    await screen.press('taken-plus-1');
    await screen.press('save-processing');
    screen.unmount();

    // Not a loss, from the act whose whole purpose is the opposite.
    expect((await lossesByGroup()).get(GROUP)).toBeUndefined();
    expect((await processedByGroup()).get(GROUP)?.count).toBe(1);
  });
});

/**
 * Asked from the farm as *"when does their group disappear?"*, and the answer
 * was: never, on its own. Taking the birds cleared the processing row and did
 * nothing else — the head count stays as the keeper set it, the group stays on
 * Stock, and the only exit was `Put this group away` at the foot of the edit
 * screen with nothing pointing at it.
 *
 * Offered, never done. A keeper holding a few back has a group that is still
 * running, so "leave it be" is a real answer rather than a cancel.
 */
describe('the end of a meat flock', () => {
  it('offers to put the group away once the whole flock is accounted for', async () => {
    await theRoasters(1);

    const screen = await mount(<ProcessingScreen {...routeProps({ groupId: GROUP })} />);
    await screen.press('taken-plus-1');
    await screen.press('save-processing');

    expect(screen.has('put-group-away')).toBe(true);
    expect(screen.has('keep-group')).toBe(true);
    screen.unmount();
  });

  it('says nothing while birds are still out there', async () => {
    const screen = await mount(<ProcessingScreen {...routeProps({ groupId: GROUP })} />);
    // One of seven.
    await screen.press('taken-plus-1');
    await screen.press('save-processing');

    expect(screen.has('put-group-away')).toBe(false);
    screen.unmount();
  });

  it('leaves nothing offering a harvest that is not a cause', () => {
    expect(MORTALITY_CAUSES).toContain('harvest');
    expect(isTaken('harvest')).toBe(true);
    expect(isTaken('cull')).toBe(true);
    expect(isTaken('predator')).toBe(false);
  });
});
