import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LAYOUT } from '../theme/tokens';
import { hasRail, widthClass, windowClass, type WindowClass } from '../theme/window';

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
export function useWindow({ bar = false }: { bar?: boolean } = {}): WindowClass {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  /**
   * `bar` is "this screen has the tab bar under it", which above the expanded
   * boundary means "and it is a rail beside it, taking 96dp of my width".
   *
   * Composed here rather than inside `windowClass` on purpose: the pure
   * function stays general and takes a plain number, and the app-specific
   * question of *which* chrome is standing where is answered in the one place
   * that can see both the window and the screen asking.
   *
   * A pushed screen passes nothing, because it has neither.
   */
  const chrome =
    bar && hasRail(widthClass(width - insets.left - insets.right)) ? LAYOUT.rail : 0;

  return windowClass(width, height, { insets, chrome });
}
