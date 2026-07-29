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
