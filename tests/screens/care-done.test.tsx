import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@homefarm/contracts';
import { lastCareBySubject, listCareLogs } from '@homefarm/core/read/care';
import { enqueue } from '@homefarm/core/sync/queue';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { TodayScreen } from '../../apps/mobile/src/screens/TodayScreen';

/**
 * Marking a husbandry job done, and the lie that made it not work.
 *
 * Reported from a handset: *"I selected it done yesterday on the main screen.
 * It asked again today."*
 *
 * The button is a two-tap confirm, and that is deliberate — a `careLog` is
 * append-only, there is no undo, and a job recorded as done that was not done
 * is worse than one still on the list. The failure was not the confirm. It was
 * that the **armed state was indistinguishable from a finished one**: a brass
 * fill, a tick, and a past-tense label. Brass fill is what a selected chip and
 * the primary button look like in this app, and a past-tense verb reads as a
 * statement of fact rather than a question.
 *
 * So somebody tapped once, read "✓ Looked over" on a brass chip, and walked
 * away. Nothing was written, and the row came back the next morning — which is
 * the due engine working exactly as designed on a record that never existed.
 *
 * Every other confirm in this app says **"Tap again…"** (`Notes`, `Photos`,
 * `PlantingScreen`, `BreedingScreen`, `JobsScreen`). This one did not follow
 * the convention it had.
 */

const GROUP = newId();

/**
 * The parasite-check row.
 *
 * Chosen over the look-over because `health-check` is deliberately off by
 * default now — you see your animals daily and an app asking monthly for
 * confirmation is a chore it invented. Red mite is a real quarterly job that
 * looking at a bird does not cover, so this is the poultry row that remains.
 */
const MITE_CHECK = `due-done-${GROUP}:care:parasite-check`;

beforeEach(async () => {
  await freshStore();
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: { name: 'Chickens', species: 'chicken', count: 6, purposes: ['eggs'] },
  });
});

describe('the first tap', () => {
  it('writes nothing, because the confirm is real', async () => {
    const today = await mount(<TodayScreen />);
    await today.press(MITE_CHECK);
    today.unmount();

    expect(await listCareLogs()).toEqual([]);
  });

  /**
   * The whole defect in one assertion. After one tap the control must not say
   * anything that reads as "this is done" — otherwise the app has told
   * somebody a job is recorded when nothing has been written.
   */
  it('does not claim the job has been done', async () => {
    const today = await mount(<TodayScreen />);
    await today.press(MITE_CHECK);

    const said = today.text();
    expect(said).not.toContain('Checked for parasites');
    // It says what is still needed instead.
    expect(said).toContain('Tap again');
    today.unmount();
  });

  /** A screen reader still gets the specifics, which is where they belong. */
  it('names the record it is about to write, for anyone who cannot see it', async () => {
    const today = await mount(<TodayScreen />);
    await today.press(MITE_CHECK);

    expect(today.get(MITE_CHECK).props.accessibilityLabel).toContain('Checked for parasites');
    today.unmount();
  });
});

describe('the second tap', () => {
  it('writes the careLog the form would have written', async () => {
    const today = await mount(<TodayScreen />);
    await today.press(MITE_CHECK);
    await today.press(MITE_CHECK);
    today.unmount();

    const logs = await listCareLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ kind: 'parasite-check', flockId: GROUP });
    expect(logs[0]?.occurredAt).toBeGreaterThan(0);
  });

  /**
   * The row goes because the record now exists, not because anything was
   * ticked — due engine property 3. This is the assertion the farm's report
   * was really about.
   */
  it('clears the row, and it stays gone the next morning', async () => {
    const today = await mount(<TodayScreen />);
    await today.press(MITE_CHECK);
    await today.press(MITE_CHECK);
    today.unmount();

    const logs = await listCareLogs();
    expect(lastCareBySubject(logs).get(GROUP)?.['parasite-check']).toBeDefined();

    const tomorrow = await mount(<TodayScreen />);
    expect(tomorrow.has(MITE_CHECK)).toBe(false);
    expect(tomorrow.text()).not.toContain('Check for parasites — Chickens');
    tomorrow.unmount();
  });
});
