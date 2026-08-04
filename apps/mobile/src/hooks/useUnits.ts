import type { Currency, UnitSystem } from '@steading/contracts';
import { DEFAULT_CURRENCY, DEFAULT_UNIT_SYSTEM } from '@steading/contracts';
import { readSiteOrBlank } from '@steading/core/read/growing';
import { useLive } from './useLive';

/**
 * Which units this farm reads in.
 *
 * ## The inconsistency this closes
 *
 * The setting existed, was on the site record, and was honoured by exactly one
 * screen — the forecast. Everywhere a weight appeared it was `formatMass(ug,
 * 'imperial')`, hardcoded, so a metric farm that set the switch got Celsius on
 * the weather screen and pounds on the scales. That is worse than never having
 * offered the choice: a setting that half works teaches somebody it does not
 * work, and they stop trusting the other ones too.
 *
 * ## Never null
 *
 * `useLive` answers `null` for "not read yet" and a screen cannot tell that
 * apart from a genuine absence — the trap `readSiteOrBlank` was written for,
 * and one this app has now shipped three times. A unit system has a sensible
 * default and no meaningful absent state, so this collapses the union and hands
 * back {@link DEFAULT_UNIT_SYSTEM} until the store answers.
 *
 * The cost is one frame of imperial on a metric farm before the site read
 * lands. The alternative is every weight on every screen holding blank until a
 * disk read finishes, which is a worse trade for a screen read at arm's length.
 */
export function useUnits(): UnitSystem {
  const site = useLive(readSiteOrBlank, 'your units');
  return site?.units ?? DEFAULT_UNIT_SYSTEM;
}

/**
 * What the farm keeps its books in.
 *
 * Same shape and same reasoning as {@link useUnits}: a farm-wide reading
 * preference off the site record, with a default rather than a null, because
 * every screen that shows a price can show one before a disk read lands.
 *
 * A currency belongs to the farm and never to a record. A sack priced in
 * dollars and one in pounds cannot be added, and a shelf total across them
 * would be a lie told confidently.
 */
export function useCurrency(): Currency {
  const site = useLive(readSiteOrBlank, 'your currency');
  return site?.currency ?? DEFAULT_CURRENCY;
}
