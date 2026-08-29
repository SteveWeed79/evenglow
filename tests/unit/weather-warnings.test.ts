import { describe, expect, it } from 'vitest';
import {
  type Alert,
  liveAlerts,
  withoutSupersededWatches,
  hazardsCoveredByAlerts,
  alertCoverage,
  camelidHeatIndex,
  dayStart,
  type FarmToday,
  type Forecast,
  forecastSchema,
  thi,
  type Warning,
  warningsFor,
} from '@homefarm/contracts';

/**
 * What the forecast means for this farm.
 *
 * The rules are pure functions over a forecast and a handful of counts, which
 * is the reason they live in `contracts` — every threshold below is testable
 * without a database, a screen, or a network.
 *
 * **The assertions worth reading are the negative ones.** A warning that fires
 * is easy; a warning that stays quiet on an ordinary morning is the whole
 * design, because a strip that appears every day is one nobody reads by the
 * second week — and then it is not read on the morning it matters.
 */

const DAY = 86_400_000;
const NOW = Date.parse('2026-05-15T07:00:00Z');
const TODAY = dayStart(NOW);

function forecast(days: Record<string, unknown>[]): Forecast {
  return forecastSchema.parse({
    issuedAt: NOW,
    now: { condition: 'clear', tempDeciC: 100 },
    days: days.map((over, index) => ({
      day: TODAY + index * DAY,
      condition: 'clear',
      highDeciC: 180,
      lowDeciC: 80,
      rainChance: 0,
      rainUm: 0,
      ...over,
    })),
    hours: [],
  });
}

function farm(over: Partial<FarmToday> = {}): FarmToday {
  return { groups: [], uncoveredPlantings: 0, births: [], ...over };
}

const HENS = { id: 'g1', name: 'The hens', species: 'chicken' as const, count: 12 };
const COWS = { id: 'g2', name: 'The cows', species: 'cattle' as const, count: 4 };
const GOATS = { id: 'g3', name: 'The goats', species: 'goat' as const, count: 6 };
const ALPACAS = { id: 'g4', name: 'The alpacas', species: 'alpaca' as const, count: 3 };

function warn(days: Record<string, unknown>[], over: Partial<FarmToday> = {}): Warning[] {
  return warningsFor({ forecast: forecast(days), stale: false }, farm(over), NOW);
}

function kinds(warnings: Warning[]): string[] {
  return warnings.map((warning) => warning.kind);
}

describe('an ordinary day', () => {
  it('says nothing at all', () => {
    expect(
      warn([{}, {}], { groups: [HENS, COWS], uncoveredPlantings: 6 }),
    ).toEqual([]);
  });
});

describe('when there is nothing to go on', () => {
  it('says nothing without a forecast', () => {
    expect(warningsFor(null, farm({ groups: [HENS] }), NOW)).toEqual([]);
  });

  /**
   * **A stale forecast raises no warning.** The correct failure for a feature
   * whose whole promise is that it works offline: a confident sentence about a
   * night that has already happened is worse than silence, and this is the one
   * place staleness has to be handled — which is why warnings are not dues.
   */
  it('says nothing from a forecast that has gone stale', () => {
    const cold = { forecast: forecast([{ lowDeciC: -50 }]), stale: true };
    expect(warningsFor(cold, farm({ groups: [COWS], uncoveredPlantings: 6 }), NOW)).toEqual([]);
  });
});

describe('frost', () => {
  /**
   * Frost forms above freezing. NWS issues a Frost Advisory at 33–36°F because
   * on a still clear night the ground radiates and surfaces reach freezing
   * while the thermometer at head height does not. A threshold of exactly zero
   * would miss the nights that actually kill tomatoes.
   */
  it('warns at two degrees above freezing, not at zero', () => {
    expect(kinds(warn([{ lowDeciC: 15 }], { uncoveredPlantings: 6 }))).toContain('frost');
    expect(kinds(warn([{ lowDeciC: 25 }], { uncoveredPlantings: 6 }))).not.toContain('frost');
  });

  it('counts the plantings rather than naming which of them mind', () => {
    const [warning] = warn([{ lowDeciC: 10 }], { uncoveredPlantings: 6 });

    // The row the farm asked for. It defers the judgement to the person who
    // can make it: a keeper knows their own beds.
    expect(warning?.title).toBe('Frost tonight. You have 6 plantings in uncovered beds.');
  });

  it('says one planting rather than 1 plantings', () => {
    const [warning] = warn([{ lowDeciC: 10 }], { uncoveredPlantings: 1 });
    expect(warning?.title).toContain('1 planting in');
  });

  /** Nothing outside means nothing to lose. */
  it('stays quiet on a farm with nothing in an uncovered bed', () => {
    expect(warn([{ lowDeciC: -50 }], { uncoveredPlantings: 0 })).toEqual([]);
  });

  it('is an act below freezing and a watch above it', () => {
    expect(warn([{ lowDeciC: 15 }], { uncoveredPlantings: 2 })[0]?.severity).toBe('watch');
    expect(warn([{ lowDeciC: -10 }], { uncoveredPlantings: 2 })[0]?.severity).toBe('act');
  });
});

describe('water freezing', () => {
  it('warns once, for all the stock, when it goes below zero', () => {
    const warnings = warn([{ lowDeciC: -20 }], { groups: [HENS, COWS] });
    const freeze = warnings.filter((warning) => warning.kind === 'freeze');

    expect(freeze).toHaveLength(1);
    // The head count is the number that makes it matter.
    expect(freeze[0]?.detail).toContain('16 head');
  });

  it('does not warn a farm with no stock about its drinkers', () => {
    expect(kinds(warn([{ lowDeciC: -50 }], { uncoveredPlantings: 3 }))).not.toContain('freeze');
  });

  /** Water freezes at zero. There is no judgement in this one. */
  it('does not fire at one degree above', () => {
    expect(kinds(warn([{ lowDeciC: 10 }], { groups: [HENS] }))).not.toContain('freeze');
  });
});

describe('heat, which is three rules because the animals differ', () => {
  /**
   * Poultry have no sweat glands — they lose heat by panting and through the
   * comb, and both stop working as the air approaches body temperature.
   */
  it('warns about birds on dry heat a cow would shrug off', () => {
    const warnings = warn([{ highDeciC: 300 }], { groups: [HENS, COWS] });

    expect(kinds(warnings)).toContain('heat-poultry');
    // 30°C with no humidity figure: nothing for the cows, and nothing invented.
    expect(kinds(warnings)).not.toContain('heat-ruminant');
  });

  it('escalates for birds at the temperature heavy breeds start dying', () => {
    expect(warn([{ highDeciC: 300 }], { groups: [HENS] })[0]?.severity).toBe('watch');
    expect(warn([{ highDeciC: 360 }], { groups: [HENS] })[0]?.severity).toBe('act');
  });

  it('does not warn about birds on a warm afternoon', () => {
    expect(warn([{ highDeciC: 280 }], { groups: [HENS] })).toEqual([]);
  });

  /**
   * The reason THI exists: temperature alone lies. 32°C at 30% humidity is a
   * warm day; 32°C at 80% is dangerous, and an animal that cannot dump heat by
   * evaporation does not care which one the thermometer says.
   */
  it('separates a dry hot day from a humid one for ruminants', () => {
    // 25°C both times. Dry it is THI 69 and a pleasant afternoon; at 85% it is
    // THI 75 and a cow is already losing milk over it.
    expect(kinds(warn([{ highDeciC: 250, humidity: 20 }], { groups: [COWS] }))).not.toContain(
      'heat-ruminant',
    );
    expect(kinds(warn([{ highDeciC: 250, humidity: 85 }], { groups: [COWS] }))).toContain(
      'heat-ruminant',
    );
  });

  /**
   * **Humidity is optional and its absence must be silent.** It arrived after
   * the cache table did, so a forecast written by an older build has none —
   * and inventing one would produce a confident number nobody measured.
   */
  it('stays silent about ruminants when the forecast carried no humidity', () => {
    expect(kinds(warn([{ highDeciC: 380 }], { groups: [COWS, ALPACAS] }))).not.toContain(
      'heat-ruminant',
    );
    expect(kinds(warn([{ highDeciC: 380 }], { groups: [ALPACAS] }))).not.toContain(
      'heat-camelid',
    );
  });

  /**
   * Cattle feel it before goats do. A farm keeping both would otherwise be
   * warned about its goats every time its cows were merely uncomfortable.
   */
  it('warns about cattle at a heat load goats are still fine in', () => {
    const day = { highDeciC: 280, humidity: 70 };

    expect(kinds(warn([day], { groups: [COWS] }))).toContain('heat-ruminant');
    expect(kinds(warn([day], { groups: [GOATS] }))).not.toContain('heat-ruminant');
  });

  /**
   * Camelids get the rule their keepers use — °F plus humidity, 120 to watch
   * and 150 for an emergency. Running them through THI would put them
   * alongside sheep, which is exactly the mistake that kills alpacas.
   */
  it('warns about alpacas on their own scale', () => {
    // 27°C is 80.6°F; plus 45% humidity is under 126 — over the watch line.
    const warnings = warn([{ highDeciC: 270, humidity: 45 }], { groups: [ALPACAS] });

    expect(kinds(warnings)).toContain('heat-camelid');
    // And a sheep-scale rule would have said nothing at all here.
    expect(thi(270, 45)).toBeLessThan(79);
  });

  it('names the groups, and counts them past two', () => {
    const many = [HENS, { ...HENS, id: 'g9', name: 'The ducks', species: 'duck' as const }];
    expect(warn([{ highDeciC: 360 }], { groups: many })[0]?.title).toContain(
      'The hens and The ducks',
    );

    const lots = [...many, { ...HENS, id: 'g8', name: 'The geese', species: 'goose' as const }];
    expect(warn([{ highDeciC: 360 }], { groups: lots })[0]?.title).toContain('3 groups');
  });
});

describe('a cold night on an imminent birth', () => {
  const nutmeg = { key: 'b1:birth', title: 'Nutmeg due', at: TODAY + 3 * DAY };

  it('warns when both are true', () => {
    const [warning] = warn([{ lowDeciC: -30 }], { births: [nutmeg] });

    expect(warning?.kind).toBe('birth-cold');
    expect(warning?.title).toBe('Nutmeg due, and it is freezing tonight.');
    expect(warning?.severity).toBe('act');
  });

  it('says nothing about a cold night with no birth near it', () => {
    expect(kinds(warn([{ lowDeciC: -30 }], { births: [] }))).not.toContain('birth-cold');
  });

  it('says nothing about a birth on a mild night', () => {
    expect(kinds(warn([{ lowDeciC: 60 }], { births: [nutmeg] }))).not.toContain('birth-cold');
  });

  /**
   * A week, which is roughly the window in which "be around, and put a lamp
   * in" is a thing somebody can arrange. The `birth` due already carries six
   * weeks of notice for the pen-building half; this is the other question.
   */
  it('ignores a birth still a month out', () => {
    const later = { key: 'b2:birth', title: 'Clover due', at: TODAY + 30 * DAY };
    expect(kinds(warn([{ lowDeciC: -30 }], { births: [later] }))).not.toContain('birth-cold');
  });

  /**
   * ── The half of the window that did not exist ────────────────────────────
   *
   * The filter was `at >= today`, so a doe past her date got nothing — and past
   * her date is the ORDINARY case, not a closed one. `birthDue` emits a row only
   * while `bornAt` is unrecorded, so an `at` in the past means *she has not
   * kidded yet and nobody logged it*.
   *
   * `GESTATION_DAYS` says as much where it is declared: every figure there
   * *"varies by several days across breeds and conditions… The date is when to
   * be ready, not a promise."* A doe two days over on a −7 °C night was exactly
   * the farm this warning exists for, and it was silent.
   */
  it('warns for a doe who is past her date', () => {
    const overdue = { key: 'b3:birth', title: 'Nutmeg due', at: TODAY - 2 * DAY };
    const [warning] = warn([{ lowDeciC: -30 }], { births: [overdue] });

    expect(warning?.kind).toBe('birth-cold');
    expect(warning?.title).toBe('Nutmeg due, and it is freezing tonight.');
  });

  /** A week over, matching the variance those averages carry. */
  it('still warns a week past the date', () => {
    const overdue = { key: 'b4:birth', title: 'Nutmeg due', at: TODAY - 7 * DAY };
    expect(kinds(warn([{ lowDeciC: -30 }], { births: [overdue] }))).toContain('birth-cold');
  });

  /**
   * **Bounded, and not by accident.** A breeding record nobody ever closed would
   * otherwise raise a freezing-night warning every winter for ever — the
   * permanent-resident failure `due/types.ts` names, and the same one
   * `processingDue` had. Past a week the likelier readings are that she gave
   * birth unlogged or that something is wrong, and a weather warning helps with
   * neither.
   */
  it('gives up on a date long gone rather than shouting every winter', () => {
    const abandoned = { key: 'b5:birth', title: 'Clover due', at: TODAY - 40 * DAY };
    expect(kinds(warn([{ lowDeciC: -30 }], { births: [abandoned] }))).not.toContain('birth-cold');
  });
});

describe('the window', () => {
  /**
   * A frost forecast six days out is not reliable and not actionable —
   * nothing about tonight changes because next Tuesday looks cold.
   */
  it('is today and tomorrow, and no further', () => {
    const days = [{}, {}, { lowDeciC: -50 }, { lowDeciC: -50 }];
    expect(warn(days, { uncoveredPlantings: 4 })).toEqual([]);
  });

  it('names tomorrow as tomorrow', () => {
    const [warning] = warn([{}, { lowDeciC: -20 }], { uncoveredPlantings: 4 });
    expect(warning?.title).toContain('tomorrow night');
  });

  /** A forecast still carrying yesterday must not warn about a night that has been. */
  it('ignores a day that has already gone', () => {
    const stale = forecastSchema.parse({
      issuedAt: NOW,
      now: { condition: 'clear', tempDeciC: 100 },
      days: [
        {
          day: TODAY - DAY,
          condition: 'clear',
          highDeciC: 180,
          lowDeciC: -50,
          rainChance: 0,
          rainUm: 0,
        },
      ],
      hours: [],
    });

    expect(warningsFor({ forecast: stale, stale: false }, farm({ uncoveredPlantings: 4 }), NOW))
      .toEqual([]);
  });
});

describe('the order they are read in', () => {
  it('puts what must be done now above what to keep an eye on', () => {
    // Freezing (act) and a frost watch cannot co-occur, so: a poultry watch
    // alongside a freeze act.
    const warnings = warn([{ highDeciC: 300, lowDeciC: -20 }], { groups: [HENS] });

    expect(warnings[0]?.severity).toBe('act');
    expect(warnings.at(-1)?.severity).toBe('watch');
  });

  it('is stable across recomputations', () => {
    const days = [{ highDeciC: 300, lowDeciC: -20 }, { lowDeciC: -20 }];
    const once = warn(days, { groups: [HENS, COWS], uncoveredPlantings: 3 });
    const twice = warn(days, { groups: [HENS, COWS], uncoveredPlantings: 3 });

    expect(once.map((warning) => warning.key)).toEqual(twice.map((warning) => warning.key));
    // Keys are unique, so a list re-rendered every few seconds keeps its React
    // keys and cannot draw the same row twice.
    expect(new Set(once.map((warning) => warning.key)).size).toBe(once.length);
  });
});

/**
 * Reported from a handset: two heat warnings, four lines each, filling the
 * screen above the egg tally. One hot spell had become two rows saying the
 * same thing in different tenses.
 *
 * That is the failure `TodayScreen` already records about the due list —
 * *"three groups of routine look-overs filled the screen and the egg tally
 * started below the fold"* — made a second time, with warnings.
 *
 * The answer is emphatically NOT a dismiss button. A dismissed safety warning
 * is the app agreeing to be silent about conditions that are still live, it
 * needs stored state that either does not follow the farm to a second phone or
 * becomes a mutable entity for something that expires in a day, and it is the
 * completion flag the due engine refuses wearing another name.
 */
describe('the same warning on both days', () => {
  const HOT = { highDeciC: 360 };

  it('is one row that names both days', () => {
    const warnings = warn([HOT, HOT], { groups: [HENS] });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.title).toBe('Dangerous heat today and tomorrow for The hens.');
    // And the detail is said once rather than twice.
    expect(warnings[0]?.detail).toContain('Birds cannot sweat');
  });

  it('dates itself from the first of the two days', () => {
    expect(warn([HOT, HOT], { groups: [HENS] })[0]?.at).toBe(TODAY);
  });

  /** Nights are nights. "Frost today" is not what anybody says out loud. */
  it('says nights as nights', () => {
    const [warning] = warn([{ lowDeciC: -20 }, { lowDeciC: -20 }], { groups: [HENS] });
    expect(warning?.title).toBe('Below freezing tonight and tomorrow night. Waterers will ice over.');
  });

  /**
   * A watch today and an act tomorrow stay two rows. "Dangerous heat today and
   * tomorrow" would be overstating today, and a warning that overstates is one
   * people learn to discount.
   */
  it('does not fold a watch into an act', () => {
    const warnings = warn([{ highDeciC: 300 }, { highDeciC: 360 }], { groups: [HENS] });

    expect(warnings).toHaveLength(2);
    expect(warnings.map((one) => one.severity)).toEqual(['act', 'watch']);
    expect(warnings.find((one) => one.severity === 'act')?.title).toContain('tomorrow');
    expect(warnings.find((one) => one.severity === 'watch')?.title).toContain('today');
  });

  it('does not fold two different warnings that happen to share a night', () => {
    const warnings = warn([{ lowDeciC: -20 }], { groups: [HENS], uncoveredPlantings: 3 });
    expect(kinds(warnings).sort()).toEqual(['freeze', 'frost']);
  });

  /**
   * The heat index is deliberately not in the detail line. It moves a point
   * between today and tomorrow, which would make two otherwise identical
   * warnings refuse to fold — the same sentence twice over a number nobody can
   * act on.
   */
  it('folds a humid spell whose index drifts by a degree', () => {
    const warnings = warn(
      [
        { highDeciC: 300, humidity: 70 },
        { highDeciC: 305, humidity: 72 },
      ],
      { groups: [COWS] },
    );

    expect(warnings.filter((one) => one.kind === 'heat-ruminant')).toHaveLength(1);
  });

  /**
   * Two does due the same week are two rows on the same freezing night, and a
   * key of kind-plus-day would give them the same React key.
   */
  it('keeps two births on one night apart', () => {
    const warnings = warn([{ lowDeciC: -30 }], {
      births: [
        { key: 'b1:birth', title: 'Nutmeg due', at: TODAY + DAY },
        { key: 'b2:birth', title: 'Clover due', at: TODAY + 2 * DAY },
      ],
    });

    expect(warnings).toHaveLength(2);
    expect(new Set(warnings.map((one) => one.key)).size).toBe(2);
  });

  /** A birth eight days out is not imminent because tomorrow happens to be cold. */
  it('measures the birth window from today, not from the day being examined', () => {
    const justOutside = { key: 'b1:birth', title: 'Nutmeg due', at: TODAY + 8 * DAY };
    expect(kinds(warn([{ lowDeciC: -30 }, { lowDeciC: -30 }], { births: [justOutside] })))
      .not.toContain('birth-cold');
  });
});

describe('the two indices, checked against their published figures', () => {
  /**
   * NRC (1971): THI = (1.8T + 32) − (0.55 − 0.0055 × RH)(1.8T − 26).
   *
   * Worked by hand: 30°C at 60% is 86 − 0.22 × 28 = 79.84, which is past the
   * point of real production loss in a dairy cow. Dry, the same 30°C is 73.7 —
   * still over the onset of mild stress at 72, which is the figure itself
   * being informative: cattle feel 30°C whatever the air is doing.
   */
  it('computes THI as the dairy literature does', () => {
    expect(thi(300, 60)).toBeCloseTo(79.84, 2);
    expect(thi(300, 20)).toBeCloseTo(73.68, 2);
    // Humidity only ever adds. Same heat, wetter air, higher load.
    expect(thi(300, 90)).toBeGreaterThan(thi(300, 10));
  });

  it('computes the camelid index as degrees Fahrenheit plus humidity', () => {
    // 30°C is 86°F.
    expect(Math.round(camelidHeatIndex(300, 40))).toBe(126);
  });
});

/**
 * The county list, which was the single biggest thing on a farmer's screen.
 *
 * Reported twice from a handset: two heat products in force, each drawing
 * nineteen counties in its COLLAPSED row, so the strip ran from the top of
 * Today to below the fold all day. The list is metadata — a farm knows which
 * county it is in — and it is still there in full on the opened row.
 */
describe('how much ground an alert covers', () => {
  it('names the first and counts the rest', () => {
    expect(alertCoverage('Bourbon; Crawford; Cherokee; Benton')).toBe('Bourbon and 3 more');
  });

  it('says one or two in full, because a count would be longer', () => {
    expect(alertCoverage('Riley County, KS')).toBe('Riley County, KS');
    expect(alertCoverage('Riley; Geary')).toBe('Riley, Geary');
  });

  it('shortens the real thing to one line', () => {
    // Verbatim from the screenshot that prompted this.
    const real =
      'Bourbon; Crawford; Cherokee; Benton; Morgan; Miller; Maries; Vernon; St. Clair; ' +
      'Hickory; Camden; Barton; Cedar; Polk; Dallas; Jasper; Dade; Newton; Lawrence; McDonald';

    expect(alertCoverage(real)).toBe('Bourbon and 19 more');
    expect(alertCoverage(real).length).toBeLessThan(30);
  });

  it('survives the shapes a feed actually sends', () => {
    // Trailing separators and doubled spaces are ordinary in areaDesc.
    expect(alertCoverage('Riley; Geary; ')).toBe('Riley, Geary');
    expect(alertCoverage('')).toBe('');
  });
});


/**
 * Three cards about one afternoon, reported from a handset.
 *
 * An Extreme Heat Watch, an Extreme Heat Warning, and the app's own "Dangerous
 * heat today and tomorrow for Austies" - filling the screen above the tally the
 * app is opened for. The first two are the service upgrading its own product;
 * the third is this app agreeing with it at length.
 */
describe('one weather event, one card', () => {
  const alert = (id: string, event: string, over: Partial<Alert> = {}): Alert => ({
    id,
    event,
    severity: 'severe',
    ...over,
  });

  it('drops a watch the service has already upgraded to a warning', () => {
    const shown = liveAlerts(
      [alert('a', 'Extreme Heat Watch'), alert('b', 'Extreme Heat Warning')],
      1_000,
    );

    expect(shown.map((a) => a.event)).toEqual(['Extreme Heat Warning']);
  });

  it('keeps a watch for a hazard nothing has warned about', () => {
    // A tornado watch beside a flood warning is two real things.
    const shown = liveAlerts(
      [alert('a', 'Tornado Watch'), alert('b', 'Flood Warning')],
      1_000,
    );

    expect(shown).toHaveLength(2);
  });

  it('keeps a lone watch, because a maybe is still worth saying', () => {
    expect(liveAlerts([alert('a', 'Winter Storm Watch')], 1_000)).toHaveLength(1);
  });

  it('leaves an event it cannot parse alone', () => {
    // Better a duplicate than a dropped warning: anything not named
    // "<hazard> <tier>" survives untouched.
    const shown = withoutSupersededWatches([alert('a', 'Special Weather Statement'), alert('b', 'Air Quality Alert')]);
    expect(shown).toHaveLength(2);
  });
});

describe('what the app stops saying itself', () => {
  const alert = (event: string): Alert => ({ id: event, event, severity: 'severe' });

  it('stands down on heat when the service has warned about heat', () => {
    expect(hazardsCoveredByAlerts([alert('Extreme Heat Warning')]).has('heat')).toBe(true);
  });

  it('does not stand down for a watch, which is only a maybe', () => {
    // The derived row claims it IS happening. So does a warning; a watch does
    // not, so the app's own opinion is still worth having beside it.
    expect(hazardsCoveredByAlerts([alert('Excessive Heat Watch')].filter(Boolean)).size).toBe(0);
  });

  it('covers only the hazard named, never the whole strip', () => {
    const covered = hazardsCoveredByAlerts([alert('Frost Advisory')]);

    expect(covered.has('frost')).toBe(true);
    expect(covered.has('heat')).toBe(false);
    expect(covered.has('freeze')).toBe(false);
  });

  it('says nothing is covered when nothing is in force', () => {
    expect(hazardsCoveredByAlerts([]).size).toBe(0);
  });
});
