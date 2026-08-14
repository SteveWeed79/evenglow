import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';
import { readLook, writeLook } from './look';
import { THEMES, type Theme, type ThemeName } from './tokens';

/**
 * Lamplight — UX-SPEC §6, the first of the six places warmth is allowed.
 *
 * Three themes, not two. Bright sun is an attribute selector on the web and
 * simply a third theme here: warmth yields to legibility, never the reverse.
 *
 * ## Toggling and choosing are different acts
 *
 * The **lamp toggle** is session-scoped and stays that way. It exists for the
 * hour before sunrise when the phone still thinks it is day, and a temporary
 * answer to a temporary problem should not outlive the morning.
 *
 * The **row in Settings** is somebody stating a preference, and that is kept.
 * It was not, and the difference had never been drawn: *"I selected lamplight
 * and shut the app down and when I loaded the app again it was back on follow
 * the device."* This file already knew — *"persisting a display preference
 * belongs with the SQLite settings table"* — so the behaviour was understood
 * and the other half was never built. See `look.ts` for why it is a file on the
 * device rather than the settings table that sentence imagined.
 *
 * The read is async and nothing waits on it, because nothing has to: the splash
 * is held until `start()` finishes opening SQLite and refreshing the session,
 * and a one-file read settles long before that. Were it ever to lose that race
 * the cost is a frame of daylight at 5am, which is precisely what lamplight
 * exists to prevent — so if the splash ever stops covering boot, this wants
 * revisiting rather than leaving to luck.
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

  // What this handset was last told to wear. `undefined` means nothing was
  // ever chosen, which is not the same as choosing to follow the device — and
  // `readLook` keeps them apart so a stored `null` is honoured as the answer
  // it is rather than read as a missing one.
  useEffect(() => {
    void readLook().then((look) => {
      if (look !== undefined) setOverride(look);
    });
  }, []);

  // Until someone overrides it, sunrise while the app is open just happens.
  const theme = override ?? systemTheme(scheme === 'dark');

  /** The lamp. Deliberately not written down — see the header. */
  const toggle = useCallback(() => setOverride(otherTheme(theme)), [theme]);

  /**
   * The Settings row, which is a decision rather than a moment.
   *
   * The state moves first and the write is not awaited: somebody who asked for
   * lamplight gets lamplight now, and whether the disk cooperated is a question
   * about the *next* launch. `writeLook` swallows its own failures for the same
   * reason.
   */
  const choose = useCallback((next: ThemeName | null) => {
    setOverride(next);
    void writeLook(next);
  }, []);

  const value = useMemo<ThemeValue>(
    () => ({ theme, colors: THEMES[theme], toggle, setTheme: choose, override }),
    [theme, toggle, choose, override],
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
