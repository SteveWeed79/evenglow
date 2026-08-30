import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@homefarm/contracts';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { seedWindow } from '../support/native/react-native';
import { seedInsets, seedSecureStore } from '../support/native/modules';
import { FONTS } from '../../apps/mobile/src/theme/tokens';
import { FarmScreen } from '../../apps/mobile/src/screens/FarmScreen';

/**
 * Which face says what, and the one line that broke the rule.
 *
 * UX-SPEC §2 spends the data face on *"pantry-label typography — section
 * labels, small-caps, tracked... structural, not decorative — they mark where
 * you are"*, and says sentence case everywhere else. `Screen` makes the same
 * argument about its own subtitle: a proper noun set in tracked caps *"is the
 * same mistake as printing a species' collective noun as telemetry"*.
 *
 * `Row`'s detail line was set in that face, and a `Row` is what The farm,
 * Settings and Log something are built from — so every door on the hub
 * described itself in monospace. *"Groups, individuals, health, and what they
 * produce"*, rendered as though it were a meter reading, on the screen a farm
 * opens most. The rule was written down; this was the place that broke it.
 */

const SENTENCE = 'Groups, individuals, health, and what they produce';

/** The style of the element that renders this exact string, flattened. */
function faceOf(node: unknown, words: string): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = faceOf(child, words);
      if (found !== null) return found;
    }
    return null;
  }
  if (node === null || typeof node !== 'object') return null;

  const n = node as { props?: { style?: unknown }; children?: unknown };
  const kids = Array.isArray(n.children) ? n.children : [];
  if (kids.some((c) => typeof c === 'string' && c.includes(words))) {
    const merged: Record<string, unknown> = {};
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return void v.forEach(walk);
      if (typeof v === 'object' && v !== null) Object.assign(merged, v);
    };
    walk(n.props?.style);
    return merged;
  }
  return n.children === undefined ? null : faceOf(n.children, words);
}

beforeEach(async () => {
  await freshStore();
  seedWindow();
  seedInsets();
  seedSecureStore({
    'homefarm.claims': JSON.stringify({ userId: 'u1', orgId: newId(), role: 'owner' }),
  });
});

describe('a hub row describes itself', () => {
  it('in the body face, because it is a sentence', async () => {
    const screen = await mount(<FarmScreen />);

    const face = faceOf(screen.tree.toJSON(), SENTENCE);

    // Present at all first: a helper that quietly found nothing would pass the
    // assertion below by having no style to disagree with.
    expect(face, SENTENCE).not.toBeNull();
    expect(face?.['fontFamily']).toBe(FONTS.body);
    expect(face?.['fontFamily']).not.toBe(FONTS.data);
    screen.unmount();
  });
});
