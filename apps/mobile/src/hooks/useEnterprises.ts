import { ENTERPRISES, type Enterprise } from '@steading/contracts';
import { readSite } from '@steading/core/read/growing';
import { useLive } from './useLive';

/**
 * What this farm runs, for the screens that change shape because of it.
 *
 * Read from the site through the local projection, so it is right with the
 * radio off and follows along when the setting is changed on another device —
 * two hands on one farm should not be looking at two different apps.
 *
 * **Everything, until a farm says otherwise.** `useLive` returns null while the
 * first read is in flight, and a null that meant "no enterprises" would blink
 * the tab bar down to one tab on every cold start. A farm that has never
 * opened the setting is also every farm that exists today.
 */
export function useEnterprises(): readonly Enterprise[] {
  const site = useLive(readSite, 'your farm');
  return site?.enterprises ?? ENTERPRISES;
}
