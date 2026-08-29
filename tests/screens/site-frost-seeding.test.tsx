import { beforeEach, describe, expect, it } from 'vitest';
import { monthDay, newId, splitMonthDay } from '@homefarm/contracts';
import { enqueue } from '@homefarm/core/sync/queue';
import { localStore } from '@homefarm/core/db/store';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { SiteSetupScreen } from '../../apps/mobile/src/screens/SiteSetupScreen';

/**
 * Re-opening *Your ground* must not propose the app's defaults as the farm's
 * answer.
 *
 * The screen was written as a create form and then used as an edit form. Its
 * four date fields initialised to hardcoded constants — 15 May and 5 October —
 * and nothing ever told them what the farm had already said. So a keeper who
 * entered 20 April re-opened the screen, was shown 15 May, and saving wrote
 * that over the real date.
 *
 * **It is stamped `source: 'entered'`**, which is what makes this worse than a
 * bad default: everything downstream treats the value as the farmer's own
 * answer rather than as a guess it could refine. And frost dates are not one
 * feature's input — they drive every sow window, every transplant date, the
 * autumn count-back, chick brooding and the cold-birth warning. The wrong
 * number here is the wrong number in all of them, with nothing anywhere saying
 * a number changed.
 *
 * Nothing caught it because no test had ever opened this screen twice.
 */

const SITE = newId();

/** 20 April and 28 September — deliberately neither of the defaults. */
const LAST_SPRING = monthDay(4, 20);
const FIRST_AUTUMN = monthDay(9, 28);

async function aFarmThatAnswered(extra: Record<string, unknown> = {}): Promise<void> {
  await enqueue({
    entity: 'site',
    op: 'create',
    targetId: SITE,
    payload: {
      name: 'Hollow Farm',
      frost: { lastSpring: LAST_SPRING, firstAutumn: FIRST_AUTUMN, source: 'entered' },
      ...extra,
    },
  });
}

async function storedSite(): Promise<Record<string, unknown>> {
  const records = await localStore().readRecordsByEntity('site');
  const live = records.filter((r) => !r.deleted);
  expect(live).toHaveLength(1);
  return live[0]?.value as Record<string, unknown>;
}

beforeEach(async () => {
  await freshStore();
});

describe('a farm that has already given its frost dates', () => {
  /**
   * Read off the controls, not off the text.
   *
   * The month row renders all twelve labels in every state — selection is a
   * background colour and an `accessibilityState` — so this screen's flattened
   * text says "Jan Feb Mar…" whatever is chosen and can prove nothing. That is
   * a large part of why a screen proposing the wrong date to every farm went
   * unnoticed: there was nothing a text assertion could have caught.
   */
  it('is shown its own dates, not the defaults', async () => {
    await aFarmThatAnswered();
    const screen = await mount(<SiteSetupScreen />);

    expect(screen.get('frost-last-day').props.value).toBe('20');
    expect(screen.get('frost-first-day').props.value).toBe('28');

    screen.unmount();
  });

  /**
   * The defect itself, asserted on the record rather than on the screen.
   *
   * Opening and saving without touching a date is the exact gesture a keeper
   * makes when they came to set the zone, and it must be a no-op on the dates.
   */
  it('does not overwrite them when the screen is opened and saved untouched', async () => {
    await aFarmThatAnswered();
    const screen = await mount(<SiteSetupScreen />);

    await screen.press('save-site');

    const site = await storedSite();
    expect(site.frost).toEqual({
      lastSpring: LAST_SPRING,
      firstAutumn: FIRST_AUTUMN,
      source: 'entered',
    });

    screen.unmount();
  });

  /**
   * The name and the zone were never the casualty, and it is worth recording
   * why — it is the whole reason this defect was frost-shaped.
   *
   * An unseeded name falls back to `site.name` on save, and an unseeded zone is
   * an empty string, which the payload omits, which an update merges over
   * harmlessly. Both were protected by accident. The frost dates had neither
   * defence: they are always written, and they are written from whatever the
   * pickers happen to hold. Seeding them all is the fix; asserting the two that
   * were already safe is what stops a later change quietly removing the
   * accident that saved them.
   */
  it('keeps the zone through an untouched open and save', async () => {
    await aFarmThatAnswered({ zone: { system: 'usda', value: '6b' } });
    const screen = await mount(<SiteSetupScreen />);

    await screen.press('save-site');

    const site = await storedSite();
    expect(site.zone).toEqual({ system: 'usda', value: '6b' });
    expect(site.name).toBe('Hollow Farm');

    screen.unmount();
  });

  /**
   * ── The zone that could not be taken back out ────────────────────────────
   *
   * An emptied box omitted the key, and an omitted key **keeps its old value**
   * — that is the whole of `contracts/clearing.ts`. So a farm that had typed
   * the wrong zone could not correct it to "I do not know": the box emptied,
   * the save succeeded, and the old zone came back with every hardiness warning
   * it drives.
   *
   * `null` is the wire's word for cleared.
   */
  it('clears the zone when the box is emptied', async () => {
    await aFarmThatAnswered({ zone: { system: 'usda', value: '6b' } });
    const screen = await mount(<SiteSetupScreen />);

    await screen.type('site-zone', '');
    await screen.press('save-site');

    expect((await storedSite()).zone).toBeUndefined();
    screen.unmount();
  });

  /** And a zone that is merely changed is still changed, not cleared. */
  it('replaces a zone that is typed over', async () => {
    await aFarmThatAnswered({ zone: { system: 'usda', value: '6b' } });
    const screen = await mount(<SiteSetupScreen />);

    await screen.type('site-zone', '8a');
    await screen.press('save-site');

    expect((await storedSite()).zone).toEqual({ system: 'usda', value: '8a' });
    screen.unmount();
  });

  /**
   * A farm with a position and no frost dates is a real state — the weather
   * screen writes `lat`/`lon` onto this same entity — and it should meet the
   * suggestion rather than a blank. So the seeding is per-field, not one branch
   * on the record's existence.
   */
  it('still offers the defaults for a field the site does not carry', async () => {
    await enqueue({
      entity: 'site',
      op: 'create',
      targetId: SITE,
      payload: { name: 'Hollow Farm', lat: 44.51, lon: -109.06 },
    });
    const screen = await mount(<SiteSetupScreen />);

    expect(screen.text()).toContain('May');
    expect(screen.text()).toContain('Oct');

    screen.unmount();
  });
});

describe('a farm that has never answered', () => {
  it('is offered the defaults and creates rather than updates', async () => {
    const screen = await mount(<SiteSetupScreen />);

    expect(screen.text()).toContain('May');
    expect(screen.text()).toContain('Oct');

    await screen.press('save-site');

    const site = await storedSite();
    expect(site.frost).toEqual({
      lastSpring: monthDay(5, 15),
      firstAutumn: monthDay(10, 5),
      source: 'entered',
    });

    screen.unmount();
  });
});

describe('splitMonthDay', () => {
  /**
   * The inverse is tested here rather than only through the screen because the
   * screen's month picker is zero-indexed and the encoding is not, which is
   * exactly the seam a decoding written twice gets wrong.
   */
  it('is monthDay backwards, in the same 1-indexed months', () => {
    expect(splitMonthDay(monthDay(5, 15))).toEqual({ month: 5, day: 15 });
    expect(splitMonthDay(monthDay(1, 1))).toEqual({ month: 1, day: 1 });
    expect(splitMonthDay(monthDay(12, 31))).toEqual({ month: 12, day: 31 });
    expect(splitMonthDay(monthDay(2, 29))).toEqual({ month: 2, day: 29 });
  });
});
