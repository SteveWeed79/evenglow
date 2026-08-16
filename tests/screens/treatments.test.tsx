import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { localStore } from '@steading/core/db/store';
import { treatmentsFor } from '@steading/core/read/withdrawals';
import { enqueue } from '@steading/core/sync/queue';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { TreatmentScreen } from '../../apps/mobile/src/screens/TreatmentScreen';
import { TreatmentsScreen } from '../../apps/mobile/src/screens/TreatmentsScreen';

/**
 * Treatments could be recorded and never seen again.
 *
 * No list, no detail, no edit, no removal — the only trace was a withdrawal
 * banner naming a medication with no way to reach it. The reason it matters is
 * one field:
 *
 * A withdrawal is counted from the **last** day of treatment, and
 * `withdrawalClearsAt` takes `Math.max(administeredAt, treatmentEndsAt ?? 0)`
 * — so **a course logged as still running is counted from the first dose**. It
 * under-states the window by however long the course ran, which is to say it
 * clears produce early: the one direction this app says everywhere it must
 * never err in. And the record could not be reached to correct it.
 *
 * (The first version of this file asserted the opposite — that an open course
 * holds produce for ever. It does not, and the test below failed and said so.
 * Early is the dangerous direction and it is the one that was happening.)
 */

const GROUP = newId();
const DAY = 86_400_000;

async function theHens(): Promise<void> {
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: { name: 'The hens', species: 'chicken', count: 6, purposes: ['eggs'] },
  });
}

/** A course started a fortnight ago and never closed. */
async function aRunningCourse(): Promise<string> {
  const id = newId();
  await enqueue({
    entity: 'medication',
    op: 'create',
    targetId: id,
    payload: {
      flockId: GROUP,
      name: 'Baytril',
      administeredAt: Date.now() - 14 * DAY,
      route: 'water',
      withdrawalDays: { egg: 7 },
    },
  });
  return id;
}

beforeEach(async () => {
  await freshStore();
  await theHens();
});

describe('seeing what a group has had', () => {
  it('lists the treatments, newest first', async () => {
    await enqueue({
      entity: 'medication',
      op: 'create',
      targetId: newId(),
      payload: {
        flockId: GROUP,
        name: 'Ivermectin',
        administeredAt: Date.now() - 40 * DAY,
        treatmentEndsAt: Date.now() - 40 * DAY,
      },
    });
    await aRunningCourse();

    const listed = await treatmentsFor(GROUP);
    expect(listed.map((t) => t.name)).toEqual(['Baytril', 'Ivermectin']);
  });

  it('invites rather than showing an empty page', async () => {
    const screen = await mount(<TreatmentsScreen {...routeProps({ groupId: GROUP })} />);

    expect(screen.text()).toContain('Nothing recorded yet');
    // The way to record one is on the screen that says there are none.
    expect(screen.has('go-record-treatment')).toBe(true);
    screen.unmount();
  });

  /** The state a person has to act on leads the line. */
  it('says a course is still running rather than burying it behind a date', async () => {
    await aRunningCourse();
    const screen = await mount(<TreatmentsScreen {...routeProps({ groupId: GROUP })} />);

    expect(screen.text()).toContain('Baytril');
    expect(screen.text()).toContain('Still running');
    screen.unmount();
  });

  it('says which produce a closed course is still holding', async () => {
    await enqueue({
      entity: 'medication',
      op: 'create',
      targetId: newId(),
      payload: {
        flockId: GROUP,
        name: 'Baytril',
        administeredAt: Date.now() - 2 * DAY,
        treatmentEndsAt: Date.now() - 2 * DAY,
        withdrawalDays: { egg: 7 },
      },
    });

    const screen = await mount(<TreatmentsScreen {...routeProps({ groupId: GROUP })} />);
    expect(screen.text()).toContain('still holding eggs');
    screen.unmount();
  });
});

describe('correcting one', () => {
  it('opens with the record already in the form', async () => {
    const id = await aRunningCourse();
    const screen = await mount(
      <TreatmentScreen {...routeProps({ groupId: GROUP, treatmentId: id })} />,
    );

    expect(screen.shows('treatment-name')).toBe('Baytril');
    // Editing, not recording — the button says which.
    expect(screen.labels()).toContain('Save the change');
    screen.unmount();
  });

  /**
   * The whole reason this screen exists, and it moves the date the right way.
   *
   * A course started four days ago with a seven-day egg withdrawal reads as
   * clearing on day seven while it is open — counted from the first dose. It
   * is still running, so the true last day is today and the true clear date is
   * seven days from now. Closing it moves the date OUT by the four days the
   * course has been running, which is the difference between selling eggs
   * legally and not.
   */
  it('closing a running course extends the withdrawal to the honest date', async () => {
    const id = newId();
    const started = Date.now() - 4 * DAY;
    await enqueue({
      entity: 'medication',
      op: 'create',
      targetId: id,
      payload: {
        flockId: GROUP,
        name: 'Baytril',
        administeredAt: started,
        route: 'water',
        withdrawalDays: { egg: 7 },
      },
    });

    const [before] = await treatmentsFor(GROUP);
    expect(before?.running).toBe(true);
    expect(before?.treatmentEndsAt).toBeUndefined();

    const screen = await mount(
      <TreatmentScreen {...routeProps({ groupId: GROUP, treatmentId: id })} />,
    );
    await screen.pressLabel('The course is still running');
    await screen.press('save-treatment');

    const [after] = await treatmentsFor(GROUP);
    expect(after?.running).toBe(false);
    // Dated today, not backdated to the first dose — so the clock now runs
    // from the real end of the course.
    expect(after?.treatmentEndsAt).toBeGreaterThan(started);
    expect(after?.holding).toEqual(['egg']);
    screen.unmount();
  });

  /**
   * The under-count itself — **fixed, and this test is the record of it.**
   *
   * It used to read the other way: *"an open course is not held for ever, it
   * is cleared four days early"*, asserting that a course started eight days
   * ago with a seven-day withdrawal reported nothing held while the bird was
   * still being dosed. That was a true description of the code and a wrong
   * description of the produce, and writing it down as expected behaviour is
   * how it survived being known about.
   *
   * An open course now holds indefinitely: there is no last dose, so there is
   * nothing to count from, and the honest answer to "are these eggs clear" is
   * no. Closing the course is what starts the clock.
   */
  it('an open course holds until somebody records the last dose', async () => {
    const id = newId();
    await enqueue({
      entity: 'medication',
      op: 'create',
      targetId: id,
      // Started eight days ago, seven-day egg withdrawal, still running.
      payload: {
        flockId: GROUP,
        name: 'Baytril',
        administeredAt: Date.now() - 8 * DAY,
        withdrawalDays: { egg: 7 },
      },
    });

    // Eight days in, past a seven-day withdrawal, and still held — because the
    // course has not ended. This is the assertion that was inverted.
    expect((await treatmentsFor(GROUP))[0]?.holding).toEqual(['egg']);

    const screen = await mount(
      <TreatmentScreen {...routeProps({ groupId: GROUP, treatmentId: id })} />,
    );
    await screen.pressLabel('The course is still running');
    await screen.press('save-treatment');

    // Closed today, so the clock starts now: still held, and now with a date.
    expect((await treatmentsFor(GROUP))[0]?.holding).toEqual(['egg']);
    screen.unmount();
  });

  /**
   * `administeredAt` is what every withdrawal counts from. Re-stamping it on a
   * correction would move the clock, which is the whole compliance question.
   */
  it('never re-dates the day it was given', async () => {
    const id = await aRunningCourse();
    const [before] = await treatmentsFor(GROUP);

    const screen = await mount(
      <TreatmentScreen {...routeProps({ groupId: GROUP, treatmentId: id })} />,
    );
    await screen.type('treatment-name', 'Baytril 10%');
    await screen.press('save-treatment');

    const [after] = await treatmentsFor(GROUP);
    expect(after?.name).toBe('Baytril 10%');
    expect(after?.administeredAt).toBe(before?.administeredAt);
    screen.unmount();
  });

  it('sends an update rather than a second record', async () => {
    const id = await aRunningCourse();
    const screen = await mount(
      <TreatmentScreen {...routeProps({ groupId: GROUP, treatmentId: id })} />,
    );
    await screen.type('treatment-name', 'Baytril 10%');
    await screen.press('save-treatment');

    const queued = await localStore().readOutboxBySeq();
    const edit = queued.find((m) => m.entity === 'medication' && m.op === 'update');

    expect(edit?.targetId).toBe(id);
    // One treatment on the group, not two.
    expect(await treatmentsFor(GROUP)).toHaveLength(1);
    screen.unmount();
  });

  it('offers no removal when recording a new one', async () => {
    const screen = await mount(<TreatmentScreen {...routeProps({ groupId: GROUP })} />);

    expect(screen.has('remove-treatment')).toBe(false);
    expect(screen.labels()).toContain('Record it');
    screen.unmount();
  });
});

describe('taking one back', () => {
  it('removes the treatment and lifts the withdrawal it was holding', async () => {
    const id = newId();
    await enqueue({
      entity: 'medication',
      op: 'create',
      targetId: id,
      payload: {
        flockId: GROUP,
        name: 'Baytril',
        administeredAt: Date.now(),
        treatmentEndsAt: Date.now(),
        withdrawalDays: { egg: 7 },
      },
    });
    expect((await treatmentsFor(GROUP))[0]?.holding).toEqual(['egg']);

    const screen = await mount(
      <TreatmentScreen {...routeProps({ groupId: GROUP, treatmentId: id })} />,
    );
    await screen.press('remove-treatment');
    await screen.press('remove-treatment');

    // Gone from the list, and holding nothing.
    expect(await treatmentsFor(GROUP)).toHaveLength(0);
    screen.unmount();
  });

  /** Archived, never deleted (P13) — so it goes to the server as a delete. */
  it('queues the removal rather than only forgetting it locally', async () => {
    const id = await aRunningCourse();
    const screen = await mount(
      <TreatmentScreen {...routeProps({ groupId: GROUP, treatmentId: id })} />,
    );
    await screen.press('remove-treatment');
    await screen.press('remove-treatment');

    const queued = await localStore().readOutboxBySeq();
    const removal = queued.find((m) => m.entity === 'medication' && m.op === 'delete');

    expect(removal?.targetId).toBe(id);
    screen.unmount();
  });
});
