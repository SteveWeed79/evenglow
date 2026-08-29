import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@homefarm/contracts';
import { localStore } from '@homefarm/core/db/store';
import { treatmentById, treatmentsFor } from '@homefarm/core/read/withdrawals';
import { enqueue } from '@homefarm/core/sync/queue';
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

/**
 * ── A course recorded after it finished ────────────────────────────────────
 *
 * `administeredAt` was stamped `Date.now()` on a create, and
 * `withdrawalWindow` counts from `Math.max(administeredAt, treatmentEndsAt)` —
 * so a course finished on Tuesday and recorded on Friday had the Tuesday the
 * person picked **thrown away**, and the withdrawal counted from Friday.
 *
 * It errs long, which is the safe direction and is why this was not worse than
 * it is. But it costs the farm days of sellable produce, and it writes an
 * administration date that never happened onto a record a vet, a buyer or an
 * inspector may read — `TreatmentsScreen` prints it as the day it was given and
 * the CSV exports it under *"Given"*.
 *
 * The screen asks for one date, so that is the answer for a course recorded
 * after the fact: it was administered on or before the last dose.
 */
describe('recording a course that is already over', () => {
  /** 1 January of this year — in the past on every day the suite can run. */
  const NEW_YEAR = new Date(new Date().getFullYear(), 0, 1).getTime();

  /** Fills the form for a finished course whose last dose was back in January. */
  async function recordBackdated() {
    const screen = await mount(<TreatmentScreen {...routeProps({ groupId: GROUP })} />);
    await screen.type('treatment-name', 'Baytril');
    // The toggle defaults to off — a finished course — so the date field is
    // already on screen and must not be toggled away.
    await screen.pressLabel('Jan');
    await screen.type('day-of-month', '1');
    // Seven days off the eggs.
    await screen.pressLabel('+7');
    await screen.press('save-treatment');
    return screen;
  }

  it('keeps the last dose the person picked as the day it was given', async () => {
    const screen = await recordBackdated();

    const [record] = await treatmentsFor(GROUP);
    expect(record?.administeredAt).toBe(NEW_YEAR);
    expect(record?.treatmentEndsAt).toBe(NEW_YEAR);
    screen.unmount();
  });

  /**
   * And the produce is not held from today. Seven days from a January dose has
   * long since cleared; seven days from *now* would hold eggs that are fine.
   */
  it('counts the withdrawal from the last dose, not from today', async () => {
    const screen = await recordBackdated();

    const [record] = await treatmentsFor(GROUP);
    expect(record?.holding).toEqual([]);
    screen.unmount();
  });

  /**
   * An open course still stamps today, and that is deliberate:
   * `withdrawalWindow` returns `open` and holds indefinitely, so nothing is
   * counted from the date. That the true first dose may be older is a field
   * this screen does not ask for, and inventing one is not this fix.
   */
  it('stamps today for a course that is still running', async () => {
    const before = Date.now();
    const screen = await mount(<TreatmentScreen {...routeProps({ groupId: GROUP })} />);
    await screen.type('treatment-name', 'Baytril');
    await screen.pressLabel('The course is still running');
    await screen.pressLabel('+7');
    await screen.press('save-treatment');

    const [record] = await treatmentsFor(GROUP);
    expect(record?.administeredAt).toBeGreaterThanOrEqual(before);
    expect(record?.running).toBe(true);
    // That an open course holds indefinitely is settled by its own test above;
    // the subject here is only the date. Which produce the `+7` lands on is
    // whichever of three identically labelled steppers `pressLabel` reaches.
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

describe('taking a field off a treatment', () => {
  /**
   * The divergence that made the wire change urgent, on the record where it
   * was most dangerous.
   *
   * `TreatmentScreen` named every optional field on an edit with `undefined`
   * where it was now absent — right on this handset and lost in transit,
   * because `JSON.stringify` drops the key and the server's `$set` then keeps
   * the old value. On a medicine record that is the wrong way round to be
   * wrong: the phone that revised a withdrawal down showed produce released
   * while the server and every other device went on holding it.
   */
  it('sends the clear as a null rather than dropping it in transit', async () => {
    const id = await aRunningCourse();

    const screen = await mount(
      <TreatmentScreen {...routeProps({ groupId: GROUP, treatmentId: id })} />,
    );

    await screen.type('treatment-reason', '');
    await screen.type('treatment-dose', '');
    await screen.press('save-treatment');
    screen.unmount();

    const outbox = await localStore().readOutboxBySeq();
    const edit = outbox.filter((m) => m.entity === 'medication' && m.op === 'update').pop();
    const onTheWire = JSON.parse(JSON.stringify(edit?.payload)) as Record<string, unknown>;

    expect(onTheWire).toHaveProperty('reason');
    expect(onTheWire.reason).toBeNull();
    expect(onTheWire.dose).toBeNull();
  });

  /** And the record on this device loses the field rather than holding a null. */
  it('leaves no null in the record it just edited', async () => {
    const id = await aRunningCourse();

    const screen = await mount(
      <TreatmentScreen {...routeProps({ groupId: GROUP, treatmentId: id })} />,
    );
    await screen.type('treatment-reason', 'Respiratory');
    await screen.press('save-treatment');
    screen.unmount();

    const withReason = await treatmentById(id);
    expect(withReason?.reason).toBe('Respiratory');

    const second = await mount(
      <TreatmentScreen {...routeProps({ groupId: GROUP, treatmentId: id })} />,
    );
    await second.type('treatment-reason', '');
    await second.press('save-treatment');
    second.unmount();

    const cleared = await treatmentById(id);
    expect(cleared?.reason).toBeUndefined();
  });
});
