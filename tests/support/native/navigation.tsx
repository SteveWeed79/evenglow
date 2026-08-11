import { createElement, type ReactNode } from 'react';

/**
 * React Navigation, reduced to the thing a screen actually uses: somewhere to
 * go, and a record of having gone there.
 *
 * The real navigator is not what these tests are about. Whether `Root.tsx`
 * wires 32 routes correctly is a question the typed param list already answers
 * at compile time; whether a screen pushes the RIGHT route with the RIGHT id
 * is a question only a running screen can answer, and that is what this
 * records.
 */

export interface NavCall {
  action: 'navigate' | 'goBack' | 'popTo' | 'push' | 'replace';
  route?: string;
  params?: unknown;
}

let calls: NavCall[] = [];
let backable = true;

export function navCalls(): NavCall[] {
  return calls;
}

export function resetNav(): void {
  calls = [];
  backable = true;
}

/** Empty the stack, as an edge-swipe back mid-save does. */
export function setBackable(next: boolean): void {
  backable = next;
}

const navigation = {
  navigate: (route: string, params?: unknown) => calls.push({ action: 'navigate', route, params }),
  push: (route: string, params?: unknown) => calls.push({ action: 'push', route, params }),
  replace: (route: string, params?: unknown) => calls.push({ action: 'replace', route, params }),
  popTo: (route: string) => calls.push({ action: 'popTo', route }),
  goBack: () => calls.push({ action: 'goBack' }),
  setOptions: () => undefined,
  addListener: () => () => undefined,
  isFocused: () => true,
  /**
   * Settable, because "there is nothing to go back to" is a real state and the
   * one that produced `GO_BACK was not handled by any navigator` on a tablet.
   * A double that always says yes cannot express the case worth testing.
   */
  canGoBack: () => backable,
};

/** The recorder itself, for scaffolding that is not inside a component. */
export function navigator<T>(): T {
  return navigation as T;
}

export function useNavigation<T>(): T {
  return navigation as T;
}

export function useRoute<T>(): T {
  return { key: 'test', name: 'Test', params: {} } as T;
}

export function useIsFocused(): boolean {
  return true;
}

export function useFocusEffect(): void {
  // The screens under test read through the engine's subscription rather than
  // on focus, so there is nothing to fire.
}

export function NavigationContainer({ children }: { children?: ReactNode }): React.ReactElement {
  return createElement('NavigationContainer', null, children);
}

export function createNativeStackNavigator(): unknown {
  throw new Error('Screen tests render screens directly; they do not build a navigator.');
}

export function createBottomTabNavigator(): unknown {
  throw new Error('Screen tests render screens directly; they do not build a navigator.');
}
