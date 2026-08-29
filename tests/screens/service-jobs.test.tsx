import { beforeEach, describe, expect, it } from 'vitest';
import { jobTitle, newId, taskCreateSchema, TASK_TITLE_MAX } from '@homefarm/contracts';
import { listServiceCompletions } from '@homefarm/core/read/completions';
import { listTasks } from '@homefarm/core/read/tasks';
import { enqueue } from '@homefarm/core/sync/queue';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { ServiceDoneScreen } from '../../apps/mobile/src/screens/ServiceDoneScreen';

/**
 * The walkaround check that could not become a job.
 *
 * `ServiceDoneScreen` raised one `task` per check that was not right, titled
 * `` `${line} — ${machine.name}` ``. A check is bounded at 80 characters and a
 * machine name at 80, against a task title cap of 120 — so the composition
 * could be refused where neither half would be.
 *
 * ## Why the refusal was worse than a refusal
 *
 * The screen enqueued one mutation at a time, and `enqueue` validates and
 * stores each in turn. So by the time the job was refused the
 * `serviceCompletion` was **already durable**. What the farm saw was a failure
 * message; what had actually happened was the service recorded and the job
 * dropped. Pressing again — the only thing a failure message invites — wrote a
 * **second completion**, and the hose that was weeping was never raised either
 * time.
 *
 * Both halves are fixed and both are asserted here: `jobTitle` composes within
 * the cap, and `enqueueAll` makes the completion and its jobs one unit (that
 * half's atomicity is proven in `tests/offline/restore-atomicity.test.ts`).
 */

const MACHINE = newId();
const SCHEDULE = newId();

/**
 * Both well within their own caps — a name may be 80 and a check may be 80 —
 * and neither is unusual for a farm that owns two of the same tractor and
 * writes checks the way a person actually describes a fault.
 */
const LONG_NAME = 'The big green tractor with the loader on the front and its cracked back window';
const LONG_CHECK =
  'Hydraulic hose behind the left rear wheel is weeping badly at the crimp on load';

async function aTractor(name: string, checks: string[]): Promise<void> {
  await enqueue({
    entity: 'equipment',
    op: 'create',
    targetId: MACHINE,
    payload: { name },
  });
  await enqueue({
    entity: 'maintenance',
    op: 'create',
    targetId: SCHEDULE,
    payload: { equipmentId: MACHINE, title: 'Oil and filter', intervalDays: 365, checks },
  });
}

beforeEach(async () => {
  await freshStore();
});

describe('composing a job title', () => {
  it('says both halves when both fit', () => {
    expect(jobTitle('Loose bolt', 'The tractor')).toBe('Loose bolt — The tractor');
  });

  /**
   * The finding first, the context trimmed. Which machine it was is also
   * carried exactly by the task's `subjectId` and said again in its note, so
   * the tail is the half that can afford to go.
   */
  it('keeps the finding and trims the context to fit', () => {
    // Neither half is refusable; the composition is 160 against a cap of 120.
    expect(LONG_CHECK.length).toBeLessThanOrEqual(80);
    expect(LONG_NAME.length).toBeLessThanOrEqual(80);
    expect(`${LONG_CHECK} — ${LONG_NAME}`.length).toBe(160);

    const title = jobTitle(LONG_CHECK, LONG_NAME);

    expect(title.length).toBe(TASK_TITLE_MAX);
    expect(title.startsWith(LONG_CHECK)).toBe(true);
    expect(title.endsWith('…')).toBe(true);
  });

  /**
   * The assertion that actually matters: whatever it composes, the schema
   * takes it. The cap counts UTF-16 code units, so a trim in any other unit
   * would be the same refusal wearing a different arithmetic.
   */
  it('composes something the schema accepts, emoji included', () => {
    for (const context of [LONG_NAME, `${'x'.repeat(36)}🚜`, '🚜'.repeat(60)]) {
      const title = jobTitle(LONG_CHECK, context);

      expect(title.length).toBeLessThanOrEqual(TASK_TITLE_MAX);
      expect(
        taskCreateSchema.safeParse({ title, recurrence: 'none' }).success,
        `${title.length} units`,
      ).toBe(true);
      // No UNPAIRED surrogate anywhere: strip every valid pair and nothing in
      // the surrogate range may be left. A lone half is neither a character
      // nor valid JSON.
      //
      // No `u` flag on the strip, deliberately — under `u` the pattern's two
      // halves are read as one code point, the replace matches nothing, and
      // the check passes an intact emoji off as a fault.
      expect(/[\uD800-\uDFFF]/.test(title.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ''))).toBe(
        false,
      );
    }
  });
});

describe('a check that is not right, on a machine with a long name', () => {
  /**
   * The failure itself. Before the fix this recorded the service, refused the
   * job, and showed the farm a message that made them press again.
   */
  it('records the service AND raises the job', async () => {
    await aTractor(LONG_NAME, [LONG_CHECK]);

    const screen = await mount(<ServiceDoneScreen {...routeProps({ serviceId: SCHEDULE })} />);
    await screen.pressLabel(LONG_CHECK);
    await screen.press('save-done');

    expect(await listServiceCompletions()).toHaveLength(1);

    const jobs = await listTasks();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.title.startsWith(LONG_CHECK)).toBe(true);
    expect((jobs[0]?.title ?? '').length).toBeLessThanOrEqual(TASK_TITLE_MAX);
    // Still tied to the machine exactly, which is what makes trimming the name
    // affordable.
    expect(jobs[0]?.subjectId).toBe(MACHINE);

    screen.unmount();
  });

  /** The ordinary case, unchanged — a short check on a short name. */
  it('leaves an ordinary title exactly as it reads', async () => {
    await aTractor('The tractor', ['Coolant level']);

    const screen = await mount(<ServiceDoneScreen {...routeProps({ serviceId: SCHEDULE })} />);
    await screen.pressLabel('Coolant level');
    await screen.press('save-done');

    const jobs = await listTasks();
    expect(jobs.map((job) => job.title)).toEqual(['Coolant level — The tractor']);

    screen.unmount();
  });

  /** Nothing ticked raises nothing, which is the ordinary morning. */
  it('raises no job when everything was fine', async () => {
    await aTractor('The tractor', ['Coolant level']);

    const screen = await mount(<ServiceDoneScreen {...routeProps({ serviceId: SCHEDULE })} />);
    await screen.press('save-done');

    expect(await listServiceCompletions()).toHaveLength(1);
    expect(await listTasks()).toEqual([]);

    screen.unmount();
  });
});
