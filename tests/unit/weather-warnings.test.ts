import { describe, expect, it } from 'vitest';
import {
  camelidHeatIndex,
  dayStart,
  type FarmToday,
  type Forecast,
  forecastSchema,
  thi,
  type Warning,
  warningsFor,
} from '@steading/contracts';

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
