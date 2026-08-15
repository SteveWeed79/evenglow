import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { windowClass, type WindowClass } from '../theme/window';

/**
 * How much room this screen has, right now.
 *
 * The decision is in `theme/window.ts` — pure, and tested there. This is only
 * the part that has to ask React Native, and it is the counterpart to
 * `useRotation`: that one reads the **screen**, because whether a device may
 * turn is a fact about the display; this reads the **window**, because what a
 * layout may draw is a fact about the box it was given.
 *
 * `useWindowDimensions` rather than a `Dimensions` subscription, because it
 * already re-renders on change — which is what a split-screen divider being
 * dragged, a freeform window being resized and a foldable being opened all
 * look like from in here.
 *
 * The horizontal insets go in before anything is classified. A display cutout
 * on the left edge of a tablet in landscape is width the app may not draw
 * into, and a layout that counted it would promise a pane the safe area cannot
 * hold.
 */
export function useWindow(): WindowClass {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  /**
   * No `chrome` yet, because nothing is standing in the width.
   *
   * The navigation rail will be, and `LAYOUT.rail` is already declared for it
   * — but a rail that is not drawn must not be reserved for, or every hub
   * would lay out 80dp narrower than the room it actually has. This is the one
   * place that learns about it when it lands.
   */
  return windowClass(width, height, { insets });
}
