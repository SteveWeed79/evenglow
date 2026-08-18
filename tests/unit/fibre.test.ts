import { describe, expect, it } from 'vitest';
import {
  libraryBreed,
  shearIntervalDays,
  shearingDues,
  urgencyOf,
  warningsFor,
  type Forecast,
} from '@steading/contracts';

/**
 * The clip, as a date.
 *
 * `fibreIntervalMonths` has been on the breed library since it was written —
 * eleven breeds carry it, and the Wiltshire Horn deliberately does not because
 * a hair sheep sheds its own coat. Nothing derived a row from any of it, so a
 * farm keeping fibre had a screen to record a clip and no reminder one was
 * owed. A builder with no reader is a feature that exists only in the test
 * suite, and this is the other half.
 */

const DAY = 86_400_000;
const NOW = Date.parse('2026-08-05T14:00:00Z');

const EWES = {
  id: 'group-ewes',
  name: 'The Ewes',
  species: 'sheep' as const,
  breedId: 'sheep-merino',
  purposes: ['fibre'],
  since: NOW - 400 * DAY,
};

describe('how often a fleece comes off', () => {
  it('reads the breed, not the species', () => {
    // Both sheep. A Merino is a twelve-month fleece; a Katahdin is a hair
    // sheep that sheds its own coat and is never shorn at all.
    expect(shearIntervalDays('sheep-merino')).toBe(365);
    expect(shearIntervalDays('sheep-katahdin')).toBeNull();
  });

  it('knows an Angora is twice a year and a llama every other', () => {
    expect(shearIntervalDays('goat-angora')).toBe(183);
    expect(shearIntervalDays('llama-classic')).toBe(731);
  });

  it('says nothing for a breed the farm never named', () => {
    expect(shearIntervalDays(undefined)).toBeNull();
    expect(shearIntervalDays('not-a-breed')).toBeNull();
  });

  /**
   * Guard on the two assertions above, which would both pass against a
   * misspelt id — the answer for "breed I have never heard of" and for "breed
   * that is never shorn" is the same null, and only this tells them apart.
   */
  it('is asking about breeds that exist', () => {
    for (const id of ['sheep-merino', 'sheep-katahdin', 'goat-angora', 'llama-classic']) {
      expect(libraryBreed(id), id).toBeDefined();
    }
  });
});

describe('the row', () => {
  it('falls one interval after the last clip', () => {
    const [due] = shearingDues({ ...EWES, lastShornAt: NOW - 100 * DAY }, NOW);

    expect(due?.kind).toBe('shearing');
    expect(due?.at).toBe(NOW - 100 * DAY + 365 * DAY);
  });

  /**
   * A clip cannot be honestly completed by one press: the greasy weight is the
   * entire point of the record, and a season's yield is what a fibre farm
   * keeps records FOR. A one-tap "Shorn" would clear the row that would have
   * asked for the number.
   */
  it('has no one-press done, because the weight is the point', () => {
    const [due] = shearingDues({ ...EWES, lastShornAt: NOW - 400 * DAY }, NOW);
    expect(due?.done).toBeUndefined();
  });

  /**
   * The Wiltshire Horn is the case the library was careful about, and a
   * default would have undone that care: a permanent unclearable row on a farm
   * that will never shear anything is how a list stops being read.
   */
  it('says nothing at all about a hair sheep', () => {
    expect(
      shearingDues({ ...EWES, breedId: 'sheep-katahdin', lastShornAt: NOW - 900 * DAY }, NOW),
    ).toHaveLength(0);
  });

  it('says nothing about a flock not kept for fibre', () => {
    expect(shearingDues({ ...EWES, purposes: ['meat'] }, NOW)).toHaveLength(0);
  });

  it('says nothing when the breed was never named', () => {
    expect(shearingDues({ ...EWES, breedId: undefined }, NOW)).toHaveLength(0);
  });

  /**
   * A farm has no way to say "shorn last April" except by back-dating a clip,
   * so a red row on the first morning would be scolding somebody for a job
   * that is genuinely not owed until spring.
   */
  it('gives a newly added group a month before it asks', () => {
    const [due] = shearingDues({ ...EWES, since: NOW }, NOW);
    expect(due?.at).toBe(NOW + 30 * DAY);
    expect(urgencyOf(due!, NOW)).not.toBe('overdue');
  });

  it('asks a long-standing group that has never recorded one', () => {
    const [due] = shearingDues({ ...EWES }, NOW);
    expect(urgencyOf(due!, NOW)).toBe('overdue');
  });

  /** Six weeks, because a shearer is booked and in spring they are booked out. */
  it('gives six weeks of notice', () => {
    const [due] = shearingDues({ ...EWES, lastShornAt: NOW - 365 * DAY + 30 * DAY }, NOW);
    expect(due?.noticeDays).toBe(42);
    expect(urgencyOf(due!, NOW)).toBe('soon');
  });
});

// ── rain landing on it ───────────────────────────────────────────────────────

const TODAY = new Date(NOW);
TODAY.setHours(0, 0, 0, 0);
const DAY_START = TODAY.getTime();

function forecast(rainChance: number): { forecast: Forecast; stale: boolean } {
  return {
    stale: false,
    forecast: {
      issuedAt: NOW,
      now: { condition: 'rain', tempDeciC: 150 },
      hours: [],
      days: [
        {
          day: DAY_START,
          condition: 'rain',
          highDeciC: 180,
          lowDeciC: 90,
          rainChance,
          rainUm: 4000,
        },
      ],
    },
  };
}

const FARM = {
  groups: [{ id: 'group-ewes', name: 'The Ewes', species: 'sheep' as const, count: 20 }],
  uncoveredPlantings: 0,
  births: [],
};

describe('a wet day landing on a clip', () => {
  /**
   * The sentence a farm cannot get from either half alone: the due list says a
   * fleece is owed, the forecast says it will rain, and holding both in your
   * head at 6am is the job this screen exists to take off somebody.
   */
  it('says so when a clip is owed and rain is coming', () => {
    const warnings = warningsFor(
      forecast(70),
      { ...FARM, shearings: [{ key: 'group-ewes:shearing', title: 'Shearing — The Ewes', at: NOW + 3 * DAY }] },
      NOW,
    );

    const wet = warnings.find((warning) => warning.kind === 'shearing-wet');
    expect(wet?.title).toContain('The Ewes');
    expect(wet?.detail).toContain('dry to the skin');
  });

  /**
   * A booking is not an emergency. Raising this to `act` would put it beside
   * "your alpacas are overheating" and teach a farm that the red rows are
   * sometimes about the diary.
   */
  it('is a watch, never an act', () => {
    const warnings = warningsFor(
      forecast(90),
      { ...FARM, shearings: [{ key: 'k', title: 'Shearing — The Ewes', at: NOW }] },
      NOW,
    );

    expect(warnings.find((w) => w.kind === 'shearing-wet')?.severity).toBe('watch');
  });

  it('stays quiet on a dry day', () => {
    const warnings = warningsFor(
      forecast(10),
      { ...FARM, shearings: [{ key: 'k', title: 'Shearing — The Ewes', at: NOW }] },
      NOW,
    );

    expect(warnings.some((w) => w.kind === 'shearing-wet')).toBe(false);
  });

  /**
   * **Three weeks out is already too far, and it used to speak.**
   *
   * The window was thirty days, argued for as a planning horizon — *"the
   * weather is against the week you were thinking of"*. But the only sentence
   * this rule can write is `and it is wet ${when}`, one named day, because a
   * `ForecastDay` is all it has. So a clip three weeks away was told its
   * shearing was in trouble over weather that will be long gone.
   *
   * Reported off the tablet, with *"Shearing — Woolies · in 3 weeks"* on the
   * same screen as the warning about tomorrow.
   */
  it('stays quiet about a clip beyond the forecast that feeds it', () => {
    const warnings = warningsFor(
      forecast(90),
      { ...FARM, shearings: [{ key: 'k', title: 'Shearing — Woolies', at: NOW + 21 * DAY }] },
      NOW,
    );

    expect(warnings.some((w) => w.kind === 'shearing-wet')).toBe(false);
  });

  /** And still speaks about the week you might actually shear in. */
  it('still says so about a clip inside the week', () => {
    const warnings = warningsFor(
      forecast(90),
      { ...FARM, shearings: [{ key: 'k', title: 'Shearing — Woolies', at: NOW + 5 * DAY }] },
      NOW,
    );

    expect(warnings.some((w) => w.kind === 'shearing-wet')).toBe(true);
  });

  /** A clip owed in March is not made urgent by tomorrow being wet. */
  it('stays quiet about a clip months away', () => {
    const warnings = warningsFor(
      forecast(90),
      { ...FARM, shearings: [{ key: 'k', title: 'Shearing — The Ewes', at: NOW + 200 * DAY }] },
      NOW,
    );

    expect(warnings.some((w) => w.kind === 'shearing-wet')).toBe(false);
  });

  it('stays quiet on a farm with no fibre at all', () => {
    const warnings = warningsFor(forecast(90), FARM, NOW);
    expect(warnings.some((w) => w.kind === 'shearing-wet')).toBe(false);
  });

  /**
   * The rule the whole warnings module runs on. A stale forecast raises
   * nothing, because a confident sentence about a week that has already
   * happened is worse than silence.
   */
  it('stays quiet on a stale forecast', () => {
    const warnings = warningsFor(
      { ...forecast(90), stale: true },
      { ...FARM, shearings: [{ key: 'k', title: 'Shearing — The Ewes', at: NOW }] },
      NOW,
    );

    expect(warnings).toHaveLength(0);
  });
});
