import { beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { newId } from '@homefarm/contracts';
import { enqueue } from '@homefarm/core/sync/queue';
import { freshStore } from '../support/store';
import { seedWindow } from '../support/native/react-native';
import { seedInsets, seedSecureStore } from '../support/native/modules';
import { resetNav } from '../support/native/navigation';
import { ThemeProvider } from '../../apps/mobile/src/theme/ThemeProvider';
import { Coming } from '../../apps/mobile/src/components/Coming';
import { Screen } from '../../apps/mobile/src/components/Screen';
import { Timeline } from '../../apps/mobile/src/components/Timeline';
import { DiagnosticsScreen } from '../../apps/mobile/src/screens/DiagnosticsScreen';
import { HistoryScreen } from '../../apps/mobile/src/screens/HistoryScreen';
import { IncubationsScreen } from '../../apps/mobile/src/screens/IncubationsScreen';
import { InventoryScreen } from '../../apps/mobile/src/screens/InventoryScreen';

/**
 * **A panel may not be a screen, not even for one frame.**
 *
 * `Coming` and `Timeline` are panels — they are drawn inside somebody else's
 * screen, half way down it — and both waited on their read with `<Loading>`,
 * which is a whole `<Screen>`. So until the dues or the history answered, a
 * second status bar, a second back chevron, a second plaster wall and a second
 * scroll surface rendered inside the first screen's content.
 *
 * It is worst exactly where those two components are used most: `GroupBody`
 * and `MachineBody` end with both of them, and those bodies are what Stock and
 * Iron put in the **detail pane** on a tablet. A scroll view inside the pane's
 * own scroll view is the defect `Screen` was just repaired for, arriving
 * through a different door.
 *
 * ## Why this is asserted on the first frame
 *
 * `mount()` — even with `settle: false` — drains the microtask queue, and both
 * reads resolve within it, so the state that ships the bug is already gone by
 * the time the helper hands the screen back. A synchronous `act` commits the
 * first render and stops, which is the only way to look at what a person on a
 * handset actually sees while the store is still reading.
 */

const SUBJECT = newId();

/** Chrome that belongs to a screen and must therefore appear exactly once. */
function chrome(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((child) => chrome(child, out));
    return out;
  }
  if (node === null || typeof node !== 'object') return out;

  const n = node as { props?: Record<string, unknown>; children?: unknown };
  const label = n.props?.accessibilityLabel;
  if (label === 'Back' || label === 'Settings') out.push(label);
  // The same marker `panes.test.tsx` uses: a ScrollView is a host view
  // carrying its props, and the props are the reliable name across versions.
  if (
    n.props !== undefined &&
    ('scrollEventThrottle' in n.props || 'keyboardShouldPersistTaps' in n.props)
  ) {
    out.push('scroll');
  }

  if (n.children !== undefined) chrome(n.children, out);
  return out;
}

/** What the very first commit draws, before any read has answered. */
function firstFrame(element: React.ReactElement): string[] {
  resetNav();
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(createElement(ThemeProvider, null, element));
  });
  const found = chrome(tree.toJSON());
  act(() => {
    tree.unmount();
  });
  return found;
}

beforeEach(async () => {
  await freshStore();
  seedWindow();
  seedInsets();
  seedSecureStore({
    'homefarm.claims': JSON.stringify({ userId: 'u1', orgId: newId(), role: 'owner' }),
  });
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: SUBJECT,
    payload: { name: 'The hens', species: 'chicken', count: 6, purposes: ['eggs'] },
  });
});

describe('a panel waiting on its read', () => {
  it('draws no second screen while the dues are still reading', () => {
    const found = firstFrame(
      <Screen title="The hens" back>
        <Coming subject={SUBJECT} />
      </Screen>,
    );

    // One screen: its chevron and its scroll surface. Two of each is `Coming`
    // having rendered a `<Screen>` of its own inside this one's content.
    expect(found).toEqual(['Back', 'scroll']);
  });

  it('draws no second screen while the history is still reading', () => {
    const found = firstFrame(
      <Screen title="The hens" back>
        <Timeline subject={SUBJECT} />
      </Screen>,
    );

    expect(found).toEqual(['Back', 'scroll']);
  });
});

/**
 * And a tab that waits is still a tab.
 *
 * `Loading` is `<Screen back>`, which is right for the pushed screens that use
 * it and wrong for the one tab that does. `back` is not only the chevron:
 * `Screen` reads it as "no tab bar under this screen", so a tab borrowing the
 * default drew a chevron that goes nowhere *and* laid its content out 96dp too
 * wide — the rail's width — until the read landed.
 */
describe('What happened, while it is reading', () => {
  it('keeps the header a tab header', () => {
    const found = firstFrame(<HistoryScreen />);

    // The date and the gear, not a chevron. A back arrow on a tab pops a stack
    // whose only entry is the tabs themselves.
    expect(found).toContain('Settings');
    expect(found).not.toContain('Back');
  });
});

/**
 * And a pushed screen that waits is still a pushed screen.
 *
 * The mirror of the tab above, and three screens had it: Sync, Eggs under and
 * The shelf all waited on `<Screen title="…">` with no `back`, while the
 * screen that arrived a frame later had it. So the wait drew tab chrome on a
 * pushed screen — no way out, a quick-add and a gear that belong to a tab —
 * and, because `Screen` reads `back` as "no bar under this screen", laid the
 * content out as though a rail were taking 96dp a pushed screen never gives up.
 */
describe('a pushed screen, while it is reading', () => {
  const waiting: [string, () => React.ReactElement][] = [
    ['Sync', DiagnosticsScreen],
    ['Eggs under', IncubationsScreen],
    ['The shelf', InventoryScreen],
  ];

  for (const [name, Component] of waiting) {
    it(`keeps the way out of ${name}`, () => {
      const found = firstFrame(<Component />);

      expect(found).toContain('Back');
      // The gear is a tab control. On a pushed screen it is the wrong header.
      expect(found).not.toContain('Settings');
    });
  }
});
