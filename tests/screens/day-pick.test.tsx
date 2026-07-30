import { describe, expect, it } from 'vitest';
import { DayPick } from '../../apps/mobile/src/components/Form';
import { mount } from '../support/screen';

/**
 * The box that fought back.
 *
 * Reported from a handset: changing a group's hatch date, "it was very
 * difficult to type in the number, the box fought back."
 *
 * The field read `String(day)` straight off the clamped date and committed
 * only when the text parsed to 1 or more. Clearing it therefore did nothing —
 * an empty string parses to 0, no commit happened, and the old digit was still
 * there for the next keystroke to land beside. Going from the 9th to the 21st
 * meant the 9 would not leave.
 *
 * Asserted on what the field COMMITS rather than on what it renders: a
 * TextInput's value is not part of the rendered text, so an assertion about
 * the words on screen would pass whatever this did.
 */

const MARCH_9 = new Date(2026, 2, 9).getTime();
const dayOf = (at: number): number => new Date(at).getDate();

describe('typing a day', () => {
  it('commits nothing for an empty box, so it can be cleared', async () => {
    const seen: number[] = [];
    const screen = await mount(
      <DayPick value={MARCH_9} onChange={(next) => seen.push(next)} withYear />,
    );

    await screen.type('day-of-month', '');

    /**
     * The whole complaint, and it has to be asserted on what the BOX shows.
     * The old field committed nothing for an empty string either — so a test
     * that only checked `seen` would pass against the bug. What it did do was
     * re-render `String(day)` and put the 9 straight back, which is what made
     * it impossible to type over.
     */
    expect(screen.shows('day-of-month')).toBe('');
    expect(seen).toEqual([]);
    screen.unmount();
  });

  it('takes a two-digit day typed one digit at a time', async () => {
    const seen: number[] = [];
    const screen = await mount(
      <DayPick value={MARCH_9} onChange={(next) => seen.push(next)} withYear />,
    );

    await screen.type('day-of-month', '');
    await screen.type('day-of-month', '2');
    await screen.type('day-of-month', '21');

    expect(seen.map(dayOf)).toEqual([2, 21]);
    screen.unmount();
  });

  it('commits nothing for a non-digit', async () => {
    const seen: number[] = [];
    const screen = await mount(
      <DayPick value={MARCH_9} onChange={(next) => seen.push(next)} withYear />,
    );

    await screen.type('day-of-month', 'x');

    expect(seen).toEqual([]);
    screen.unmount();
  });

  it('still clamps a day the month has no room for', async () => {
    // February, and the clamp is deliberate: picking 31 should land on the
    // 28th rather than silently becoming the 3rd of March.
    const seen: number[] = [];
    const screen = await mount(
      <DayPick value={new Date(2026, 1, 5).getTime()} onChange={(next) => seen.push(next)} withYear />,
    );

    await screen.type('day-of-month', '31');

    expect(seen.map(dayOf)).toEqual([28]);
    screen.unmount();
  });
});
