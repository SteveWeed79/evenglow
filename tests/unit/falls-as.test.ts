import { describe, expect, it } from 'vitest';
import { CONDITIONS, fallsAs } from '@steading/contracts';

/**
 * What the chance is a chance **of**.
 *
 * `rainChance` is NWS's `probabilityOfPrecipitation`, and the field name has
 * been quietly wrong about that since it was written: what falls at −6 °C is
 * snow. Asked from the phone — *"how do we handle snow?"* — and this is the
 * rule that answers it, in one place, so the day row and anything after it
 * cannot decide it differently.
 *
 * Temperatures here are deci-Celsius, the canonical unit: `-60` is −6 °C.
 */

const FREEZING = 0;

describe('when the sky says what is falling', () => {
  it('calls snow snow', () => {
    expect(fallsAs('snow', 120)).toBe('Snow');
  });

  /**
   * Even in a thaw. A forecast of snow at 12 °C is a forecast office saying
   * something this app is in no position to second-guess, and the temperature
   * fallback exists for the days the condition is silent — not to overrule it.
   */
  it('does not argue with a snow forecast on a mild day', () => {
    expect(fallsAs('snow', 120)).toBe('Snow');
  });

  it.each(['rain', 'drizzle', 'storm'] as const)('calls %s rain', (condition) => {
    expect(fallsAs(condition, 150)).toBe('Rain');
  });
});

describe('when the sky does not say', () => {
  /** A day that never climbs above freezing cannot rain. Arithmetic, not a forecast. */
  it.each(['clear', 'cloud', 'fog'] as const)(
    'reads a %s day that stays below freezing as snow',
    (condition) => {
      expect(fallsAs(condition, -60)).toBe('Snow');
    },
  );

  it('counts exactly freezing as snow', () => {
    expect(fallsAs('cloud', FREEZING)).toBe('Snow');
  });

  it('reads a degree above freezing as rain', () => {
    expect(fallsAs('cloud', 10)).toBe('Rain');
  });

  /**
   * The high, not the low, and this is the case that pins it.
   *
   * A day that froze at dawn and reaches 8 °C by afternoon is a day rain is
   * possible on. Breaking the tie on the low would call that snow, which is the
   * app inventing weather rather than reading it.
   */
  it('does not call a frosty morning snow when the day warms up', () => {
    expect(fallsAs('cloud', 80)).toBe('Rain');
  });

  /**
   * By evening today's daytime period is gone and the high is genuinely absent
   * — the same missing half that produced the reported "79° 79°". Rain is the
   * commoner answer and the one that does not require a number nobody has.
   */
  it('says rain when there is no high to go on', () => {
    expect(fallsAs('cloud', undefined)).toBe('Rain');
  });
});

describe('the rule as a whole', () => {
  /** Every condition answers, so a new one cannot slip through as undefined. */
  it('has an answer for every condition in the enum', () => {
    for (const condition of CONDITIONS) {
      expect(['Rain', 'Snow']).toContain(fallsAs(condition, 100));
      expect(['Rain', 'Snow']).toContain(fallsAs(condition, undefined));
    }
  });
});
