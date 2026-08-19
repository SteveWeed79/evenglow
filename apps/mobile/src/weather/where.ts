import {
  Accuracy,
  getCurrentPositionAsync,
  requestForegroundPermissionsAsync,
} from 'expo-location';
import { roundPosition } from '@homefarm/contracts';
import { findPlace, type Place, type Position } from '@homefarm/core/weather';

/**
 * Finding out where the farm is, the two ways offered.
 *
 * ## Rounded before anything keeps it
 *
 * A farm's coordinates identify a family's home. Two decimals is about a
 * kilometre — ample for a forecast, useless for finding a door — and the
 * rounding happens **here**, on the way out of the device, so there is nowhere
 * in this app that ever holds the precise value. That is the only way the
 * promise in `roundPosition` actually holds: a comment on the storage layer
 * would not stop a screen keeping the original.
 *
 * ## Why typing is offered at all
 *
 * A permission somebody has denied is a dead end for the whole feature, and
 * "go to Settings, find the app, find Location" is not an instruction a farm
 * should need. The address search is the way back, and it asks the OS for
 * nothing.
 */

export type { Place, Position };
export { findPlace };

export type Located =
  | { kind: 'found'; at: Position }
  /** The permission was refused. Not an error — the typed path still works. */
  | { kind: 'refused' }
  /** Granted, and the fix failed anyway. Indoors, usually. */
  | { kind: 'unavailable' };

export async function locate(): Promise<Located> {
  const permission = await requestForegroundPermissionsAsync();
  if (!permission.granted) return { kind: 'refused' };

  try {
    /**
     * `Low` is about a kilometre, which is exactly what is kept — asking for
     * metres costs battery and a longer fix for precision thrown away on the
     * next line. It was a bare `3` (Balanced); the name says why.
     */
    const fix = await getCurrentPositionAsync({ accuracy: Accuracy.Low });
    return { kind: 'found', at: roundPosition(fix.coords.latitude, fix.coords.longitude) };
  } catch {
    return { kind: 'unavailable' };
  }
}
