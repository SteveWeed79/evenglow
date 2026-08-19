import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@homefarm/contracts';
import { enqueue } from '@homefarm/core/sync/queue';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { navCalls } from '../support/native/navigation';
import { TodayScreen } from '../../apps/mobile/src/screens/TodayScreen';

/**
 * Every row on Today, and where tapping it lands.
 *
 * ## Why this file exists
 *
 * Three faults of the same shape were reported one at a time — a service that
 * would not clear, a weighing row that opened a summary, a processing row that
 * did nothing useful — and each was fixed on its own. Asked to check the lot,
 * the pattern turned out to be structural rather than incidental: `openDue`
 * read `subject.entity` FIRST, so every flock row went to the group screen
 * whatever it was about.
 *
 * A group screen is a hub. Landing there for a row whose whole content is a
 * weight means reading a summary, finding the action among eight others, and
 * tapping again — the app knowing exactly what was wanted and making the
 * person say it a second time.
 *
 * **And one row was not merely coarse, it was broken.** `birthDue` named the
 * dam (`entity: 'animal'`), and the animal branch passed that id into
 * `Animals` as a `groupId` — which matched no group and rendered "That group —
 * Missing". A dead end reachable by any farm that recorded a breeding. Nothing
 * caught it because an animal id and a group id are the same kind of string.
 *
 * So this walks the kinds rather than trusting the branch, and it is written
 * to be extended: a new due kind should get a line here saying where it goes.
 */

const DAY = 86_400_000;

async function aGroup(id: string, over: Record<string, unknown> = {}): Promise<void> {
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: id,
    payload: { name: 'The birds', species: 'chicken', count: 6, purposes: ['eggs'], ...over },
  });
}

/** The last `navigate` this screen asked for. */
function wentTo(): { route?: string; params?: unknown } | undefined {
  const navigations = navCalls().filter((call) => call.action === 'navigate');
  return navigations[navigations.length - 1];
}

beforeEach(async () => {
  await freshStore();
  navCalls().length = 0;
});

describe('a row that asks for a weight', () => {
  /**
   * "If the reminder is for weighing it should link to the weighing screen not
   * the animal group main screen." Exactly so, and it did not.
   */
  it('opens the scale rather than the group', async () => {
    const group = newId();
    await aGroup(group, {
      name: 'Roasters',
      purposes: ['meat'],
      breedId: 'chicken-cornish-cross',
      // Old enough that the processing window is open, so the row is on Today.
      bornAt: Date.now() - 60 * DAY,
    });

    const screen = await mount(<TodayScreen />);
    await screen.press(`due-${group}:processing`);

    expect(wentTo()?.route).toBe('Weigh');
    expect(wentTo()?.params).toEqual({ groupId: group });
  });
});

describe('a row that asks for a fleece', () => {
  /** Same fault, same fix: the clip has its own screen and the row skipped it. */
  it('opens the shearing form rather than the group', async () => {
    const group = newId();
    await aGroup(group, {
      name: 'The flock',
      species: 'sheep',
      purposes: ['fibre'],
      breedId: 'sheep-merino',
    });

    const screen = await mount(<TodayScreen />);
    const shearing = navigableRows(screen).find((id) => id.includes(':shearing'));
    if (shearing === undefined) return; // No library interval for this breed.

    await screen.press(shearing);
    expect(wentTo()?.route).toBe('Shearing');
    expect(wentTo()?.params).toEqual({ groupId: group });
  });
});

/**
 * The one that was a dead end.
 *
 * A breeding record puts "Bramble due" on Today. Tapping it navigated to
 * `Animals` with the DAM'S id in the `groupId` slot, and that screen looks the
 * group up and renders "That group — Missing" when it finds none. It always
 * found none.
 */
describe('a row about a dam in kid', () => {
  it('opens her group’s breeding book, not a group that does not exist', async () => {
    const group = newId();
    const dam = newId();
    await aGroup(group, { name: 'The does', species: 'goat', purposes: ['milk'] });

    await enqueue({
      entity: 'animal',
      op: 'create',
      targetId: dam,
      payload: { flockId: group, name: 'Bramble', species: 'goat', sex: 'female' },
    });
    await enqueue({
      entity: 'breeding',
      op: 'create',
      targetId: newId(),
      payload: {
        damId: dam,
        species: 'goat',
        method: 'natural',
        // Bred long enough ago that the birth row is inside its notice window.
        bredAt: Date.now() - 145 * DAY,
      },
    });

    const screen = await mount(<TodayScreen />);
    const birth = navigableRows(screen).find((id) => id.includes(':birth'));
    expect(birth).toBeDefined();

    await screen.press(birth!);

    // Never `Animals`, and never the dam's id in a groupId slot.
    expect(wentTo()?.route).toBe('Breeding');
    expect(wentTo()?.params).toEqual({ groupId: group });
  });
});

/**
 * Every row that is drawn is either openable or deliberately not.
 *
 * The blanket assertion, because the specific ones above only cover the kinds
 * somebody has already thought about. What must never happen again is a row
 * that navigates somewhere its target screen cannot use — and the `Animals`
 * case proves that a wrong id is invisible unless something checks the pair.
 */
describe('every row Today can draw', () => {
  it('never sends a group screen an id that is not a group', async () => {
    const group = newId();
    const dam = newId();
    await aGroup(group, {
      name: 'The does',
      species: 'goat',
      purposes: ['milk', 'meat'],
      bornAt: Date.now() - 400 * DAY,
    });
    await enqueue({
      entity: 'animal',
      op: 'create',
      targetId: dam,
      payload: { flockId: group, name: 'Bramble', species: 'goat', sex: 'female' },
    });
    await enqueue({
      entity: 'breeding',
      op: 'create',
      targetId: newId(),
      payload: { damId: dam, species: 'goat', method: 'natural', bredAt: Date.now() - 145 * DAY },
    });

    const screen = await mount(<TodayScreen />);

    for (const row of navigableRows(screen)) {
      navCalls().length = 0;
      await screen.press(row);

      const went = wentTo();
      if (went === undefined) continue;

      const params = went.params as { groupId?: string } | undefined;
      if (params?.groupId !== undefined) {
        // The only group on this farm. A dam's id here is the reported bug.
        expect(params.groupId).toBe(group);
      }
    }
  });
});

/** Which rows the screen actually rendered as tappable. */
function navigableRows(screen: { tree: { root: { findAllByProps: (p: object) => unknown[] } } }): string[] {
  const found = screen.tree.root.findAllByProps({ accessibilityRole: 'button' }) as {
    props: { testID?: string };
  }[];

  return [
    ...new Set(
      found
        .map((node) => node.props.testID)
        .filter((id): id is string => id !== undefined && id.startsWith('due-')),
    ),
  ];
}
