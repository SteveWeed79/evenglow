import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { daylight, lamplight, type Surfaces } from './tokens';

/**
 * Lamplight — UX-SPEC §6, the first of the six places warmth is allowed.
 *
 * The pure helpers live in `theme.ts` and are shared with the web build. This
 * is only the plumbing: what the device asks for, what the header toggle says
 * instead, and the surfaces that fall out.
 *
 * The override stays session-scoped, exactly as on web. It is not persisted,
 * so the next cold start follows the system again — which matches what the
 * toggle is *for*, the hour before sunrise when the phone still thinks it is
 * day. Persisting a display preference belongs with the SQLite settings table
 * in R2, not here.
 */

export type Theme = 'daylight' | 'lamplight';

export function systemTheme(prefersDark: boolean): Theme {
  return prefersDark ? 'lamplight' : 'daylight';
}

export function otherTheme(theme: Theme): Theme {
  return theme === 'lamplight' ? 'daylight' : 'lamplight';
}

/**
 * The control names its destination, not its current state.
 *
 * A toggle labelled with where you already are is the most common way to make
 * someone tap twice to find out what it does, and this one is tapped in the
 * dark with cold hands.
 */
export function toggleLabel(current: Theme): string {
  return current === 'lamplight' ? 'Switch to daylight' : 'Switch to lamplight';
}

export interface ThemeValue {
  theme: Theme;
  colors: Surfaces;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [override, setOverride] = useState<Theme | null>(null);
  const scheme = useColorScheme();

  // Until someone overrides it, sunrise while the app is open just happens.
  const theme = override ?? systemTheme(scheme === 'dark');

  const toggle = useCallback(() => setOverride(otherTheme(theme)), [theme]);

  const value = useMemo<ThemeValue>(
    () => ({ theme, colors: theme === 'lamplight' ? lamplight : daylight, toggle }),
    [theme, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  // Throwing beats a silent daylight default: a screen rendered outside the
  // provider would look correct at noon and wrong at 5am, which is the worst
  // way to find out.
  if (!value) throw new Error('useTheme called outside ThemeProvider');
  return value;
}
