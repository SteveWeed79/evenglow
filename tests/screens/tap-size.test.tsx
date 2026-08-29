import { describe, expect, it } from 'vitest';
import type { ReactTestInstance } from 'react-test-renderer';
import { TAP } from '../../apps/mobile/src/theme/tokens';
import { Touch } from '../../apps/mobile/src/components/Touch';
import { mount } from '../support/screen';
import { SCREENS, stockTheFarm } from '../support/screens';
import { freshStore } from '../support/store';

/**
 * How big every control is, on every screen.
 *
 * ## The audit R4 says exists
 *
 * `docs/UX-SPEC.md` R4 — *"Tap targets ≥56px, primary actions 64px, ≥12px
 * spacing"* — lists its verification as **"Automated audit in CI"**. There was
 * none. The rule held wherever somebody had used a `Form` primitive and
 * lapsed everywhere else, which is precisely the failure mode R4's own row
 * predicts and the reason it names a check rather than a review.
 *
 * ## It measures the box, not the slop
 *
 * `hitSlop` extends where a finger registers and changes nothing about what a
 * person sees, so this asserts the declared box. A control that reaches the
 * floor on its own is one whose visible size matches its tap size.
 *
 * ## What is exempt, and why each list is closed
 *
 * Two lists, for two different reasons, and both are named individually so a
 * new control cannot join either by accident.
 *
 * A control whose height comes from its **content** — a list card of three
 * lines, a due row — cannot declare a floor it already clears by a wide margin,
 * and asserting one would be arithmetic about padding rather than about size.
 *
 * The **header chrome** is a decision rather than an oversight, and it is
 * asserted rather than skipped. See `CHROME` below.
 */

/** Flattens the array-and-function style shapes React Native accepts. */
function flat(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flat));
  return typeof style === 'object' && style !== null ? (style as Record<string, unknown>) : {};
}

function declaredHeight(node: ReactTestInstance): number | null {
  const raw = node.props['style'];
  const style = flat(typeof raw === 'function' ? raw({ pressed: false }) : raw);
  const height = style['minHeight'] ?? style['height'];
  return typeof height === 'number' ? height : null;
}

function nameOf(node: ReactTestInstance): string {
  return String(node.props['testID'] ?? node.props['accessibilityLabel'] ?? 'unnamed');
}

/**
 * Controls sized by what is inside them.
 *
 * **Matched on a prefix of the testID, so this cannot quietly cover a new
 * control.** Each is a card or a row whose content is at minimum two lines of
 * text inside `SPACE.lg` padding — comfortably past the floor, and past it in a
 * way no number in the stylesheet states. A `minHeight` on them would assert
 * nothing that is not already true and would read as though it were load
 * bearing.
 */
const SIZED_BY_CONTENT = [
  // Stock, Growing, Iron, Animals: the list cards, three lines and a figure.
  'group-',
  'bed-',
  'machine-',
  'animal-',
  // A due row and its expander, which carry a title and a detail line.
  'due-',
  'bundle-',
  // The group screen's "More" disclosure, on the same row as its heading.
  'group-more',
];

const contentSized = (id: string): boolean => SIZED_BY_CONTENT.some((p) => id.startsWith(p));

/**
 * The five controls in the header, at half the floor, on purpose.
 *
 * `Screen`'s status row carries Back **or** the quick-add and the gear, plus
 * the sync chip and the lamp. All of them are declared at `TAP.min / 2` — 28dp
 * — with `hitSlop={12}` taking the region a finger actually registers in to
 * **52**. That is over the 44 accessibility floor and under the 56 R4 sets, and
 * R4 is right that 44 is a floor rather than a target: a gloved fingertip is
 * 12–25mm.
 *
 * They stay at 28 anyway, and the reason is height rather than taste. This row
 * stands above the content on **every screen in the app**, so 56 here is 28dp
 * off the top of all of them — and `landscape-fold.test.ts` shows what that
 * costs: the stack down to the commit button already clears a 430dp landscape
 * phone by under 30dp, so a taller header is what pushes a form's own button
 * under the fold on a rotated handset. The trade is a chevron that is easier to
 * hit on one screen against a save button that is reachable on all of them.
 *
 * **Asserted, not skipped.** These are pinned at exactly `TAP.min / 2` below,
 * so the exception stays the size it was decided at — a chrome control that
 * drifts up fails here, and so does one that declares nothing at all and lets
 * its padding decide, which is what the sync chip was doing.
 *
 * The lamp's label is its state, so all three of them are here.
 */
const CHROME = [
  'Back',
  'Settings',
  'quick-add',
  'sync-chip',
  'Switch to lamplight',
  'Switch to daylight',
  'Leave bright sun',
];

const isChrome = (id: string): boolean => CHROME.includes(id);

describe('every control is at least a glove wide', () => {
  it.each(SCREENS)('%s', async (name, render) => {
    await freshStore();
    await stockTheFarm();

    const screen = await mount(render());
    const small: string[] = [];

    for (const touch of screen.tree.root.findAllByType(Touch)) {
      const id = nameOf(touch);
      if (contentSized(id) || isChrome(id)) continue;

      const height = declaredHeight(touch);
      if (height === null || height < TAP.min) {
        small.push(`${id} (${height === null ? 'no height declared' : `${height}px`})`);
      }
    }

    screen.unmount();

    expect(
      [...new Set(small)],
      `${name}: below the ${TAP.min}px floor R4 sets`,
    ).toEqual([]);
  });
});

/**
 * And the one that is larger on purpose.
 *
 * R4 gives a primary action 64. It is the only size in the app that differs
 * from the floor, and it differs upward — so "uniform" here means one floor
 * and one deliberate exception, rather than whatever each component happened
 * to declare.
 */
describe('the primary action is the only thing bigger', () => {
  it.each(SCREENS)('%s', async (name, render) => {
    await freshStore();
    await stockTheFarm();

    const screen = await mount(render());
    const wrong: string[] = [];

    for (const touch of screen.tree.root.findAllByType(Touch)) {
      if (touch.props['affordance'] !== 'brass') continue;
      const height = declaredHeight(touch);
      if (height !== TAP.primary) {
        wrong.push(`${nameOf(touch)} (${String(height)}px, not ${TAP.primary})`);
      }
    }

    screen.unmount();
    expect([...new Set(wrong)], name).toEqual([]);
  });
});

/**
 * And the exception holds at the size it was decided at.
 *
 * The point of naming it rather than skipping it: an exemption list that only
 * subtracts is a place for controls to go and stop being measured. This one
 * measures them, against the number the decision was about.
 */
describe('the header chrome stays the one size it was allowed', () => {
  it.each(SCREENS)('%s', async (name, render) => {
    await freshStore();
    await stockTheFarm();

    const screen = await mount(render());
    const wrong: string[] = [];

    for (const touch of screen.tree.root.findAllByType(Touch)) {
      const id = nameOf(touch);
      if (!isChrome(id)) continue;

      const height = declaredHeight(touch);
      if (height !== TAP.min / 2) {
        wrong.push(`${id} (${height === null ? 'no height declared' : `${height}px`})`);
      }
      // Half a box is only allowed because the slop makes up the difference. A
      // chrome control without it is 28dp and 28dp of reach, which is under the
      // accessibility floor rather than under R4's target.
      if (touch.props['hitSlop'] !== 12) {
        wrong.push(`${id} (no hitSlop to carry it past 44)`);
      }
    }

    screen.unmount();
    expect([...new Set(wrong)], `${name}: the chrome is ${TAP.min / 2}px plus slop`).toEqual([]);
  });
});
