import { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootParamList } from '../navigation/Root';

/**
 * The stack, typed.
 *
 * Every screen needs it and every screen would otherwise restate the same
 * generic — which is exactly the sort of repetition that ends with one file
 * typing it as `any` and losing the route-name checking that makes a
 * misspelled `navigate('Treatmnet')` a compile error rather than a dead tap.
 */
export function useNav(): NativeStackNavigationProp<RootParamList> {
  return useNavigation<NativeStackNavigationProp<RootParamList>>();
}

/**
 * Leaving a screen once its work is durable, without assuming there is a
 * screen behind it.
 *
 * ## The warning this exists for
 *
 *   The action 'GO_BACK' was not handled by any navigator.
 *   Is there any screen to go back to?
 *
 * From a tablet, on the first day the app ran on one. Twenty-eight call sites
 * did `useSaver(useCallback(() => nav.goBack(), [nav]))` — correct in the
 * ordinary case and unguarded in every other.
 *
 * **The one that made it show up is device-shaped.** A save is awaited, and on
 * a handset an edge-swipe back is the natural way to leave a screen you have
 * finished with. Swipe during the save and the screen pops; the save lands a
 * moment later and calls `goBack` on a stack that no longer has anything to
 * pop. An emulator has the same gesture and nobody uses it, which is why this
 * survived every run until now.
 *
 * A save must never fail to leave the screen. So: go back when there is
 * somewhere to go, and otherwise land on the tabs, which is the one
 * destination that always exists.
 */
export function useLeave(): () => void {
  const nav = useNav();
  return useCallback(() => {
    if (nav.canGoBack()) {
      nav.goBack();
      return;
    }
    nav.navigate('Tabs');
  }, [nav]);
}
