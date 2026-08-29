import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@homefarm/contracts';
import { localStore } from '@homefarm/core/db/store';
import { intoDays, listHistory } from '@homefarm/core/read/history';
import { enqueue } from '@homefarm/core/sync/queue';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { ExportScreen } from '../../apps/mobile/src/screens/ExportScreen';
import { HistoryScreen } from '../../apps/mobile/src/screens/HistoryScreen';
import { files, shared } from '../support/native/modules';

/**
 * "We need a history tab. Or somewhere that old data is visible for the user
 * in a nice easy format WITH a detailed option available."
 *
 * The records were write-only. Everything went in and the only way back out
 * was whichever screen happened to summarise it — today's tally, this group's
 * last feed. "What did we do last Tuesday" had no answer at all.
 */

const GROUP = newId();
const DAY = 86_400_000;

/** A fixed hour, so a test near midnight cannot land two days apart. */
function at(daysAgo: number, hour: number): number {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date.getTime() - daysAgo * DAY;
}

async function theHens(): Promise<void> {
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: { name: 'The hens', species: 'chicken', count: 6, purposes: ['eggs'] },
  });
}

beforeEach(async () => {
  await freshStore();
});

describe('a day reads as one line', () => {
  it('adds up what adds up and counts what does not', async () => {
    await theHens();
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: at(0, 8), flockId: GROUP, count: 7 },
    });
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: at(0, 17), flockId: GROUP, count: 5 },
    });
    await enqueue({
      entity: 'feedLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: at(0, 8), flockId: GROUP, amountGrams: 900 },
    });
    await enqueue({
      entity: 'feedLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: at(0, 17), flockId: GROUP, amountGrams: 900 },
    });

    const [today] = await listHistory();

    // Twelve eggs, because two tallies of one thing are one number. Two feeds,
    // because a feed is an occurrence and 1800 g would answer nobody.
    expect(today?.summary).toContain('12 eggs');
    expect(today?.summary).toContain('2 feeds');
  });

  /** A day of things that decline to tally still happened. */
  it('says how many when nothing in it adds up', async () => {
    await theHens();
    await enqueue({
      entity: 'predator',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: at(1, 22), species: 'Fox', lossCount: 0 },
    });

    const days = await listHistory();
    expect(days[0]?.summary).toBe('1 record');
  });
});

describe('the order', () => {
  it('is newest day first, newest record first inside it', async () => {
    await theHens();
    for (const [daysAgo, hour, count] of [
      [2, 9, 1],
      [0, 9, 2],
      [0, 18, 3],
    ] as const) {
      await enqueue({
        entity: 'eggLog',
        op: 'create',
        targetId: newId(),
        payload: { occurredAt: at(daysAgo, hour), flockId: GROUP, count },
      });
    }

    const days = await listHistory();

    expect(days).toHaveLength(2);
    expect(days[0]!.day).toBeGreaterThan(days[1]!.day);
    // 3 eggs at 18:00 before 2 eggs at 09:00.
    expect(days[0]!.events[0]?.title).toContain('3 eggs');
    expect(days[0]!.events[1]?.title).toContain('2 eggs');
  });

  /**
   * `occurredAt`, not when it synced and not `clientTs` — invariant 4 says
   * never trust that one. Backdating a feed you forgot to log is an ordinary
   * thing to do, and a history sorted by arrival would file it under today and
   * be wrong about the only thing it is for.
   */
  it('files a backdated record under the day it happened', async () => {
    await theHens();
    await enqueue({
      entity: 'feedLog',
      op: 'create',
      targetId: newId(),
      // Enqueued now, said to have happened three days ago.
      payload: { occurredAt: at(3, 7), flockId: GROUP, amountGrams: 900 },
    });

    const days = await listHistory();

    expect(days).toHaveLength(1);
    expect(days[0]!.day).toBeLessThan(Date.now() - 2 * DAY);
  });
});

describe('what is in it', () => {
  it('names the group rather than showing an id', async () => {
    await theHens();
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: at(0, 8), flockId: GROUP, count: 6 },
    });

    const days = await listHistory();
    expect(days[0]!.events[0]?.title).toBe('6 eggs — The hens');
  });

  /**
   * Invariant 13 reaching the read layer: hiding a group must not silently
   * rewrite what happened while it was here.
   */
  it('keeps the records of a group that has been archived', async () => {
    await theHens();
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: at(0, 8), flockId: GROUP, count: 6 },
    });
    await enqueue({ entity: 'flock', op: 'delete', targetId: GROUP, payload: {} });

    const days = await listHistory();

    expect(days[0]!.events).toHaveLength(1);
    expect(days[0]!.events[0]?.title).toContain('6 eggs');
  });

  /**
   * Mutable entities are not events. A flock is not something that happened,
   * it is something that is — and a history filling up with "you changed the
   * head count" would bury the morning somebody lost four birds.
   */
  it('leaves out the things that are not events', async () => {
    await theHens();

    // A group and nothing logged against it.
    expect(await listHistory()).toEqual([]);
  });

  it('carries the detail a day only wants once it is open', async () => {
    await theHens();
    await enqueue({
      entity: 'mortality',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: at(0, 12), flockId: GROUP, count: 2, cause: 'predator' },
    });

    const days = await listHistory();
    expect(days[0]!.events[0]?.title).toBe('Lost 2 — The hens');
    expect(days[0]!.events[0]?.detail).toContain('predator');
  });
});

describe('the summarising itself', () => {
  /** Driven directly, because it is arithmetic rather than a store question. */
  it('holds its order as records arrive', () => {
    const [day] = intoDays([
      { id: 'a', entity: 'eggLog', at: 1, title: 'a', removable: true, tally: { key: 'eggs', amount: 1, unit: 'egg' } },
      { id: 'b', entity: 'feedLog', at: 2, title: 'b', removable: true, tally: { key: 'feeds', amount: 1, unit: 'feed' } },
      { id: 'c', entity: 'eggLog', at: 3, title: 'c', removable: true, tally: { key: 'eggs', amount: 5, unit: 'egg' } },
    ]);

    // Eggs first because eggs appeared first — a day that reorders itself
    // between renders looks, on a phone, exactly like something changed.
    expect(day?.summary).toBe('6 eggs · 1 feed');
  });

  it('says one egg, not 1 eggs', () => {
    const [day] = intoDays([
      { id: 'a', entity: 'eggLog', at: 1, title: 'a', removable: true, tally: { key: 'eggs', amount: 1, unit: 'egg' } },
    ]);
    expect(day?.summary).toBe('1 egg');
  });

  /**
   * And two losses, not "2 losss".
   *
   * `HistoryDay.summary`'s own doc gives the intended line — *"12 eggs · 2
   * feeds · 1 loss"* — and a single loss is why it went unnoticed: at one the
   * word is right, and one is the commonest number of animals to lose in a day.
   * A fox in the run is the day this line is read on, and it is the day it read
   * wrong.
   */
  it('says two losses, not 2 losss', () => {
    const [day] = intoDays([
      { id: 'a', entity: 'mortality', at: 1, title: 'a', removable: true, tally: { key: 'losses', amount: 2, unit: 'loss' } },
    ]);
    expect(day?.summary).toBe('2 losses');
  });

  it('still says one loss at one', () => {
    const [day] = intoDays([
      { id: 'a', entity: 'mortality', at: 1, title: 'a', removable: true, tally: { key: 'losses', amount: 1, unit: 'loss' } },
    ]);
    expect(day?.summary).toBe('1 loss');
  });

  /**
   * The rule the default now knows, and the limit of it. A word ending in a
   * sibilant takes `-es`; everything irregular passes its own plural, as the
   * harvest row does for "bunches". A calf is not a calfs.
   */
  it('adds -es after a sibilant and -s otherwise', () => {
    const summary = (unit: string, amount: number): string | undefined =>
      intoDays([
        { id: 'a', entity: 'eggLog', at: 1, title: 'a', removable: true, tally: { key: 'k', amount, unit } },
      ])[0]?.summary;

    expect(summary('bunch', 3)).toBe('3 bunches');
    expect(summary('box', 3)).toBe('3 boxes');
    expect(summary('feed', 3)).toBe('3 feeds');
    expect(summary('job', 3)).toBe('3 jobs');
  });
});

describe('the screen', () => {
  it('opens the newest day so it says something without a tap', async () => {
    await theHens();
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: at(0, 8), flockId: GROUP, count: 6 },
    });
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: at(4, 8), flockId: GROUP, count: 4 },
    });

    const screen = await mount(<HistoryScreen />);

    // Today's rows are showing; the older day is a closed summary.
    expect(screen.text()).toContain('6 eggs — The hens');
    expect(screen.text()).toContain('4 eggs');
    expect(screen.text()).not.toContain('4 eggs — The hens');
    screen.unmount();
  });

  it('invites rather than showing an empty page', async () => {
    const screen = await mount(<HistoryScreen />);

    expect(screen.text()).toContain('Nothing logged yet');
    screen.unmount();
  });
});

/**
 * "how do users remove produce (eggs/milk/etc) placed in the wrong group. Not
 * just eggs mind you" — and then, on the exception this nearly shipped with:
 * *"i feel like a system that doesn't understand that accidents/mistypes
 * happen with counts of any kind is incorrect for this type of application."*
 *
 * Both are right. Counts are typed one-handed, in the dark, wearing gloves.
 * This is the only screen that shows an individual record, so it is the only
 * place a person can point at the wrong one — everywhere else shows the total
 * it landed in.
 */
describe('taking one back', () => {
  const wrong = newId();

  async function twoTallies(): Promise<void> {
    await theHens();
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: at(0, 8), flockId: GROUP, count: 7 },
    });
    // The one that went against the wrong group.
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: wrong,
      payload: { occurredAt: at(0, 17), flockId: GROUP, count: 5 },
    });
  }

  it('takes two taps, and the row is not one of them', async () => {
    await twoTallies();
    const screen = await mount(<HistoryScreen />);

    // A list where one tap destroys a record is a list nobody scrolls with
    // gloves on. Opening the row offers; it does not act.
    expect(screen.has(`event-remove-${wrong}`)).toBe(false);
    await screen.press(`event-${wrong}`);
    expect(screen.has(`event-remove-${wrong}`)).toBe(true);

    // Armed, not fired.
    await screen.press(`event-remove-${wrong}`);
    expect(screen.text()).toContain('5 eggs');
    expect((await listHistory())[0]?.events).toHaveLength(2);

    screen.unmount();
  });

  it('removes the record and re-adds the day without it', async () => {
    await twoTallies();
    const screen = await mount(<HistoryScreen />);

    const [before] = await listHistory();
    expect(before?.summary).toContain('12 eggs');

    await screen.press(`event-${wrong}`);
    await screen.press(`event-remove-${wrong}`);
    await screen.press(`event-remove-${wrong}`);

    // The row is gone from the screen and the readout above it re-added.
    expect(screen.text()).not.toContain('5 eggs');
    expect(screen.text()).toContain('7 eggs');

    const [after] = await listHistory();
    expect(after?.events).toHaveLength(1);
    expect(after?.summary).toContain('7 eggs');
    expect(after?.summary).not.toContain('12 eggs');

    screen.unmount();
  });

  /**
   * The record is archived, never deleted (P13) — so what actually goes out is
   * a `delete` mutation the server will apply, not a row vanishing from the
   * device with nothing to say for itself.
   */
  it('queues the removal for the server rather than only forgetting locally', async () => {
    await twoTallies();
    const screen = await mount(<HistoryScreen />);

    await screen.press(`event-${wrong}`);
    await screen.press(`event-remove-${wrong}`);
    await screen.press(`event-remove-${wrong}`);

    const queued = await localStore().readOutboxBySeq();
    const removal = queued.find((mutation) => mutation.op === 'delete');

    expect(removal).toBeDefined();
    expect(removal?.entity).toBe('eggLog');
    expect(removal?.targetId).toBe(wrong);

    screen.unmount();
  });

  /**
   * Not just eggs. Every append-only record a person can enter, they can take
   * back — including the hour meter, whose own monotonic rule makes a typo
   * uncorrectable by any other route (see `tests/unit/projections.test.ts`).
   */
  it('works on produce, feed, weights and the hour meter alike', async () => {
    await theHens();
    const machine = newId();
    await enqueue({
      entity: 'equipment',
      op: 'create',
      targetId: machine,
      payload: { name: 'The tractor' },
    });

    const ids = {
      productionLog: newId(),
      feedLog: newId(),
      weight: newId(),
      hourReading: newId(),
    };

    await enqueue({
      entity: 'productionLog',
      op: 'create',
      targetId: ids.productionLog,
      payload: { occurredAt: at(0, 6), flockId: GROUP, kind: 'milk', amount: 4000, unit: 'ml' },
    });
    await enqueue({
      entity: 'feedLog',
      op: 'create',
      targetId: ids.feedLog,
      payload: { occurredAt: at(0, 7), flockId: GROUP, amountGrams: 900 },
    });
    await enqueue({
      entity: 'weight',
      op: 'create',
      targetId: ids.weight,
      payload: { occurredAt: at(0, 8), flockId: GROUP, massUg: 2_000_000_000 },
    });
    await enqueue({
      entity: 'hourReading',
      op: 'create',
      targetId: ids.hourReading,
      // The fat-fingered one. Left alone, every true reading afterwards is
      // below it and the machine can never be logged again.
      payload: { occurredAt: at(0, 9), equipmentId: machine, hours: 9999 },
    });

    const screen = await mount(<HistoryScreen />);
    expect((await listHistory())[0]?.events).toHaveLength(4);

    for (const id of Object.values(ids)) {
      await screen.press(`event-${id}`);
      await screen.press(`event-remove-${id}`);
      await screen.press(`event-remove-${id}`);
    }

    expect(await listHistory()).toHaveLength(0);
    screen.unmount();
  });
});

/**
 * ── The tap that archived a recurring schedule ─────────────────────────────
 *
 * `Timeline`'s take-back enqueues a `delete` against `event.id` and
 * `event.entity`, on the stated premise that *"every entity a history row can
 * be built from is append-only"*. Three builders make a row out of a **field**
 * on a mutable record — `task.completedAt`, `maintenance.lastDoneAtDate`,
 * `incubation.hatchedAt` — so `event.id` is the parent record's own id.
 *
 * On a service row that meant one tap archived the whole recurring oil-change
 * schedule, silently, from a control captioned *"Logged in error?"*. The
 * `incubation` builder had already written the reason down while explaining why
 * its own case was the exception: *"a `maintenance` row is one service and
 * archiving it takes the whole recurring schedule."*
 *
 * These rows are the legacy path — a farm's records written before completions
 * were events — so they are built here the way such a farm holds them: the
 * field on the schedule, and no `serviceCompletion` beside it.
 */
describe('a history row that is not a record of its own', () => {
  const MACHINE = newId();
  const OIL = newId();
  const CHORE = newId();

  async function theOldRecords(): Promise<void> {
    await enqueue({
      entity: 'equipment',
      op: 'create',
      targetId: MACHINE,
      payload: { name: 'The tractor', make: 'Kubota', hasHourMeter: true },
    });
    // A schedule carrying its completion as a field, which is how every record
    // written before `serviceCompletion` existed still looks.
    await enqueue({
      entity: 'maintenance',
      op: 'create',
      targetId: OIL,
      payload: {
        equipmentId: MACHINE,
        title: 'Oil and filter',
        intervalHours: 200,
        lastDoneAtDate: at(1, 10),
      },
    });
    await enqueue({
      entity: 'task',
      op: 'create',
      targetId: CHORE,
      payload: { title: 'Sharpen the shears', completedAt: at(1, 11) },
    });
  }

  /** They are still history — nothing here removes the row from the day. */
  it('still shows the service and the job', async () => {
    await theOldRecords();

    const titles = (await listHistory()).flatMap((day) => day.events.map((e) => e.title));

    expect(titles.some((t) => t.includes('Oil and filter'))).toBe(true);
    expect(titles).toContain('Sharpen the shears');
  });

  /** The whole finding: the control is not there to be tapped. */
  it('offers no take-back on either of them', async () => {
    await theOldRecords();

    const screen = await mount(<HistoryScreen />);
    for (const id of [OIL, CHORE]) {
      await screen.press(`event-${id}`);
      expect(screen.has(`event-remove-${id}`), id).toBe(false);
    }

    expect(screen.text()).toContain('not a record of its own');
    screen.unmount();
  });

  /** And the schedule is still there, which is what was actually at stake. */
  it('leaves the schedule where it was', async () => {
    await theOldRecords();

    const screen = await mount(<HistoryScreen />);
    await screen.press(`event-${OIL}`);
    screen.unmount();

    const services = await localStore().readRecordsByEntity('maintenance');
    expect(services.filter((r) => !r.deleted)).toHaveLength(1);
  });

  /**
   * **The exception, and it is documented rather than incidental.** A set of
   * eggs and its hatch are the same thing — one set, one hatch — so taking the
   * row back out removes precisely what it describes.
   */
  it('still offers a take-back on a hatch, which is its own record', async () => {
    const set = newId();
    await enqueue({
      entity: 'incubation',
      op: 'create',
      targetId: set,
      payload: {
        label: 'The March set',
        species: 'chicken',
        setAt: at(30, 8),
        eggsSet: 12,
        source: 'own',
        method: 'incubator',
        hatchedAt: at(1, 9),
        hatched: 8,
      },
    });

    const screen = await mount(<HistoryScreen />);
    await screen.press(`event-${set}`);

    expect(screen.has(`event-remove-${set}`)).toBe(true);
    screen.unmount();
  });

  /**
   * A row built from a real completion event IS removable — the newer path,
   * where the record and the row are the same thing. Asserted so the fix reads
   * as "which rows", not "service rows are special".
   */
  it('offers a take-back on a completion event', async () => {
    await theOldRecords();

    const done = newId();
    await enqueue({
      entity: 'serviceCompletion',
      op: 'create',
      targetId: done,
      payload: { serviceId: OIL, completedAt: at(0, 10), atHours: 1240 },
    });

    const screen = await mount(<HistoryScreen />);
    await screen.press(`event-${done}`);

    expect(screen.has(`event-remove-${done}`)).toBe(true);
    screen.unmount();
  });
});

/**
 * ── A birth, which was in no timeline at all ───────────────────────────────
 *
 * `history.ts` had no `breeding` builder, so a kidding, a lambing or a calving
 * produced **no row anywhere** — while `incubation.hatchedAt`, the poultry
 * equivalent, has had one all along. `AnimalScreen` renders "What happened to
 * her" over a timeline her giving birth was not in.
 */
describe('a birth on the breeding record', () => {
  const DAM = newId();

  async function theDam(): Promise<void> {
    await enqueue({
      entity: 'animal',
      op: 'create',
      targetId: DAM,
      payload: { flockId: GROUP, name: 'Nutmeg', species: 'goat', sex: 'female' },
    });
  }

  async function bred(over: Record<string, unknown> = {}): Promise<string> {
    const id = newId();
    await enqueue({
      entity: 'breeding',
      op: 'create',
      targetId: id,
      payload: {
        species: 'goat',
        damId: DAM,
        bredAt: at(150, 9),
        method: 'natural',
        ...over,
      },
    });
    return id;
  }

  it('says who gave birth, and what came of it', async () => {
    await theDam();
    await bred({ bornAt: at(1, 6), liveBorn: 2, stillborn: 1 });

    const [day] = await listHistory();
    const born = day?.events.find((event) => event.entity === 'breeding');

    expect(born?.title).toBe('Nutmeg gave birth');
    expect(born?.detail).toBe('2 live births · 1 stillborn');
  });

  /** It belongs to her AND to the group she is in — the mortality reasoning. */
  it('reaches the dam and her group', async () => {
    await theDam();
    await bred({ bornAt: at(1, 6), liveBorn: 2 });

    const [day] = await listHistory();
    const born = day?.events.find((event) => event.entity === 'breeding');

    expect(born?.subjects).toContain(DAM);
    expect(born?.subjects).toContain(GROUP);
  });

  /** A mating with no birth yet is not an event; it is a record in progress. */
  it('says nothing until there is a birth', async () => {
    await theDam();
    await bred();

    const days = await listHistory();
    expect(days.flatMap((day) => day.events).some((e) => e.entity === 'breeding')).toBe(false);
  });

  it('says so plainly when the litter was lost', async () => {
    await theDam();
    await bred({ bornAt: at(1, 6), lost: true });

    const [day] = await listHistory();
    const born = day?.events.find((event) => event.entity === 'breeding');

    expect(born?.detail).toBe('The whole litter was lost.');
  });

  /**
   * **Not removable, and this is the M9 rule earning its keep.** `breeding` is
   * mutable and this row is a FIELD on it, so a take-back would archive the
   * mating along with the birth — the `maintenance` case, not the `incubation`
   * one where the record and the event are the same thing. A builder added
   * later is silent until somebody says otherwise, which is exactly what
   * happened here without a line being written for it.
   */
  it('offers no take-back, because the record is the mating', async () => {
    await theDam();
    const breeding = await bred({ bornAt: at(1, 6), liveBorn: 2 });

    const screen = await mount(<HistoryScreen />);
    await screen.press(`event-${breeding}`);

    expect(screen.has(`event-remove-${breeding}`)).toBe(false);
    screen.unmount();
  });
});

/**
 * The share itself.
 *
 * The CSV is settled by `tests/unit/export.test.ts`; what is left is the part
 * that suite cannot see — that a file is written, that what reaches it is what
 * the builder produced, and that something is actually offered to the OS
 * rather than the screen quietly succeeding.
 */
describe('sending records out', () => {
  beforeEach(() => {
    files.clear();
    shared.length = 0;
  });

  it('writes the CSV and offers the file, not the text', async () => {
    await theHens();
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: at(0, 8), flockId: GROUP, count: 6 },
    });

    const screen = await mount(<ExportScreen />);
    await screen.press('export-eggs');
    screen.unmount();

    expect(shared).toHaveLength(1);
    const written = files.get(shared[0]!);
    expect(written).toContain('The hens');
    expect(written).toContain('6');
  });

  /** It has to say what it is from the outside of an inbox. */
  it('names the file for the record and the day', async () => {
    await theHens();
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: at(0, 8), flockId: GROUP, count: 6 },
    });

    const screen = await mount(<ExportScreen />);
    await screen.press('export-eggs');
    screen.unmount();

    expect(shared[0]).toMatch(/homefarm-eggs-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  /**
   * The promise on the screen: sending changes nothing on this device. It is
   * the sentence that makes the feature safe to press, so it is worth a test
   * rather than trust.
   */
  it('leaves every record exactly where it was', async () => {
    await theHens();
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: at(0, 8), flockId: GROUP, count: 6 },
    });

    const screen = await mount(<ExportScreen />);
    await screen.press('export-eggs');
    screen.unmount();

    const days = await listHistory();
    expect(days[0]?.events).toHaveLength(1);
  });

  it('offers only the kinds of record the farm has', async () => {
    await theHens();
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: at(0, 8), flockId: GROUP, count: 6 },
    });

    const screen = await mount(<ExportScreen />);

    expect(screen.has('export-eggs')).toBe(true);
    // No harvests on this farm, so no empty harvests file to be puzzled by.
    expect(screen.has('export-harvests')).toBe(false);
    screen.unmount();
  });

  it('invites rather than showing an empty page', async () => {
    const screen = await mount(<ExportScreen />);
    expect(screen.text()).toContain('Nothing to send yet');
    screen.unmount();
  });
});
