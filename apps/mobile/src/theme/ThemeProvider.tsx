import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { THEMES, type Theme, type ThemeName } from './tokens';

/**
 * Lamplight — UX-SPEC §6, the first of the six places warmth is allowed.
 *
 * Three themes, not two. Bright sun is an attribute selector on the web and
 * simply a third theme here: warmth yields to legibility, never the reverse.
 *
 * The override is session-scoped, exactly as on web. It is not persisted, so
 * the next cold start follows the system again — which matches what the toggle
 * is *for*, the hour before sunrise when the phone still thinks it is day.
 * Persisting a display preference belongs with the SQLite settings table, not
 * here.
 */

export type { ThemeName };

export function systemTheme(prefersDark: boolean): ThemeName {
  return prefersDark ? 'lamplight' : 'daylight';
}

/**
 * The lamp toggles between the two ambient themes and never lands on `sun`.
 *
 * Bright sun is a legibility override, not a time of day — cycling into it
 * from a two-state control would put someone in high-contrast mode by accident
 * at 5am, which is the opposite of what they reached for.
 */
export function otherTheme(theme: ThemeName): ThemeName {
  return theme === 'lamplight' ? 'daylight' : 'lamplight';
}

/**
 * The control names its destination, not its current state.
 *
 * A toggle labelled with where you already are is the most common way to make
 * someone tap twice to find out what it does, and this one is tapped in the
 * dark with cold hands.
 */
export function toggleLabel(current: ThemeName): string {
  if (current === 'sun') return 'Leave bright sun';
  return current === 'lamplight' ? 'Switch to daylight' : 'Switch to lamplight';
}

export interface ThemeValue {
  theme: ThemeName;
  colors: Theme;
  toggle: () => void;
  /** Bright sun is set explicitly, never reached by toggling. */
  setTheme: (theme: ThemeName | null) => void;
  /**
   * What was chosen, as opposed to what is being shown — null while the
   * system decides.
   *
   * A control that offers "follow the phone" cannot render its own state from
   * `theme` alone: at night, following the phone and choosing lamplight both
   * resolve to lamplight, and the control would show the wrong row selected
   * for one of them.
   */
  override: ThemeName | null;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [override, setOverride] = useState<ThemeName | null>(null);
  const scheme = useColorScheme();

  // Until someone overrides it, sunrise while the app is open just happens.
  const theme = override ?? systemTheme(scheme === 'dark');

  const toggle = useCallback(() => setOverride(otherTheme(theme)), [theme]);

  const value = useMemo<ThemeValue>(
    () => ({ theme, colors: THEMES[theme], toggle, setTheme: setOverride, override }),
    [theme, toggle, override],
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
